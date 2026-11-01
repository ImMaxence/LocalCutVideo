import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from '../../shared/icon';

/** A step of the guided tour: what to point at (first visible match) and the text key. */
export interface TourStep {
  targets: string[];
  key: string;
}

type Placement = 'below' | 'above' | 'right' | 'left' | 'center';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 16;
const MARGIN = 12;

function sameBox(a: Box | null, b: Box | null): boolean {
  return !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Guided tour of the editor: the current element is lit up (the rest of the page darkens) and a
 * bubble with an arrow points at it and explains it. The page stays usable underneath. Steps
 * whose element is not on screen (phone layout) are skipped.
 */
@Component({
  selector: 'app-tour',
  imports: [TranslocoPipe, Icon],
  templateUrl: './tour.html',
  styleUrl: './tour.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)', '(window:resize)': 'refresh()' },
})
export class Tour {
  readonly steps = input.required<TourStep[]>();
  readonly closed = output<void>();

  private readonly bubbleRef = viewChild<ElementRef<HTMLElement>>('bubble');
  protected readonly index = signal(0);
  protected readonly spot = signal<Box | null>(null);
  private readonly bubbleSize = signal({ width: 340, height: 180 });
  private target: Element | null = null;
  private raf = 0;

  /** The steps whose element exists and is visible now. */
  protected readonly available = computed(() => this.steps().filter((s) => !!this.find(s)));
  protected readonly step = computed(() => this.available()[Math.min(this.index(), this.available().length - 1)]);
  protected readonly last = computed(() => this.index() >= this.available().length - 1);

  /** Where the bubble goes, and where its arrow points (offset along the bubble edge). */
  protected readonly position = computed(() => {
    const s = this.spot();
    const { width: bw, height: bh } = this.bubbleSize();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!s) return { placement: 'center' as Placement, x: (vw - bw) / 2, y: (vh - bh) / 2, arrow: 0 };
    const cx = s.left + s.width / 2;
    const cy = s.top + s.height / 2;
    const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - bw - MARGIN);
    const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - bh - MARGIN);
    const arrowX = (x: number) => Math.min(Math.max(cx - x, 22), bw - 22);
    const arrowY = (y: number) => Math.min(Math.max(cy - y, 22), bh - 22);
    if (vh - (s.top + s.height) >= bh + GAP + MARGIN) {
      const x = clampX(cx - bw / 2);
      return { placement: 'below' as Placement, x, y: s.top + s.height + GAP, arrow: arrowX(x) };
    }
    if (s.top >= bh + GAP + MARGIN) {
      const x = clampX(cx - bw / 2);
      return { placement: 'above' as Placement, x, y: s.top - bh - GAP, arrow: arrowX(x) };
    }
    if (vw - (s.left + s.width) >= bw + GAP + MARGIN) {
      const y = clampY(cy - bh / 2);
      return { placement: 'right' as Placement, x: s.left + s.width + GAP, y, arrow: arrowY(y) };
    }
    if (s.left >= bw + GAP + MARGIN) {
      const y = clampY(cy - bh / 2);
      return { placement: 'left' as Placement, x: s.left - bw - GAP, y, arrow: arrowY(y) };
    }
    // Huge element (or tiny screen): the bubble sits over it, at the bottom of the screen.
    return { placement: 'center' as Placement, x: (vw - bw) / 2, y: vh - bh - MARGIN, arrow: 0 };
  });

  constructor() {
    afterNextRender(() => {
      const loop = () => {
        this.refresh();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
  }

  /** Follows the element (layout changes, scrolling) and the bubble's own size. */
  protected refresh(): void {
    const step = this.step();
    const target = step ? this.find(step) : null;
    if (target !== this.target) {
      this.target = target;
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const r = target?.getBoundingClientRect();
    const box = r ? { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
    if (!sameBox(box, this.spot()) && (box || this.spot())) this.spot.set(box);
    const bubble = this.bubbleRef()?.nativeElement.getBoundingClientRect();
    if (bubble && (bubble.width !== this.bubbleSize().width || bubble.height !== this.bubbleSize().height)) {
      this.bubbleSize.set({ width: bubble.width, height: bubble.height });
    }
  }

  private find(step: TourStep): Element | null {
    for (const selector of step.targets) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  protected next(): void {
    if (this.last()) this.closed.emit();
    else this.index.update((i) => i + 1);
  }

  protected prev(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.closed.emit();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') this.next();
    else if (e.key === 'ArrowLeft') this.prev();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
