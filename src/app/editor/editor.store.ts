import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, debounceTime, from, switchMap, tap } from 'rxjs';
import { db, getClipFile, musicKey, storeClipFile } from '../core/db';
import { analyzeFaces } from '../core/face-tracker';
import {
  AUDIO_ACCEPT,
  VIDEO_ACCEPT,
  downloadBlob,
  pickFile,
  pickFiles,
  pickSaveTarget,
  queryReadPermission,
  requestReadPermission,
} from '../core/file-access';
import { ProjectsService, skippedNotice } from '../core/projects.service';
import { WorkersService, proxy } from '../core/workers.service';
import {
  ANALYSIS_SAMPLE_RATE,
  FRAME_RATE,
  PEAKS_RATE,
  SILENCE_PRESETS,
  type SilencePreset,
  concatAligned,
  detectDeadAir,
  detectSilences,
  detectSilencesFromWords,
  duckingEnvelope,
  hasVoice,
  levelingGain,
  suggestThreshold,
  whisperChunks,
} from '../engine/audio-analysis';
import { isFiller } from '../engine/fillers';
import { smoothFaceTrack } from '../engine/framing';
import {
  type AspectFormat,
  type AudioAnalysis,
  type Cut,
  type FacePoint,
  type FramingMode,
  type Project,
  type Rotation,
  type SilenceSettings,
  type WhisperModel,
  type Word,
  clipHasVoice,
  defaultCaptionWords,
  fingerprint,
  migrateProject,
  uid,
} from '../engine/model';
import { moveItem, placeClips, remapTimeline } from '../engine/sequence';
import { aspectRatio, rotatedSize, zoomBeats } from '../engine/render';
import { buildCaptionPages, keptSegments, nextKeptTime, removedRanges, totalDuration } from '../engine/timeline-math';
import type { AiDevice, RawWord } from '../workers/worker-types';

/** Shortest cut, in seconds (also the minimum length of a timeline region). */
export const MIN_CUT = 0.05;

/** Samples of a clip rated by Whisper to tell whether someone speaks in it. */
const VOICE_SAMPLES = 6;

/** Per clip: `missing` = no stored handle (browser without File System Access), `moved` = handle broken. */
export type ClipStatus = 'loading' | 'ready' | 'permission' | 'missing' | 'moved' | 'error';
export type FileState = 'loading' | 'ready' | 'reconnect' | 'missing-project';
export type MusicState = 'none' | 'ready' | 'permission' | 'relocate';
export type SaveState = 'saved' | 'saving' | 'error';

export type ExportState =
  | { status: 'idle' }
  | { status: 'running'; progress: number; startedAt: number }
  | { status: 'done'; name: string; streamed: boolean; seconds: number }
  | { status: 'error'; message: string };

export interface TaskProgress {
  stage: 'audio' | 'download' | 'transcribe';
  progress: number;
}

/** Audio analysis of the whole sequence, built from the cached per-clip analyses. */
export interface SequenceAnalysis {
  duration: number;
  peaks: Float32Array;
  peaksRate: number;
  frameDb: Float32Array;
  frameRate: number;
  suggestedThresholdDb: number;
}

/** Implemented by the preview, which owns the <video> elements. */
export interface PlayerApi {
  seek(t: number): void;
  toggle(): void;
}

/** Auto edit: one click that chains every automatic tool with good defaults. */
export type AutoStepId = 'analyze' | 'voice' | 'transcribe' | 'fillers' | 'silences' | 'framing' | 'style';
export type AutoStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface AutoEditOptions {
  format: AspectFormat;
  rhythm: SilencePreset;
  silences: boolean;
  fillers: boolean;
  captions: boolean;
  framing: boolean;
  zoom: boolean;
}

export interface AutoEditRun {
  steps: { id: AutoStepId; status: AutoStepStatus }[];
  done: boolean;
  summary?: { removed: number; cuts: number; words: number; faces: boolean; silentClips: number };
}

export type PreviewQuality = 360 | 540 | 720;
const PREVIEW_QUALITY_KEY = 'lcv-preview-quality';

function readPreviewQuality(): PreviewQuality {
  try {
    const v = Number(localStorage.getItem(PREVIEW_QUALITY_KEY));
    if (v === 360 || v === 540 || v === 720) return v;
  } catch {
    // ignore
  }
  // Phones get the lightest preview by default.
  return matchMedia('(max-width: 760px)').matches ? 360 : 540;
}

const AUTOSAVE_DEBOUNCE_MS = 800;
const HISTORY_LIMIT = 100;

/**
 * State of one open project. Every mutation goes through `update()`, which feeds the undo
 * history and the auto-save stream (RxJS debounceTime → Dexie), so a crash or a closed tab
 * never loses more than the last fraction of a second of work.
 */
@Injectable()
export class EditorStore {
  private readonly workers = inject(WorkersService);
  private readonly projects = inject(ProjectsService);
  private readonly transloco = inject(TranslocoService);

  readonly project = signal<Project | null>(null);
  readonly projectMissing = signal(false);
  readonly clipFiles = signal<ReadonlyMap<string, File>>(new Map());
  readonly clipStatus = signal<Readonly<Record<string, ClipStatus>>>({});
  readonly clipErrors = signal<Readonly<Record<string, string>>>({});
  readonly clipAnalyses = signal<ReadonlyMap<string, AudioAnalysis>>(new Map());
  readonly musicFile = signal<File | null>(null);
  readonly musicState = signal<MusicState>('none');
  readonly audioProgress = signal<number | null>(null);
  /** Translation key of the last audio analysis failure, shown in the timeline with a retry. */
  readonly analysisError = signal<string | null>(null);
  readonly transcription = signal<TaskProgress | null>(null);
  readonly transcribedWords = signal(0);
  readonly aiDevice = signal<AiDevice | null>(null);
  readonly faceProgress = signal<number | null>(null);
  /** Progress of the voice detection (0..1), null when idle. */
  readonly voiceProgress = signal<number | null>(null);
  readonly exportState = signal<ExportState>({ status: 'idle' });
  readonly saveState = signal<SaveState>('saved');
  readonly savedAt = signal<number | null>(null);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  readonly currentTime = signal(0);
  readonly playing = signal(false);
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly markIn = signal<number | null>(null);
  readonly markOut = signal<number | null>(null);
  /** Cut picked on the timeline, adjusted with its edges or the start / end nudges. */
  readonly selectedCut = signal<string | null>(null);
  readonly whisperModel = signal<WhisperModel>('base');
  readonly whisperLanguage = signal<string | null>(null);
  readonly notice = signal<{ key: string; params?: Record<string, unknown>; tone: 'info' | 'error' } | null>(null);
  private noticeTimer = 0;

  /** Stable across edits that do not touch the clips, so the waveform is not rebuilt for nothing. */
  readonly clips = computed(() => placeClips(this.project()?.clips ?? []), {
    equal: (a, b) => a.length === b.length && a.every((c, i) => c.id === b[i].id && c.end === b[i].end && c.source === b[i].source),
  });
  readonly duration = computed(() => this.clips().at(-1)?.end ?? 0);
  readonly fileState = computed<FileState>(() => {
    if (this.projectMissing()) return 'missing-project';
    const p = this.project();
    if (!p) return 'loading';
    const statuses = p.clips.map((c) => this.clipStatus()[c.id] ?? 'loading');
    if (statuses.some((s) => s !== 'ready' && s !== 'loading')) return 'reconnect';
    if (!statuses.length || statuses.some((s) => s === 'loading')) return 'loading';
    return 'ready';
  });
  readonly analysis = computed<SequenceAnalysis | null>(() => {
    const clips = this.clips();
    const analyses = this.clipAnalyses();
    if (!clips.length || clips.some((c) => !analyses.has(c.id))) return null;
    const parts = clips.map((c) => ({ duration: c.end - c.start, analysis: analyses.get(c.id)! }));
    const frameDb = concatAligned(parts.map((p) => ({ duration: p.duration, data: p.analysis.frameDb })), FRAME_RATE, -90);
    return {
      duration: this.duration(),
      peaks: concatAligned(parts.map((p) => ({ duration: p.duration, data: p.analysis.peaks })), PEAKS_RATE),
      peaksRate: PEAKS_RATE,
      frameDb,
      frameRate: FRAME_RATE,
      suggestedThresholdDb: suggestThreshold(frameDb),
    };
  });
  readonly removed = computed(() => {
    const p = this.project();
    return p ? removedRanges(this.duration(), p.cuts, p.words) : [];
  });
  readonly segments = computed(() => keptSegments(this.duration(), this.removed()));
  readonly outputDuration = computed(() => totalDuration(this.segments()));
  readonly captionPages = computed(() => {
    const p = this.project();
    return p ? buildCaptionPages(p.words, this.segments(), p.captions.maxWords) : [];
  });
  readonly zoomBeats = computed(() => {
    const p = this.project();
    return p ? zoomBeats(p, this.segments()) : [];
  });
  /** Preview resolution (short side). Lower is lighter for the browser; the export is not affected. */
  readonly previewQuality = signal<PreviewQuality>(readPreviewQuality());
  /** Loudness that drives the music ducking: clips without voice never push the music down. */
  readonly duckingDb = computed(() => {
    const a = this.analysis();
    const p = this.project();
    if (!a || !p) return null;
    const quiet = this.clips().filter((c) => !clipHasVoice(p.clips.find((x) => x.id === c.id) ?? c));
    if (!quiet.length) return a.frameDb;
    const db = a.frameDb.slice();
    for (const c of quiet) db.fill(-90, Math.round(c.start * FRAME_RATE), Math.round(c.end * FRAME_RATE));
    return db;
  });
  readonly musicEnvelope = computed(() => {
    const p = this.project();
    const db = this.duckingDb();
    if (!p?.music.enabled || !db || !this.musicFile()) return null;
    return duckingEnvelope(db, this.segments(), this.outputDuration(), p.silence.thresholdDb, p.music.volume, p.music.ducking);
  });
  private readonly levels = new WeakMap<AudioAnalysis, number>();
  /** Volume of each clip's sound: the overall volume, times the leveling gain when enabled. */
  readonly clipGains = computed(() => {
    const p = this.project();
    const gains = new Map<string, number>();
    for (const c of p?.clips ?? []) {
      let gain = p!.audio.volume;
      const a = this.clipAnalyses().get(c.id);
      if (p!.audio.normalize && a) {
        let level = this.levels.get(a);
        if (level === undefined) this.levels.set(a, (level = levelingGain(a.frameDb)));
        // Leveling never boosts the room noise of a clip without voice.
        gain *= clipHasVoice(c) ? level : Math.min(1, level);
      }
      gains.set(c.id, gain);
    }
    return gains;
  });

  private player: PlayerApi | null = null;
  private readonly clipPcm = new Map<string, Float32Array>();
  private analyzing: Promise<void> | null = null;
  private analysisRequested = false;
  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  private lastHistory = { key: '', at: 0 };
  private faceCancelled = false;
  private dirty = false;
  private readonly changes = new Subject<void>();

  constructor() {
    const sub = this.changes
      .pipe(
        tap(() => {
          this.dirty = true;
          this.saveState.set('saving');
        }),
        debounceTime(AUTOSAVE_DEBOUNCE_MS),
        switchMap(() => from(this.save())),
      )
      .subscribe();

    // Flush immediately when the tab is hidden or closed: `beforeunload` is not reliable.
    const flush = () => {
      if (this.dirty) void this.save();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      flush();
      sub.unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      this.workers.ai.cancel();
      this.faceCancelled = true;
    });
  }

  // ---------------------------------------------------------------------------------------
  // Mutations, history and auto-save

  update(mutate: (draft: Project) => void, options: { history?: boolean; coalesce?: string } = {}): void {
    const current = this.project();
    if (!current) return;
    const draft = structuredClone(current);
    mutate(draft);
    if (options.history !== false) {
      const now = Date.now();
      const sameGesture = options.coalesce && options.coalesce === this.lastHistory.key && now - this.lastHistory.at < 1000;
      if (!sameGesture) {
        this.undoStack.push(current);
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      }
      this.redoStack = [];
      this.lastHistory = { key: options.coalesce ?? '', at: now };
    }
    this.project.set(draft);
    this.syncHistoryFlags();
    this.changes.next();
  }

  undo(): void {
    const current = this.project();
    const previous = this.undoStack.pop();
    if (!current || !previous) return;
    this.redoStack.push(current);
    this.project.set(previous);
    this.lastHistory = { key: '', at: 0 };
    this.syncHistoryFlags();
    this.changes.next();
  }

  redo(): void {
    const current = this.project();
    const next = this.redoStack.pop();
    if (!current || !next) return;
    this.undoStack.push(current);
    this.project.set(next);
    this.syncHistoryFlags();
    this.changes.next();
  }

  notify(key: string, params?: Record<string, unknown>, tone: 'info' | 'error' = 'info'): void {
    clearTimeout(this.noticeTimer);
    this.notice.set({ key, params, tone });
    this.noticeTimer = window.setTimeout(() => this.notice.set(null), tone === 'error' ? 8000 : 3500);
  }

  private syncHistoryFlags(): void {
    this.canUndo.set(this.undoStack.length > 0);
    this.canRedo.set(this.redoStack.length > 0);
  }

  private async save(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.dirty = false;
    try {
      await db.projects.put({ ...p, updatedAt: Date.now() });
      this.savedAt.set(Date.now());
      this.saveState.set(this.dirty ? 'saving' : 'saved');
    } catch {
      this.saveState.set('error');
    }
  }

  // ---------------------------------------------------------------------------------------
  // Opening a project and reconnecting its clips (crash recovery)

  async open(id: string): Promise<void> {
    const raw = await db.projects.get(id);
    if (!raw) {
      this.projectMissing.set(true);
      return;
    }
    const project = migrateProject(raw);
    this.project.set(project);
    this.projects.setLastProject(id);
    this.whisperModel.set(project.transcript?.model ?? 'base');
    // Auto-detection by default: the spoken language is often not the interface language.
    this.whisperLanguage.set(project.transcript ? project.transcript.language : null);
    await Promise.all(
      project.clips.map(async (clip) => {
        const sessionFile = this.projects.takeSessionFile(id, clip.id);
        if (sessionFile) await this.attachClip(clip.id, sessionFile);
        else await this.reconnectClip(clip.id, false);
      }),
    );
    void this.ensureAnalyses();
    void this.restoreMusic(false);
    const flash = this.projects.takeFlash();
    if (flash) this.notify(flash.key, flash.params, 'error');
  }

  /** Re-opens a clip's stored handle. With `fromGesture`, the browser may show its permission prompt. */
  async reconnectClip(clipId: string, fromGesture: boolean): Promise<void> {
    const p = this.project();
    if (!p) return;
    const stored = await getClipFile(p.id, clipId);
    if (!stored?.handle) {
      this.setClipStatus(clipId, 'missing');
      return;
    }
    let granted = false;
    try {
      granted = fromGesture
        ? await requestReadPermission(stored.handle)
        : (await queryReadPermission(stored.handle)) === 'granted';
    } catch {
      // The user activation was used up by a previous prompt: one more click will do.
    }
    if (!granted) {
      this.setClipStatus(clipId, 'permission');
      return;
    }
    try {
      await this.attachClip(clipId, await stored.handle.getFile());
    } catch {
      // The file was moved, renamed or deleted since the last session.
      this.setClipStatus(clipId, 'moved');
    }
  }

  /** One click, several prompts: browsers may need a second click if they limit prompts per gesture. */
  async reconnectAll(): Promise<void> {
    for (const clip of this.clips()) {
      if (this.clipStatus()[clip.id] === 'permission') await this.reconnectClip(clip.id, true);
    }
    void this.ensureAnalyses();
  }

  async relocateClip(clipId: string): Promise<void> {
    const p = this.project();
    const clip = p?.clips.find((c) => c.id === clipId);
    if (!p || !clip) return;
    const picked = await pickFile(VIDEO_ACCEPT, this.transloco.translate('common.videoFiles'));
    if (!picked) return;
    if (fingerprint(picked.file) !== fingerprint(clip.source)) {
      const ok = confirm(this.transloco.translate('editor.reconnect.mismatch', { name: clip.source.name }));
      if (!ok) return;
    }
    await storeClipFile(p.id, clipId, picked.file, picked.handle);
    await this.attachClip(clipId, picked.file);
    void this.ensureAnalyses();
  }

  private async attachClip(clipId: string, file: File): Promise<void> {
    const p = this.project();
    const clip = p?.clips.find((c) => c.id === clipId);
    if (!p || !clip) return;
    this.setClipStatus(clipId, 'loading');
    try {
      if (fingerprint(file) !== fingerprint(clip.source)) {
        // Another file (or the same file modified): refresh its metadata, keep the edit aligned.
        const source = await this.workers.media.probe(file);
        this.update(
          (d) => {
            const after = d.clips.map((c) => (c.id === clipId ? { ...c, source } : c));
            remapTimeline(d, d.clips, after);
            d.clips = after;
          },
          { history: false },
        );
      }
      this.clipFiles.update((m) => new Map(m).set(clipId, file));
      this.projects.rememberSessionFile(p.id, clipId, file);
      this.setClipStatus(clipId, 'ready');
      // Whatever path reconnected the clip (open, per-clip "Allow", re-select…), analyze it.
      void this.ensureAnalyses();
    } catch (e) {
      this.clipErrors.update((m) => ({ ...m, [clipId]: errorKey(e) }));
      this.setClipStatus(clipId, 'error');
    }
  }

  private setClipStatus(clipId: string, status: ClipStatus): void {
    this.clipStatus.update((s) => ({ ...s, [clipId]: status }));
  }

  /** Analyzes, one after the other, the clips whose audio analysis is not cached yet. */
  /**
   * Analyzes, one after the other, the clips whose audio analysis is not cached yet. Safe to
   * call at any time: a call made while a pass is running schedules another pass.
   */
  ensureAnalyses(): Promise<void> {
    if (this.analyzing) {
      this.analysisRequested = true;
      return this.analyzing;
    }
    this.analysisError.set(null);
    this.analyzing = (async () => {
      do {
        this.analysisRequested = false;
        let pending = this.clips().filter((c) => !this.clipAnalyses().has(c.id) && this.clipFiles().has(c.id));
        const total = pending.length;
        let done = 0;
        while (pending.length) {
          const clip = pending[0];
          const file = this.clipFiles().get(clip.id)!;
          try {
            const cached = await db.analysis.get(fingerprint(file));
            if (cached) this.clipAnalyses.update((m) => new Map(m).set(clip.id, cached));
            else await this.extractClipAudio(clip.id, file, (p) => this.audioProgress.set((done + p) / Math.max(1, total)));
          } catch (e) {
            // Leave a visible, retryable error instead of an endless spinner.
            this.analysisError.set(errorKey(e));
            return;
          }
          done++;
          pending = this.clips().filter((c) => !this.clipAnalyses().has(c.id) && this.clipFiles().has(c.id));
        }
      } while (this.analysisRequested);
      const p = this.project();
      const a = this.analysis();
      if (p && a && !p.cuts.length && !p.words.length) {
        this.update((d) => (d.silence.thresholdDb = a.suggestedThresholdDb), { history: false });
      }
    })().finally(() => {
      this.audioProgress.set(null);
      this.analyzing = null;
    });
    return this.analyzing;
  }

  private async extractClipAudio(clipId: string, file: File, onProgress: (p: number) => void): Promise<Float32Array> {
    onProgress(0);
    const result = await this.workers.media.extractAudio(file, proxy(onProgress));
    this.clipPcm.set(clipId, result.pcm);
    const analysis: AudioAnalysis = {
      fingerprint: fingerprint(file),
      duration: result.duration,
      peaks: result.peaks,
      peaksRate: result.peaksRate,
      frameDb: result.frameDb,
      frameRate: result.frameRate,
      suggestedThresholdDb: result.suggestedThresholdDb,
      createdAt: Date.now(),
    };
    this.clipAnalyses.update((m) => new Map(m).set(clipId, analysis));
    await db.analysis.put(analysis);
    return result.pcm;
  }

  // ---------------------------------------------------------------------------------------
  // Clips: add, remove, reorder

  async addClips(): Promise<void> {
    const p = this.project();
    if (!p) return;
    const picked = await pickFiles(VIDEO_ACCEPT, this.transloco.translate('common.videoFiles'));
    if (!picked.length) return;
    try {
      const { clips, skipped } = await this.projects.createClips(p.id, picked);
      this.update((d) => d.clips.push(...clips));
      for (const clip of clips) {
        const file = picked.find((item) => item.file.name === clip.source.name && item.file.size === clip.source.size)!.file;
        this.clipFiles.update((m) => new Map(m).set(clip.id, file));
        this.setClipStatus(clip.id, 'ready');
      }
      if (skipped.length) {
        const notice = skippedNotice(skipped);
        this.notify(notice.key, notice.params, 'error');
      } else {
        this.notify(p.words.length ? 'editor.clips.addedTranscribe' : 'editor.clips.added', { count: clips.length });
      }
      void this.ensureAnalyses();
    } catch (e) {
      this.notify(errorKey(e), undefined, 'error');
    }
  }

  removeClip(clipId: string): void {
    const p = this.project();
    if (!p || p.clips.length < 2) return;
    this.update((d) => {
      const after = d.clips.filter((c) => c.id !== clipId);
      remapTimeline(d, d.clips, after);
      d.clips = after;
    });
  }

  moveClip(clipId: string, to: number): void {
    const p = this.project();
    const from = p?.clips.findIndex((c) => c.id === clipId) ?? -1;
    if (!p || from < 0 || from === to) return;
    this.update((d) => {
      const after = moveItem(d.clips, from, to);
      remapTimeline(d, d.clips, after);
      d.clips = after;
    });
  }

  // ---------------------------------------------------------------------------------------
  // Playback bridge (the preview owns the <video> elements)

  registerPlayer(player: PlayerApi | null): void {
    this.player = player;
  }

  seek(t: number): void {
    const time = Math.max(0, Math.min(this.duration(), t));
    this.player?.seek(time);
    this.currentTime.set(time);
  }

  togglePlay(): void {
    this.player?.toggle();
  }

  /** Plays from a little before `t`, to hear how a cut sounds. */
  playAround(t: number): void {
    this.seek(t - 2);
    if (!this.playing()) this.player?.toggle();
  }

  // ---------------------------------------------------------------------------------------
  // Auto-cut

  /**
   * Silence cuts for the current settings, clip by clip: from the transcript when chosen and
   * available, from the loudness otherwise, and only real dead air in clips without voice.
   */
  private silenceCuts(p: Project): Cut[] {
    const analyses = this.clipAnalyses();
    const cuts: Cut[] = [];
    for (const clip of placeClips(p.clips)) {
      const analysis = analyses.get(clip.id);
      const length = clip.end - clip.start;
      const local = (list: Cut[]) => list.map((c) => ({ ...c, start: c.start + clip.start, end: c.end + clip.start }));
      const words = p.words
        .filter((w) => (w.start + w.end) / 2 >= clip.start && (w.start + w.end) / 2 < clip.end)
        .map((w) => ({ start: w.start - clip.start, end: w.end - clip.start }));
      if (!clipHasVoice(clip)) {
        if (analysis) cuts.push(...local(detectDeadAir(analysis.frameDb, length, p.silence)));
      } else if (p.silence.mode === 'transcript' && words.length) {
        cuts.push(...local(detectSilencesFromWords(words, length, p.silence)));
      } else if (analysis) {
        cuts.push(...local(detectSilences(analysis.frameDb, length, p.silence)));
      }
    }
    return cuts;
  }

  detectSilences(): number {
    const p = this.project();
    if (!p || !this.analysis()) return 0;
    let count = 0;
    this.update((d) => {
      d.cuts = this.withSilenceCuts(d);
      count = d.cuts.filter((c) => c.reason === 'silence').length;
      d.silence.live = true;
    });
    return count;
  }

  /** Changes a silence setting; once silences are cut, the cuts follow the settings live. */
  setSilence(patch: Partial<SilenceSettings>, coalesce?: string): void {
    this.update(
      (d) => {
        Object.assign(d.silence, patch);
        if (d.silence.live) d.cuts = this.withSilenceCuts(d);
      },
      { coalesce },
    );
  }

  /** Replaces the silence cuts. A detected silence that overlaps a manual cut gives way to it. */
  private withSilenceCuts(d: Project): Cut[] {
    const kept = d.cuts.filter((c) => c.reason !== 'silence');
    const fresh = this.silenceCuts(d).filter((s) => !kept.some((c) => c.start < s.end && s.start < c.end));
    return kept.concat(fresh);
  }

  clearCuts(): void {
    this.update((d) => {
      d.cuts = [];
      d.silence.live = false;
    });
  }

  addCut(start: number, end: number): void {
    if (end - start < MIN_CUT) return;
    this.update((d) => d.cuts.push({ id: uid(), start, end, reason: 'manual' }));
  }

  /** Moves the edges of a cut. An adjusted silence cut becomes manual, so live re-detection keeps it. */
  updateCut(id: string, start: number, end: number, coalesce?: string): void {
    const from = Math.max(0, Math.min(start, end));
    const to = Math.min(this.duration(), Math.max(start, end));
    if (to - from < MIN_CUT) return;
    this.update(
      (d) => {
        const cut = d.cuts.find((c) => c.id === id);
        if (cut) {
          cut.start = from;
          cut.end = to;
          cut.reason = 'manual';
        }
      },
      { coalesce },
    );
  }

  /** Moves one edge of a cut by `delta` seconds, keeping the cut at least MIN_CUT long. */
  nudgeCut(id: string, edge: 'start' | 'end', delta: number): void {
    const cut = this.project()?.cuts.find((c) => c.id === id);
    if (!cut) return;
    const start = edge === 'start' ? Math.min(cut.start + delta, cut.end - MIN_CUT) : cut.start;
    const end = edge === 'end' ? Math.max(cut.end + delta, cut.start + MIN_CUT) : cut.end;
    this.updateCut(id, start, end, `nudge-${id}-${edge}`);
    // Show the kept frame on the edited edge: just before the cut, or right after it.
    this.seek(edge === 'start' ? start - 0.04 : end);
  }

  removeCut(id: string): void {
    this.update((d) => (d.cuts = d.cuts.filter((c) => c.id !== id)));
    if (this.selectedCut() === id) this.selectedCut.set(null);
  }

  /** In / out points placed on the playhead, to cut a part of the video by hand. */
  setMark(which: 'in' | 'out', t = this.currentTime()): void {
    (which === 'in' ? this.markIn : this.markOut).set(t);
  }

  clearMarks(): void {
    this.markIn.set(null);
    this.markOut.set(null);
  }

  /** Cuts between the in and out points (in any order). Returns false when they are not set. */
  cutMarked(): boolean {
    const a = this.markIn();
    const b = this.markOut();
    if (a === null || b === null || Math.abs(b - a) < 0.05) return false;
    this.addCut(Math.min(a, b), Math.max(a, b));
    this.clearMarks();
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // Transcription (per clip, cached) and text-based editing

  /** Clips that have no words yet although the project was transcribed (added afterwards). */
  readonly untranscribedClips = computed(() => {
    const p = this.project();
    if (!p?.transcript) return 0;
    const voiced = new Set(p.clips.filter(clipHasVoice).map((c) => c.id));
    return this.clips().filter((c) => voiced.has(c.id) && !p.words.some((w) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 < c.end)).length;
  });

  /**
   * Transcribes clip by clip. `missing` only transcribes clips without words (keeping the
   * others and their edits); `all` starts over, ignoring the cache, for a real retry.
   */
  async transcribe(model: WhisperModel, language: string | null, scope: 'missing' | 'all' = 'all'): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.transcription.set({ stage: 'audio', progress: 0 });
    this.transcribedWords.set(0);
    try {
      await this.ensureAnalyses();
      if (!this.analysis()) throw new Error('NO_ANALYSIS');
      const clips = this.clips();
      const wordsOf = (c: (typeof clips)[number]) => p.words.filter((w) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 < c.end);
      // Clips without voice are never transcribed: Whisper would invent text on the ambience.
      const voiced = new Set(p.clips.filter(clipHasVoice).map((c) => c.id));
      const todo = (scope === 'all' ? clips : clips.filter((c) => !wordsOf(c).length)).filter((c) => voiced.has(c.id));
      const totalSeconds = todo.reduce((n, c) => n + (c.end - c.start), 0) || 1;
      let doneSeconds = 0;
      const result: Word[] = [];
      let detected: string | null = null;

      for (const clip of clips) {
        if (!voiced.has(clip.id)) continue;
        if (!todo.includes(clip)) {
          result.push(...wordsOf(clip));
          continue;
        }
        const file = this.clipFiles().get(clip.id)!;
        const cacheKey = `${fingerprint(file)}|${model}|${language ?? 'auto'}`;
        let raw = scope === 'all' ? undefined : (await db.transcripts.get(cacheKey))?.words;
        if (!raw) {
          const pcm = this.clipPcm.get(clip.id) ?? (await this.extractClipAudio(clip.id, file, () => undefined));
          const analysis = this.clipAnalyses().get(clip.id)!;
          const clipDuration = clip.end - clip.start;
          const words: RawWord[] = [];
          const res = await this.workers.ai.transcribe(
            pcm.subarray(0, Math.round(clipDuration * ANALYSIS_SAMPLE_RATE)),
            whisperChunks(analysis.frameDb, clipDuration, p.silence.thresholdDb),
            { model, language },
            proxy((progress: { stage: 'download' | 'transcribe'; progress: number }) =>
              this.transcription.set(
                progress.stage === 'download'
                  ? progress
                  : { stage: 'transcribe', progress: (doneSeconds + progress.progress * clipDuration) / totalSeconds },
              ),
            ),
            proxy((chunk: RawWord[]) => {
              words.push(...chunk);
              this.transcribedWords.update((n) => n + chunk.length);
            }),
          );
          this.aiDevice.set(res.device);
          detected ??= res.language;
          raw = words;
          await db.transcripts.put({ key: cacheKey, words, createdAt: Date.now() });
        }
        result.push(...raw.map((w) => ({ id: uid(), text: w.text, start: clip.start + w.start, end: clip.start + w.end, deleted: false })));
        doneSeconds += clip.end - clip.start;
      }

      this.update((d) => {
        d.words = result.sort((a, b) => a.start - b.start);
        d.transcript = { model, language, detected: language ? null : (detected ?? p.transcript?.detected ?? null), createdAt: Date.now() };
      });
    } finally {
      this.transcription.set(null);
    }
  }

  cancelTranscription(): void {
    this.workers.ai.cancel();
  }

  toggleDeleteSelection(): void {
    const ids = this.selection();
    const p = this.project();
    if (!ids.size || !p) return;
    const selected = p.words.filter((w) => ids.has(w.id));
    const restore = selected.every((w) => w.deleted);
    this.update((d) => d.words.forEach((w) => ids.has(w.id) && (w.deleted = !restore)));
  }

  removeFillers(): number {
    const p = this.project();
    if (!p) return 0;
    const count = p.words.filter((w) => !w.deleted && isFiller(w)).length;
    if (count) this.update((d) => d.words.forEach((w) => isFiller(w) && (w.deleted = true)));
    return count;
  }

  restoreAllWords(): void {
    this.update((d) => d.words.forEach((w) => (w.deleted = false)));
  }

  editWord(id: string, text: string): void {
    this.replaceWords([id], text);
  }

  /**
   * Corrects what Whisper heard: the selected words are replaced by the typed text. Timings
   * are spread over the original span in proportion to each new word's length, so captions
   * stay in sync even when the number of words changes.
   */
  replaceWords(ids: Iterable<string>, text: string): void {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    const selected = new Set(ids);
    const p = this.project();
    if (!p || !tokens.length || !selected.size) return;
    const indices = p.words.flatMap((w, i) => (selected.has(w.id) ? [i] : []));
    const from = Math.min(...indices);
    const to = Math.max(...indices);
    const original = p.words.slice(from, to + 1);
    if (original.map((w) => w.text).join(' ') === tokens.join(' ')) return;
    const start = original[0].start;
    const end = original[original.length - 1].end;
    const total = tokens.reduce((n, t) => n + t.length, 0);
    let cursor = start;
    const replacement: Word[] = tokens.map((token) => {
      const length = ((end - start) * token.length) / total;
      const word = { id: uid(), text: token, start: cursor, end: cursor + length, deleted: original.every((w) => w.deleted) };
      cursor += length;
      return word;
    });
    this.update((d) => d.words.splice(from, to - from + 1, ...replacement));
    this.selection.set(new Set(replacement.map((w) => w.id)));
  }

  // ---------------------------------------------------------------------------------------
  // Auto-framing (tracked clip by clip, a cut between clips is a hard camera jump)

  async analyzeFaces(): Promise<boolean> {
    const clips = this.clips();
    if (!clips.length) return false;
    this.faceCancelled = false;
    this.faceProgress.set(0);
    const rotation = this.project()?.rotation ?? 0;
    try {
      const total = this.duration() || 1;
      const points: FacePoint[] = [];
      let found = false;
      for (const clip of clips) {
        const file = this.clipFiles().get(clip.id);
        if (!file || this.faceCancelled) break;
        const length = clip.end - clip.start;
        const samples = await analyzeFaces(file, length, (p) => this.faceProgress.set((clip.start + p * length) / total), () => this.faceCancelled, rotation);
        const track = smoothFaceTrack(samples);
        found ||= !!track;
        const local = track ?? [
          { t: 0, x: 0.5, y: 0.5 },
          { t: length, x: 0.5, y: 0.5 },
        ];
        points.push(...local.map((pt) => ({ ...pt, t: clip.start + pt.t })));
        // Hold the last position until the very end of the clip: no slow pan across the cut.
        const last = local[local.length - 1];
        points.push({ t: clip.end - 0.001, x: last.x, y: last.y });
      }
      // Turned in the meantime: these positions belong to the old orientation.
      if (this.project()?.rotation !== rotation) return false;
      this.update((d) => {
        d.faces = found ? points : null;
        d.framing.mode = found ? 'face' : 'center';
      });
      return found;
    } finally {
      this.faceProgress.set(null);
    }
  }

  /** Following the face needs a face track: choosing it starts the analysis when needed. */
  async setFramingMode(mode: FramingMode): Promise<void> {
    const p = this.project();
    if (!p) return;
    if (mode === 'face' && !p.faces) {
      const found = await this.analyzeFaces();
      this.notify(found ? 'editor.framing.found' : 'editor.framing.notFound', undefined, found ? 'info' : 'error');
      return;
    }
    this.update((d) => (d.framing.mode = mode));
  }

  setPreviewQuality(q: PreviewQuality): void {
    this.previewQuality.set(q);
    try {
      localStorage.setItem(PREVIEW_QUALITY_KEY, String(q));
    } catch {
      // ignore
    }
  }

  cancelFaces(): void {
    this.faceCancelled = true;
  }

  /** Turns the whole project by a quarter turn. The face track no longer matches and is dropped. */
  rotate(direction: 1 | -1): void {
    const p = this.project();
    if (!p) return;
    const following = p.framing.mode === 'face' || this.faceProgress() !== null;
    this.faceCancelled = true;
    this.update((d) => {
      d.rotation = ((((d.rotation + direction * 90) % 360) + 360) % 360) as Rotation;
      d.faces = null;
      d.framing.mode = 'center';
    });
    if (following) this.notify('editor.format.rotatedFaces');
  }

  // ---------------------------------------------------------------------------------------
  // Voice: does someone speak in each clip?

  /** Says whether someone speaks in a clip (null lets the detection decide). */
  setClipVoice(clipId: string, voice: boolean | null): void {
    this.update((d) => {
      const clip = d.clips.find((c) => c.id === clipId);
      if (clip) clip.voice = voice;
      if (d.silence.live) d.cuts = this.withSilenceCuts(d);
    });
  }

  /**
   * Finds out whether someone speaks in the clips left on "auto": Whisper rates a few samples
   * spread over each clip. A clip without any audible sound has no voice.
   */
  async detectVoices(): Promise<void> {
    const pending = this.project()?.clips.filter((c) => c.voice == null && c.voiceDetected === undefined) ?? [];
    if (!pending.length) return;
    this.voiceProgress.set(0);
    try {
      const found = new Map<string, boolean>();
      for (const [i, clip] of pending.entries()) {
        const placed = this.clips().find((c) => c.id === clip.id);
        const file = this.clipFiles().get(clip.id);
        const analysis = this.clipAnalyses().get(clip.id);
        if (!placed || !file || !analysis) continue;
        const chunks = whisperChunks(analysis.frameDb, placed.end - placed.start, this.project()!.silence.thresholdDb).filter((c) => !c.silent);
        if (!chunks.length) {
          found.set(clip.id, false);
          continue;
        }
        const pcm = this.clipPcm.get(clip.id) ?? (await this.extractClipAudio(clip.id, file, () => undefined));
        const picks =
          chunks.length <= VOICE_SAMPLES ? chunks : Array.from({ length: VOICE_SAMPLES }, (_, k) => chunks[Math.floor((k * chunks.length) / VOICE_SAMPLES)]);
        const samples = picks.map((c) => pcm.slice(Math.floor(c.start * ANALYSIS_SAMPLE_RATE), Math.floor(c.end * ANALYSIS_SAMPLE_RATE)));
        const res = await this.workers.ai.detectSpeech(
          samples,
          this.whisperModel(),
          proxy((p: { stage: 'download' | 'transcribe'; progress: number }) =>
            this.voiceProgress.set(p.stage === 'download' ? p.progress : (i + p.progress) / pending.length),
          ),
        );
        this.aiDevice.set(res.device);
        found.set(clip.id, hasVoice(res.samples));
      }
      this.update((d) => d.clips.forEach((c) => found.has(c.id) && (c.voiceDetected = found.get(c.id))), { history: false });
    } finally {
      this.voiceProgress.set(null);
    }
  }

  /** Drops the words heard in clips without voice (text Whisper invented on the ambience). */
  private dropWordsWithoutVoice(): void {
    const p = this.project();
    if (!p) return;
    const quiet = this.clips().filter((c) => !clipHasVoice(p.clips.find((x) => x.id === c.id) ?? c));
    const inQuiet = (w: Word) => quiet.some((c) => (w.start + w.end) / 2 >= c.start && (w.start + w.end) / 2 < c.end);
    if (p.words.some(inQuiet)) this.update((d) => (d.words = d.words.filter((w) => !inQuiet(w))));
  }

  // ---------------------------------------------------------------------------------------
  // Auto edit

  readonly autoEdit = signal<AutoEditRun | null>(null);
  private autoEditBackup: Project | null = null;

  /** Whether the output shape crops the source, i.e. whether following the face matters. */
  needsCrop(format: AspectFormat): boolean {
    const p = this.project();
    const source = p?.clips[0]?.source;
    if (!p || !source) return false;
    const { width, height } = rotatedSize(source.width, source.height, p.rotation);
    const target = aspectRatio(format);
    return Math.abs(width / height - target) / target > 0.05;
  }

  /**
   * Chains every automatic tool: audio analysis, transcription, filler removal, silence cuts
   * (from the transcript when available), face framing when the format crops the video,
   * smart zoom and karaoke captions. The project before the run is kept to undo it at once.
   */
  async runAutoEdit(o: AutoEditOptions): Promise<void> {
    const p = this.project();
    const current = this.autoEdit();
    if (!p || (current && !current.done)) return;
    this.autoEditBackup = structuredClone(p);
    const ids: AutoStepId[] = ['analyze', 'voice', 'transcribe', 'fillers', 'silences', 'framing', 'style'];
    this.autoEdit.set({ steps: ids.map((id) => ({ id, status: 'pending' })), done: false });
    const mark = (id: AutoStepId, status: AutoStepStatus) =>
      this.autoEdit.update((r) => r && { ...r, steps: r.steps.map((s) => (s.id === id ? { ...s, status } : s)) });
    const step = async (id: AutoStepId, enabled: boolean, work: () => Promise<boolean | void>) => {
      if (!enabled) return mark(id, 'skipped');
      mark(id, 'running');
      try {
        mark(id, (await work()) === false ? 'skipped' : 'done');
      } catch (e) {
        if (String((e as Error)?.message).includes('CANCELLED')) throw e;
        mark(id, 'error');
      }
    };
    const words = () => this.project()?.words.length ?? 0;

    try {
      await step('analyze', true, async () => {
        await this.ensureAnalyses();
        if (!this.analysis()) throw new Error('NO_ANALYSIS');
      });
      const needsWords = o.captions || o.fillers || o.silences;
      const undecided = () => this.project()?.clips.some((c) => c.voice == null && c.voiceDetected === undefined) ?? false;
      await step('voice', needsWords && undecided(), () => this.detectVoices());
      await step('transcribe', needsWords, async () => {
        this.dropWordsWithoutVoice();
        if (!this.project()?.clips.some(clipHasVoice)) return false;
        if (words() && !this.untranscribedClips()) return false;
        await this.transcribe(this.whisperModel(), this.whisperLanguage(), words() ? 'missing' : 'all');
        return true;
      });
      await step('fillers', o.fillers, async () => (words() ? void this.removeFillers() : false));
      await step('silences', o.silences, async () => {
        const preset = SILENCE_PRESETS.find((x) => x.id === o.rhythm) ?? SILENCE_PRESETS[1];
        this.update((d) => {
          d.silence.minSilence = preset.minSilence;
          d.silence.padding = preset.padding;
          d.silence.mode = d.words.length ? 'transcript' : 'audio';
        });
        this.detectSilences();
      });
      this.update((d) => {
        if (d.captions.maxWords === defaultCaptionWords(d.format)) d.captions.maxWords = defaultCaptionWords(o.format);
        d.format = o.format;
      });
      await step('framing', o.framing, async () => {
        if (!this.needsCrop(o.format)) return false;
        return (await this.analyzeFaces()) ? undefined : false;
      });
      await step('style', true, async () => {
        this.update((d) => {
          d.captions.enabled = o.captions && d.words.length > 0;
          if (o.captions) {
            d.captions.style = 'karaoke';
            d.captions.position = 'bottom';
          }
          d.framing.punchIn = o.zoom;
          d.framing.zoom = 1.12;
        });
      });
      const result = this.project()!;
      this.seek(nextKeptTime(this.segments(), 0) ?? 0);
      this.autoEdit.update(
        (r) =>
          r && {
            ...r,
            done: true,
            summary: {
              removed: this.duration() - this.outputDuration(),
              cuts: result.cuts.length,
              words: result.words.filter((w) => !w.deleted).length,
              faces: result.framing.mode === 'face',
              silentClips: result.clips.filter((c) => !clipHasVoice(c)).length,
            },
          },
      );
    } catch {
      this.autoEdit.set(null);
    }
  }

  /** Puts the project back as it was before the auto edit, as a single undo step. */
  undoAutoEdit(): void {
    const backup = this.autoEditBackup;
    if (!backup) return;
    this.update((d) => Object.assign(d, structuredClone(backup)));
    this.autoEditBackup = null;
    this.autoEdit.set(null);
  }

  closeAutoEdit(): void {
    this.autoEdit.set(null);
  }

  // ---------------------------------------------------------------------------------------
  // Background music (auto-ducking)

  async pickMusic(): Promise<void> {
    const p = this.project();
    if (!p) return;
    const picked = await pickFile(AUDIO_ACCEPT, this.transloco.translate('common.audioFiles'));
    if (!picked) return;
    await db.files.put({
      key: musicKey(p.id),
      projectId: p.id,
      role: 'music',
      handle: picked.handle,
      name: picked.file.name,
      size: picked.file.size,
      lastModified: picked.file.lastModified,
      type: picked.file.type,
    });
    this.musicFile.set(picked.file);
    this.musicState.set('ready');
    this.update((d) => {
      d.music.enabled = true;
      d.music.name = picked.file.name;
    });
  }

  async restoreMusic(fromGesture: boolean): Promise<void> {
    const p = this.project();
    if (!p) return;
    const stored = await db.files.get(musicKey(p.id));
    if (!stored) {
      this.musicState.set('none');
      return;
    }
    if (!stored.handle) {
      this.musicState.set('relocate');
      return;
    }
    const granted = fromGesture
      ? await requestReadPermission(stored.handle)
      : (await queryReadPermission(stored.handle)) === 'granted';
    if (!granted) {
      this.musicState.set('permission');
      return;
    }
    try {
      this.musicFile.set(await stored.handle.getFile());
      this.musicState.set('ready');
    } catch {
      this.musicState.set('relocate');
    }
  }

  async removeMusic(): Promise<void> {
    const p = this.project();
    if (!p) return;
    await db.files.delete(musicKey(p.id));
    this.musicFile.set(null);
    this.musicState.set('none');
    this.update((d) => {
      d.music.enabled = false;
      d.music.name = null;
    });
  }

  // ---------------------------------------------------------------------------------------
  // Export

  async exportVideo(): Promise<void> {
    const p = this.project();
    const files = this.clipFiles();
    if (!p || this.fileState() !== 'ready' || this.exportState().status === 'running') return;
    const name = `${p.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'video'}-${p.format.replace(':', 'x')}.mp4`;
    const target = await pickSaveTarget(name);
    if (target === null) return;
    const startedAt = Date.now();
    this.exportState.set({ status: 'running', progress: 0, startedAt });
    try {
      const result = await this.workers.exporter.run(
        {
          clips: this.clips().map((c) => ({
            file: files.get(c.id)!,
            start: c.start,
            duration: c.end - c.start,
            hasAudio: c.source.hasAudio,
            gain: this.clipGains().get(c.id) ?? 1,
          })),
          project: p,
          music: p.music.enabled ? this.musicFile() : null,
          frameDb: this.duckingDb(),
          target: target === 'unsupported' ? null : target,
        },
        proxy((progress: { progress: number }) => this.exportState.set({ status: 'running', progress: progress.progress, startedAt })),
      );
      if (result.buffer) downloadBlob(new Blob([result.buffer], { type: 'video/mp4' }), name);
      this.exportState.set({ status: 'done', name, streamed: result.streamed, seconds: (Date.now() - startedAt) / 1000 });
    } catch (e) {
      if (String((e as Error)?.message).includes('CANCELLED')) this.exportState.set({ status: 'idle' });
      else this.exportState.set({ status: 'error', message: String((e as Error)?.message ?? e) });
    }
  }

  cancelExport(): void {
    this.workers.exporter.cancel();
  }

  resetExport(): void {
    this.exportState.set({ status: 'idle' });
  }
}

export function errorKey(e: unknown): string {
  const message = String((e as Error)?.message ?? e);
  if (message.includes('NO_VIDEO_TRACK')) return 'errors.noVideo';
  if (message.includes('UNSUPPORTED_CODEC')) return 'errors.codec';
  return 'errors.generic';
}
