import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DownloadMeter, formatBytes, formatSpeed } from '../engine/download-stats';

const REFRESH_MS = 500;

/** What a model download has done so far: amount received, speed and what is left. */
@Component({
  selector: 'app-download-progress',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (params(); as p) {
      <small>{{ 'common.downloadStats' | transloco: p }}</small>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    small {
      font-size: 12.5px;
      font-weight: 400;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class DownloadProgress {
  readonly loaded = input.required<number>();
  readonly total = input.required<number>();

  private readonly transloco = inject(TranslocoService);
  private readonly meter = new DownloadMeter();
  private shownAt = 0;
  protected readonly params = signal<{ done: string; total: string; left: string; speed: string } | null>(null);

  constructor() {
    effect(() => {
      const loaded = this.loaded();
      const total = this.total();
      untracked(() => {
        const now = performance.now();
        const stats = this.meter.add(loaded, total, now);
        // Refreshed at a readable pace: a download reports hundreds of times per second.
        if (this.params() && now - this.shownAt < REFRESH_MS) return;
        this.shownAt = now;
        const locale = this.transloco.getActiveLang();
        this.params.set({
          done: formatBytes(stats.loaded, locale),
          total: formatBytes(stats.total, locale),
          left: formatBytes(stats.left, locale),
          speed: stats.speed === null ? '…' : formatSpeed(stats.speed, locale),
        });
      });
    });
  }
}
