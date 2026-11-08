import { ChangeDetectionStrategy, Component, computed, inject, input, model, output, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { spokenLanguageName, spokenLanguageOptions } from '../../core/spoken-languages';
import { SILENCE_PRESETS } from '../../engine/audio-analysis';
import type { ThumbStyle } from '../../engine/thumbnail';
import {
  type AspectFormat,
  type CaptionPosition,
  type CaptionStyle,
  type Project,
  type SilenceSettings,
  type TextOverlay,
  type TransitionStyle,
  type WhisperModel,
  clipHasVoice,
  defaultCaptionWords,
} from '../../engine/model';
import type { PlacedClip } from '../../engine/sequence';
import { formatTime, nextKeptTime } from '../../engine/timeline-math';
import { ConfirmService } from '../../shared/confirm';
import { Icon } from '../../shared/icon';
import { Select, type SelectOption } from '../../shared/select';
import { EditorStore } from '../editor.store';

export type InspectorTab = 'clips' | 'format' | 'cuts' | 'captions' | 'texts' | 'framing' | 'audio';

export const INSPECTOR_TABS: { id: InspectorTab; icon: string }[] = [
  { id: 'clips', icon: 'layers' },
  { id: 'format', icon: 'crop' },
  { id: 'cuts', icon: 'scissors' },
  { id: 'captions', icon: 'captions' },
  { id: 'texts', icon: 'type' },
  { id: 'framing', icon: 'face' },
  { id: 'audio', icon: 'volume' },
];

/** Approximate one-time download per model (WASM / WebGPU variants differ slightly). */
const MODEL_SIZES: Record<WhisperModel, string> = { tiny: '≈ 40 MB', base: '≈ 80 MB', small: '≈ 250 MB' };

@Component({
  selector: 'app-inspector',
  imports: [TranslocoPipe, Icon, Select],
  templateUrl: './inspector.html',
  styleUrl: './inspector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Inspector {
  protected readonly store = inject(EditorStore);
  private readonly transloco = inject(TranslocoService);
  private readonly confirm = inject(ConfirmService);
  readonly transcribe = output<'missing' | 'all'>();
  /** The mobile layout drives the tab from its bottom bar and hides the inner tab bar. */
  readonly tab = model<InspectorTab>('format');
  readonly showTabs = input(true);
  protected readonly dragIndex = signal<number | null>(null);
  protected readonly overIndex = signal<number | null>(null);

  protected readonly tabs = INSPECTOR_TABS;
  protected readonly formats: { id: AspectFormat; icon: string; key: string }[] = [
    { id: '16:9', icon: 'ratio-16-9', key: 'landscape' },
    { id: '9:16', icon: 'ratio-9-16', key: 'vertical' },
    { id: '1:1', icon: 'ratio-1-1', key: 'square' },
  ];
  protected readonly models: WhisperModel[] = ['tiny', 'base', 'small'];
  protected readonly modelSizes = MODEL_SIZES;
  protected readonly presets = SILENCE_PRESETS;
  protected readonly styles: CaptionStyle[] = ['karaoke', 'clean', 'boxed'];
  protected readonly positions: CaptionPosition[] = ['top', 'center', 'bottom'];
  protected readonly transitions: TransitionStyle[] = ['none', 'dip', 'black'];
  protected readonly swatches = ['#ffd60a', '#39ff88', '#4dd8ff', '#ff4d8d', '#ffffff'];
  protected readonly formatTime = formatTime;

  protected readonly p = computed(() => this.store.project()!);
  protected readonly removedSeconds = computed(() => this.store.duration() - this.store.outputDuration());
  protected readonly textStyles: ThumbStyle[] = ['outline', 'shadow', 'box', 'highlight'];
  protected readonly textColors = ['#ffffff', '#ffd60a', '#111111'];
  protected readonly textAccents = ['#ffd60a', '#ff4d8d', '#39ff88', '#4dd8ff', '#ff7a1a'];
  protected readonly selectedText = computed(() => {
    const id = this.store.selectedText();
    return (id && this.p().texts?.find((t) => t.id === id)) || null;
  });

  protected selectText(text: TextOverlay): void {
    this.store.selectedText.set(text.id);
    this.store.seek(text.start + 0.01);
  }

  protected excerpt(text: string): string {
    const plain = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    return plain.length > 40 ? `${plain.slice(0, 38)}…` : plain;
  }

  /** Clips where nobody speaks: only real dead air is cut there. */
  protected readonly silentClips = computed(() => this.p().clips.filter((c) => !clipHasVoice(c)).length);
  private lastVolume = 1;

  protected readonly preset = computed(() => {
    const s = this.p().silence;
    return SILENCE_PRESETS.find((x) => Math.abs(x.minSilence - s.minSilence) < 0.01 && Math.abs(x.padding - s.padding) < 0.005)?.id ?? null;
  });

  private readonly lang = toSignal(inject(TranslocoService).langChanges$);
  protected readonly languageOptions = computed<SelectOption[]>(() => {
    this.lang();
    return spokenLanguageOptions(this.transloco.translate('editor.transcribe.auto'), this.transloco.getActiveLang());
  });

  /**
   * Sets a nested project field from the template (e.g. `patch('captions.size', 1.2)`).
   * Slider gestures pass a `coalesce` key so one drag is one undo step.
   */
  protected patch(path: string, value: unknown, coalesce?: string): void {
    this.store.update(
      (draft: Project) => {
        const keys = path.split('.');
        let target = draft as unknown as Record<string, unknown>;
        for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
        target[keys[keys.length - 1]] = value;
      },
      { coalesce },
    );
  }

  protected silence(patch: Partial<SilenceSettings>, coalesce?: string): void {
    this.store.setSilence(patch, coalesce);
  }

  /** Changing the shape also adapts the caption length, unless the user customized it. */
  protected setFormat(format: AspectFormat): void {
    this.store.update((d) => {
      if (d.captions.maxWords === defaultCaptionWords(d.format)) d.captions.maxWords = defaultCaptionWords(format);
      d.format = format;
    });
  }

  protected num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  /** Read from the project (the placed clips do not follow voice changes). */
  protected voiceOf(clipId: string): boolean {
    const clip = this.p().clips.find((c) => c.id === clipId);
    return clip ? clipHasVoice(clip) : true;
  }

  protected toggleMute(): void {
    const volume = this.p().audio.volume;
    if (volume > 0) this.lastVolume = volume;
    this.patch('audio.volume', volume > 0 ? 0 : this.lastVolume || 1);
  }

  /** Leveling correction of a clip, in dB. */
  protected levelDb(clipId: string): string {
    const volume = this.p().audio.volume || 1;
    const db = 20 * Math.log10((this.store.clipGains().get(clipId) ?? volume) / volume);
    return `${db >= 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
  }

  protected detect(): void {
    const n = this.store.detectSilences();
    this.store.notify('editor.cuts.detected', { count: n });
  }

  protected spokenLanguage(): string {
    return this.store.whisperLanguage() ?? 'auto';
  }

  /** Localized name of any language Whisper may detect (not only the ones of the list). */
  protected languageName(code: string): string {
    this.lang();
    return spokenLanguageName(code, this.transloco.getActiveLang());
  }

  protected setSpokenLanguage(v: string): void {
    this.store.whisperLanguage.set(v === 'auto' ? null : v);
  }

  protected async retranscribe(): Promise<void> {
    const edited = this.p().words.some((w) => w.deleted);
    if (!edited || (await this.confirm.ask({ text: 'editor.transcribe.confirmAll', confirm: 'editor.transcribe.rerun', danger: true }))) {
      this.transcribe.emit('all');
    }
  }

  protected sourceLabel(): string {
    const clips = this.p().clips;
    if (clips.length > 1) return this.transloco.translate('editor.clips.summary', { count: clips.length, time: formatTime(this.store.duration()) });
    const s = clips[0]?.source;
    return s ? `${s.width}×${s.height} · ${Math.round(s.fps)} fps · ${formatTime(s.duration)}` : '';
  }

  // Clips ----------------------------------------------------------------------------------------

  /** Goes to the first frame of the clip that is kept in the edit (its start is often a cut silence). */
  protected jumpTo(clip: PlacedClip): void {
    const t = nextKeptTime(this.store.segments(), clip.start);
    this.store.seek(t !== null && t < clip.end ? t : clip.start);
  }

  protected async removeClip(clip: PlacedClip): Promise<void> {
    const ok = await this.confirm.ask({ text: 'editor.clips.confirmRemove', params: { name: clip.source.name }, confirm: 'editor.clips.remove', danger: true });
    if (ok) this.store.removeClip(clip.id);
  }

  protected onDragStart(index: number, e: DragEvent): void {
    this.dragIndex.set(index);
    e.dataTransfer?.setData('text/plain', String(index));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  protected onDragOver(index: number, e: DragEvent): void {
    if (this.dragIndex() === null) return;
    e.preventDefault();
    this.overIndex.set(index);
  }

  protected onDrop(index: number, e: DragEvent): void {
    e.preventDefault();
    const from = this.dragIndex();
    const clip = from === null ? undefined : this.store.clips()[from];
    if (clip) this.store.moveClip(clip.id, index);
    this.dragIndex.set(null);
    this.overIndex.set(null);
  }

  protected onDragEnd(): void {
    this.dragIndex.set(null);
    this.overIndex.set(null);
  }
}
