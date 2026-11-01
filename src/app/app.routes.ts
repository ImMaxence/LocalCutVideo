import type { Routes } from '@angular/router';

const legal = () => import('./legal/legal').then((m) => m.Legal);
const thumbnail = () => import('./thumbnail/thumbnail').then((m) => m.Thumbnail);

export const routes: Routes = [
  {
    path: '',
    title: 'LocalCutVideo — Edit videos in your browser, nothing is uploaded',
    loadComponent: () => import('./landing/landing').then((m) => m.Landing),
  },
  { path: 'changelog', title: 'Changelog — LocalCutVideo', loadComponent: () => import('./changelog/changelog').then((m) => m.Changelog) },
  { path: 'legal', title: 'Legal notice — LocalCutVideo', loadComponent: legal, data: { doc: 'notice' } },
  { path: 'privacy', title: 'Privacy policy — LocalCutVideo', loadComponent: legal, data: { doc: 'privacy' } },
  { path: 'terms', title: 'Terms of use — LocalCutVideo', loadComponent: legal, data: { doc: 'terms' } },
  { path: 'thumbnail', title: 'Thumbnail maker — LocalCutVideo', loadComponent: thumbnail },
  { path: 'thumbnail/:id', title: 'Thumbnail maker — LocalCutVideo', loadComponent: thumbnail },
  { path: 'app', title: 'Projects — LocalCutVideo', loadComponent: () => import('./projects/projects').then((m) => m.Projects) },
  {
    path: 'app/:id',
    title: 'Editor — LocalCutVideo',
    loadComponent: () => import('./editor/editor').then((m) => m.Editor),
    data: { fullscreen: true },
  },
  { path: '**', redirectTo: '' },
];
