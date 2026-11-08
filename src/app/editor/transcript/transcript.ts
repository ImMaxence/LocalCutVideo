import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { isFiller } from '../../engine/fillers';
import type { Word } from '../../engine/model';
import { formatTime } from '../../engine/timeline-math';
import { Icon } from '../../shared/icon';
import { ReportDownload } from '../../shared/report-download';
import { EditorStore } from '../editor.store';
import { SpeedMenu } from '../speed-menu';

interface Paragraph {
  start: number;
  words: { word: Word; index: number; filler: boolean }[];
}

/**
 * Text-based editing: the transcript is the edit. Select words (click, drag or shift-click),
 * then press Delete to cut them from the video (again to bring them back), or Correct to
 * retype what Whisper misheard.
 */
@Component({
  selector: 'app-transcript',
  imports: [TranslocoPipe, Icon, SpeedMenu, ReportDownload],
  templateUrl: './transcript.html',
  styleUrl: './transcript.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Transcript {
  protected readonly store = inject(EditorStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly transcribe = output<void>();
  readonly autoEdit = output<void>();

  protected readonly correcting = signal(false);
  protected readonly draft = signal('');
  protected readonly formatTime = formatTime;
  private anchor = -1;
  private dragging = false;
  private moved = false;

  protected readonly words = computed(() => this.store.project()?.words ?? []);
  protected readonly paragraphs = computed<Paragraph[]>(() => {
    const result: Paragraph[] = [];
    let current: Paragraph | null = null;
    this.words().forEach((word, index) => {
      const prev = this.words()[index - 1];
      if (!current || (prev && word.start - prev.end > 1.5)) {
        current = { start: word.start, words: [] };
        result.push(current);
      }
      current.words.push({ word, index, filler: isFiller(word) });
    });
    return result;
  });
  protected readonly fillerCount = computed(() => this.words().filter((w) => !w.deleted && isFiller(w)).length);
  protected readonly deletedCount = computed(() => this.words().filter((w) => w.deleted).length);
  protected readonly activeId = computed(() => {
    const t = this.store.currentTime();
    const words = this.words();
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const w = words[found];
    return w && t < (words[found + 1]?.start ?? w.end + 1) ? w.id : null;
  });

  constructor() {
    const stop = () => (this.dragging = false);
    document.addEventListener('mouseup', stop);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('mouseup', stop));

    // Keep the spoken word visible while playing.
    effect(() => {
      const id = this.activeId();
      if (!id || !this.store.playing()) return;
      const el = this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  protected onMouseDown(index: number, e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.dragging = true;
    this.moved = false;
    if (e.shiftKey && this.anchor >= 0) this.selectRange(this.anchor, index);
    else {
      this.anchor = index;
      this.selectRange(index, index);
    }
  }

  protected onMouseEnter(index: number): void {
    if (!this.dragging || this.anchor < 0) return;
    this.moved = true;
    this.selectRange(this.anchor, index);
  }

  protected onClick(word: Word, e: MouseEvent): void {
    if (!this.moved && !e.shiftKey) this.store.seek(word.start);
  }

  private selectRange(a: number, b: number): void {
    const [from, to] = a < b ? [a, b] : [b, a];
    this.store.selection.set(new Set(this.words().slice(from, to + 1).map((w) => w.id)));
  }

  /** Opens the correction box with the selected words, ready to be retyped. */
  startCorrection(): void {
    const ids = this.store.selection();
    const selected = this.words().filter((w) => ids.has(w.id));
    if (!selected.length) return;
    this.draft.set(selected.map((w) => w.text).join(' '));
    this.correcting.set(true);
    requestAnimationFrame(() => {
      const box = this.host.nativeElement.querySelector<HTMLTextAreaElement>('.correction textarea');
      box?.focus();
      box?.select();
    });
  }

  protected applyCorrection(): void {
    this.store.replaceWords(this.store.selection(), this.draft());
    this.correcting.set(false);
  }

  protected onCorrectionKey(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.applyCorrection();
    } else if (e.key === 'Escape') {
      this.correcting.set(false);
    }
  }

  protected value(e: Event): string {
    return (e.target as HTMLTextAreaElement).value;
  }

  protected removeFillers(): void {
    this.store.removeFillers();
  }

  protected clearSelection(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.store.selection.set(new Set());
  }

  protected selectionSize(): number {
    return this.store.selection().size;
  }
}
