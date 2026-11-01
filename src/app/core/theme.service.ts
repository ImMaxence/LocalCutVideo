import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'lcv-theme';

/**
 * The palette follows the OS through `prefers-color-scheme` (CSS `color-scheme` +
 * `light-dark()`). Forcing light or dark only overrides `color-scheme` on <html>.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readStoredMode());
  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const mode = this.mode();
      const root = this.document.documentElement;
      // Attributes rather than dataset, which the build-time renderer's DOM lacks.
      if (mode === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', mode);
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Private mode: the choice simply is not remembered.
      }
    });
  }
}

function readStoredMode(): ThemeMode {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}
