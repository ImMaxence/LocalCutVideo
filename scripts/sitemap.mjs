// Writes public/sitemap.xml: every public page in every language, with its alternates.
// Run with `npm run sitemap` when a public page is added.
import { writeFileSync } from 'node:fs';

const SITE = 'https://localcutvideo.mbonnici.fr';
const LANGS = ['en', 'fr', 'es', 'it', 'de'];
const PAGES = ['/', '/thumbnail', '/changelog', '/legal', '/privacy', '/terms'];
const url = (page, lang) => `${SITE}${lang === 'en' ? page : `/${lang}${page === '/' ? '' : page}`}`;
const today = new Date().toISOString().slice(0, 10);

const entries = PAGES.flatMap((page) =>
  LANGS.map((lang) => {
    const alternates = [...LANGS.map((l) => [l, url(page, l)]), ['x-default', url(page, 'en')]]
      .map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`)
      .join('\n');
    const priority = page === '/' ? '1.0' : page === '/thumbnail' ? '0.8' : '0.4';
    return `  <url>\n    <loc>${url(page, lang)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n${alternates}\n  </url>`;
  }),
);

writeFileSync(
  new URL('../public/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`,
);
console.log(`sitemap.xml: ${entries.length} URLs`);
