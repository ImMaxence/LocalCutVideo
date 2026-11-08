/**
 * Contracts of the three Web Workers. Kept apart from the worker files so the main thread
 * can import them without pulling the `webworker` lib into the DOM compilation.
 */
import type { AspectFormat, Project, Range, SourceInfo, WhisperModel } from '../engine/model';

export interface AudioExtraction {
  pcm: Float32Array;
  peaks: Float32Array;
  peaksRate: number;
  frameDb: Float32Array;
  frameRate: number;
  suggestedThresholdDb: number;
  duration: number;
}

export interface MediaWorkerApi {
  probe(file: File): Promise<SourceInfo>;
  thumbnail(file: File, at: number): Promise<Blob | null>;
  extractAudio(file: File, onProgress: (p: number) => void): Promise<AudioExtraction>;
}

export type AiDevice = 'webgpu' | 'wasm';

export interface TranscribeProgress {
  stage: 'download' | 'load' | 'language' | 'transcribe';
  progress: number;
  /** Progress once the running step ends: the display moves toward it in the meantime. */
  next?: number;
  /** The language being transcribed, once known. */
  language?: string | null;
}

export interface ImageProgress {
  stage: 'download' | 'generate';
  progress: number;
}

export interface ImageWorkerApi {
  /** Downloads the model files that are not in the browser cache yet. */
  download(onProgress: (p: ImageProgress) => void): Promise<void>;
  /** The caption states of a sentence. */
  encode(prompt: string): Promise<Float32Array>;
  /** The picture, in latents. */
  denoise(states: Float32Array, format: AspectFormat, onStep: (done: number) => void): Promise<Float32Array>;
  /** The final PNG. */
  decode(latents: Float32Array, format: AspectFormat): Promise<Blob>;
  cancel(): void;
}

export interface RawWord {
  text: string;
  start: number;
  end: number;
}

export type WhisperChunk = Range & { silent: boolean };

/** What Whisper makes of a sample of a clip, to tell whether someone speaks in it. */
export interface SpeechSample {
  /** Probability of the "no speech" token. */
  noSpeech: number;
  /** Average log-probability of a short greedy transcription (close to 0 = confident). */
  logprob: number;
  /** Words in that transcription. */
  words: number;
  /** Known hallucination (subtitle credits) or a word repeated over and over. */
  invented: boolean;
}

export interface AiWorkerApi {
  detectDevice(): Promise<{ device: AiDevice; fp16: boolean }>;
  detectSpeech(samples: Float32Array[], model: WhisperModel, onProgress: (p: TranscribeProgress) => void): Promise<{ device: AiDevice; samples: SpeechSample[] }>;
  transcribe(
    pcm: Float32Array,
    chunks: WhisperChunk[],
    options: { model: WhisperModel; language: string | null },
    onProgress: (p: TranscribeProgress) => void,
    onWords: (words: RawWord[]) => void,
  ): Promise<{ device: AiDevice; language: string | null }>;
  cancel(): void;
}

/** A clip of the sequence, placed at `start` (sequence seconds). */
export interface ExportClip {
  file: File;
  start: number;
  duration: number;
  hasAudio: boolean;
  /** Volume of this clip's sound (overall volume × leveling). */
  gain: number;
  /** Remove the background noise of the voice. */
  denoise: boolean;
}

export interface ExportRequest {
  clips: ExportClip[];
  /** Output times where the picture dips to black (see the project's transition style). */
  transitionPoints: number[];
  project: Project;
  music: File | null;
  frameDb: Float32Array | null;
  target: FileSystemFileHandle | null;
}

export interface ExportProgress {
  progress: number;
  frame: number;
  frames: number;
}

export interface ExportResult {
  buffer: ArrayBuffer | null;
  streamed: boolean;
  codec: string;
  width: number;
  height: number;
  duration: number;
}

/** A few seconds of the exported sound, to listen to it before exporting. */
export interface SoundPreview {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export interface ExportWorkerApi {
  run(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<ExportResult>;
  previewSound(req: ExportRequest, from: number, seconds: number): Promise<SoundPreview>;
  cancel(): void;
}
