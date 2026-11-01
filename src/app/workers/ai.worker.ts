/// <reference lib="webworker" />
/**
 * AI worker: runs Whisper locally with Transformers.js (WebGPU when available, WASM
 * otherwise) and returns word-level timestamps. The model is downloaded once from
 * Hugging Face and then served from the browser cache, so it works offline afterwards.
 */
import * as Comlink from 'comlink';
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { WhisperModel } from '../engine/model';
import type { AiDevice, AiWorkerApi, RawWord, TranscribeProgress, WhisperChunk } from './worker-types';

env.allowLocalModels = false;
env.useBrowserCache = true;
// ONNX Runtime binaries are self-hosted (no CDN), which also lets the PWA cache them.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let loadedKey = '';
let cancelled = false;

async function detectDevice(): Promise<{ device: AiDevice; fp16: boolean }> {
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) return { device: 'webgpu', fp16: adapter.features.has('shader-f16') };
    } catch {
      // Fall through to WASM.
    }
  }
  return { device: 'wasm', fp16: false };
}

async function load(model: WhisperModel, onProgress: (p: TranscribeProgress) => void): Promise<AiDevice> {
  const { device, fp16 } = await detectDevice();
  const key = `${model}|${device}`;
  if (transcriber && loadedKey === key) return device;
  await transcriber?.dispose();
  transcriber = null;

  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status === 'progress' && info.file) {
      files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
      let loaded = 0;
      let total = 0;
      files.forEach((f) => {
        loaded += f.loaded;
        total += f.total;
      });
      if (total) onProgress({ stage: 'download', progress: loaded / total });
    }
  };

  const dtype =
    device === 'webgpu'
      ? { encoder_model: fp16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
      : { encoder_model: 'q8', decoder_model_merged: 'q8' };

  transcriber = (await pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
    device,
    dtype: dtype as never,
    progress_callback: progress_callback as never,
  })) as AutomaticSpeechRecognitionPipeline;
  loadedKey = key;
  return device;
}

/** Known Whisper hallucinations on silence or music (credits from its subtitle training data). */
const HALLUCINATIONS = [/amara\.org/i, /sous-titr/i, /subtitles by/i, /merci d'avoir regardé/i, /thanks for watching/i];

interface WhisperInternals {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: {
    generation_config: { decoder_start_token_id: number; lang_to_id: Record<string, number> };
    generate: (options: Record<string, unknown>) => Promise<{ data: ArrayLike<number | bigint> }>;
  };
}

/**
 * Spoken language detection. Transformers.js silently falls back to English when no language
 * is given (which then *translates* other languages), so we ask Whisper ourselves: after the
 * start-of-transcript token, the model's first prediction is the language token.
 */
async function detectLanguage(audio: Float32Array): Promise<string | null> {
  const { processor, model } = transcriber as unknown as WhisperInternals;
  const { input_features } = await processor(audio);
  const config = model.generation_config;
  const output = await model.generate({
    inputs: input_features,
    decoder_input_ids: [config.decoder_start_token_id],
    max_new_tokens: 1,
    return_timestamps: false,
  });
  const token = Number(output.data[output.data.length - 1]);
  const entry = Object.entries(config.lang_to_id).find(([, id]) => id === token);
  return entry ? entry[0].replace(/[<|>]/g, '') : null;
}

const api: AiWorkerApi = {
  detectDevice,

  async transcribe(
    pcm: Float32Array,
    chunks: WhisperChunk[],
    options: { model: WhisperModel; language: string | null },
    onProgress: (p: TranscribeProgress) => void,
    onWords: (words: RawWord[]) => void,
  ): Promise<{ device: AiDevice; language: string | null }> {
    cancelled = false;
    const device = await load(options.model, onProgress);
    const sampleRate = 16000;
    const work = chunks.filter((c) => !c.silent);
    const totalSeconds = work.reduce((n, c) => n + (c.end - c.start), 0) || 1;
    let doneSeconds = 0;
    onProgress({ stage: 'transcribe', progress: 0 });

    // Automatic mode: detect the language on the three longest stretches with speech and keep
    // the majority, which is far more reliable than a single guess (especially with small models).
    let language = options.language;
    if (!language && work.length) {
      const samples = work
        .slice()
        .sort((a, b) => b.end - b.start - (a.end - a.start))
        .slice(0, 3);
      const votes = new Map<string, number>();
      for (const s of samples) {
        const guess = await detectLanguage(pcm.subarray(Math.floor(s.start * sampleRate), Math.floor(s.end * sampleRate)));
        if (guess) votes.set(guess, (votes.get(guess) ?? 0) + 1);
      }
      language = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    for (const chunk of work) {
      if (cancelled) throw new Error('CANCELLED');
      const audio = pcm.subarray(Math.floor(chunk.start * sampleRate), Math.floor(chunk.end * sampleRate));
      const output = (await transcriber!(audio, {
        return_timestamps: 'word',
        language: language ?? undefined,
        task: 'transcribe',
      } as never)) as { chunks?: { text: string; timestamp: [number, number | null] }[] };

      const raw = output.chunks ?? [];
      if (!HALLUCINATIONS.some((re) => re.test(raw.map((c) => c.text).join('')))) {
        const words: RawWord[] = [];
        raw.forEach((c, i) => {
          const text = c.text.trim();
          if (!text) return;
          const start = chunk.start + c.timestamp[0];
          const nextStart = raw[i + 1]?.timestamp[0];
          const endRel = c.timestamp[1] ?? nextStart ?? c.timestamp[0] + 0.3;
          const end = Math.min(chunk.end, Math.max(start + 0.05, chunk.start + endRel));
          // Whisper splits elisions and punctuation into separate tokens ("j" + "'ai", "word" + "!"):
          // glue them back to the previous word.
          const prev = words[words.length - 1];
          if (prev && (/^['’]/.test(text) || /^(?:[a-z]|qu|jusqu|lorsqu|puisqu)['’]$/i.test(prev.text) || /^[.,!?;:…»)]+$/.test(text))) {
            prev.text += text;
            prev.end = Math.max(prev.end, end);
            return;
          }
          words.push({ text, start, end });
        });
        if (words.length) onWords(words);
      }
      doneSeconds += chunk.end - chunk.start;
      onProgress({ stage: 'transcribe', progress: doneSeconds / totalSeconds });
    }
    return { device, language };
  },

  cancel(): void {
    cancelled = true;
  },
};

Comlink.expose(api);
