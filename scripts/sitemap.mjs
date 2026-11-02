// Writes public/sitemap.xml: every public page in every language, with its alternates.
// Run with `npm run sitemap` when a public page or a language is added.
import { writeFileSync } from 'node:fs';
import { LANGUAGES } from '../src/app/core/languages.ts';

const SITE = 'https://localcutvideo.mbonnici.fr';
const PAGES = ['/', '/thumbnail', '/changelog', '/legal', '/privacy', '/terms'];
const url = (page, lang) => `${SITE}${lang === 'en' ? page : `/${lang}${page === '/' ? '' : page}`}`;
const today = new Date().toISOString().slice(0, 10);

const entries = PAGES.flatMap((page) => {
  const alternates = [...LANGUAGES.flatMap((l) => l.hreflang.map((h) => [h, url(page, l.code)])), ['x-default', url(page, 'en')]]
    .map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`)
    .join('\n');
  const priority = page === '/' ? '1.0' : page === '/thumbnail' ? '0.8' : '0.4';
  return LANGUAGES.map(
    ({ code }) => `  <url>\n    <loc>${url(page, code)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n${alternates}\n  </url>`,
  );
});

writeFileSync(
  new URL('../public/sitemap.xml', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`,
);
console.log(`sitemap.xml: ${entries.length} URLs`);
