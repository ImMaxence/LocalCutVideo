import { describe, expect, it } from 'vitest';
import { EMBEDDING_BYTES, EMBEDDING_SIZE, SCALE_BYTES, cropLatents, featherWeights, float16, inputScale, modelInput, nextLatents, predictClean, sanaSize, scmTime, selectedTokens, tileStarts, toPixels, unpackEmbedding } from './sana';

describe('SANA-Sprint maths', () => {
  it('uses a trained size for each format, in multiples of the latent scale', () => {
    expect(sanaSize('16:9')).toEqual({ width: 1344, height: 768 });
    expect(sanaSize('9:16')).toEqual({ width: 768, height: 1344 });
    expect(sanaSize('1:1')).toEqual({ width: 1024, height: 1024 });
  });

  it('keeps the first token and the last ones', () => {
    expect(selectedTokens(5)).toEqual([0, 1, 2, 3, 4]);
    const many = selectedTokens(600);
    expect(many).toHaveLength(300);
    expect(many[0]).toBe(0);
    expect(many[1]).toBe(301);
    expect(many.at(-1)).toBe(599);
  });

  it('computes the transformer time like the pipeline', () => {
    expect(scmTime(0)).toBe(0);
    expect(scmTime(Math.PI / 4)).toBeCloseTo(0.5);
    expect(inputScale(0)).toBe(1);
    expect(modelInput(new Float32Array([1]), 0)[0]).toBeCloseTo(2);
  });

  it('follows the trigflow scheduler', () => {
    expect(predictClean(new Float32Array([2]), new Float32Array([1]), 0)[0]).toBeCloseTo(2);
    expect(predictClean(new Float32Array([2]), new Float32Array([1]), Math.PI / 2)[0]).toBeCloseTo(-1);
    expect(nextLatents(new Float32Array([3]), new Float32Array([1]), 0)[0]).toBeCloseTo(3);
    expect(nextLatents(new Float32Array([3]), new Float32Array([1]), Math.PI / 2)[0]).toBeCloseTo(0.5);
  });

  it('reads float16 values', () => {
    expect(float16(new Uint8Array([0x00, 0x3c]), 0)).toBe(1);
    expect(float16(new Uint8Array([0x00, 0xc0]), 0)).toBe(-2);
    expect(float16(new Uint8Array([0x00, 0x34]), 0)).toBe(0.25);
  });

  it('unpacks a 4-bit embedding, even column in the low nibble', () => {
    const values = new Uint8Array(EMBEDDING_BYTES);
    values[0] = 0xf9; // column 0: 9 - 8 = 1; column 1: 15 - 8 = 7
    const scales = new Uint8Array(SCALE_BYTES);
    scales.set([0x00, 0x40]); // 2.0 for the first block
    const target = new Float32Array(EMBEDDING_SIZE);
    unpackEmbedding(values, scales, target, 0);
    expect(target[0]).toBe(2);
    expect(target[1]).toBe(14);
  });

  it('covers the whole picture with overlapping pieces', () => {
    expect(tileStarts(16)).toEqual([0]);
    for (const total of [24, 32, 42]) {
      const starts = tileStarts(total);
      expect(starts[0]).toBe(0);
      expect(starts.at(-1)! + 16).toBe(total);
      for (let i = 1; i < starts.length; i++) expect(starts[i - 1] + 16 - starts[i]).toBeGreaterThanOrEqual(4);
    }
  });

  it('crops a piece of every channel', () => {
    // 2 channels of 3×3: channel c, row y, column x holds c*100 + y*10 + x.
    const latents = Float32Array.from({ length: 18 }, (_, i) => Math.floor(i / 9) * 100 + Math.floor((i % 9) / 3) * 10 + (i % 3));
    expect(Array.from(cropLatents(latents, 2, 3, 3, 1, 1, 2))).toEqual([11, 12, 21, 22, 111, 112, 121, 122]);
  });

  it('fades only the sides that meet a neighbour', () => {
    expect(Array.from(featherWeights(4, 2, false, false))).toEqual([1, 1, 1, 1]);
    const inner = featherWeights(6, 2, true, true);
    expect(inner[0]).toBeCloseTo(1 / 3);
    expect(inner[2]).toBe(1);
    expect(inner[5]).toBeCloseTo(1 / 3);
  });

  it('turns channels-first values into pixels', () => {
    const pixels = toPixels(new Float32Array([1, -1, 0]), 1, 1);
    expect(Array.from(pixels)).toEqual([255, 0, 128, 255]);
  });
});
