import type { AspectFormat } from './model';

/**
 * The maths of SANA-Sprint 0.6B (image generation), following the diffusers SanaSprintPipeline
 * and its SCMScheduler. Kept apart from the worker so it can be tested without a graphics card.
 */

export const SIGMA_DATA = 0.5;
export const VAE_SCALING = 0.41407;
export const GUIDANCE = 4.5 * 0.1;
/** Two steps: the setting the model was made for. */
export const TIMESTEPS = [1.5708, 1.3, 0];
export const MAX_TOKENS = 300;
/** One latent per 32 pixels. */
export const LATENT_SCALE = 32;

/** Rewrites a short request into a detailed one, inside the text encoder (part of the model). */
export const INSTRUCTION = [
  "Given a user prompt, generate an 'Enhanced prompt' that provides detailed visual descriptions suitable for image generation. Evaluate the level of detail in the user prompt:",
  '- If the prompt is simple, focus on adding specifics about colors, shapes, sizes, textures, and spatial relationships to create vivid and concrete scenes.',
  '- If the prompt is already detailed, refine and enhance the existing details slightly without overcomplicating.',
  'Here are examples of how to transform or refine prompts:',
  '- User Prompt: A cat sleeping -> Enhanced: A small, fluffy white cat curled up in a round shape, sleeping peacefully on a warm sunny windowsill, surrounded by pots of blooming red flowers.',
  '- User Prompt: A busy city street -> Enhanced: A bustling city street scene at dusk, featuring glowing street lamps, a diverse crowd of people in colorful clothing, and a double-decker bus passing by towering glass skyscrapers.',
  'Please generate only the enhanced description for the prompt below and avoid including any additional commentary or evaluations:',
  'User Prompt: ',
].join('\n');

/** Picture sizes the model was trained on, closest to each thumbnail format. */
export function sanaSize(format: AspectFormat): { width: number; height: number } {
  if (format === '16:9') return { width: 1344, height: 768 };
  if (format === '9:16') return { width: 768, height: 1344 };
  return { width: 1024, height: 1024 };
}

/** Positions of the tokens kept for the image model: the first one and the last ones. */
export function selectedTokens(length: number): number[] {
  const kept = Math.min(length - 1, MAX_TOKENS - 1);
  return [0, ...Array.from({ length: kept }, (_, i) => length - kept + i)];
}

/** Time given to the transformer for a scheduler time. */
export function scmTime(t: number): number {
  return Math.sin(t) / (Math.cos(t) + Math.sin(t));
}

/** Scale of the transformer's input at a given scmTime. */
export function inputScale(s: number): number {
  return Math.sqrt(s * s + (1 - s) * (1 - s));
}

/** The latents as the transformer expects them. */
export function modelInput(latents: Float32Array, s: number): Float32Array {
  const scale = inputScale(s) / SIGMA_DATA;
  return latents.map((v) => v * scale);
}

/** Turns the transformer's output into the scheduler's model output. */
export function modelOutput(input: Float32Array, output: Float32Array, s: number): Float32Array {
  const scale = inputScale(s);
  return output.map((v, i) => (((1 - 2 * s) * input[i] + (1 - 2 * s + 2 * s * s) * v) / scale) * SIGMA_DATA);
}

/** The clean picture predicted at time t, in latents. */
export function predictClean(latents: Float32Array, output: Float32Array, t: number): Float32Array {
  const c = Math.cos(t);
  const n = Math.sin(t);
  return latents.map((v, i) => c * v - n * output[i]);
}

/** The next latents: the predicted picture, with fresh noise for the next time. */
export function nextLatents(clean: Float32Array, noise: Float32Array, t: number): Float32Array {
  const c = Math.cos(t);
  const n = Math.sin(t) * SIGMA_DATA;
  return clean.map((v, i) => c * v + n * noise[i]);
}

/** One value of a float16 table. */
export function float16(bytes: Uint8Array, index: number): number {
  const v = bytes[index * 2] | (bytes[index * 2 + 1] << 8);
  const sign = v & 0x8000 ? -1 : 1;
  const exponent = (v >> 10) & 0x1f;
  const fraction = v & 0x3ff;
  if (exponent === 0) return (sign * fraction) / 2 ** 24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export const EMBEDDING_SIZE = 2304;
const EMBEDDING_BLOCK = 32;
/** Bytes of one token in the table of 4-bit values, and in the table of block scales. */
export const EMBEDDING_BYTES = EMBEDDING_SIZE / 2;
export const SCALE_BYTES = (EMBEDDING_SIZE / EMBEDDING_BLOCK) * 2;

/**
 * Unpacks a token's embedding: two signed 4-bit values per byte (the even column in the low
 * nibble, stored plus 8), multiplied by one scale per block of 32 columns.
 */
export function unpackEmbedding(values: Uint8Array, scales: Uint8Array, target: Float32Array, offset: number): void {
  for (let column = 0; column < EMBEDDING_SIZE; column++) {
    const byte = values[column >> 1];
    const nibble = column & 1 ? byte >> 4 : byte & 15;
    target[offset + column] = (nibble - 8) * float16(scales, Math.floor(column / EMBEDDING_BLOCK));
  }
}

/** RGBA pixels of the decoded picture (values in [-1, 1], channels first). */
export function toPixels(image: Float32Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    for (let channel = 0; channel < 3; channel++) pixels[i * 4 + channel] = (image[channel * pixelCount + i] + 1) * 127.5;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

/** Side of a piece and overlap between pieces of the decoding, in latents (32 pixels each). */
export const TILE_SIZE = 16;
export const TILE_OVERLAP = 4;

/** Start of each piece along one side: evenly spread, the last one ending on the edge. */
export function tileStarts(total: number, size = TILE_SIZE, overlap = TILE_OVERLAP): number[] {
  if (total <= size) return [0];
  const count = Math.ceil((total - size) / (size - overlap)) + 1;
  return Array.from({ length: count }, (_, i) => Math.round((i * (total - size)) / (count - 1)));
}

/** The latents of one piece (channels first). */
export function cropLatents(latents: Float32Array, channels: number, height: number, width: number, top: number, left: number, size: number): Float32Array {
  const piece = new Float32Array(channels * size * size);
  for (let c = 0; c < channels; c++) {
    for (let y = 0; y < size; y++) {
      const from = (c * height + top + y) * width + left;
      piece.set(latents.subarray(from, from + size), (c * size + y) * size);
    }
  }
  return piece;
}

/** Weight of each pixel along one side of a piece: fades in and out where it meets a neighbour. */
export function featherWeights(length: number, feather: number, fadeStart: boolean, fadeEnd: boolean): Float32Array {
  return Float32Array.from({ length }, (_, i) => {
    const start = fadeStart ? Math.min(1, (i + 1) / (feather + 1)) : 1;
    const end = fadeEnd ? Math.min(1, (length - i) / (feather + 1)) : 1;
    return Math.min(start, end);
  });
}
