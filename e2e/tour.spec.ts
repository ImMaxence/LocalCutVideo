import { test } from '@playwright/test';
import { expect } from './helpers';

test.describe('guided tour', () => {
  test('starts with the demo and points at each tool', async ({ page }, info) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Try with a demo video' }).click();
    const bubble = page.locator('app-tour .bubble');
    await expect(bubble).toContainText('One click: the auto edit', { timeout: 60_000 });
    await expect(page).not.toHaveURL(/tour=/);

    // The lit area surrounds the auto edit button (once its move has finished).
    await expect
      .poll(async () => {
        const spot = (await page.locator('app-tour .spot').boundingBox())!;
        const button = (await page.locator('.auto-btn').boundingBox())!;
        return spot.x <= button.x && spot.y <= button.y && spot.x + spot.width >= button.x + button.width && spot.y + spot.height >= button.y + button.height;
      })
      .toBe(true);
    await page.screenshot({ path: info.outputPath('tour-first-step.png') });

    for (let i = 0; i < 7; i++) await page.getByRole('button', { name: /^Next/ }).click();
    await expect(bubble).toContainText('Export');
    await page.getByRole('button', { name: "Let's go!" }).click();
    await expect(page.locator('app-tour')).toHaveCount(0);

    // It can be replayed from the help button, and Escape closes it.
    await page.locator('.help-btn').click();
    await expect(bubble).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('app-tour')).toHaveCount(0);
  });
});
