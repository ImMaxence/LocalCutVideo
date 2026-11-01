import { test } from '@playwright/test';
import { expect, openVideo } from './helpers';

/** Whisper runs in the browser: the first run downloads its model (about 40 MB). Opt in with E2E_AI=1. */
test.describe('auto edit (Whisper)', () => {
  test.skip(!process.env['E2E_AI'], 'set E2E_AI=1 to run the Whisper tests');

  test('detects the voice, transcribes, cuts and subtitles the demo', async ({ page }) => {
    test.setTimeout(600_000);
    await openVideo(page);
    await page.locator('.auto-btn').click();
    await page.getByRole('button', { name: 'Start the auto edit' }).click();
    await expect(page.locator('.auto-summary')).toBeVisible({ timeout: 540_000 });
    await expect(page.locator('.auto-steps li', { hasText: 'Detecting voices' })).toHaveClass(/done/);
    const words = Number(await page.locator('.auto-summary div').nth(2).locator('b').innerText());
    expect(words).toBeGreaterThan(10);
  });
});
