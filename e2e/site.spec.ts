import { test } from '@playwright/test';
import { LANGUAGES } from '../src/app/core/languages';
import { expect, watchErrors } from './helpers';

test.describe('public site', () => {
  test('prerendered pages carry their language, title and alternates, and hydrate cleanly', async ({ page, request }) => {
    const html = await (await request.get('/fr/thumbnail')).text();
    expect(html).toContain('<html lang="fr"');
    expect(html).toContain('<title>Créateur de miniatures YouTube gratuit — LocalCutVideo</title>');
    expect(html).toContain('<link rel="canonical" href="https://localcutvideo.mbonnici.fr/fr/thumbnail">');
    expect(html).toContain('hreflang="x-default" href="https://localcutvideo.mbonnici.fr/thumbnail"');
    expect(html).toContain('Des miniatures qui donnent envie de cliquer');
    expect(html).not.toMatch(/<script>|<script type="text\/javascript"/);

    const errors = watchErrors(page);
    for (const path of ['/', '/fr', '/es/changelog', '/de/privacy']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('h1').first()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('sends a French browser to the French pages, and the picker switches the page language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR' });
    const page = await context.newPage();
    await page.goto('/changelog');
    await expect(page).toHaveURL(/\/fr\/changelog$/);
    await page.locator('.site-header .nav a', { hasText: 'Miniatures' }).click();
    await expect(page).toHaveURL(/\/fr\/thumbnail$/);
    await page.locator('.site-header app-lang-picker .trigger').click();
    await page.locator('.site-header app-lang-picker li', { hasText: 'English' }).click();
    await expect(page).toHaveURL(/\/thumbnail$/);
    await expect(page).toHaveTitle('Free YouTube thumbnail maker — LocalCutVideo');
    // The choice is remembered: the English home page is not redirected any more.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await context.close();
  });

  test('keeps the header on one line in every language, install button included', async ({ page }) => {
    for (const { code: lang } of LANGUAGES) {
      await page.goto(lang === 'en' ? '/' : `/${lang}`);
      await page.evaluate(() => {
        const e = Object.assign(new Event('beforeinstallprompt'), { prompt: () => undefined, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
        window.dispatchEvent(e);
      });
      for (const width of [1600, 1280, 1200, 1000, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.locator('.site-header .bar').evaluate((bar) => bar.scrollWidth - bar.clientWidth);
        expect(overflow, `${lang} at ${width}px`).toBeLessThanOrEqual(0);
      }
      await page.setViewportSize({ width: 1400, height: 900 });
    }
  });

  test('describes the app to search engines and AI assistants', async ({ request }) => {
    const html = await (await request.get('/fr')).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    expect(blocks.map((b) => b['@type'])).toEqual(['WebApplication', 'FAQPage']);
    expect(blocks[0].isAccessibleForFree).toBe(true);
    expect(blocks[1].inLanguage).toBe('fr');
    expect(blocks[1].mainEntity.length).toBeGreaterThan(3);
    expect(await (await request.get('/llms.txt')).text()).toContain('# LocalCutVideo');
  });

  test('opens every page to search engines and AI crawlers, with a sitemap in every language', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(robots).toContain(`User-agent: ${bot}`);
    expect(robots).not.toContain('Disallow');
    expect(robots).toContain('Sitemap: https://localcutvideo.mbonnici.fr/sitemap.xml');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap.match(/<loc>/g)).toHaveLength(LANGUAGES.length * 6);
    expect(sitemap).toContain('<loc>https://localcutvideo.mbonnici.fr/it/terms</loc>');
  });

  test('serves each page as Markdown to assistants that ask for it', async ({ request }) => {
    const md = await request.get('/fr/changelog', { headers: { Accept: 'text/markdown' } });
    expect(md.headers()['content-type']).toBe('text/markdown; charset=utf-8');
    expect(md.headersArray()).toContainEqual({ name: 'Vary', value: 'Accept' });
    expect(await md.text()).toMatch(/^# Nouveautés — LocalCutVideo\n/);
    expect(await (await request.get('/ja/thumbnail/index.md')).text()).toContain('https://localcutvideo.mbonnici.fr/ja/thumbnail');

    const html = await request.get('/fr/changelog');
    expect(html.headers()['content-type']).toBe('text/html; charset=utf-8');
    expect(await html.text()).toContain('<link rel="alternate" type="text/markdown" href="https://localcutvideo.mbonnici.fr/fr/changelog/index.md">');
    // Files keep their own type, whatever the request accepts.
    expect((await request.get('/og-image.png', { headers: { Accept: 'text/markdown' } })).headers()['content-type']).toBe('image/png');
    expect(await (await request.get('/llms-full.txt')).text()).toContain('# LocalCutVideo: full text');
  });

  test('the app is not indexed', async ({ page, request }) => {
    expect((await request.get('/app')).headers()['x-robots-tag']).toBe('noindex');
    await page.goto('/app');
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');
  });
});
