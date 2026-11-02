import { test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import fs from 'node:fs';
import { dragOnWaveform, expect, openVideo, outputDuration, useDownloads, waitTimeline, watchErrors } from './helpers';

test.describe('export', () => {
  test('renders an MP4 of the edit, with its speed change, text, fade and sound', async ({ page }, info) => {
    test.slow();
    const errors = watchErrors(page);
    await openVideo(page);
    await dragOnWaveform(page, 0.3, 0.45);
    await page.locator('app-timeline app-speed-menu > button').click();
    await page.locator('app-timeline app-speed-menu .rate', { hasText: /^0\.5×$/ }).click();
    await page.getByRole('tab', { name: 'Texts' }).click();
    await page.getByRole('button', { name: 'Add a text at the playhead' }).click();
    await page.getByRole('tab', { name: 'Cuts' }).click();
    await page.getByRole('button', { name: 'Fade to black' }).click();
    await page.getByRole('tab', { name: 'Sound' }).click();
    await page.locator('app-inspector .volume-row input[type=range]').fill('1.5');
    const expected = await outputDuration(page);

    await useDownloads(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download', { timeout: 300_000 });
    await page.getByRole('button', { name: 'Export MP4' }).click();
    const file = info.outputPath('export.mp4');
    await (await download).saveAs(file);

    const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(fs.readFileSync(file)) });
    expect(await input.computeDuration()).toBeCloseTo(expected, 0);
    expect(await input.getPrimaryVideoTrack()).not.toBeNull();
    expect(await input.getPrimaryAudioTrack()).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('saves the project as a file and opens it again', async ({ page }, info) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Try the demo' }).click();
    // The demo starts the guided tour: skip it.
    await page.getByRole('button', { name: 'Skip the tour' }).first().click();
    await expect(page.locator('app-tour')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Texts' }).click();
    await page.getByRole('button', { name: 'Add a text at the playhead' }).click();

    await useDownloads(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save the project' }).click();
    const file = info.outputPath('project.lcv.json');
    await (await download).saveAs(file);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(doc.format).toBe('localcutvideo-project');
    expect(doc.project.texts).toHaveLength(1);

    await page.goto('/app');
    await page.locator('[data-testid=project-input]').setInputFiles(file);
    await page.waitForURL(/\/app\/[\w-]+$/);
    // The demo video is served by the site, so it reconnects by itself.
    await waitTimeline(page);
    await page.getByRole('tab', { name: 'Texts' }).click();
    await expect(page.locator('.text-list li')).toHaveCount(1);
  });
});
