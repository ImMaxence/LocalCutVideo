/// <reference lib="webworker" />
/**
 * FLUX.2 klein 4B and its text encoder Qwen3 4B, from an ONNX export made for browsers. Its
 * files are written to the site's private disk space (OPFS): the browser cache refuses files
 * of this size. Each phase runs in its own worker (see image.worker.ts).
 */
import { Qwen2Tokenizer } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { FLUX_LATENT_SIZE, FLUX_SCALE, FLUX_STEPS, FLUX_TEXT_SIZE, FLUX_TEXT_TOKENS, fluxImageIds, fluxPackedLatent, fluxSigmas, fluxTextIds } from '../engine/flux';
import type { ImageProgress } from './worker-types';

const BASE = 'https://huggingface.co/cgb/flux2-klein-4b-onnx-webgpu/resolve/3bffc0efef1d9f84727036cdbc44df3b6ab51131/';

const TEXT_SHARDS = ['text_encoder_q4-00000.data', 'text_encoder_q4-00001.data'];
const TRANSFORMER_SHARDS = ['transformer_q8-00000.data', 'transformer_q8-00001.data', 'transformer_q8-00002.data'];
const DECODER_DATA = 'vae_decoder.onnx.data';

/** Everything to download, with its exact size. */
const FILES: Record<string, number> = {
  'tokenizer/tokenizer.json': 11_422_654,
  'tokenizer/tokenizer_config.json': 5_404,
  'tokenizer/chat_template.jinja': 4_168,
  'text_encoder_q4.onnx': 5_341_471,
  'text_encoder_q4-00000.data': 1_599_733_760,
  'text_encoder_q4-00001.data': 594_170_880,
  'transformer_q8.onnx': 4_991_601,
  'transformer_q8-00000.data': 1_585_446_912,
  'transformer_q8-00001.data': 1_566_572_544,
  'transformer_q8-00002.data': 981_258_240,
  'vae_decoder.onnx': 760_826,
  'vae_decoder.onnx.data': 198_508_544,
};
const TOTAL_BYTES = Object.values(FILES).reduce((n, bytes) => n + bytes, 0);

const storageName = (name: string) => `flux-${name.replace('/', '-')}`;

/** A complete downloaded file. A cancelled download leaves an empty one, which does not count. */
async function storedFile(name: string): Promise<File | null> {
  try {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle(storageName(name))).getFile();
    return file.size === FILES[name] ? file : null;
  } catch {
    return null;
  }
}

async function file(name: string): Promise<File> {
  const found = await storedFile(name);
  if (!found) throw new Error(`Missing model file ${name}`);
  return found;
}

export async function downloadFlux(onProgress: (p: ImageProgress) => void, isCancelled: () => boolean): Promise<void> {
  const missing: string[] = [];
  let done = 0;
  for (const name of Object.keys(FILES)) {
    if (await storedFile(name)) done += FILES[name];
    else missing.push(name);
  }
  if (!missing.length) return;
  const root = await navigator.storage.getDirectory();
  const report = () => onProgress({ stage: 'download', progress: Math.min(0.999, done / TOTAL_BYTES), loaded: done, total: TOTAL_BYTES });
  for (const name of missing) {
    report();
    const abort = new AbortController();
    const url = BASE + name;
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`Error (${response.status}) downloading ${url}`);
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (isCancelled()) {
          abort.abort();
          return;
        }
        done += chunk.length;
        report();
        controller.enqueue(chunk);
      },
    });
    const handle = await root.getFileHandle(storageName(name), { create: true });
    try {
      // The file only appears once complete: createWritable works on a copy until it closes.
      await response.body.pipeThrough(counter).pipeTo(await handle.createWritable());
    } catch (e) {
      if (isCancelled()) throw new Error('CANCELLED');
      throw e;
    }
  }
}

async function createSession(name: string, shards: string[]): Promise<ort.InferenceSession> {
  const graph = new Uint8Array(await (await file(name)).arrayBuffer());
  const externalData = await Promise.all(shards.map(async (path) => ({ path, data: await file(path) })));
  return ort.InferenceSession.create(graph, { executionProviders: ['webgpu'], externalData } as ort.InferenceSession.SessionOptions);
}

export async function encodeFluxPrompt(prompt: string): Promise<Float32Array> {
  const [json, config, template] = await Promise.all(['tokenizer/tokenizer.json', 'tokenizer/tokenizer_config.json', 'tokenizer/chat_template.jinja'].map(async (name) => (await file(name)).text()));
  const tokenizer = new Qwen2Tokenizer(JSON.parse(json), JSON.parse(config));
  const text = tokenizer.apply_chat_template([{ role: 'user', content: prompt }], { tokenize: false, add_generation_prompt: true, enable_thinking: false, chat_template: template } as never) as unknown as string;
  const encoded = tokenizer(text, { padding: 'max_length', truncation: true, max_length: FLUX_TEXT_TOKENS }) as unknown as {
    input_ids: { data: BigInt64Array };
    attention_mask: { data: BigInt64Array };
  };
  const session = await createSession('text_encoder_q4.onnx', TEXT_SHARDS);
  const output = await session.run({
    input_ids: new ort.Tensor('int64', encoded.input_ids.data, [1, FLUX_TEXT_TOKENS]),
    attention_mask: new ort.Tensor('int64', encoded.attention_mask.data, [1, FLUX_TEXT_TOKENS]),
  });
  return Float32Array.from(output['prompt_embeds'].data as ArrayLike<number>);
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

const float16 = (values: ArrayLike<number>, dims: number[]) => new ort.Tensor('float16', Float16Array.from(values) as never, dims);

export async function denoiseFlux(embeds: Float32Array, width: number, height: number, onStep: (done: number) => void, throwIfCancelled: () => void): Promise<Float32Array> {
  const session = await createSession('transformer_q8.onnx', TRANSFORMER_SHARDS);
  throwIfCancelled();
  const rows = height / FLUX_SCALE;
  const columns = width / FLUX_SCALE;
  const tokens = rows * columns;
  const imageIds = new ort.Tensor('int64', fluxImageIds(rows, columns), [1, tokens, 4]);
  const textIds = new ort.Tensor('int64', fluxTextIds(FLUX_TEXT_TOKENS), [1, FLUX_TEXT_TOKENS, 4]);
  const text = float16(embeds, [1, FLUX_TEXT_TOKENS, FLUX_TEXT_SIZE]);
  const sigmas = fluxSigmas(FLUX_STEPS, tokens);
  const latent = gaussian(tokens * FLUX_LATENT_SIZE);
  for (let step = 0; step < FLUX_STEPS; step++) {
    throwIfCancelled();
    const output = await session.run({
      hidden_states: float16(latent, [1, tokens, FLUX_LATENT_SIZE]),
      encoder_hidden_states: text,
      timestep: float16([sigmas[step]], [1]),
      img_ids: imageIds,
      txt_ids: textIds,
    });
    const predicted = output['noise_pred'].data as ArrayLike<number>;
    const delta = sigmas[step + 1] - sigmas[step];
    for (let i = 0; i < latent.length; i++) latent[i] += delta * predicted[i];
    onStep(step + 1);
  }
  return latent;
}

/** The decoded picture, channels first, values in [-1, 1]. */
export async function decodeFlux(latent: Float32Array, width: number, height: number): Promise<Float32Array> {
  const session = await createSession('vae_decoder.onnx', [DECODER_DATA]);
  const rows = height / FLUX_SCALE;
  const columns = width / FLUX_SCALE;
  const output = await session.run({ packed_latent: new ort.Tensor('float32', fluxPackedLatent(latent, rows, columns), [1, FLUX_LATENT_SIZE, rows, columns]) });
  return output['sample'].data as Float32Array;
}
