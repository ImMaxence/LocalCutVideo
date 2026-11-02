import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LANGUAGES, type LangCode, LanguageService } from '../core/i18n';
import type { Language } from '../core/languages';
import { Flag } from './flag';
import { Icon } from './icon';

let uid = 0;

/** Lower case without accents, for the filter: 'Français' → 'francais'. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Names of languages in a language ('de' in French: 'Allemand'), empty when the browser cannot tell. */
function namesIn(lang: string): (tag: string) => string {
  try {
    const names = new Intl.DisplayNames([lang], { type: 'language' });
    return (tag) => {
      // zh-Hans / zh-Hant read better than "Chinese (China)" / "Chinese (Taiwan)".
      const name = names.of(tag.replace('zh-CN', 'zh-Hans').replace('zh-TW', 'zh-Hant')) ?? '';
      return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
    };
  } catch {
    return () => '';
  }
}

interface Entry {
  language: Language;
  /** Name in the interface language, even when it reads like the language's own name. */
  name: string;
  /** What the filter matches: own name, code, name in the interface language and in English. */
  search: string;
}

/**
 * Language selector with flags and a filter. `menu` is a select-like dropdown (header, editor),
 * `list` shows every language at once (mobile menu).
 */
@Component({
  selector: 'app-lang-picker',
  imports: [Flag, Icon, NgTemplateOutlet, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.list]': "variant() === 'list'",
    '[class.compact]': 'compact()',
    '(document:pointerdown)': 'onOutside($event)',
  },
  template: `
    <ng-template #search let-combobox>
      <label class="search">
        <app-icon name="search" [size]="15" />
        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          [attr.role]="combobox ? 'combobox' : null"
          [attr.aria-expanded]="combobox ? true : null"
          [attr.aria-controls]="combobox ? id + '-list' : null"
          [attr.aria-activedescendant]="combobox ? focusedId() : null"
          [attr.aria-label]="'nav.searchLanguage' | transloco"
          [placeholder]="'nav.searchLanguage' | transloco"
          [value]="query()"
          (input)="filter($event)"
          (keydown)="combobox && onMenuKey($event)"
        />
      </label>
    </ng-template>

    @if (variant() === 'list') {
      <ng-container [ngTemplateOutlet]="search" [ngTemplateOutletContext]="{ $implicit: false }" />
      <div class="grid" role="radiogroup" [attr.aria-label]="'nav.language' | transloco">
        @for (e of filtered(); track e.language.code) {
          <button
            type="button"
            role="radio"
            class="item"
            [class.active]="e.language.code === current()"
            [attr.aria-checked]="e.language.code === current()"
            (click)="choose(e.language.code)"
          >
            <app-flag [code]="e.language.flag" />
            <span [attr.lang]="e.language.tag">{{ e.language.label }}</span>
          </button>
        } @empty {
          <p class="empty">{{ 'nav.noLanguage' | transloco }}</p>
        }
      </div>
    } @else {
      <button
        type="button"
        class="trigger"
        aria-haspopup="listbox"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'nav.language' | transloco"
        [title]="currentLanguage().label"
        (click)="toggle()"
        (keydown)="onTriggerKey($event)"
      >
        <app-flag [code]="currentLanguage().flag" />
        @if (compact()) {
          <span class="code">{{ currentLanguage().code }}</span>
        } @else {
          <span class="label" [attr.lang]="currentLanguage().tag">{{ currentLanguage().label }}</span>
        }
        <app-icon name="chevron" [size]="14" class="chev" />
      </button>
      @if (open()) {
        <div class="panel" animate.enter="menu-in" animate.leave="menu-out">
          <ng-container [ngTemplateOutlet]="search" [ngTemplateOutletContext]="{ $implicit: true }" />
          <ul class="options" role="listbox" [id]="id + '-list'" [attr.aria-label]="'nav.language' | transloco">
            @for (e of filtered(); track e.language.code; let i = $index) {
              <li
                role="option"
                [id]="id + '-' + e.language.code"
                [attr.aria-selected]="e.language.code === current()"
                [class.active]="e.language.code === current()"
                [class.focused]="i === focus()"
                (pointerenter)="focus.set(i)"
                (click)="choose(e.language.code)"
              >
                <app-flag [code]="e.language.flag" />
                <span class="native" [attr.lang]="e.language.tag">{{ e.language.label }}</span>
                <span class="name">{{ e.name }}</span>
                @if (e.language.code === current()) {
                  <app-icon name="check" [size]="15" class="tick" />
                }
              </li>
            } @empty {
              <li class="empty" role="presentation">{{ 'nav.noLanguage' | transloco }}</li>
            }
          </ul>
        </div>
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
      padding: 0 9px 0 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-elev);
      color: var(--text);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition:
        border-color 0.15s,
        box-shadow 0.15s,
        background 0.15s;
      &:hover {
        border-color: var(--border-strong);
      }
      &[aria-expanded='true'] {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
    }
    .code {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .chev {
      color: var(--text-muted);
      transition: transform 0.2s;
      [aria-expanded='true'] & {
        transform: rotate(180deg);
      }
    }
    .panel {
      position: absolute;
      top: calc(100% + 8px);
      inset-inline-end: 0;
      z-index: 70;
      display: grid;
      gap: 6px;
      width: 340px;
      max-width: calc(100vw - 32px);
      padding: 6px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: var(--bg-elev);
      box-shadow: var(--shadow-lg);
      transform-origin: top right;
    }
    :host-context([dir='rtl']) .panel {
      transform-origin: top left;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 38px;
      padding: 0 11px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      color: var(--text-faint);
      cursor: text;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
      &:focus-within {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
        color: var(--accent);
      }
      input {
        flex: 1;
        min-width: 0;
        height: 100%;
        padding: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--text);
        font-size: 14px;
        &::placeholder {
          color: var(--text-faint);
        }
      }
    }
    .options {
      max-height: min(360px, calc(100dvh - 170px));
      overflow-y: auto;
      overscroll-behavior: contain;
      margin: 0;
      padding: 0;
      list-style: none;
      li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 9px;
        font-size: 14px;
        font-weight: 550;
        white-space: nowrap;
        cursor: pointer;
        &.focused {
          background: var(--surface-hover);
        }
        &.active {
          color: var(--accent);
        }
        &.empty {
          justify-content: center;
          padding: 18px 10px;
          color: var(--text-muted);
          cursor: default;
        }
      }
      .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: end;
        font-size: 12.5px;
        font-weight: 500;
        color: var(--text-faint);
      }
      .tick {
        flex: none;
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
    :host(.list) {
      display: grid;
      gap: 10px;
      width: 100%;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 6px;
      max-height: 300px;
      overflow-y: auto;
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
      min-width: 0;
      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      &.active {
        border-color: var(--accent);
        background: var(--accent-soft);
        color: var(--accent);
      }
    }
    .grid .empty {
      grid-column: 1 / -1;
      margin: 0;
      padding: 12px;
      text-align: center;
      color: var(--text-muted);
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
  /** Flag and language code only, the names stay in the menu (crowded headers). */
  readonly compact = input(false);
  private readonly language = inject(LanguageService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly id = `lang${++uid}`;
  protected readonly open = signal(false);
  protected readonly query = signal('');
  /** Focused option, an index in `filtered()`. */
  protected readonly focus = signal(0);
  protected readonly current = toSignal(inject(TranslocoService).langChanges$, { initialValue: this.language.active }) as () => LangCode;
  protected readonly currentLanguage = computed(() => LANGUAGES.find((l) => l.code === this.current()) ?? LANGUAGES[0]);

  private readonly entries = computed<Entry[]>(() => {
    const local = namesIn(this.currentLanguage().tag);
    const english = namesIn('en');
    return LANGUAGES.map((language) => {
      const name = local(language.tag);
      return {
        language,
        name,
        search: fold([language.label, language.code, name, english(language.tag)].join(' ')),
      };
    });
  });

  protected readonly filtered = computed(() => {
    const query = fold(this.query().trim());
    return query ? this.entries().filter((e) => e.search.includes(query)) : this.entries();
  });

  protected readonly focusedId = computed(() => {
    const entry = this.filtered()[this.focus()];
    return entry ? `${this.id}-${entry.language.code}` : null;
  });

  protected toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  private show(): void {
    this.query.set('');
    this.focus.set(Math.max(0, LANGUAGES.findIndex((l) => l.code === this.current())));
    this.open.set(true);
    // The panel is rendered on the next frame: then the filter takes the keyboard.
    requestAnimationFrame(() => {
      this.host.nativeElement.querySelector<HTMLInputElement>('.panel input')?.focus();
      this.revealFocused();
    });
  }

  /** Keeps the focused language visible in the scrolling list. */
  private revealFocused(): void {
    const id = this.focusedId();
    if (id) this.host.nativeElement.querySelector(`[id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private close(refocus = false): void {
    this.open.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('.trigger')?.focus();
  }

  protected filter(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
    this.focus.set(0);
  }

  protected choose(code: LangCode): void {
    this.query.set('');
    this.language.choose(code);
    this.close(this.variant() === 'menu');
  }

  protected onTriggerKey(e: KeyboardEvent): void {
    if (!this.open() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      this.show();
    }
  }

  /** Keys of the filter field: arrows move through the list, Enter picks, Escape closes. */
  protected onMenuKey(e: KeyboardEvent): void {
    const last = this.filtered().length - 1;
    if (e.key === 'ArrowDown') this.focus.update((i) => (i >= last ? 0 : i + 1));
    else if (e.key === 'ArrowUp') this.focus.update((i) => (i <= 0 ? last : i - 1));
    else if (e.key === 'Enter') {
      const entry = this.filtered()[this.focus()];
      if (entry) this.choose(entry.language.code);
    } else if (e.key === 'Escape') this.close(true);
    else {
      // Tab keeps its default behavior (moving focus on) and simply closes the menu.
      if (e.key === 'Tab') this.close();
      return;
    }
    e.preventDefault();
    if (this.open()) requestAnimationFrame(() => this.revealFocused());
  }

  protected onOutside(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.close();
  }
}
