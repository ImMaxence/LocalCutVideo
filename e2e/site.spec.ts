import { test } from '@playwright/test';
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
    for (const lang of ['en', 'fr', 'es', 'it', 'de']) {
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

  test('serves robots.txt and a sitemap of every page in every language', async ({ request }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /app');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap.match(/<loc>/g)).toHaveLength(30);
    expect(sitemap).toContain('<loc>https://localcutvideo.mbonnici.fr/it/terms</loc>');
  });

  test('the app is not indexed', async ({ page }) => {
    await page.goto('/app');
    await expect(page.locator('meta[name=robots]')).toHaveAttribute('content', 'noindex');
  });
});
