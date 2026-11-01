import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type Translation, type TranslocoLoader, TranslocoService } from '@jsverse/transloco';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'de', label: 'Deutsch' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

const STORAGE_KEY = 'lcv-lang';
const CODES = LANGUAGES.map((l) => l.code) as string[];

export function detectLanguage(): LangCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CODES.includes(stored)) return stored as LangCode;
  } catch {
    // ignore
  }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const code = lang.slice(0, 2).toLowerCase();
    if (CODES.includes(code)) return code as LangCode;
  }
  return 'en';
}

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

  constructor() {
    document.documentElement.lang = this.transloco.getActiveLang();
  }

  get active(): LangCode {
    return this.transloco.getActiveLang() as LangCode;
  }

  set(lang: LangCode): void {
    this.transloco.setActiveLang(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }
}
