import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { CONTACT_EMAIL } from '../core/version';
import { Icon } from '../shared/icon';

export type LegalDoc = 'notice' | 'privacy' | 'terms';

interface LegalContent {
  title: string;
  intro: string;
  sections: { title: string; body: string[] }[];
}

type Segment = { text: string; href?: string; internal?: boolean };

/**
 * Turns `[label](/path)`, `[label](https://…)` and bare e-mail addresses of a paragraph into
 * links, without ever injecting HTML from the translation files.
 */
export function linkify(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|([\w.+-]+@[\w-]+\.[\w.-]+\w)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index) });
    if (m[1]) segments.push({ text: m[1], href: m[2], internal: m[2].startsWith('/') });
    else segments.push({ text: m[3], href: `mailto:${m[3]}` });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

@Component({
  selector: 'app-legal',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, Icon],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Legal {
  /** Bound from the route data. */
  readonly doc = input.required<LegalDoc>();
  private readonly transloco = inject(TranslocoService);
  protected readonly email = CONTACT_EMAIL;
  protected readonly linkify = linkify;
  protected readonly docs: { id: LegalDoc; path: string; icon: string }[] = [
    { id: 'notice', path: '/legal', icon: 'scale' },
    { id: 'privacy', path: '/privacy', icon: 'shield' },
    { id: 'terms', path: '/terms', icon: 'file' },
  ];

  protected readonly content = toSignal(
    toObservable(this.doc).pipe(switchMap((doc) => this.transloco.selectTranslateObject<LegalContent>(`legal.${doc}`))),
  );
}
