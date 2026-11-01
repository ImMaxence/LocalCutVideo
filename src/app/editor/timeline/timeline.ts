import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type WaveSurfer from 'wavesurfer.js';
import type { Region } from 'wavesurfer.js/dist/plugins/regions.js';
import { ThemeService } from '../../core/theme.service';
import { SPEED_RATES } from '../../engine/model';
import { deletedWordRanges, formatTime } from '../../engine/timeline-math';
import { Icon } from '../../shared/icon';
import { EditorStore, MIN_CUT, type SequenceAnalysis } from '../editor.store';
import { SpeedMenu } from '../speed-menu';

type RegionsApi = {
  getRegions(): Region[];
  addRegion(options: Record<string, unknown>): Region;
  enableDragSelection(options: Record<string, unknown>, threshold?: number): () => void;
  on(event: string, cb: (...args: never[]) => void): () => void;
};

/**
 * Scales the waveform on the loudness of the voice (99th percentile) rather than on its single
 * loudest sound, so one bang or clap does not flatten the whole recording.
 */
function displayPeaks(peaks: Float32Array): Float32Array {
  const sorted = Float32Array.from(peaks).sort();
  const reference = sorted[Math.floor(sorted.length * 0.99)] || 1;
  return peaks.map((v) => Math.min(1, (v / reference) * 0.92));
}

/** Resolves a CSS custom property (which may use light-dark()) to a concrete color. */
function cssColor(host: HTMLElement, variable: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${variable})`;
  probe.style.display = 'none';
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/**
 * Waveform timeline of the whole sequence (Wavesurfer.js). The cursor follows the preview and
 * clicking on the waveform seeks. Dragging on it selects a part (the same as Start / End), which
 * is then cut or sped up / slowed down. Cuts and speed changes are regions: click one to select
 * it, drag its edges or nudge them to adjust, double-click to remove. Words deleted in the
 * transcript appear as locked regions, and markers show where each clip starts.
 */
@Component({
  selector: 'app-timeline',
  imports: [TranslocoPipe, Icon, SpeedMenu],
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Lets automated tests wait for the waveform and its regions to be usable.
  host: { '[attr.data-ready]': 'ready() || null' },
})
export class Timeline {
  protected readonly store = inject(EditorStore);
  private readonly theme = inject(ThemeService);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('wave');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly zoom = signal(0);
  protected readonly ready = signal(false);
  /** The selected cut, for the start / end editor in the toolbar. */
  protected readonly selected = computed(() => {
    const id = this.store.selectedCut();
    return (id && this.store.project()?.cuts.find((c) => c.id === id)) || null;
  });
  /** The selected speed change, for the rate editor in the toolbar. */
  protected readonly selectedSpeed = computed(() => {
    const id = this.store.selectedSpeed();
    return (id && this.store.project()?.speeds.find((s) => s.id === id)) || null;
  });
  protected readonly rates = SPEED_RATES;
  protected readonly nudgeStep = 0.1;
  protected readonly edges = [
    { id: 'start', label: 'editor.timeline.markIn' },
    { id: 'end', label: 'editor.timeline.markOut' },
  ] as const;
  protected readonly formatTime = formatTime;

  private ws: WaveSurfer | null = null;
  private regions: RegionsApi | null = null;
  private syncing = false;
  private building = 0;

  private readonly rendered = signal(false);

  constructor() {
    afterNextRender(() => this.rendered.set(true));
    // (Re)build the waveform whenever the sequence changes: clips added, removed or reordered.
    effect(() => {
      const analysis = this.store.analysis();
      const ready = this.store.fileState() === 'ready' && this.rendered();
      if (analysis && ready) untracked(() => void this.create(analysis));
    });

    effect(() => {
      const p = this.store.project();
      this.store.clips();
      this.store.markIn();
      this.store.markOut();
      this.store.selectedCut();
      this.store.selectedSpeed();
      const ready = this.ready();
      if (p && ready) untracked(() => this.syncRegions());
    });

    effect(() => {
      const t = this.store.currentTime();
      if (this.ready()) untracked(() => this.ws?.setTime(t));
    });

    effect(() => {
      this.theme.mode();
      if (this.ready()) untracked(() => this.applyColors());
    });

    const media = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => this.applyColors();
    media.addEventListener('change', onScheme);

    inject(DestroyRef).onDestroy(() => {
      media.removeEventListener('change', onScheme);
      this.ws?.destroy();
    });
  }

  private async create(analysis: SequenceAnalysis): Promise<void> {
    const build = ++this.building;
    const [{ default: WaveSurferCtor }, { default: RegionsPlugin }, { default: TimelinePlugin }] = await Promise.all([
      import('wavesurfer.js'),
      import('wavesurfer.js/dist/plugins/regions.js'),
      import('wavesurfer.js/dist/plugins/timeline.js'),
    ]);
    if (build !== this.building) return;
    this.ready.set(false);
    this.ws?.destroy();
    const regions = RegionsPlugin.create();
    const ws = WaveSurferCtor.create({
      container: this.container().nativeElement,
      peaks: [displayPeaks(analysis.peaks)],
      duration: analysis.duration,
      height: 92,
      normalize: false,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      cursorWidth: 2,
      autoScroll: true,
      autoCenter: false,
      minPxPerSec: this.zoom(),
      plugins: [
        regions,
        TimelinePlugin.create({
          height: 20,
          formatTimeCallback: (s: number) => formatTime(s),
          style: { fontSize: '11px', color: 'var(--text-faint)' },
        }),
      ],
    });
    this.ws = ws;
    this.regions = regions as unknown as RegionsApi;

    // No media element is attached: the preview plays the clips, the waveform only seeks.
    // (No dragToSeek: it swallows the drag that draws a new cut.)
    ws.on('interaction', (t: number) => {
      this.store.seek(t);
      this.store.selectedCut.set(null);
      this.store.selectedSpeed.set(null);
    });
    this.regions.enableDragSelection({ color: 'var(--mark-region)' });
    this.regions.on('region-created', ((region: Region) => {
      if (this.syncing) return;
      // A region drawn by the user selects that part (Start / End): it is then cut or its speed changed.
      region.remove();
      this.store.selectedCut.set(null);
      this.store.selectedSpeed.set(null);
      this.store.markIn.set(region.start);
      this.store.markOut.set(region.end);
    }) as never);
    this.regions.on('region-updated', ((region: Region) => {
      if (region.id.startsWith('cut-')) this.store.updateCut(region.id.slice(4), region.start, region.end);
      if (region.id.startsWith('speed-')) this.store.updateSpeed(region.id.slice(6), region.start, region.end);
      if (region.id === 'mark') {
        this.store.markIn.set(region.start);
        this.store.markOut.set(region.end);
      }
    }) as never);
    this.regions.on('region-clicked', ((region: Region, e: MouseEvent) => {
      e.stopPropagation();
      if (region.id.startsWith('cut-')) {
        this.store.selectedSpeed.set(null);
        this.store.selectedCut.set(region.id.slice(4));
      }
      if (region.id.startsWith('speed-')) {
        this.store.selectedCut.set(null);
        this.store.selectedSpeed.set(region.id.slice(6));
      }
    }) as never);
    this.regions.on('region-double-clicked', ((region: Region, e: MouseEvent) => {
      e.stopPropagation();
      if (region.id.startsWith('cut-')) this.store.removeCut(region.id.slice(4));
      if (region.id.startsWith('speed-')) this.store.removeSpeed(region.id.slice(6));
    }) as never);
    ws.on('ready', () => {
      this.applyColors();
      ws.setTime(this.store.currentTime());
      this.ready.set(true);
    });
  }

  private syncRegions(): void {
    const p = this.store.project();
    const regions = this.regions;
    if (!p || !regions) return;
    this.syncing = true;
    const wanted = new Map<string, { start: number; end?: number; color: string; drag: boolean; content?: string }>();
    const selected = this.store.selectedCut();
    for (const c of p.cuts) {
      wanted.set(`cut-${c.id}`, {
        start: c.start,
        end: c.end,
        color: c.id === selected ? 'var(--cut-selected)' : c.reason === 'silence' ? 'var(--cut-silence)' : 'var(--cut-manual)',
        drag: true,
      });
    }
    const speedSelected = this.store.selectedSpeed();
    for (const s of p.speeds ?? []) {
      wanted.set(`speed-${s.id}`, {
        start: s.start,
        end: s.end,
        color: s.id === speedSelected ? 'var(--speed-selected)' : 'var(--speed)',
        drag: true,
        content: `${s.rate}×`,
      });
    }
    deletedWordRanges(p.words).forEach((r, i) => {
      wanted.set(`word-${i}-${r.start.toFixed(2)}`, { start: r.start, end: r.end, color: 'var(--cut-text)', drag: false });
    });
    // The part chosen with Start / End, adjustable by its edges.
    const a = this.store.markIn();
    const b = this.store.markOut();
    if (a !== null && b !== null) {
      wanted.set('mark', { start: Math.min(a, b), end: Math.max(a, b), color: 'var(--mark-region)', drag: true });
    } else if (a !== null || b !== null) {
      wanted.set(`mark-${a !== null ? 'in' : 'out'}`, { start: (a ?? b)!, color: 'var(--mark-line)', drag: false, content: a !== null ? '[' : ']' });
    }
    const clips = this.store.clips();
    if (clips.length > 1) {
      clips.forEach((c) => {
        wanted.set(`clip-${c.index}-${c.id}`, { start: c.start, color: 'var(--clip-marker)', drag: false, content: `${c.index + 1}` });
      });
    }

    for (const region of regions.getRegions()) {
      const w = wanted.get(region.id);
      if (!w) {
        region.remove();
      } else {
        const end = w.end ?? w.start;
        if (Math.abs(region.start - w.start) > 1e-4 || Math.abs(region.end - end) > 1e-4 || region.color !== w.color) {
          region.setOptions({ start: w.start, end, color: w.color });
        }
        if (w.content !== undefined && region.content?.textContent !== w.content) region.setContent(w.content);
        wanted.delete(region.id);
      }
    }
    for (const [id, w] of wanted) {
      regions.addRegion({ id, start: w.start, end: w.end, color: w.color, drag: w.drag, resize: w.drag, minLength: MIN_CUT, content: w.content });
    }
    this.syncing = false;
    if (selected && !p.cuts.some((c) => c.id === selected)) this.store.selectedCut.set(null);
    if (speedSelected && !p.speeds?.some((s) => s.id === speedSelected)) this.store.selectedSpeed.set(null);
  }

  private applyColors(): void {
    if (!this.ws) return;
    // Wait one frame so a theme switch has been applied to the CSS variables.
    requestAnimationFrame(() => {
      const host = this.host.nativeElement;
      this.ws?.setOptions({
        waveColor: cssColor(host, '--wave'),
        progressColor: cssColor(host, '--wave-progress'),
        cursorColor: cssColor(host, '--text'),
      });
    });
  }

  /** Zoom in pixels per second; 0 fits the whole sequence in the panel. */
  protected readonly maxZoom = 300;

  protected setZoom(e: Event): void {
    this.applyZoom(Number((e.target as HTMLInputElement).value));
  }

  protected zoomBy(direction: 1 | -1): void {
    const current = this.zoom() || this.fitPxPerSec();
    const next = direction > 0 ? current * 1.6 : current / 1.6;
    this.applyZoom(next <= this.fitPxPerSec() * 1.05 ? 0 : Math.min(this.maxZoom, Math.round(next)));
  }

  /** Ctrl/Cmd + wheel zooms around the playhead, like in video editors. */
  protected onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1 : -1);
  }

  applyZoom(value: number): void {
    const ws = this.ws;
    const px = Math.max(0, Math.min(this.maxZoom, value));
    // Below the "fit" density, zooming has no visible effect: snap back to fit.
    const target = px > 0 && px <= this.fitPxPerSec() ? 0 : px;
    this.zoom.set(target);
    if (!ws) return;
    ws.zoom(target);
    // Keep the playhead in the middle of the view after zooming.
    const visible = ws.getWidth() / (target || this.fitPxPerSec());
    ws.setScrollTime(Math.max(0, this.store.currentTime() - visible / 2));
  }

  private fitPxPerSec(): number {
    const width = this.container().nativeElement.clientWidth || 1;
    return width / Math.max(1, this.store.duration());
  }

  protected cut(): void {
    if (!this.store.cutMarked()) this.selectFirst();
  }

  /** Cut or Speed pressed without a selected part: say how to select one. */
  protected selectFirst(): void {
    this.store.notify('editor.timeline.selectFirst', undefined, 'error');
  }

  protected nudge(edge: 'start' | 'end', direction: 1 | -1): void {
    const id = this.store.selectedCut();
    if (id) this.store.nudgeCut(id, edge, direction * this.nudgeStep);
  }

  protected canCut(): boolean {
    const a = this.store.markIn();
    const b = this.store.markOut();
    return a !== null && b !== null && Math.abs(b - a) >= 0.05;
  }

  protected cutCount(): number {
    return this.store.project()?.cuts.length ?? 0;
  }
}
