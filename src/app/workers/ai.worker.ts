/// <reference lib="webworker" />
/**
 * AI worker: runs Whisper locally with Transformers.js (WebGPU when available, WASM
 * otherwise) and returns word-level timestamps. The model is downloaded once, from this site
 * when it hosts it (/models), otherwise from Hugging Face, then served from the browser cache,
 * so it works offline afterwards.
 */
import * as Comlink from 'comlink';
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { WhisperModel } from '../engine/model';
import type { AiDevice, AiWorkerApi, RawWord, SpeechSample, TranscribeProgress, WhisperChunk } from './worker-types';

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

/** Models this site serves itself (listed by scripts/download-models.mjs), null when unknown. */
let hosted: Promise<string[]> | null = null;

function hostedModels(): Promise<string[]> {
  hosted ??= fetch(`${self.location.origin}/models/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((m: { models?: unknown } | null) => (Array.isArray(m?.models) ? (m.models as string[]) : []))
    .catch(() => []);
  return hosted;
}

async function load(model: WhisperModel, onProgress: (p: TranscribeProgress) => void): Promise<AiDevice> {
  const { device, fp16 } = await detectDevice();
  // Served here: no request to Hugging Face at all. Otherwise Hugging Face is the source.
  const local = (await hostedModels()).includes(model);
  env.allowLocalModels = local;
  env.allowRemoteModels = !local;
  // A path, not a full URL: Transformers.js only checks that local files exist for paths.
  env.localModelPath = '/models/';
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
  tokenizer: { decode: (ids: number[], options: { skip_special_tokens: boolean }) => string };
  model: {
    generation_config: { decoder_start_token_id: number; no_timestamps_token_id: number; lang_to_id: Record<string, number> };
    generate: (options: Record<string, unknown>) => Promise<unknown>;
  };
}

/**
 * One decoding step after the start-of-transcript token, reading the raw scores Whisper gives
 * to every token there:
 * - the most likely language token. Transformers.js silently falls back to English when no
 *   language is given (which then *translates* other languages), so we detect it ourselves;
 * - the probability of the "no speech" token, computed like OpenAI's no_speech_prob, before
 *   any token suppression (that token sits just before <|notimestamps|> in every vocabulary).
 */
async function probe(audio: Float32Array, features?: unknown): Promise<{ language: string | null; noSpeech: number }> {
  const { processor, model } = transcriber as unknown as WhisperInternals;
  const input_features = features ?? (await processor(audio)).input_features;
  const config = model.generation_config;
  let logits: Float32Array | null = null;
  await model.generate({
    inputs: input_features,
    decoder_input_ids: [config.decoder_start_token_id],
    max_new_tokens: 1,
    return_timestamps: false,
    suppress_tokens: null,
    begin_suppress_tokens: null,
    logits_processor: [
      (_ids: unknown, scores: { data: Float32Array }) => {
        logits ??= Float32Array.from(scores.data);
        return scores;
      },
    ],
  });
  if (!logits) return { language: null, noSpeech: 1 };
  const scores: Float32Array = logits;
  let language: string | null = null;
  let best = -Infinity;
  for (const [token, id] of Object.entries(config.lang_to_id)) {
    if (scores[id] > best) {
      best = scores[id];
      language = token.replace(/[<|>]/g, '');
    }
  }
  let max = -Infinity;
  for (const v of scores) if (v > max) max = v;
  let sum = 0;
  for (const v of scores) sum += Math.exp(v - max);
  const noSpeech = Math.exp(scores[config.no_timestamps_token_id - 1] - max) / sum;
  return { language, noSpeech };
}

/**
 * How much a sample sounds like speech. Besides the "no speech" probability, Whisper writes a
 * short greedy transcription in the detected language: on real words it is confident (high
 * average log-probability), on noise it hesitates or makes up its usual subtitle credits.
 */
async function speechSample(audio: Float32Array): Promise<SpeechSample> {
  const { processor, model, tokenizer } = transcriber as unknown as WhisperInternals;
  const { input_features } = await processor(audio);
  const { language, noSpeech } = await probe(audio, input_features);
  let total = 0;
  let steps = 0;
  const output = (await model.generate({
    inputs: input_features,
    language: language ?? undefined,
    task: 'transcribe',
    max_new_tokens: 32,
    return_timestamps: false,
    begin_suppress_tokens: null,
    logits_processor: [
      (_ids: unknown, scores: { data: Float32Array }) => {
        // Log-probability of the token greedy decoding picks (the most likely one).
        let max = -Infinity;
        for (const v of scores.data) if (v > max) max = v;
        let sum = 0;
        for (const v of scores.data) sum += Math.exp(v - max);
        total -= Math.log(sum);
        steps++;
        return scores;
      },
    ],
  })) as { data: ArrayLike<number | bigint> };
  const text = tokenizer.decode(Array.from(output.data, Number), { skip_special_tokens: true }).trim();
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const invented = HALLUCINATIONS.some((re) => re.test(text)) || (words.length >= 4 && new Set(words).size <= words.length / 3);
  return { noSpeech, logprob: steps ? total / steps : -10, words: words.length, invented };
}

const api: AiWorkerApi = {
  detectDevice,

  /** Speech clues of each sample (up to 30 s of 16 kHz audio taken from a clip). */
  async detectSpeech(
    samples: Float32Array[],
    model: WhisperModel,
    onProgress: (p: TranscribeProgress) => void,
  ): Promise<{ device: AiDevice; samples: SpeechSample[] }> {
    cancelled = false;
    const device = await load(model, onProgress);
    const results: SpeechSample[] = [];
    for (const sample of samples) {
      if (cancelled) throw new Error('CANCELLED');
      results.push(await speechSample(sample));
      onProgress({ stage: 'transcribe', progress: results.length / samples.length });
    }
    return { device, samples: results };
  },

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
        const guess = (await probe(pcm.subarray(Math.floor(s.start * sampleRate), Math.floor(s.end * sampleRate)))).language;
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
