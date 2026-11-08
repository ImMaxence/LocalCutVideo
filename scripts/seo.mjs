// Runs after `ng build` (see the "build" script). Writes into the build, for search engines and
// AI assistants:
//   - sitemap.xml: every public page in every language, with its alternates;
//   - an index.md next to each prerendered page: its text as Markdown, also served to requests
//     asking for text/markdown (see docker/nginx.conf);
//   - llms.txt (what the site is and its pages) and llms-full.txt (every English page in one file).
// The texts come from the same translation files as the pages.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LANGUAGES } from '../src/app/core/languages.ts';
import { AI_MODELS } from '../src/app/core/ai-models.ts';

const SITE = 'https://localcutvideo.mbonnici.fr';
const REPO = 'https://github.com/ImMaxence/LocalCutVideo';
const OUT = new URL('../dist/localcutvideo/browser/', import.meta.url);
const PAGES = ['/', '/thumbnail', '/changelog', '/legal', '/privacy', '/terms'];
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const url = (page, lang) => `${SITE}${lang === 'en' ? page : `/${lang}${page === '/' ? '' : page}`}`;
const dir = (page, lang) => `${lang === 'en' ? '' : `${lang}/`}${page === '/' ? '' : `${page.slice(1)}/`}`;
const write = (path, text) => writeFileSync(new URL(path, OUT), text);

const english = JSON.parse(readFileSync(new URL('../public/i18n/en.json', import.meta.url), 'utf8'));

/** A translation lookup like the app's: English when a key is missing, `{{ name }}` filled in. */
function translator(lang) {
  const texts = JSON.parse(readFileSync(new URL(`../public/i18n/${lang}.json`, import.meta.url), 'utf8'));
  const find = (tree, key) => key.split('.').reduce((node, k) => node?.[k], tree);
  return (key, params = {}) => {
    const value = find(texts, key) ?? find(english, key);
    if (value === undefined) throw new Error(`${lang}: no text for ${key}`);
    return typeof value === 'string' ? value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(params[name])) : value;
  };
}

/** `[label](/terms)` of the legal texts, with the absolute address of the page in this language. */
const links = (text, lang) => text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `[${label}](${href.startsWith('/') ? url(href, lang) : href})`);

const sections = (...blocks) => blocks.flat().filter(Boolean).join('\n\n');

// --- The pages ------------------------------------------------------------------------------

function home(t, lang) {
  const features = ['speech', 'aiImage', 'silences', 'captions', 'framing', 'textEdit', 'zoom', 'ducking', 'clips', 'export', 'inputs', 'recovery', 'offline', 'languages'];
  const compare = [
    ['free', 'sometimes'],
    ['account', 'sometimes'],
    ['auto', 'sometimes'],
    ['upload', 'no'],
    ['offline', 'no'],
  ];
  const browsers = [
    ['Chrome / Edge', 'ok', 'full'],
    ['Opera / Brave', 'ok', 'full'],
    ['Firefox', 'partial', 'firefox'],
    ['Safari', 'partial', 'safari'],
    [t('landing.support.mobile'), 'partial', 'mobileText'],
  ];
  return sections(
    `## ${t('landing.hero.title1')} — ${t('landing.hero.title2')}`,
    `${t('landing.hero.badgeAlt')} · ${t('landing.hero.badgeLocal')} · ${t('landing.hero.badgeOpen')}`,
    t('landing.hero.lead'),
    `[${t('landing.hero.cta')}](${SITE}/app) · [${t('landing.hero.demo')}](${SITE}/app?demo=1) · [${t('landing.hero.github')}](${REPO})`,
    t('landing.hero.hint'),
    [
      `- **100%** ${t('landing.stats.free')}`,
      `- **0** ${t('landing.stats.watermark')}`,
      `- **0** ${t('landing.stats.upload')}`,
      `- **${LANGUAGES.length}** ${t('landing.stats.languages')}`,
    ].join('\n'),
    `## ${t('landing.how.title')}`,
    ['open', 'edit', 'export'].map((step, i) => `### ${i + 1}. ${t(`landing.how.${step}.title`)}\n\n${t(`landing.how.${step}.text`)}`),
    `## ${t('landing.features.title')}`,
    t('landing.features.lead'),
    features.map((f) => `### ${t(`landing.features.${f}.title`)}\n\n${t(`landing.features.${f}.text`, { count: LANGUAGES.length })}`),
    `## ${t('landing.ai.title')}`,
    t('landing.ai.lead'),
    AI_MODELS.map((m) => `- **${m.name}** (${m.maker}, ${m.license}, ${m.size}): ${t(`landing.ai.${m.key}`)}`).join('\n'),
    `## ${t('landing.compare.title')}`,
    t('landing.compare.lead'),
    [
      `| | LocalCutVideo | ${t('landing.compare.them')} |`,
      '|---|---|---|',
      ...compare.map(([row, them]) => `| ${t(`landing.compare.rows.${row}`)} | ${t('landing.compare.yes')} | ${t(`landing.compare.${them}`)} |`),
    ].join('\n'),
    t('landing.compare.note'),
    `## ${t('landing.thumbnail.title')}`,
    t('landing.thumbnail.text'),
    ['moments', 'title', 'formats', 'local'].map((p) => `- ${t(`landing.thumbnail.points.${p}`)}`).join('\n'),
    `[${t('landing.thumbnail.cta')}](${url('/thumbnail', lang)})`,
    `## ${t('landing.privacy.title')}`,
    t('landing.privacy.lead'),
    ['upload', 'account', 'sensitive', 'storage'].map((p) => `- ${t(`landing.privacy.${p}`)}`).join('\n'),
    `## ${t('landing.support.title')}`,
    browsers.map(([name, level, text]) => `- **${name}** (${t(`landing.support.${level}`)}) — ${t(`landing.support.${text}`)}`).join('\n'),
    `## ${t('landing.faq.title')}`,
    ['free', 'capcut', 'formats', 'browsers', 'size', 'offline', 'ai'].map((q) => `### ${t(`landing.faq.${q}.q`)}\n\n${t(`landing.faq.${q}.a`)}`),
    `## ${t('landing.final.title')}`,
    t('landing.final.text'),
    `[${t('landing.hero.cta')}](${SITE}/app)`,
  );
}

function thumbnail(t) {
  return sections(
    `## ${t('thumbnail.title')}`,
    t('thumbnail.lead'),
    ['moments', 'title', 'formats', 'local'].map((p) => `- ${t(`landing.thumbnail.points.${p}`)}`).join('\n'),
    `${t('thumbnail.pick')} — ${t('thumbnail.pickHint')}`,
    t('thumbnail.local'),
  );
}

/** The release notes, in English on every language's page, as on the site. */
function changelog(t) {
  const notes = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const releases = notes
    .slice(notes.indexOf('\n## '))
    .replace(/^## \[([^\]]+)\] - (.+)$/gm, '## $1 ($2)')
    .trim();
  return sections(t('changelog.lead'), releases);
}

function legal(t, lang, id) {
  const doc = t(`legal.${id}`);
  return sections(
    t('legal.updated'),
    doc.intro,
    doc.sections.map((s) => sections(`## ${s.title}`, s.body.map((p) => links(p, lang)))),
  );
}

const SEO_KEYS = { '/': 'home', '/thumbnail': 'thumbnail', '/changelog': 'changelog', '/legal': 'legal', '/privacy': 'privacy', '/terms': 'terms' };

/** One page as Markdown. `nav` adds the site's links and the page in the other languages. */
function pageMarkdown(page, lang, nav = true) {
  const t = translator(lang);
  const seo = SEO_KEYS[page];
  const body = {
    '/': () => home(t, lang),
    '/thumbnail': () => thumbnail(t),
    '/changelog': () => changelog(t),
    '/legal': () => legal(t, lang, 'notice'),
    '/privacy': () => legal(t, lang, 'privacy'),
    '/terms': () => legal(t, lang, 'terms'),
  }[page]();
  const item = (label, target) => `- [${label}](${target})`;
  return (
    sections(
      `# ${t(`seo.${seo}.title`)}`,
      `> ${t(`seo.${seo}.description`)}`,
      body,
      nav && [
        `## ${t('footer.product')}\n\n${[
          item('LocalCutVideo', url('/', lang)),
          item(t('nav.open'), `${SITE}/app`),
          item(t('nav.thumbnail'), url('/thumbnail', lang)),
          item(t('nav.changelog'), url('/changelog', lang)),
          item('GitHub', REPO),
        ].join('\n')}`,
        `## ${t('footer.legal')}\n\n${[
          item(t('legal.nav.notice'), url('/legal', lang)),
          item(t('legal.nav.privacy'), url('/privacy', lang)),
          item(t('legal.nav.terms'), url('/terms', lang)),
        ].join('\n')}`,
        `## ${t('nav.language')}\n\n${LANGUAGES.filter((l) => l.code !== lang).map((l) => item(l.label, url(page, l.code))).join('\n')}`,
      ],
      `---\n\nLocalCutVideo ${version} · ${t('footer.noTracking')} · ${url(page, lang)}`,
    ) + '\n'
  );
}

// --- llms.txt and llms-full.txt ---------------------------------------------------------------

function llmsText() {
  const t = translator('en');
  const others = LANGUAGES.filter((l) => l.code !== 'en');
  return `# LocalCutVideo

> Free, open source video editor that runs entirely in the web browser. Videos are never uploaded: decoding, AI (speech-to-text, face tracking), editing and MP4 export all happen on the user's device. Made for talking-head videos, vlogs, YouTube, TikTok, Reels and Shorts.

LocalCutVideo is a web app (installable as a PWA, works offline), version ${version}, available in ${LANGUAGES.length} languages. No account, no tracking, MIT license.

## What it does

- Auto edit: one click detects whether someone speaks, transcribes the speech (Whisper, in the browser), removes hesitations ("um", "euh"), cuts the silences, follows the face, adds smart zoom and karaoke subtitles. Undo in one step
- Silence removal from the loudness or from the transcript; videos without voice (street, nature) only lose real dead air
- Text-based editing: delete words in the transcript to cut the video, correct misheard words
- Manual editing on a waveform timeline: select a part, then cut it or change its speed (0.25× to 4×, the voice keeps its pitch)
- Output formats 16:9 (YouTube), 9:16 (TikTok, Reels, Shorts) and 1:1, with automatic face framing (MediaPipe)
- Background blur behind the person, texts over the video, fades at cuts, rotation of videos filmed sideways
- Sound: volume up to 300 % with a limiter, leveling between clips, voice noise reduction (RNNoise), background music that lowers itself when someone speaks
- Multi-clip projects (MP4, MOV, WebM, MKV), saved automatically in the browser, exportable as a project file
- Thumbnail maker: suggests the sharpest moments of a video, big title with highlighted words, JPG or PNG for YouTube (1280×720), Shorts or Instagram
- Fast MP4 export with the browser's hardware encoder (WebCodecs)

## Requirements

- A recent Chrome or Edge on a computer gives every feature; Firefox and Safari work with some limits
- The Whisper model (about 40 to 250 MB) is downloaded once on first use, then cached
- AI thumbnail images need a computer with WebGPU; their model (SANA-Sprint 0.6B, about 3.1 GB) is downloaded from Hugging Face only if used, then cached

## Pages

${PAGES.map((p) => `- [${t(`seo.${SEO_KEYS[p]}.title`)}](${url(p, 'en')}): ${t(`seo.${SEO_KEYS[p]}.description`)}`).join('\n')}
- [Open the editor](${SITE}/app)
- [Try with a demo video](${SITE}/app?demo=1)

## Markdown

Every page also exists as Markdown: add index.md to its address (${SITE}/index.md, ${SITE}/fr/thumbnail/index.md…) or ask for it with the header "Accept: text/markdown". Every English page in one file: ${SITE}/llms-full.txt

## Other languages

Home pages below; each language also has /thumbnail, /changelog, /legal, /privacy and /terms (${SITE}/de/privacy…).

${others.map((l) => `- ${l.label}: [${translator(l.code)('seo.home.title')}](${url('/', l.code)})`).join('\n')}

## Optional

- [Source code on GitHub](${REPO})
- [Release notes (Markdown)](${SITE}/CHANGELOG.md)
- [Sitemap](${SITE}/sitemap.xml)
`;
}

function llmsFull() {
  return [
    `# LocalCutVideo: full text\n\n> Free, open source video editor that runs entirely in the browser, version ${version}. Below: every page in English. Each page in each of the ${LANGUAGES.length} languages also exists on its own as Markdown, at its address followed by index.md (${SITE}/fr/index.md, ${SITE}/ja/thumbnail/index.md…); the list of pages is in ${SITE}/llms.txt.`,
    ...PAGES.map((p) => pageMarkdown(p, 'en', false)),
  ].join('\n\n---\n\n');
}

// --- sitemap.xml --------------------------------------------------------------------------------

function sitemap() {
  const entries = PAGES.flatMap((page) => {
    const alternates = [...LANGUAGES.flatMap((l) => l.hreflang.map((h) => [h, url(page, l.code)])), ['x-default', url(page, 'en')]]
      .map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${href}"/>`)
      .join('\n');
    const priority = page === '/' ? '1.0' : page === '/thumbnail' ? '0.8' : '0.4';
    return LANGUAGES.map(({ code }) => `  <url>\n    <loc>${url(page, code)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${priority}</priority>\n${alternates}\n  </url>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}

// --- Write ------------------------------------------------------------------------------------

let count = 0;
for (const page of PAGES) {
  for (const { code } of LANGUAGES) {
    // Next to the prerendered page: a missing one means the routes and this list differ.
    if (!existsSync(new URL(`${dir(page, code)}index.html`, OUT))) throw new Error(`No prerendered page for ${url(page, code)}`);
    write(`${dir(page, code)}index.md`, pageMarkdown(page, code));
    count++;
  }
}
write('sitemap.xml', sitemap());
write('llms.txt', llmsText());
write('llms-full.txt', llmsFull());
console.log(`seo: ${count} index.md, sitemap.xml (${count} URLs), llms.txt, llms-full.txt`);
