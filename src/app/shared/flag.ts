import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';

let uid = 0;

/** Inline SVG flags (Windows does not render flag emojis). Static markup only. */
function flagSvg(code: string, id: string): string {
  switch (code) {
    case 'fr':
      return '<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><path fill="#0055A4" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#EF4135" d="M2 0h1v2H2z"/></svg>';
    case 'it':
      return '<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><path fill="#009246" d="M0 0h1v2H0z"/><path fill="#fff" d="M1 0h1v2H1z"/><path fill="#CE2B37" d="M2 0h1v2H2z"/></svg>';
    case 'de':
      return '<svg viewBox="0 0 5 3" preserveAspectRatio="xMidYMid slice"><path fill="#000" d="M0 0h5v1H0z"/><path fill="#DD0000" d="M0 1h5v1H0z"/><path fill="#FFCE00" d="M0 2h5v1H0z"/></svg>';
    case 'pt':
      return '<svg viewBox="0 0 5 3" preserveAspectRatio="xMidYMid slice"><path fill="#046A38" d="M0 0h2v3H0z"/><path fill="#DA291C" d="M2 0h3v3H2z"/><circle cx="2" cy="1.5" r=".6" fill="#FFE900"/></svg>';
    case 'nl':
      return '<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><path fill="#AE1C28" d="M0 0h3v.67H0z"/><path fill="#fff" d="M0 .67h3v.66H0z"/><path fill="#21468B" d="M0 1.33h3V2H0z"/></svg>';
    case 'es':
      return '<svg viewBox="0 0 3 2" preserveAspectRatio="xMidYMid slice"><path fill="#AA151B" d="M0 0h3v2H0z"/><path fill="#F1BF00" d="M0 .5h3v1H0z"/></svg>';
    default:
      // English: United Kingdom.
      return `<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><clipPath id="${id}s"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="${id}t"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#${id}s)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#${id}t)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>`;
  }
}

@Component({
  selector: 'app-flag',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'flag' },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 20px;
      height: 14px;
      border-radius: 3px;
      overflow: hidden;
      box-shadow: 0 0 0 1px light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.16));
    }
    :host ::ng-deep svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  `,
})
export class Flag {
  readonly code = input.required<string>();
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly id = `flag${++uid}`;

  constructor() {
    effect(() => {
      // The SVG markup is built from constants only, never from user input.
      this.el.nativeElement.innerHTML = flagSvg(this.code(), this.id);
    });
  }
}
