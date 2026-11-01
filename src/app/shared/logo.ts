import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient [attr.id]="id" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6d4dff" />
          <stop offset="0.5" stop-color="#b14dff" />
          <stop offset="1" stop-color="#ff4d8d" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" [attr.fill]="'url(#' + id + ')'" />
      <path d="M24 17.5 47 32 24 46.5Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round" />
      <path d="M14 43 50 21" [attr.stroke]="'url(#' + id + ')'" stroke-width="5" stroke-linecap="round" />
    </svg>
  `,
  host: { style: 'display:inline-flex' },
})
export class Logo {
  readonly size = input(28);
  protected readonly id = `lcv-g-${Math.random().toString(36).slice(2, 8)}`;
}
