import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { supportsSavePicker } from '../core/file-access';
import { saveProjectFile } from '../core/project-file';
import { spokenLanguageName, spokenLanguageOptions } from '../core/spoken-languages';
import { SILENCE_PRESETS } from '../engine/audio-analysis';
import type { AspectFormat, ExportSettings, Project } from '../engine/model';
import { outputSize } from '../engine/render';
import { formatTime } from '../engine/timeline-math';
import { Icon } from '../shared/icon';
import { LangPicker } from '../shared/lang-picker';
import { LocalizePipe } from '../shared/localize';
import { Logo } from '../shared/logo';
import { Select, type SelectOption } from '../shared/select';
import { type AutoEditOptions, type AutoStepId, EditorStore } from './editor.store';
import { INSPECTOR_TABS, Inspector, type InspectorTab } from './inspector/inspector';
import { Preview } from './preview/preview';
import { Timeline } from './timeline/timeline';
import { Tour, type TourStep } from './tour/tour';
import { Transcript } from './transcript/transcript';

type MobileTab = 'transcript' | InspectorTab;

const MOBILE_QUERY = '(max-width: 760px)';
const MOBILE_NOTICE_KEY = 'lcv-mobile-notice';

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-editor',
  imports: [RouterLink, TranslocoPipe, Icon, Logo, LangPicker, Preview, Timeline, Transcript, Inspector, LocalizePipe, Tour, Select],
  providers: [EditorStore],
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Editor {
  readonly id = input.required<string>();
  /** `?tour=1` (the demo): the guided tour starts once the editor is ready. */
  readonly tour = input<string>();
  protected readonly store = inject(EditorStore);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  protected readonly tourOpen = signal(false);
  protected readonly tourSteps: TourStep[] = [
    { key: 'auto', targets: ['.auto-btn'] },
    { key: 'preview', targets: ['app-preview .stage', '.m-preview'] },
    { key: 'timeline', targets: ['app-timeline .wave-wrap'] },
    { key: 'cut', targets: ['app-timeline .marks', 'app-timeline .toolbar'] },
    { key: 'transcript', targets: ['.transcript-panel', '.m-tabs'] },
    { key: 'settings', targets: ['app-inspector .tabs', '.m-tabs'] },
    { key: 'thumbnail', targets: ['.thumb-btn'] },
    { key: 'export', targets: ['.export-btn'] },
  ];
  private readonly startTour = effect(() => {
    if (!this.tour() || this.store.fileState() !== 'ready') return;
    untracked(() => {
      // Let the waveform and the panels settle before pointing at them.
      setTimeout(() => this.tourOpen.set(true), 800);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    });
  });
  protected readonly exportOpen = signal(false);
  protected readonly savePicker = supportsSavePicker();
  protected readonly formatTime = formatTime;
  protected readonly resolutions: ExportSettings['resolution'][] = [720, 1080];
  protected readonly frameRates: ExportSettings['fps'][] = [24, 25, 30, 60];
  protected readonly presets = SILENCE_PRESETS;
  protected readonly formats: { id: AspectFormat; icon: string; key: string }[] = [
    { id: '9:16', icon: 'ratio-9-16', key: 'vertical' },
    { id: '16:9', icon: 'ratio-16-9', key: 'landscape' },
    { id: '1:1', icon: 'ratio-1-1', key: 'square' },
  ];
  protected readonly autoToggles: (keyof Omit<AutoEditOptions, 'format' | 'rhythm'>)[] = ['silences', 'fillers', 'captions', 'framing', 'zoom'];
  protected readonly autoOpen = signal(false);
  protected readonly autoOptions = signal<AutoEditOptions>({
    format: '9:16',
    rhythm: 'normal',
    silences: true,
    fillers: true,
    captions: true,
    framing: true,
    zoom: true,
  });
  private readonly transcriptRef = viewChild(Transcript);
  private readonly lang = toSignal(this.transloco.langChanges$);
  protected readonly languageOptions = computed<SelectOption[]>(() => {
    this.lang();
    return spokenLanguageOptions(this.transloco.translate('editor.transcribe.auto'), this.transloco.getActiveLang());
  });
  /** Current time, ticking while an auto edit runs. */
  private readonly clock = signal(Date.now());
  private readonly autoClock = effect((onCleanup) => {
    const run = this.store.autoEdit();
    if (!run || run.done) return;
    const timer = setInterval(() => this.clock.set(Date.now()), 500);
    onCleanup(() => clearInterval(timer));
  });

  /** Phones get their own layout: preview on top, tools in a bottom tab bar. */
  protected readonly mobile = signal(matchMedia(MOBILE_QUERY).matches);
  /** On a phone, a notice says a computer works better; shown once per browsing session. */
  protected readonly mobileNotice = signal(!readSessionFlag(MOBILE_NOTICE_KEY));
  protected readonly inspectorTab = signal<InspectorTab>('format');
  protected readonly mobileTab = signal<MobileTab>('transcript');
  protected readonly mobileTabs: { id: MobileTab; icon: string; key: string }[] = [
    { id: 'transcript', icon: 'text', key: 'editor.transcript.title' },
    ...INSPECTOR_TABS.map((t) => ({ id: t.id, icon: t.icon, key: `editor.tabs.${t.id}` })),
  ];

  protected readonly exportSize = computed(() => {
    const p = this.store.project();
    return p ? outputSize(p.format, p.export.resolution) : null;
  });
  protected readonly needsPermission = computed(() => Object.values(this.store.clipStatus()).some((s) => s === 'permission'));
  protected readonly eta = computed(() => {
    const s = this.store.exportState();
    if (s.status !== 'running' || s.progress < 0.02) return null;
    const elapsed = (Date.now() - s.startedAt) / 1000;
    return Math.max(0, elapsed / s.progress - elapsed);
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.store.open(id));
    });
    const media = matchMedia(MOBILE_QUERY);
    const onChange = () => this.mobile.set(media.matches);
    media.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
  }

  protected rename(e: Event): void {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name && name !== this.store.project()?.name) this.store.update((d) => (d.name = name));
  }

  protected async transcribe(scope: 'missing' | 'all'): Promise<void> {
    try {
      await this.store.transcribe(this.store.whisperModel(), this.store.whisperLanguage(), scope);
      const count = this.store.project()?.words.length ?? 0;
      this.store.notify(count ? 'editor.transcribe.done' : 'editor.transcribe.empty', { count }, count ? 'info' : 'error');
    } catch (e) {
      if (String((e as Error)?.message).includes('CANCELLED')) return;
      console.error('Transcription failed', e);
      this.store.notify('errors.transcribe', undefined, 'error', String((e as Error)?.message ?? e).slice(0, 200));
    }
  }

  protected setExport(patch: Partial<Project['export']>): void {
    this.store.update((d) => Object.assign(d.export, patch));
  }

  protected openAutoEdit(): void {
    const p = this.store.project();
    if (!p) return;
    if (this.store.autoEdit()?.done) this.store.closeAutoEdit();
    this.autoOptions.update((o) => ({ ...o, format: p.format }));
    this.autoOpen.set(true);
  }

  protected setAuto(patch: Partial<AutoEditOptions>): void {
    this.autoOptions.update((o) => ({ ...o, ...patch }));
  }

  protected toggleAuto(key: (typeof this.autoToggles)[number], e: Event): void {
    this.setAuto({ [key]: (e.target as HTMLInputElement).checked });
  }

  protected runAutoEdit(): void {
    void this.store.runAutoEdit(this.autoOptions());
  }

  protected closeAutoEdit(): void {
    const run = this.store.autoEdit();
    if (run && !run.done) return;
    this.store.closeAutoEdit();
    this.autoOpen.set(false);
  }

  protected undoAutoEdit(): void {
    this.store.undoAutoEdit();
    this.autoOpen.set(false);
    this.store.notify('editor.auto.undone');
  }

  /** Live progress of the running step, when the underlying task reports one. */
  protected stepProgress(id: AutoStepId): number | null {
    if (id === 'analyze') return this.store.audioProgress() || null;
    if (id === 'voice') return this.store.voiceProgress() || null;
    if (id === 'transcribe') return this.store.transcription()?.progress || null;
    if (id === 'framing') return this.store.faceProgress() || null;
    return null;
  }

  /** The steps long enough to need a progress bar. */
  protected tracksProgress(id: AutoStepId): boolean {
    return id === 'analyze' || id === 'voice' || id === 'transcribe' || id === 'framing';
  }

  /** What the running step is busy with, in words, when a percentage is not enough. */
  protected stepDetail(id: AutoStepId): string | null {
    const stage = id === 'voice' ? this.store.voiceStage() : id === 'transcribe' ? this.store.transcription()?.stage : null;
    if (!stage) return null;
    if (stage !== 'transcribe') return this.transloco.translate(`editor.transcribe.stage.${stage}`);
    const heard = id === 'transcribe' && !this.store.whisperLanguage() ? this.store.heardLanguage() : null;
    return heard ? this.transloco.translate('editor.transcribe.detected', { language: this.languageName(heard) }) : null;
  }

  protected languageName(code: string): string {
    this.lang();
    return spokenLanguageName(code, this.transloco.getActiveLang());
  }

  /** Time spent on a step, which keeps counting even when a percentage cannot move. */
  protected elapsed(startedAt: number | undefined): string {
    return formatTime(startedAt ? Math.max(0, this.clock() - startedAt) / 1000 : 0);
  }

  protected spokenLanguage(): string {
    return this.store.whisperLanguage() ?? 'auto';
  }

  protected setSpokenLanguage(value: string): void {
    this.store.whisperLanguage.set(value === 'auto' ? null : value);
  }

  protected openExport(): void {
    this.store.resetExport();
    this.exportOpen.set(true);
  }

  /** The edit as a .lcv.json file (no video inside), to continue on another computer. */
  protected saveProject(): void {
    const p = this.store.project();
    if (!p) return;
    saveProjectFile(p);
    this.store.notify('editor.export.projectSaved');
  }

  protected closeExport(): void {
    if (this.store.exportState().status === 'running') return;
    this.exportOpen.set(false);
  }

  protected dismissMobileNotice(): void {
    this.mobileNotice.set(false);
    try {
      sessionStorage.setItem(MOBILE_NOTICE_KEY, '1');
    } catch {
      // Private mode: it comes back on the next visit.
    }
  }

  protected selectMobileTab(tab: MobileTab): void {
    this.mobileTab.set(tab);
    if (tab !== 'transcript') this.inspectorTab.set(tab);
  }

  protected onKey(e: KeyboardEvent): void {
    if (this.tourOpen()) return;
    const target = e.target as HTMLElement;
    // A confirmation dialog is open (app-confirm): its keys are its own.
    if (target.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.store.redo();
      else this.store.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.store.redo();
    } else if (e.key === ' ' && !target.closest('button')) {
      e.preventDefault();
      this.store.togglePlay();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.selection().size) {
      e.preventDefault();
      this.store.toggleDeleteSelection();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.selectedCut()) {
      e.preventDefault();
      this.store.removeCut(this.store.selectedCut()!);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.selectedSpeed()) {
      e.preventDefault();
      this.store.removeSpeed(this.store.selectedSpeed()!);
    } else if (e.key === 'Escape') {
      if (this.autoOpen()) this.closeAutoEdit();
      else if (this.exportOpen()) this.closeExport();
      else {
        this.store.selection.set(new Set());
        this.store.selectedCut.set(null);
        this.store.selectedSpeed.set(null);
      }
    } else if (mod || e.altKey) {
      return;
    } else if (e.key === 'i' || e.key === 'o') {
      this.store.setMark(e.key === 'i' ? 'in' : 'out');
    } else if (e.key === 'x') {
      if (!this.store.cutMarked()) this.store.notify('editor.timeline.selectFirst', undefined, 'error');
    } else if (e.key === 'Enter' && this.store.selection().size) {
      e.preventDefault();
      this.transcriptRef()?.startCorrection();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.shiftKey ? 5 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
      this.store.seek(this.store.currentTime() + step);
    }
  }
}
