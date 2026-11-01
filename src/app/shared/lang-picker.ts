import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { toSignal } from '@angular/core/rxjs-interop';
import { LANGUAGES, type LangCode, LanguageService } from '../core/i18n';
import { Flag } from './flag';
import { Icon } from './icon';

/**
 * Language selector with flags. `menu` is a keyboard-accessible dropdown (header), `list`
 * shows every language at once (mobile menu).
 */
@Component({
  selector: 'app-lang-picker',
  imports: [Flag, Icon, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.list]': "variant() === 'list'",
    '(document:pointerdown)': 'onOutside($event)',
  },
  template: `
    @if (variant() === 'list') {
      <div class="grid" role="radiogroup" [attr.aria-label]="'nav.language' | transloco">
        @for (l of languages; track l.code) {
          <button type="button" role="radio" class="item" [class.active]="l.code === current()" [attr.aria-checked]="l.code === current()" (click)="choose(l.code)">
            <app-flag [code]="l.code" />
            <span>{{ l.label }}</span>
          </button>
        }
      </div>
    } @else {
      <button
        type="button"
        class="trigger"
        aria-haspopup="listbox"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'nav.language' | transloco"
        (click)="toggle()"
        (keydown)="onTriggerKey($event)"
      >
        <app-flag [code]="current()" />
        <span class="label">{{ currentLabel() }}</span>
        <app-icon name="chevron" [size]="14" class="chev" />
      </button>
      @if (open()) {
        <ul class="menu" role="listbox" tabindex="-1" animate.enter="menu-in" animate.leave="menu-out" (keydown)="onMenuKey($event)">
          @for (l of languages; track l.code; let i = $index) {
            <li
              role="option"
              [attr.aria-selected]="l.code === current()"
              [class.active]="l.code === current()"
              [class.focused]="i === focus()"
              (pointerenter)="focus.set(i)"
              (click)="choose(l.code)"
            >
              <app-flag [code]="l.code" />
              <span>{{ l.label }}</span>
              @if (l.code === current()) {
                <app-icon name="check" [size]="15" class="tick" />
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .trigger {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 10px 0 12px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: transparent;
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      &:hover,
      &[aria-expanded='true'] {
        background: var(--surface);
        border-color: var(--border);
      }
    }
    .chev {
      color: var(--text-muted);
      transition: transform 0.2s;
      [aria-expanded='true'] & {
        transform: rotate(180deg);
      }
    }
    .menu {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 70;
      min-width: 190px;
      margin: 0;
      padding: 6px;
      list-style: none;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--bg-elev);
      box-shadow: var(--shadow-lg);
      transform-origin: top right;
      outline: none;
      li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 9px;
        font-size: 14px;
        font-weight: 550;
        cursor: pointer;
        &.focused {
          background: var(--surface-hover);
        }
        &.active {
          color: var(--accent);
        }
      }
      .tick {
        margin-left: auto;
      }
    }
    .menu-in {
      animation: menu-in 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .menu-out {
      animation: menu-in 0.12s ease-in reverse both;
    }
    @keyframes menu-in {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.96);
      }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 6px;
      width: 100%;
    }
    :host(.list) {
      display: flex;
      width: 100%;
    }
    .item {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 42px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: var(--bg-elev);
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      &.active {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }
    }
    @media (max-width: 600px) {
      .label {
        display: none;
      }
    }
  `,
})
export class LangPicker {
  readonly variant = input<'menu' | 'list'>('menu');
  private readonly language = inject(LanguageService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly languages = LANGUAGES;
  protected readonly open = signal(false);
  protected readonly focus = signal(0);
  protected readonly current = toSignal(inject(TranslocoService).langChanges$, { initialValue: this.language.active }) as () => LangCode;
  protected readonly currentLabel = computed(() => LANGUAGES.find((l) => l.code === this.current())?.label ?? '');

  protected toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  private show(): void {
    this.focus.set(Math.max(0, LANGUAGES.findIndex((l) => l.code === this.current())));
    this.open.set(true);
    // The menu is rendered on the next frame; until then the trigger forwards the keys.
    requestAnimationFrame(() => this.host.nativeElement.querySelector<HTMLElement>('.menu')?.focus());
  }

  private close(refocus = false): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('.trigger')?.focus();
  }

  protected choose(code: LangCode): void {
    this.language.set(code);
    this.close(this.variant() === 'menu');
  }

  protected onTriggerKey(e: KeyboardEvent): void {
    if (this.open()) {
      this.onMenuKey(e);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.show();
    }
  }

  protected onMenuKey(e: KeyboardEvent): void {
    const last = LANGUAGES.length - 1;
    if (e.key === 'ArrowDown') this.focus.update((i) => (i >= last ? 0 : i + 1));
    else if (e.key === 'ArrowUp') this.focus.update((i) => (i <= 0 ? last : i - 1));
    else if (e.key === 'Home') this.focus.set(0);
    else if (e.key === 'End') this.focus.set(last);
    else if (e.key === 'Enter' || e.key === ' ') this.choose(LANGUAGES[this.focus()].code);
    else if (e.key === 'Escape') this.close(true);
    else {
      // Tab keeps its default behavior (moving focus on) and simply closes the menu.
      if (e.key === 'Tab') this.close();
      return;
    }
    e.preventDefault();
  }

  protected onOutside(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}
