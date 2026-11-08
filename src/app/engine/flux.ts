import type { AspectFormat } from './model';

/**
 * The maths of FLUX.2 klein 4B (image generation), following its diffusers pipeline. Kept apart
 * from the worker so it can be tested without a graphics card.
 */

export const FLUX_STEPS = 4;
/** The prompt is padded to this many tokens. */
export const FLUX_TEXT_TOKENS = 512;
export const FLUX_TEXT_SIZE = 7680;
/** Values per image token. */
export const FLUX_LATENT_SIZE = 128;
/** One image token per 16 pixels. */
export const FLUX_SCALE = 16;

/** The picture size of each thumbnail format (multiples of 16). */
export function fluxSize(format: AspectFormat): { width: number; height: number } {
  if (format === '16:9') return { width: 1280, height: 720 };
  if (format === '9:16') return { width: 720, height: 1280 };
  return { width: 1024, height: 1024 };
}

/** The noise levels: the schedule shifts with the number of image tokens, like the checkpoint's own. */
export function fluxSigmas(steps: number, imageTokens: number): number[] {
  const slope = (1.15 - 0.5) / (4096 - 256);
  const shift = Math.exp(0.5 + slope * (imageTokens - 256));
  const sigmas = Array.from({ length: steps }, (_, i) => {
    const s = 1 + ((1 / steps - 1) * i) / Math.max(1, steps - 1);
    return shift / (shift + (1 / s - 1));
  });
  return [...sigmas, 0];
}

/** Position of each image token: [t, row, column, layer]. */
export function fluxImageIds(rows: number, columns: number): BigInt64Array {
  const ids = new BigInt64Array(rows * columns * 4);
  for (let i = 0; i < rows * columns; i++) {
    ids[i * 4 + 1] = BigInt(Math.floor(i / columns));
    ids[i * 4 + 2] = BigInt(i % columns);
  }
  return ids;
}

/** Position of each text token: [t, row, column, layer]. */
export function fluxTextIds(tokens: number): BigInt64Array {
  const ids = new BigInt64Array(tokens * 4);
  for (let i = 0; i < tokens; i++) ids[i * 4 + 3] = BigInt(i);
  return ids;
}

/** Turns [token, value] latents into the [value, row, column] layout the decoder takes. */
export function fluxPackedLatent(latent: Float32Array, rows: number, columns: number): Float32Array {
  const tokens = rows * columns;
  const packed = new Float32Array(latent.length);
  for (let token = 0; token < tokens; token++) {
    for (let value = 0; value < FLUX_LATENT_SIZE; value++) packed[value * tokens + token] = latent[token * FLUX_LATENT_SIZE + value];
  }
  return packed;
}
