import { test } from '@playwright/test';
import fs from 'node:fs';
import { DEMO_VIDEO, expect, watchErrors } from './helpers';

test.describe('thumbnail maker', () => {
  test('suggests moments and downloads a 1280×720 JPG with the title', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('/thumbnail');
    await page.locator('[data-testid=thumb-input]').setInputFiles(DEMO_VIDEO);
    await expect(page.locator('.moment img')).toHaveCount(8, { timeout: 60_000 });
    await page.locator('.moment').nth(2).click();
    await page.locator('#thumb-title').fill('I edited this in *2 minutes*');

    // Holding › scrolls through the frames.
    const before = await page.locator('.scrub .time').innerText();
    const next = (await page.locator('.scrub .step').nth(1).boundingBox())!;
    await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1500);
    await page.mouse.up();
    await expect(page.locator('.scrub .time')).not.toHaveText(before);

    const download = page.waitForEvent('download');
    await page.locator('.download .btn.primary').click();
    const file = info.outputPath('thumbnail.jpg');
    await (await download).saveAs(file);
    expect((await download).suggestedFilename()).toBe('i-edited-this-in-2-minutes-thumbnail.jpg');
    // JPEG header and its size (SOF0 / SOF2 marker holds height then width).
    const jpg = fs.readFileSync(file);
    expect(jpg.subarray(0, 2).toString('hex')).toBe('ffd8');
    const sof = jpg.findIndex((b, i) => b === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2));
    expect([jpg.readUInt16BE(sof + 7), jpg.readUInt16BE(sof + 5)]).toEqual([1280, 720]);
    expect(errors).toEqual([]);
  });
});
