import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, NavigationStart, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import { PwaService } from './core/pwa.service';
import { SeoService } from './core/seo';
import { APP_VERSION, REPO_URL } from './core/version';
import { Icon } from './shared/icon';
import { LangPicker } from './shared/lang-picker';
import { LocalizePipe } from './shared/localize';
import { Logo } from './shared/logo';
import { ConfirmDialog } from './shared/confirm';
import { ThemeSwitch } from './shared/theme-switch';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslocoPipe, Icon, Logo, LangPicker, ThemeSwitch, LocalizePipe, ConfirmDialog],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'menuOpen.set(false)' },
})
export class App {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly pwa = inject(PwaService);
  protected readonly version = APP_VERSION;
  protected readonly repoUrl = REPO_URL;
  protected readonly year = new Date().getFullYear();
  protected readonly menuOpen = signal(false);
  protected readonly navLinks = [
    { fragment: 'ai', key: 'nav.ai' },
    { fragment: 'features', key: 'nav.features' },
    { fragment: 'privacy', key: 'nav.privacy' },
    { fragment: 'faq', key: 'nav.faq' },
  ];

  /** The editor runs full screen, without the marketing header and footer. */
  protected readonly fullscreen = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => {
        let r = this.route.snapshot;
        while (r.firstChild) r = r.firstChild;
        return !!r.data['fullscreen'];
      }),
    ),
    { initialValue: false },
  );

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe(() => this.menuOpen.set(false));
    inject(SeoService);
    // Freeze the page behind the open mobile menu.
    const document = inject(DOCUMENT);
    effect(() => document.documentElement.classList.toggle('menu-open', this.menuOpen()));
  }
}
