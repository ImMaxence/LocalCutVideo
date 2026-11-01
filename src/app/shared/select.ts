import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, model, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Flag } from './flag';
import { Icon } from './icon';

export interface SelectOption {
  value: string;
  label: string;
  flag?: string;
  icon?: string;
}

/** Styled, keyboard-accessible replacement for the native <select>. */
@Component({
  selector: 'app-select',
  imports: [Flag, Icon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)' },
  template: `
    <button
      type="button"
      class="trigger"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      (click)="toggle()"
      (keydown)="onKey($event)"
    >
      @if (selected(); as o) {
        <ng-container [ngTemplateOutlet]="optionContent" [ngTemplateOutletContext]="{ $implicit: o }" />
      }
      <app-icon name="chevron" [size]="15" class="chev" />
    </button>
    @if (open()) {
      <ul class="menu" role="listbox" animate.enter="menu-in" animate.leave="menu-out">
        @for (o of options(); track o.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="o.value === value()"
            [class.active]="o.value === value()"
            [class.focused]="i === focus()"
            (pointerenter)="focus.set(i)"
            (click)="choose(o.value)"
          >
            <ng-container [ngTemplateOutlet]="optionContent" [ngTemplateOutletContext]="{ $implicit: o }" />
            @if (o.value === value()) {
              <app-icon name="check" [size]="15" class="tick" />
            }
          </li>
        }
      </ul>
    }
    <ng-template #optionContent let-o>
      @if (o.flag) {
        <app-flag [code]="o.flag" />
      } @else if (o.icon) {
        <app-icon [name]="o.icon" [size]="16" class="opt-icon" />
      }
      <span class="text">{{ o.label }}</span>
    </ng-template>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .trigger {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 38px;
      padding: 0 10px 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--bg-elev);
      color: var(--text);
      font-size: 14px;
      font-weight: 550;
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s, box-shadow 0.15s;
      &:hover {
        border-color: var(--border-strong);
      }
      &[aria-expanded='true'] {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-soft);
      }
    }
    .text {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chev {
      color: var(--text-muted);
      transition: transform 0.2s;
      [aria-expanded='true'] & {
        transform: rotate(180deg);
      }
    }
    .opt-icon {
      color: var(--accent);
    }
    .menu {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 40;
      max-height: 280px;
      overflow-y: auto;
      margin: 0;
      padding: 5px;
      list-style: none;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--bg-elev);
      box-shadow: var(--shadow-lg);
      transform-origin: top center;
      li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 8px;
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
    }
    .menu-in {
      animation: menu-in 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .menu-out {
      animation: menu-in 0.1s ease-in reverse both;
    }
    @keyframes menu-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.98);
      }
    }
  `,
})
export class Select {
  readonly options = input.required<SelectOption[]>();
  readonly value = model.required<string>();
  readonly label = input('');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);
  protected readonly focus = signal(0);
  protected readonly selected = computed(() => this.options().find((o) => o.value === this.value()) ?? this.options()[0]);

  protected toggle(): void {
    if (!this.open()) this.focus.set(Math.max(0, this.options().findIndex((o) => o.value === this.value())));
    this.open.update((v) => !v);
  }

  protected choose(value: string): void {
    this.value.set(value);
    this.open.set(false);
  }

  protected onKey(e: KeyboardEvent): void {
    const last = this.options().length - 1;
    if (!this.open()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.toggle();
      }
      return;
    }
    if (e.key === 'ArrowDown') this.focus.update((i) => (i >= last ? 0 : i + 1));
    else if (e.key === 'ArrowUp') this.focus.update((i) => (i <= 0 ? last : i - 1));
    else if (e.key === 'Enter' || e.key === ' ') this.choose(this.options()[this.focus()].value);
    else if (e.key === 'Escape') this.open.set(false);
    else {
      if (e.key === 'Tab') this.open.set(false);
      return;
    }
    e.preventDefault();
  }

  protected onOutside(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }
}
