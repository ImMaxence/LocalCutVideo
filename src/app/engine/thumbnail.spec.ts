import { describe, expect, it } from 'vitest';
import type { TextOverlay } from './model';
import type { Ctx2D } from './render';
import { defaultThumbnail, drawTexts, frameScore, parseTitle, thumbnailName, visibleFraction } from './thumbnail';

describe('title', () => {
  it('colors the words between asterisks', () => {
    expect(parseTitle('Votre *titre* ici').map((w) => [w.text, w.accent])).toEqual([
      ['Votre', false],
      ['titre', true],
      ['ici', false],
    ]);
  });

  it('accepts an accent over several words, and lone asterisks', () => {
    expect(parseTitle('En *2 minutes* chrono').map((w) => w.accent)).toEqual([false, true, true, false]);
    expect(parseTitle('a * b c * d').map((w) => w.accent)).toEqual([false, true, true, false]);
  });

  it('keeps the line breaks typed by the user', () => {
    expect(parseTitle('one two\nthree').map((w) => w.newLine)).toEqual([false, false, true]);
  });

  it('names the file after the title', () => {
    expect(thumbnailName("J'ai monté *ça* en 2 minutes !", 'video', 'jpg')).toBe('j-ai-monte-ca-en-2-minutes-thumbnail.jpg');
    expect(thumbnailName('***', 'my-clip', 'png')).toBe('my-clip-thumbnail.png');
  });
});

describe('framing', () => {
  const s = defaultThumbnail('');

  it('shows the whole picture when shapes match, a part when zoomed', () => {
    expect(visibleFraction(1920, 1080, s, 1280, 720)).toEqual({ fx: 1, fy: 1 });
    expect(visibleFraction(1920, 1080, { ...s, zoom: 2 }, 1280, 720)).toEqual({ fx: 0.5, fy: 0.5 });
  });

  it('crops the sides of a landscape picture for a vertical thumbnail', () => {
    const { fx, fy } = visibleFraction(1920, 1080, { ...s, format: '9:16' }, 1080, 1920);
    expect(fy).toBe(1);
    expect(fx).toBeCloseTo(1080 * (9 / 16) / 1920);
  });

  it('accounts for the rotation', () => {
    const { fx, fy } = visibleFraction(1920, 1080, { ...s, rotation: 90 }, 1080, 1920);
    expect(fx).toBeCloseTo(1);
    expect(fy).toBeCloseTo(1);
  });
});

describe('best moments', () => {
  it('prefers a sharp, contrasted frame to a flat one', () => {
    const size = 32;
    const sharp = new Uint8ClampedArray(size * size * 4);
    const flat = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = Math.floor(i / size);
      const v = (x + y) % 2 ? 230 : 30;
      sharp.set([v, v, v, 255], i * 4);
      flat.set([120, 120, 120, 255], i * 4);
    }
    expect(frameScore(sharp, size, size)).toBeGreaterThan(frameScore(flat, size, size));
  });
});

/** Canvas context that records what is written, and with which color and opacity. */
function recordingContext() {
  const drawn: { text: string; fill: string; alpha: number }[] = [];
  const state = { fillStyle: '', globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'measureText') return (text: string) => ({ width: text.length * 10 });
      if (key === 'fillText') return (text: string) => drawn.push({ text, fill: String(target.fillStyle), alpha: target.globalAlpha });
      if (key in target) return target[key as keyof typeof target];
      return () => undefined;
    },
    set(target, key, value) {
      (target as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx2D, drawn };
}

describe('texts over the video', () => {
  const text: TextOverlay = { ...defaultThumbnail('Hello *world*'), id: 't', start: 2, end: 5, size: 0.6, uppercase: false };

  it('shows a text only during its time, fading in', () => {
    const before = recordingContext();
    drawTexts(before.ctx, [text], 1, 1280, 720);
    expect(before.drawn).toEqual([]);

    const during = recordingContext();
    drawTexts(during.ctx, [text], 2.1, 1280, 720);
    expect(during.drawn.map((d) => d.text)).toEqual(['Hello', 'world']);
    expect(during.drawn[0].alpha).toBeCloseTo(0.5);
    expect(during.drawn[1].fill).toBe(text.accent);
  });
});
