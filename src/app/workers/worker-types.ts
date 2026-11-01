/**
 * Contracts of the three Web Workers. Kept apart from the worker files so the main thread
 * can import them without pulling the `webworker` lib into the DOM compilation.
 */
import type { Project, Range, SourceInfo, WhisperModel } from '../engine/model';

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
  stage: 'download' | 'transcribe';
  progress: number;
}

export interface RawWord {
  text: string;
  start: number;
  end: number;
}

export type WhisperChunk = Range & { silent: boolean };

export interface AiWorkerApi {
  detectDevice(): Promise<{ device: AiDevice; fp16: boolean }>;
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
}

export interface ExportRequest {
  clips: ExportClip[];
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

export interface ExportWorkerApi {
  run(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<ExportResult>;
  cancel(): void;
}
