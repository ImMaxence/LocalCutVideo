import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'lcv-theme';

/**
 * The palette follows the OS through `prefers-color-scheme` (CSS `color-scheme` +
 * `light-dark()`). Forcing light or dark only overrides `color-scheme` on <html>.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readStoredMode());

  constructor() {
    effect(() => {
      const mode = this.mode();
      const root = document.documentElement;
      if (mode === 'system') delete root.dataset['theme'];
      else root.dataset['theme'] = mode;
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Private mode: the choice simply is not remembered.
      }
    });
  }
}

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // ignore
  }
  return 'system';
}
