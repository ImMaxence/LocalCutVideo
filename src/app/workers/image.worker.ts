/// <reference lib="webworker" />
/**
 * Image worker: generates a picture from a sentence with SANA-Sprint 0.6B (or FLUX.2 klein 4B,
 * see flux-pipeline.ts), on this device's graphics card. The model comes from Hugging Face once, then from the browser cache; the
 * sentence and the picture never leave the device. Each phase (text, picture, decoding) runs in
 * a worker of its own, ended afterwards: nothing else gives the graphics memory back.
 */
import * as Comlink from 'comlink';
import { GemmaTokenizer } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import {
  EMBEDDING_BYTES,
  EMBEDDING_SIZE,
  GUIDANCE,
  INSTRUCTION,
  LATENT_SCALE,
  MAX_TOKENS,
  SCALE_BYTES,
  SIGMA_DATA,
  TILE_OVERLAP,
  TILE_SIZE,
  TIMESTEPS,
  VAE_SCALING,
  cropLatents,
  featherWeights,
  modelInput,
  modelOutput,
  nextLatents,
  predictClean,
  sanaSize,
  scmTime,
  selectedTokens,
  tileStarts,
  toPixels,
  unpackEmbedding,
} from '../engine/sana';
import type { ImageModelId } from '../core/image-models';
import { fluxSize } from '../engine/flux';
import type { AspectFormat } from '../engine/model';
import { decodeFlux, denoiseFlux, downloadFlux, encodeFluxPrompt } from './flux-pipeline';
import type { ImageProgress, ImageWorkerApi } from './worker-types';

const WEIGHTS = 'https://huggingface.co/UtopiaIA/sana-sprint-0.6b-1024px-onnx-web/resolve/131c0f31f7607f8e92e7209dfeb968e8b7f44374';
const CONFIG = 'https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers/resolve/aa76e7f4f4928f378716b6716a2130fba3caf5b1';
const CACHE = 'lcv-image-models';

/** Everything to download, with its size for an exact percentage. */
const FILES = {
  tokenizer: { url: `${CONFIG}/tokenizer/tokenizer.json`, bytes: 34_362_873 },
  tokenizerConfig: { url: `${CONFIG}/tokenizer/tokenizer_config.json`, bytes: 46_996 },
  embeddings: { url: `${WEIGHTS}/text_encoder/embed_tokens_q4.bin`, bytes: 294_912_000 },
  scales: { url: `${WEIGHTS}/text_encoder/embed_tokens_q4_scales.bin`, bytes: 36_864_000 },
  textEncoder: { url: `${WEIGHTS}/text_encoder/model_q4.onnx`, bytes: 1_298_400_000 },
  transformer: { url: `${WEIGHTS}/transformer/model_fp16.onnx`, bytes: 1_189_000_000 },
  decoder: { url: `${WEIGHTS}/vae_decoder/model_fp16.onnx`, bytes: 318_800_000 },
};
type FileId = keyof typeof FILES;
const TOTAL_BYTES = Object.values(FILES).reduce((n, f) => n + f.bytes, 0);

ort.env.wasm.wasmPaths = {
  mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
};

let cancelled = false;

function throwIfCancelled(): void {
  if (cancelled) throw new Error('CANCELLED');
}

/** The files, downloaded the first time and read from the browser cache afterwards. */
async function ensureFiles(onProgress: (p: ImageProgress) => void): Promise<Record<FileId, Blob>> {
  const cache = await caches.open(CACHE);
  const found = {} as Record<FileId, Blob>;
  const ids = Object.keys(FILES) as FileId[];
  const missing: FileId[] = [];
  let done = 0;
  for (const id of ids) {
    const cached = await cache.match(FILES[id].url);
    if (cached) {
      found[id] = await cached.blob();
      done += FILES[id].bytes;
    } else {
      missing.push(id);
    }
  }
  for (const id of missing) {
    const { url } = FILES[id];
    onProgress({ stage: 'download', progress: done / TOTAL_BYTES, loaded: done, total: TOTAL_BYTES });
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Error (${response.status}) downloading ${url}`);
    const [toCache, toCount] = response.body.tee();
    const saved = cache.put(url, new Response(toCache, { headers: response.headers }));
    const reader = toCount.getReader();
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      if (cancelled) {
        await reader.cancel();
        throw new Error('CANCELLED');
      }
      done += value.length;
      onProgress({ stage: 'download', progress: Math.min(0.999, done / TOTAL_BYTES), loaded: done, total: TOTAL_BYTES });
    }
    await saved;
    found[id] = await (await cache.match(url))!.blob();
  }
  return found;
}

function createSession(file: Blob): Promise<ort.InferenceSession> {
  return file.arrayBuffer().then((buffer) =>
    ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }),
  );
}

/** The caption states of a sentence, as the image model expects them. */
async function encodeText(prompt: string, files: Record<FileId, Blob>): Promise<Float32Array> {
  const tokenizer = new GemmaTokenizer(JSON.parse(await files.tokenizer.text()), JSON.parse(await files.tokenizerConfig.text()));
  tokenizer.padding_side = 'right';
  const instructionTokens = tokenizer.encode(INSTRUCTION).length;
  const length = instructionTokens + MAX_TOKENS - 2;
  const encoded = tokenizer(INSTRUCTION + prompt.toLowerCase().trim(), { padding: 'max_length', truncation: true, max_length: length, add_special_tokens: true }) as unknown as {
    input_ids: { data: BigInt64Array };
    attention_mask: { data: BigInt64Array };
  };
  const attention = Array.from(encoded.attention_mask.data, Number);
  // Padding is on the right: the text encoder only takes the real tokens.
  const ids = Array.from(encoded.input_ids.data, Number).slice(0, attention.reduce((n, v) => n + v, 0));

  // The embedding table is far too large for a graphics card: only the tokens used are read.
  const embeddings = new Float32Array(ids.length * EMBEDDING_SIZE);
  for (const [position, id] of ids.entries()) {
    const [values, scales] = await Promise.all([
      files.embeddings.slice(id * EMBEDDING_BYTES, (id + 1) * EMBEDDING_BYTES).arrayBuffer(),
      files.scales.slice(id * SCALE_BYTES, (id + 1) * SCALE_BYTES).arrayBuffer(),
    ]);
    unpackEmbedding(new Uint8Array(values), new Uint8Array(scales), embeddings, position * EMBEDDING_SIZE);
  }

  const session = await createSession(files.textEncoder);
  throwIfCancelled();
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', embeddings, [1, ids.length, EMBEDDING_SIZE]) });
  const all = output[session.outputNames[0]].data as Float32Array;
  // The image model has no mask: it only gets the states of real tokens among the selected ones.
  const picked = selectedTokens(attention.length).filter((token) => attention[token]);
  const states = new Float32Array(picked.length * EMBEDDING_SIZE);
  picked.forEach((token, i) => states.set(all.subarray(token * EMBEDDING_SIZE, (token + 1) * EMBEDDING_SIZE), i * EMBEDDING_SIZE));
  await session.release();
  return states;
}

function gaussian(length: number): Float32Array {
  const values = new Float32Array(length);
  for (let i = 0; i < length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(1 - Math.random()));
    const angle = 2 * Math.PI * Math.random();
    values[i] = radius * Math.cos(angle);
    if (i + 1 < length) values[i + 1] = radius * Math.sin(angle);
  }
  return values;
}

async function generateLatents(
  states: Float32Array,
  dims: number[],
  file: Blob,
  onStep: (done: number) => void,
): Promise<Float32Array> {
  const session = await createSession(file);
  throwIfCancelled();
  const count = dims.reduce((a, b) => a * b, 1);
  let latents: Float32Array = gaussian(count).map((v) => v * SIGMA_DATA);
  let clean: Float32Array = latents;
  const tokens = states.length / EMBEDDING_SIZE;
  const steps = TIMESTEPS.length - 1;
  for (let step = 0; step < steps; step++) {
    throwIfCancelled();
    const t = TIMESTEPS[step];
    const s = scmTime(t);
    const input = modelInput(latents, s);
    const output = await session.run({
      latents: new ort.Tensor('float32', input, [1, ...dims]),
      caption: new ort.Tensor('float32', states, [1, tokens, EMBEDDING_SIZE]),
      timestep: new ort.Tensor('float32', new Float32Array([s]), [1]),
      guidance: new ort.Tensor('float32', new Float32Array([GUIDANCE]), [1]),
    });
    const predicted = modelOutput(input, output[session.outputNames[0]].data as Float32Array, s);
    clean = predictClean(latents, predicted, t);
    if (step + 1 < steps) latents = nextLatents(clean, gaussian(count), TIMESTEPS[step + 1]);
    onStep(step + 1);
  }
  await session.release();
  return clean;
}

/** Decodes overlapping pieces one by one and blends them: the whole picture at once runs out of graphics memory. */
async function decodeInPieces(session: ort.InferenceSession, latents: Float32Array, dims: number[], width: number, height: number): Promise<Float32Array> {
  const [channels, rows, columns] = dims;
  const pixelCount = width * height;
  const color = new Float32Array(pixelCount * 3);
  const total = new Float32Array(pixelCount);
  const side = TILE_SIZE * LATENT_SCALE;
  const feather = TILE_OVERLAP * LATENT_SCALE;
  const tops = tileStarts(rows);
  const lefts = tileStarts(columns);
  for (const [r, top] of tops.entries()) {
    const across = featherWeights(side, feather, r > 0, r < tops.length - 1);
    for (const [c, left] of lefts.entries()) {
      throwIfCancelled();
      const along = featherWeights(side, feather, c > 0, c < lefts.length - 1);
      const piece = cropLatents(latents, channels, rows, columns, top, left, TILE_SIZE);
      const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', piece, [1, channels, TILE_SIZE, TILE_SIZE]) });
      const image = output[session.outputNames[0]].data as Float32Array;
      for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
          const weight = across[y] * along[x];
          const target = (top * LATENT_SCALE + y) * width + left * LATENT_SCALE + x;
          total[target] += weight;
          for (let channel = 0; channel < 3; channel++) color[channel * pixelCount + target] += image[(channel * side + y) * side + x] * weight;
        }
      }
    }
  }
  for (let i = 0; i < pixelCount; i++) for (let channel = 0; channel < 3; channel++) color[channel * pixelCount + i] /= total[i];
  return color;
}

async function decode(clean: Float32Array, dims: number[], width: number, height: number, file: Blob): Promise<Blob> {
  const session = await createSession(file);
  throwIfCancelled();
  const scale = SIGMA_DATA * VAE_SCALING;
  const pixels = toPixels(await decodeInPieces(session, clean.map((v) => v / scale), dims, width, height), width, height);
  await session.release();
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

/** A finished picture as a PNG file. */
function toPng(image: Float32Array, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(toPixels(image, width, height), width, height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

const api: ImageWorkerApi = {
  async download(model: ImageModelId, onProgress: (p: ImageProgress) => void): Promise<void> {
    cancelled = false;
    if (model === 'flux') await downloadFlux(onProgress, () => cancelled);
    else await ensureFiles(onProgress);
  },

  async encode(model: ImageModelId, prompt: string): Promise<Float32Array> {
    cancelled = false;
    return model === 'flux' ? encodeFluxPrompt(prompt) : encodeText(prompt, await ensureFiles(() => undefined));
  },

  async denoise(model: ImageModelId, states: Float32Array, format: AspectFormat, onStep: (done: number) => void): Promise<Float32Array> {
    cancelled = false;
    if (model === 'flux') {
      const { width, height } = fluxSize(format);
      return denoiseFlux(states, width, height, onStep, throwIfCancelled);
    }
    const { width, height } = sanaSize(format);
    const files = await ensureFiles(() => undefined);
    return generateLatents(states, [32, height / LATENT_SCALE, width / LATENT_SCALE], files.transformer, onStep);
  },

  async decode(model: ImageModelId, latents: Float32Array, format: AspectFormat): Promise<Blob> {
    cancelled = false;
    if (model === 'flux') {
      const { width, height } = fluxSize(format);
      return toPng(await decodeFlux(latents, width, height), width, height);
    }
    const { width, height } = sanaSize(format);
    const files = await ensureFiles(() => undefined);
    return decode(latents, [32, height / LATENT_SCALE, width / LATENT_SCALE], width, height, files.decoder);
  },

  cancel(): void {
    cancelled = true;
  },
};

Comlink.expose(api);
