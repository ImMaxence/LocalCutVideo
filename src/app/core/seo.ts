import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { DEFAULT_LANG, LANGUAGES, applyLanguage, localizedPath, unlocalizedPath } from './i18n';
import { APP_VERSION, REPO_URL, SITE_URL } from './version';

const FEATURES = ['silences', 'clips', 'textEdit', 'captions', 'framing', 'zoom', 'ducking', 'recovery', 'offline', 'export', 'inputs', 'languages'];
const FAQ = ['free', 'formats', 'browsers', 'size', 'offline', 'ai'];

/**
 * Title, description, canonical URL and language alternates of every page, from the `seo` key
 * of its route (texts in i18n `seo.<key>`). Runs on the server too, so prerendered pages
 * carry them, with schema.org data (the app, the FAQ) that search engines and AI assistants read.
 * App pages (projects, editor) are not indexed.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.update());
    // The app pages follow language changes without a navigation.
    this.transloco.langChanges$.subscribe(() => this.update());
  }

  private update(): void {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    const key = (route.data['seo'] as string | undefined) ?? 'app';
    const indexed = !!route.data['seo'] && !route.data['noindex'];
    const lang = this.transloco.getActiveLang();
    const language = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];
    const t = (field: string) => this.transloco.translate(`seo.${key}.${field}`);
    const path = unlocalizedPath(this.router.url);
    const url = `${SITE_URL}${localizedPath(path, lang)}`;

    this.title.setTitle(t('title'));
    this.meta.updateTag({ name: 'description', content: t('description') });
    this.meta.updateTag({ name: 'robots', content: indexed ? 'index, follow' : 'noindex' });
    this.meta.updateTag({ property: 'og:title', content: t('title') });
    this.meta.updateTag({ property: 'og:description', content: t('description') });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:locale', content: language.og });
    applyLanguage(this.document, lang);

    // Canonical URL and the alternates of every language (x-default: English).
    this.document.head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang], script[type="application/ld+json"]').forEach((l) => l.remove());
    if (!indexed) return;
    for (const data of this.structuredData(key, url, language.tag)) {
      const script = this.document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.textContent = JSON.stringify(data);
      this.document.head.appendChild(script);
    }
    this.link({ rel: 'canonical', href: url });
    for (const l of LANGUAGES) {
      for (const hreflang of l.hreflang) this.link({ rel: 'alternate', hreflang, href: `${SITE_URL}${localizedPath(path, l.code)}` });
    }
    this.link({ rel: 'alternate', hreflang: 'x-default', href: `${SITE_URL}${localizedPath(path, DEFAULT_LANG)}` });
  }

  /** schema.org descriptions: the web app on the home and thumbnail pages, the FAQ on the home page. */
  private structuredData(key: string, url: string, lang: string): object[] {
    if (key !== 'home' && key !== 'thumbnail') return [];
    const t = (k: string) => this.transloco.translate(k);
    const app = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: key === 'home' ? 'LocalCutVideo' : t('thumbnail.eyebrow'),
      url,
      description: t(`seo.${key}.description`),
      inLanguage: lang,
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any',
      browserRequirements: 'A recent browser with WebCodecs: Chrome or Edge recommended',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      license: 'https://opensource.org/licenses/MIT',
      softwareVersion: APP_VERSION,
      author: { '@type': 'Person', name: 'Maxence Bonnici' },
      sameAs: [REPO_URL],
      featureList: key === 'home' ? FEATURES.map((f) => t(`landing.features.${f}.title`)) : undefined,
    };
    if (key !== 'home') return [app];
    const faq = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      inLanguage: lang,
      mainEntity: FAQ.map((id) => ({
        '@type': 'Question',
        name: t(`landing.faq.${id}.q`),
        acceptedAnswer: { '@type': 'Answer', text: t(`landing.faq.${id}.a`) },
      })),
    };
    return [app, faq];
  }

  private link(attributes: Record<string, string>): void {
    const link = this.document.createElement('link');
    for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
    this.document.head.appendChild(link);
  }
}
