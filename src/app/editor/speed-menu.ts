import { ChangeDetectionStrategy, Component, ElementRef, inject, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { SPEED_RATES } from '../engine/model';
import { Icon } from '../shared/icon';

/**
 * "Speed" button and its menu of rates, for the part selected on the timeline or in the
 * transcript. The button is never greyed out: without a selection it emits `missing`, so the
 * editor can explain how to select a part instead of leaving the user guessing.
 */
@Component({
  selector: 'app-speed-menu',
  imports: [TranslocoPipe, Icon],
  template: `
    <button
      class="btn sm"
      type="button"
      [class.ready]="ready()"
      [attr.aria-expanded]="open()"
      aria-haspopup="menu"
      (click)="toggle()"
      [title]="'editor.timeline.speedHint' | transloco"
    >
      <app-icon name="gauge" [size]="14" /> {{ 'editor.timeline.speed' | transloco }}
    </button>
    @if (open()) {
      <span class="menu" role="menu" animate.enter="pop-in">
        @for (r of rates; track r) {
          <button class="rate" type="button" role="menuitem" (click)="choose(r)">{{ r }}×</button>
        }
      </span>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .btn.ready {
      border-color: var(--speed-solid, #38bdf8);
      color: var(--speed-solid, #38bdf8);
    }
    /* Below the button (the timeline panel clips anything above its toolbar), aligned on its
       right edge so it stays on screen when the button sits at the end of a phone's toolbar. */
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: repeat(4, auto);
      gap: 2px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-elev);
      box-shadow: var(--shadow-lg);
    }
    .rate {
      height: 28px;
      padding: 0 8px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text);
      font: 600 12px var(--mono);
      cursor: pointer;
      &:hover {
        background: var(--surface-hover);
      }
    }
    .pop-in {
      animation: pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    @keyframes pop-in {
      from {
        opacity: 0;
        transform: scale(0.96);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)' },
})
export class SpeedMenu {
  /** Whether a part is selected. */
  readonly ready = input(false);
  readonly pick = output<number>();
  /** Pressed without a selection. */
  readonly missing = output<void>();

  protected readonly rates = SPEED_RATES;
  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected toggle(): void {
    if (!this.ready()) {
      this.open.set(false);
      this.missing.emit();
      return;
    }
    this.open.update((v) => !v);
  }

  protected choose(rate: number): void {
    this.open.set(false);
    this.pick.emit(rate);
  }

  protected onOutside(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
