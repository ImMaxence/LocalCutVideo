import { describe, expect, it } from 'vitest';
import { TimeStretcher } from './time-stretch';

const RATE = 48000;

/** 2 s of a 440 Hz tone with a slow amplitude wobble, stretched in 100 ms chunks. */
function stretch(rate: number): Float32Array {
  const input = Float32Array.from(
    { length: RATE * 2 },
    (_, i) => Math.sin((2 * Math.PI * 440 * i) / RATE) * (0.6 + 0.3 * Math.sin((2 * Math.PI * 3 * i) / RATE)),
  );
  const stretcher = new TimeStretcher(rate);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += 4800) {
    const chunk = input.subarray(i, i + 4800);
    parts.push(stretcher.push([chunk, chunk])[0]);
  }
  parts.push(stretcher.flush()[0]);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Frequency from the zero crossings of the steady middle half. */
function pitch(signal: Float32Array): number {
  const middle = signal.subarray(Math.floor(signal.length / 4), Math.floor((signal.length * 3) / 4));
  let crossings = 0;
  for (let i = 1; i < middle.length; i++) if (middle[i - 1] < 0 && middle[i] >= 0) crossings++;
  return crossings / (middle.length / RATE);
}

describe('time stretch', () => {
  for (const rate of [0.5, 0.75, 1.5, 2, 4]) {
    it(`plays ${rate}× without changing the pitch`, () => {
      const out = stretch(rate);
      expect(out.length / RATE).toBeCloseTo(2 / rate, 1);
      expect(Math.abs(pitch(out) - 440)).toBeLessThan(5);
      let peak = 0;
      for (const v of out) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.8);
      expect(peak).toBeLessThan(1);
    });
  }
});
