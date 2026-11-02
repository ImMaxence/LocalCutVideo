import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { type ThemeMode, ThemeService } from '../core/theme.service';
import { Icon } from './icon';

const MODES: { id: ThemeMode; icon: string }[] = [
  { id: 'system', icon: 'monitor' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
];

/** Three-way theme switch (system / light / dark) with a sliding thumb. */
@Component({
  selector: 'app-theme-switch',
  imports: [Icon, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.labelled]': 'labels()' },
  template: `
    <div class="switch" role="radiogroup" [attr.aria-label]="'theme.label' | transloco">
      <span class="thumb" [style.--i]="index()" aria-hidden="true"></span>
      @for (m of modes; track m.id) {
        <button
          type="button"
          role="radio"
          [class.active]="theme.mode() === m.id"
          [attr.aria-checked]="theme.mode() === m.id"
          [attr.aria-label]="'theme.' + m.id | transloco"
          [title]="'theme.' + m.id | transloco"
          (click)="theme.mode.set(m.id)"
        >
          <app-icon [name]="m.icon" [size]="15" />
          @if (labels()) {
            <span>{{ 'theme.' + m.id | transloco }}</span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    :host(.labelled) {
      display: flex;
      width: 100%;
    }
    .switch {
      position: relative;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      padding: 3px;
      border-radius: 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      width: 100%;
    }
    .thumb {
      position: absolute;
      top: 3px;
      bottom: 3px;
      inset-inline-start: 3px;
      width: calc((100% - 6px) / 3);
      border-radius: 8px;
      background: var(--bg-elev);
      box-shadow: var(--shadow-sm);
      transform: translateX(calc(var(--i) * 100%));
      transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
      &:dir(rtl) {
        transform: translateX(calc(var(--i) * -100%));
      }
    }
    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 30px;
      min-width: 32px;
      padding: 0 8px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: color 0.15s;
      &:hover,
      &.active {
        color: var(--text);
      }
      &.active {
        color: var(--accent);
      }
    }
    :host(.labelled) button {
      height: 36px;
    }
  `,
})
export class ThemeSwitch {
  readonly labels = input(false);
  protected readonly theme = inject(ThemeService);
  protected readonly modes = MODES;
  protected readonly index = computed(() => MODES.findIndex((m) => m.id === this.theme.mode()));
}
