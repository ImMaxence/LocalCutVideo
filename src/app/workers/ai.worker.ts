/// <reference lib="webworker" />
/**
 * AI worker: runs Whisper locally with Transformers.js (WebGPU when available and working, WASM
 * otherwise) and returns word-level timestamps. The model is downloaded once, from this site
 * when it hosts it (/models), otherwise from Hugging Face, then served from the browser cache,
 * so it works offline afterwards.
 */
import * as Comlink from 'comlink';
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { WHISPER_REPOS } from '../core/whisper-models';
import { languagesToCheck, rankLanguages, settleLanguage } from '../engine/language';
import type { WhisperModel } from '../engine/model';
import { modelProgress } from './model-progress';
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
/** Device of the model being loaded or loaded. */
let device: AiDevice = 'wasm';
let cancelled = false;
/**
 * WebGPU failed once (loading or running Whisper): WebAssembly from then on, slower but
 * reliable. Safari on iPhone and iPad starts there: its WebGPU runs out of memory or fails.
 */
let gpuFailed = /iPhone|iPad|iPod/.test(self.navigator.userAgent);

async function detectDevice(): Promise<{ device: AiDevice; fp16: boolean }> {
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (gpu && !gpuFailed) {
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

/** The GPU check, made once (and again after a WebGPU failure). */
let detected: Promise<{ device: AiDevice; fp16: boolean }> | null = null;

async function load(model: WhisperModel, onProgress: (p: TranscribeProgress) => void): Promise<AiDevice> {
  detected ??= detectDevice();
  const target = await detected;
  // Served here: no request to Hugging Face at all. Otherwise Hugging Face is the source.
  const local = (await hostedModels()).includes(model);
  env.allowLocalModels = local;
  env.allowRemoteModels = !local;
  // A path, not a full URL: Transformers.js only checks that local files exist for paths.
  env.localModelPath = '/models/';
  const key = `${model}|${target.device}`;
  if (transcriber && loadedKey === key) return device;
  // A broken GPU may also fail to free its model: it is dropped anyway.
  await transcriber?.dispose().catch(() => undefined);
  transcriber = null;
  loadedKey = '';
  device = target.device;
  const fp16 = target.fp16;

  // Preparing the model on the graphics card can take many seconds, with no signal from it.
  onProgress({ stage: 'load', progress: 0 });

  const dtype =
    device === 'webgpu'
      ? { encoder_model: fp16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }
      : { encoder_model: 'q8', decoder_model_merged: 'q8' };

  const { repo, revision } = WHISPER_REPOS[model];
  transcriber = (await pipeline('automatic-speech-recognition', repo, {
    revision,
    device,
    dtype: dtype as never,
    progress_callback: modelProgress(onProgress) as never,
  })) as AutomaticSpeechRecognitionPipeline;
  loadedKey = key;
  return device;
}

/**
 * Loads the model if needed and runs one Whisper step. When WebGPU fails, at loading or while
 * running, the model is loaded again on WebAssembly and the step runs once more.
 */
async function withFallback<T>(model: WhisperModel, onProgress: (p: TranscribeProgress) => void, run: () => Promise<T>): Promise<T> {
  try {
    await load(model, onProgress);
    return await run();
  } catch (e) {
    if (device !== 'webgpu' || cancelled) throw e;
    console.warn('Whisper failed on WebGPU, switching to WebAssembly', e);
    gpuFailed = true;
    detected = null;
    await load(model, onProgress);
    return run();
  }
}

const SAMPLE_RATE = 16000;
/** Below this average log-probability, a sample does not count as speech (see isSpoken). */
const LOW_CONFIDENCE = -1;

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
 * - the probability of each language token. Transformers.js silently falls back to English when no
 *   language is given (which then *translates* other languages), so we detect it ourselves;
 * - the probability of the "no speech" token, computed like OpenAI's no_speech_prob, before
 *   any token suppression (that token sits just before <|notimestamps|> in every vocabulary).
 */
async function probe(audio: Float32Array, features?: unknown): Promise<{ languages: Record<string, number>; noSpeech: number }> {
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
  if (!logits) return { languages: {}, noSpeech: 1 };
  const scores: Float32Array = logits;
  const tokens = Object.entries(config.lang_to_id);
  const top = Math.max(...tokens.map(([, id]) => scores[id]));
  const total = tokens.reduce((n, [, id]) => n + Math.exp(scores[id] - top), 0);
  const languages = Object.fromEntries(tokens.map(([token, id]) => [token.replace(/[<|>]/g, ''), Math.exp(scores[id] - top) / total]));
  let max = -Infinity;
  for (const v of scores) if (v > max) max = v;
  let sum = 0;
  for (const v of scores) sum += Math.exp(v - max);
  const noSpeech = Math.exp(scores[config.no_timestamps_token_id - 1] - max) / sum;
  return { languages, noSpeech };
}

/** A short greedy transcription and Whisper's confidence in it (average log-probability, close to 0 = sure). */
async function greedyDecode(input_features: unknown, language: string | null, max_new_tokens: number): Promise<{ text: string; logprob: number }> {
  const { model, tokenizer } = transcriber as unknown as WhisperInternals;
  let total = 0;
  let steps = 0;
  const output = (await model.generate({
    inputs: input_features,
    language: language ?? undefined,
    task: 'transcribe',
    max_new_tokens,
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
  return {
    text: tokenizer.decode(Array.from(output.data, Number), { skip_special_tokens: true }).trim(),
    logprob: steps ? total / steps : -10,
  };
}

/**
 * Most likely language of the stretches with speech: their probabilities are averaged, then
 * the guess is checked by writing the longest one in the languages it could be mistaken for.
 */
async function detectLanguage(pcm: Float32Array, work: WhisperChunk[], infer: <T>(run: () => Promise<T>) => Promise<T>): Promise<string | null> {
  const stretches = work
    .slice()
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 3)
    .map((s) => pcm.subarray(Math.floor(s.start * SAMPLE_RATE), Math.floor(s.end * SAMPLE_RATE)));
  const found: Record<string, number>[] = [];
  for (const audio of stretches) found.push((await infer(() => probe(audio))).languages);
  const ranked = rankLanguages(found);
  const guess = ranked[0]?.[0] ?? null;
  const others = languagesToCheck(ranked);
  if (!guess || !others.length) return guess;
  const confidence = await infer(async () => {
    const { processor } = transcriber as unknown as WhisperInternals;
    const { input_features } = await processor(stretches[0]);
    const scores: Record<string, number> = {};
    for (const code of [guess, ...others]) scores[code] = (await greedyDecode(input_features, code, 48)).logprob;
    return scores;
  });
  return settleLanguage(guess, confidence);
}

/**
 * How much a sample sounds like speech. Besides the "no speech" probability, Whisper writes a
 * short greedy transcription in the detected language: on real words it is confident (high
 * average log-probability), on noise it hesitates or makes up its usual subtitle credits.
 */
async function speechSample(audio: Float32Array): Promise<SpeechSample> {
  const { processor } = transcriber as unknown as WhisperInternals;
  const { input_features } = await processor(audio);
  const { languages, noSpeech } = await probe(audio, input_features);
  const ranked = rankLanguages([languages]);
  let { text, logprob } = await greedyDecode(input_features, ranked[0]?.[0] ?? null, 32);
  // Speech with an accent, written in the wrong language, looks as unsure as noise.
  if (logprob <= LOW_CONFIDENCE) {
    for (const code of languagesToCheck(ranked)) {
      const other = await greedyDecode(input_features, code, 32);
      if (other.logprob > logprob) ({ text, logprob } = other);
    }
  }
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const invented = HALLUCINATIONS.some((re) => re.test(text)) || (words.length >= 4 && new Set(words).size <= words.length / 3);
  return { noSpeech, logprob, words: words.length, invented };
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
    const results: SpeechSample[] = [];
    // Loaded first, so that the time this takes is not mistaken for the first sample's.
    await withFallback(model, onProgress, async () => undefined);
    for (const sample of samples) {
      if (cancelled) throw new Error('CANCELLED');
      onProgress({ stage: 'transcribe', progress: results.length / samples.length, next: (results.length + 1) / samples.length });
      results.push(await withFallback(model, onProgress, () => speechSample(sample)));
    }
    onProgress({ stage: 'transcribe', progress: 1 });
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
    const infer = <T>(run: () => Promise<T>) => withFallback(options.model, onProgress, run);
    // Loads the model first, so its download shows before the language detection.
    await infer(async () => undefined);
    const work = chunks.filter((c) => !c.silent);
    const totalSeconds = work.reduce((n, c) => n + (c.end - c.start), 0) || 1;
    let doneSeconds = 0;

    let language = options.language;
    if (!language && work.length) {
      onProgress({ stage: 'language', progress: 0 });
      language = await detectLanguage(pcm, work, infer);
    }

    for (const chunk of work) {
      if (cancelled) throw new Error('CANCELLED');
      onProgress({ stage: 'transcribe', progress: doneSeconds / totalSeconds, next: (doneSeconds + chunk.end - chunk.start) / totalSeconds, language });
      const audio = pcm.subarray(Math.floor(chunk.start * SAMPLE_RATE), Math.floor(chunk.end * SAMPLE_RATE));
      const output = (await infer(() =>
        transcriber!(audio, {
          return_timestamps: 'word',
          language: language ?? undefined,
          task: 'transcribe',
        } as never),
      )) as { chunks?: { text: string; timestamp: [number, number | null] }[] };

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
    }
    onProgress({ stage: 'transcribe', progress: 1, language });
    return { device, language };
  },

  cancel(): void {
    cancelled = true;
  },
};

Comlink.expose(api);
