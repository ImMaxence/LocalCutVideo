import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { supportsSavePicker } from '../core/file-access';
import { SILENCE_PRESETS } from '../engine/audio-analysis';
import type { AspectFormat, ExportSettings, Project } from '../engine/model';
import { outputSize } from '../engine/render';
import { formatTime } from '../engine/timeline-math';
import { Icon } from '../shared/icon';
import { LangPicker } from '../shared/lang-picker';
import { Logo } from '../shared/logo';
import { type AutoEditOptions, type AutoStepId, EditorStore } from './editor.store';
import { INSPECTOR_TABS, Inspector, type InspectorTab } from './inspector/inspector';
import { Preview } from './preview/preview';
import { Timeline } from './timeline/timeline';
import { Transcript } from './transcript/transcript';

type MobileTab = 'transcript' | InspectorTab;

const MOBILE_QUERY = '(max-width: 760px)';

@Component({
  selector: 'app-editor',
  imports: [RouterLink, TranslocoPipe, Icon, Logo, LangPicker, Preview, Timeline, Transcript, Inspector],
  providers: [EditorStore],
  templateUrl: './editor.html',
  styleUrl: './editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Editor {
  readonly id = input.required<string>();
  protected readonly store = inject(EditorStore);
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

  /** Phones get their own layout: preview on top, tools in a bottom tab bar. */
  protected readonly mobile = signal(matchMedia(MOBILE_QUERY).matches);
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
      if (!String((e as Error)?.message).includes('CANCELLED')) this.store.notify('errors.transcribe', undefined, 'error');
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
    if (id === 'analyze') return this.store.audioProgress();
    if (id === 'voice') return this.store.voiceProgress();
    if (id === 'transcribe') return this.store.transcription()?.progress ?? null;
    if (id === 'framing') return this.store.faceProgress();
    return null;
  }

  protected openExport(): void {
    this.store.resetExport();
    this.exportOpen.set(true);
  }

  protected closeExport(): void {
    if (this.store.exportState().status === 'running') return;
    this.exportOpen.set(false);
  }

  protected selectMobileTab(tab: MobileTab): void {
    this.mobileTab.set(tab);
    if (tab !== 'transcript') this.inspectorTab.set(tab);
  }

  protected onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
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
