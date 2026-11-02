import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type CanMatchFn, type ResolveFn, Router } from '@angular/router';
import { type Translation, type TranslocoLoader, TranslocoService } from '@jsverse/transloco';
import { map } from 'rxjs';
import { LANGUAGES, type LangCode, languageFor } from './languages';

export { LANGUAGES, type LangCode } from './languages';

/**
 * Public pages have one URL per language: English at the root (/changelog), the others under
 * their code (/fr/changelog), so search engines index every language. The app itself (/app)
 * keeps one URL and follows the language chosen by the user.
 */
export const DEFAULT_LANG: LangCode = 'en';
export const PREFIXED_LANGS = LANGUAGES.map((l) => l.code).filter((c) => c !== DEFAULT_LANG) as LangCode[];

const STORAGE_KEY = 'lcv-lang';
const CODES = LANGUAGES.map((l) => l.code) as string[];
/** Language segment at the start of a path: /fr, /pt-br, /fil. */
const SEGMENT = /^\/([a-z]{2,3}(?:-[a-z]{2})?)(\/.*)?$/;

/** Language for the app pages: the user's choice, else the browser's, else English. */
export function detectLanguage(): LangCode {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (stored && CODES.includes(stored)) return stored as LangCode;
  } catch {
    // ignore
  }
  const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const lang of browser) {
    const code = languageFor(lang);
    if (code) return code;
  }
  return DEFAULT_LANG;
}

/**
 * Language to start with: the one of the page's URL (so a prerendered page hydrates in its own
 * language), the user's for the app pages, English while prerendering.
 */
export function initialLanguage(): LangCode {
  if (typeof location === 'undefined' || typeof document === 'undefined') return DEFAULT_LANG;
  const prefix = SEGMENT.exec(location.pathname)?.[1];
  if (prefix && (PREFIXED_LANGS as string[]).includes(prefix)) return prefix as LangCode;
  if (/^\/(thumbnail|changelog|legal|privacy|terms)?\/?$/.test(location.pathname)) return DEFAULT_LANG;
  return detectLanguage();
}

/** URL of a public page in a language: localizedPath('/changelog', 'fr') = '/fr/changelog'. */
export function localizedPath(path: string, lang: string): string {
  if (lang === DEFAULT_LANG) return path || '/';
  return `/${lang}${path === '/' ? '' : path}`;
}

/** Public page path without its language: '/fr/changelog' → '/changelog'. */
export function unlocalizedPath(url: string): string {
  const path = url.split(/[?#]/)[0];
  const match = SEGMENT.exec(path);
  return match && (PREFIXED_LANGS as string[]).includes(match[1]) ? match[2] || '/' : path || '/';
}

/** `<html lang>` and `dir` of a language: <html lang="ar" dir="rtl">. */
export function applyLanguage(document: Document, lang: string): void {
  const language = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
  document.documentElement.lang = language.tag;
  document.documentElement.dir = 'rtl' in language ? 'rtl' : 'ltr';
}

/** Matches the language segment of /fr/…, /pt-br/…, etc. */
export const languageSegment: CanMatchFn = (_route, segments) => (PREFIXED_LANGS as string[]).includes(segments[0]?.path ?? '');

/** Activates the language of a public page (and loads it) before the page renders. */
export const languageResolver: ResolveFn<boolean> = (route) => {
  const lang = (route.paramMap.get('lang') ?? DEFAULT_LANG) as LangCode;
  const transloco = inject(TranslocoService);
  transloco.setActiveLang(lang);
  applyLanguage(inject(DOCUMENT), lang);
  return transloco.load(lang).pipe(map(() => true));
};

@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(lang: string) {
    return this.http.get<Translation>(`/i18n/${lang}.json`);
  }
}

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);

  constructor() {
    applyLanguage(this.document, this.transloco.getActiveLang());
  }

  get active(): LangCode {
    return this.transloco.getActiveLang() as LangCode;
  }

  /** The user picks a language: remembered, and public pages move to their URL in it. */
  choose(lang: LangCode): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    if (route.data['seo'] && !route.data['noindex']) {
      const url = this.router.url;
      const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : undefined;
      void this.router.navigateByUrl(localizedPath(unlocalizedPath(url), lang) + (hash ? `#${hash}` : ''));
      return;
    }
    this.transloco.setActiveLang(lang);
    applyLanguage(this.document, lang);
  }
}
