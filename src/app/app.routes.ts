import type { Routes } from '@angular/router';
import { languageResolver, languageSegment } from './core/i18n';

const legal = () => import('./legal/legal').then((m) => m.Legal);
const thumbnail = () => import('./thumbnail/thumbnail').then((m) => m.Thumbnail);

/** Public pages, prerendered once per language. `seo` names their title and description texts. */
const publicPages: Routes = [
  { path: '', loadComponent: () => import('./landing/landing').then((m) => m.Landing), data: { seo: 'home' } },
  { path: 'thumbnail', loadComponent: thumbnail, data: { seo: 'thumbnail' } },
  { path: 'changelog', loadComponent: () => import('./changelog/changelog').then((m) => m.Changelog), data: { seo: 'changelog' } },
  { path: 'legal', loadComponent: legal, data: { doc: 'notice', seo: 'legal' } },
  { path: 'privacy', loadComponent: legal, data: { doc: 'privacy', seo: 'privacy' } },
  { path: 'terms', loadComponent: legal, data: { doc: 'terms', seo: 'terms' } },
];

export const routes: Routes = [
  // The app: one URL, in the language chosen by the user, never indexed.
  { path: 'app', loadComponent: () => import('./projects/projects').then((m) => m.Projects), data: { seo: 'app', noindex: true } },
  {
    path: 'app/:id',
    loadComponent: () => import('./editor/editor').then((m) => m.Editor),
    data: { fullscreen: true, seo: 'editor', noindex: true },
  },
  { path: 'thumbnail/:id', loadComponent: thumbnail, data: { seo: 'thumbnail', noindex: true } },
  // Public pages: /fr/…, /es/…, /it/…, /de/…, and English at the root.
  { path: ':lang', canMatch: [languageSegment], resolve: { language: languageResolver }, children: publicPages },
  { path: '', resolve: { language: languageResolver }, children: publicPages },
  { path: '**', redirectTo: '' },
];
