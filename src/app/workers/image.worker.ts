/// <reference lib="webworker" />
/**
 * Image worker: generates a picture from a sentence with Janus Pro, on this device's graphics
 * card. The model comes from Hugging Face once, then from the browser cache; the sentence and
 * the picture never leave the device.
 */
import * as Comlink from 'comlink';
import { AutoProcessor, BaseStreamer, InterruptableStoppingCriteria, MultiModalityCausalLM, env } from '@huggingface/transformers';
import { modelProgress } from './model-progress';
import type { ImageProgress, ImageWorkerApi } from './worker-types';

const REPO = 'onnx-community/Janus-Pro-1B-ONNX';
const REVISION = '04efdf2e36cb07a034b0d94f7322356b292f0418';

env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

interface Gpu {
  requestAdapter(): Promise<{ features: Set<string> } | null>;
}

/** Whether the graphics card can run the model, and with half-precision weights (a lighter download). */
async function gpuSupport(): Promise<{ fp16: boolean } | null> {
  try {
    const adapter = await (self.navigator as Navigator & { gpu?: Gpu }).gpu?.requestAdapter();
    return adapter ? { fp16: adapter.features.has('shader-f16') } : null;
  } catch {
    return null;
  }
}

interface Janus {
  processor: { (conversation: unknown, options: unknown): Promise<Record<string, unknown>>; num_image_tokens: number };
  model: { generate_images(options: Record<string, unknown>): Promise<{ toBlob(): Promise<Blob> }[]> };
}

let loading: Promise<Janus> | null = null;

/** The smallest weights that still draw properly: about 1.6 GB instead of 8 GB. */
function load(fp16: boolean, onProgress: (p: ImageProgress) => void): Promise<Janus> {
  loading ??= (async () => {
    onProgress({ stage: 'load', progress: 0 });
    const progress_callback = modelProgress(onProgress) as never;
    const processor = await AutoProcessor.from_pretrained(REPO, { revision: REVISION, progress_callback });
    const model = await MultiModalityCausalLM.from_pretrained(REPO, {
      revision: REVISION,
      dtype: {
        prepare_inputs_embeds: 'quantized',
        language_model: fp16 ? 'q4f16' : 'q4',
        lm_head: fp16 ? 'q4f16' : 'q4',
        gen_head: fp16 ? 'fp16' : 'fp32',
        gen_img_embeds: fp16 ? 'fp16' : 'fp32',
        image_decode: 'fp32',
      },
      // Janus's first part fails on WebGPU (same setting as the official demo).
      device: { prepare_inputs_embeds: 'wasm', language_model: 'webgpu', lm_head: 'webgpu', gen_head: 'webgpu', gen_img_embeds: 'webgpu', image_decode: 'webgpu' },
      progress_callback,
    } as never);
    return { processor, model } as unknown as Janus;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

class TokenProgress extends BaseStreamer {
  private count = -1;

  constructor(
    private readonly total: number,
    private readonly report: (p: ImageProgress) => void,
  ) {
    super();
  }

  override put(): void {
    // The first call is the prompt.
    if (++this.count > 0) this.report({ stage: 'generate', progress: this.count / this.total });
  }

  override end(): void {}
}

const stopping = new InterruptableStoppingCriteria();

const api: ImageWorkerApi = {
  async generate(prompt: string, onProgress: (p: ImageProgress) => void): Promise<Blob | null> {
    const gpu = await gpuSupport();
    if (!gpu) throw new Error('NO_WEBGPU');
    stopping.reset();
    const { processor, model } = await load(gpu.fp16, onProgress);
    if (stopping.interrupted) return null;
    onProgress({ stage: 'generate', progress: 0 });
    const inputs = await processor([{ role: 'User', content: prompt }], { chat_template: 'text_to_image' });
    const total = processor.num_image_tokens;
    const images = await model.generate_images({
      ...inputs,
      min_new_tokens: total,
      max_new_tokens: total,
      do_sample: true,
      streamer: new TokenProgress(total, onProgress),
      stopping_criteria: stopping,
    });
    return stopping.interrupted ? null : images[0].toBlob();
  },

  cancel(): void {
    stopping.interrupt();
  },
};

Comlink.expose(api);
