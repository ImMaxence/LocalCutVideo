import { ChangeDetectionStrategy, Component, ElementRef, Injectable, afterRenderEffect, inject, signal, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Icon } from './icon';

export interface ConfirmOptions {
  /** Translation keys; `params` fill both the title and the text. */
  title?: string;
  text: string;
  params?: Record<string, unknown>;
  /** Label of the confirm button. */
  confirm: string;
  /** A destructive action: red button and trash icon. */
  danger?: boolean;
}

/** window.confirm() in the app's style: `if (await confirm.ask({ ... })) ...`. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  ask(options: ConfirmOptions): Promise<boolean> {
    this.pending()?.resolve(false);
    return new Promise((resolve) => this.pending.set({ ...options, resolve }));
  }

  answer(ok: boolean): void {
    const request = this.pending();
    this.pending.set(null);
    request?.resolve(ok);
  }
}

/** Shows the ConfirmService requests, once, at the root of the app. A modal <dialog>: focus trap and Escape come with it. */
@Component({
  selector: 'app-confirm',
  imports: [TranslocoPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog (cancel)="$event.preventDefault(); confirm.answer(false)" (click)="onClick($event)">
      @if (confirm.pending(); as r) {
        <div class="body">
          @if (r.danger) {
            <span class="icon"><app-icon name="trash" [size]="20" /></span>
          }
          @if (r.title) {
            <h2>{{ r.title | transloco: r.params }}</h2>
          }
          <p>{{ r.text | transloco: r.params }}</p>
          <div class="actions">
            <button class="btn" type="button" autofocus (click)="confirm.answer(false)">{{ 'common.cancel' | transloco }}</button>
            <button class="btn primary" [class.danger]="r.danger" type="button" (click)="confirm.answer(true)">{{ r.confirm | transloco }}</button>
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    dialog {
      width: min(420px, calc(100vw - 24px));
      max-width: none;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elev);
      color: var(--text);
      box-shadow: var(--shadow-lg);
      &[open] {
        animation: pop 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
      }
      &::backdrop {
        background: rgb(5 6 10 / 0.55);
        backdrop-filter: blur(4px);
      }
    }
    .body {
      display: grid;
      gap: 12px;
      padding: 24px;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 14px;
      background: light-dark(rgb(217 45 58 / 0.1), rgb(248 113 113 / 0.12));
      color: var(--danger);
    }
    h2 {
      font-size: 19px;
    }
    p {
      color: var(--text-muted);
      font-size: 14.5px;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
      .btn {
        flex: 1 1 auto;
      }
    }
    /* Not var(--danger): its dark-theme red is too light under white text. */
    .btn.primary.danger {
      background: #d92d3a;
      color: #fff;
      box-shadow: none;
      &:hover:not(:disabled) {
        background: #c42532;
      }
    }
    @media (min-width: 520px) {
      .actions .btn {
        flex: none;
      }
    }
    @keyframes pop {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // After rendering: the buttons exist when showModal() looks for the autofocus one.
    afterRenderEffect(() => {
      const el = this.dialog().nativeElement;
      if (this.confirm.pending()) {
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });
  }

  /** A click on the dialog element itself is a click on the backdrop around the box. */
  protected onClick(e: MouseEvent): void {
    if (e.target === this.dialog().nativeElement) this.confirm.answer(false);
  }
}
