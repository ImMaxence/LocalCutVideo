import { describe, expect, it } from 'vitest';
import { FLUX_LATENT_SIZE, FLUX_SCALE, fluxImageIds, fluxPackedLatent, fluxSigmas, fluxSize, fluxTextIds } from './flux';

describe('FLUX.2 klein maths', () => {
  it('uses sizes in multiples of an image token', () => {
    for (const format of ['16:9', '9:16', '1:1'] as const) {
      const { width, height } = fluxSize(format);
      expect(width % FLUX_SCALE).toBe(0);
      expect(height % FLUX_SCALE).toBe(0);
    }
    expect(fluxSize('16:9')).toEqual({ width: 1280, height: 720 });
  });

  it('follows the schedule of the checkpoint', () => {
    const sigmas = fluxSigmas(4, 1024);
    [1, 0.849, 0.652, 0.385, 0].forEach((expected, i) => expect(sigmas[i]).toBeCloseTo(expected, 3));
  });

  it('numbers image tokens by row and column', () => {
    expect(Array.from(fluxImageIds(2, 3), Number)).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 2, 0]);
  });

  it('numbers text tokens on the last axis', () => {
    expect(Array.from(fluxTextIds(2), Number)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('moves every value to its channel', () => {
    const latent = new Float32Array(2 * FLUX_LATENT_SIZE);
    latent[1] = 5; // token 0, value 1
    latent[FLUX_LATENT_SIZE] = 7; // token 1, value 0
    const packed = fluxPackedLatent(latent, 1, 2);
    expect(packed[1]).toBe(7); // value 0, token 1
    expect(packed[2]).toBe(5); // value 1, token 0
  });
});
