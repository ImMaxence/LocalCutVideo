import { type Page, expect } from '@playwright/test';
import path from 'node:path';

/** The sample video served on the site, also used as test fixture. */
export const DEMO_VIDEO = path.join(__dirname, '..', 'public', 'demo', 'localcutvideo-demo.mp4');

/** Collects console errors and page errors, to assert there are none at the end of a test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Imports a video from the projects page and waits until its waveform is ready. */
export async function openVideo(page: Page, file = DEMO_VIDEO): Promise<void> {
  await page.goto('/app');
  await page.locator('[data-testid=file-input]').setInputFiles(file);
  await page.waitForURL(/\/app\/[\w-]+$/);
  await waitTimeline(page);
}

export async function waitTimeline(page: Page): Promise<void> {
  await page.locator('app-timeline[data-ready]').waitFor({ timeout: 120_000 });
}

/** Output duration shown under the preview, in seconds. */
export async function outputDuration(page: Page): Promise<number> {
  const text = await page.locator('app-preview .time .faint').innerText();
  const [m, s] = text.replace('/', '').trim().split(':').map(Number);
  return m * 60 + s;
}

/**
 * Drags on the waveform between two fractions of its width (selects that part). A busy machine
 * (right after a Whisper run, for instance) may drop the first gesture: it is then made again.
 */
export async function dragOnWaveform(page: Page, from: number, to: number): Promise<void> {
  const box = (await page.locator('app-timeline .wave-wrap').boundingBox())!;
  const y = box.y + 28;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, y, { steps: 12 });
    await page.mouse.up();
    try {
      await expect.poll(() => timelineRegions(page), { timeout: 3000 }).toContain('mark');
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error('The waveform did not take the selection');
}

/** Regions drawn on the timeline (cuts, speed changes, selection), by kind. */
export async function timelineRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...(document.querySelector('app-timeline .wave > div')?.shadowRoot?.querySelectorAll('[part~="region"]') ?? [])].map(
      (r) => (r.getAttribute('part') ?? '').split(' ')[1].split('-')[0],
    ),
  );
}

/** The export and project downloads go through the browser (no save picker in tests). */
export async function useDownloads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { showSaveFilePicker?: unknown };
    delete w.showSaveFilePicker;
    w.showSaveFilePicker = undefined;
  });
}

export { expect };
