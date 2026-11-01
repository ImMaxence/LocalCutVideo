import { test } from '@playwright/test';
import { dragOnWaveform, expect, openVideo, outputDuration, timelineRegions, watchErrors } from './helpers';

test.describe('editor', () => {
  test('selects a part on the waveform, then cuts it or changes its speed', async ({ page }) => {
    const errors = watchErrors(page);
    await openVideo(page);
    const full = await outputDuration(page);
    expect(full).toBeGreaterThan(40);

    // Speed without a selection explains how to select.
    await page.locator('app-timeline app-speed-menu > button').click();
    await expect(page.locator('.notice')).toContainText('Select a part first');

    // Dragging selects, nothing is removed yet.
    await dragOnWaveform(page, 0.3, 0.45);
    expect(await timelineRegions(page)).toEqual(['mark']);
    await expect.poll(() => outputDuration(page)).toBeCloseTo(full, 0);

    // 2× on the selection.
    await page.locator('app-timeline app-speed-menu > button').click();
    await page.locator('app-timeline app-speed-menu .rate', { hasText: /^2×$/ }).click();
    await expect.poll(() => timelineRegions(page)).toEqual(['speed']);
    await expect.poll(() => outputDuration(page)).toBeLessThan(full - 2);
    const sped = await outputDuration(page);

    // Another part, cut.
    await page.keyboard.press('Escape');
    await dragOnWaveform(page, 0.7, 0.8);
    await page.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect.poll(async () => (await timelineRegions(page)).sort()).toEqual(['cut', 'speed']);
    await expect.poll(() => outputDuration(page)).toBeLessThan(sped - 2);

    // Undo brings the cut back.
    await page.keyboard.press('Control+z');
    await expect.poll(() => outputDuration(page)).toBeCloseTo(sped, 0);
    expect(errors).toEqual([]);
  });

  test('adjusts the edges of a cut with the nudge buttons', async ({ page }) => {
    await openVideo(page);
    await dragOnWaveform(page, 0.3, 0.45);
    await page.keyboard.press('x');
    await expect.poll(() => timelineRegions(page)).toEqual(['cut']);
    const cut = (await page.evaluate(() => {
      const el = document.querySelector('app-timeline .wave > div')?.shadowRoot?.querySelector('[part~="region"]');
      const r = el!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + 20 };
    }))!;
    await page.mouse.click(cut.x, cut.y);
    const editor = page.locator('app-timeline .cut-edit');
    await expect(editor).toBeVisible();
    const before = await editor.locator('.time').last().innerText();
    await editor.locator('.edge').last().locator('button').last().click();
    await expect(editor.locator('.time').last()).not.toHaveText(before);
  });

  test('adds a text over the video and turns the project', async ({ page }) => {
    await openVideo(page);
    await page.getByRole('tab', { name: 'Texts' }).click();
    await page.getByRole('button', { name: 'Add a text at the playhead' }).click();
    await page.locator('.text-input').fill('Hello *world*');
    await expect(page.locator('.text-list')).toContainText('Hello world');
    await page.getByRole('tab', { name: 'Format' }).click();
    await page.getByRole('button', { name: /^90°/ }).last().click();
    await expect(page.locator('app-inspector .rotation')).toHaveText('90°');
  });

  test('fits a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openVideo(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
