/**
 * The project document. It is the single contract shared by the auto-save, the timeline,
 * the preview and the export worker. Editing is non-destructive: the source file is never
 * modified, the project only describes what to keep and how to render it.
 *
 * A project is a sequence of one or more clips played back to back. Every time below is a
 * SEQUENCE time in seconds (clip 2 starts where clip 1 ends) unless stated otherwise.
 */

export const SCHEMA_VERSION = 2;

export type AspectFormat = '16:9' | '9:16' | '1:1';
export type CutReason = 'silence' | 'manual';
export type CaptionStyle = 'karaoke' | 'clean' | 'boxed';
export type CaptionPosition = 'top' | 'center' | 'bottom';
export type FramingMode = 'center' | 'face';
export type WhisperModel = 'tiny' | 'base' | 'small';
/** Clockwise turn applied to every clip, for videos filmed sideways. */
export type Rotation = 0 | 90 | 180 | 270;

export interface Range {
  start: number;
  end: number;
}

export interface Cut extends Range {
  id: string;
  reason: CutReason;
}

/** A part of the sequence played faster or slower (2 = twice as fast, 0.5 = slow motion). */
export interface SpeedRange extends Range {
  id: string;
  rate: number;
}

/** Speeds offered in the editor. */
export const SPEED_RATES = [0.25, 0.5, 0.75, 1.5, 2, 3, 4];

export interface Word extends Range {
  id: string;
  text: string;
  deleted: boolean;
}

export interface SourceInfo {
  name: string;
  size: number;
  lastModified: number;
  type: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string | null;
}

/** One video file of the sequence. */
export interface Clip {
  id: string;
  source: SourceInfo;
  /** Does someone speak in it? Chosen by the user; null or absent lets the detection decide. */
  voice?: boolean | null;
  /** What the automatic voice detection found (Whisper's "no speech" probability). */
  voiceDetected?: boolean;
}

/** Normalized face center (0..1 of the source frame) at a source time. */
export interface FacePoint {
  t: number;
  x: number;
  y: number;
}

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyle;
  position: CaptionPosition;
  size: number;
  uppercase: boolean;
  highlight: string;
  maxWords: number;
}

export interface FramingSettings {
  mode: FramingMode;
  punchIn: boolean;
  zoom: number;
}

/** Sound of the clips themselves: overall volume and per-clip leveling. */
export interface AudioSettings {
  /** Linear gain on the clips' sound (1 = unchanged, up to 3). */
  volume: number;
  /** Brings every clip to the same loudness (recordings made at different levels). */
  normalize: boolean;
}

export interface MusicSettings {
  enabled: boolean;
  name: string | null;
  volume: number;
  ducking: number;
}

/** `audio`: loudness of the sound; `transcript`: gaps between the words Whisper heard (robust to background noise). */
export type SilenceMode = 'audio' | 'transcript';

export interface SilenceSettings {
  thresholdDb: number;
  minSilence: number;
  padding: number;
  mode: SilenceMode;
  /** Once silences have been cut, changing a setting updates the cuts live. */
  live: boolean;
}

export interface TranscriptMeta {
  model: WhisperModel;
  language: string | null;
  /** Language found by automatic detection (when `language` is null). */
  detected?: string | null;
  createdAt: number;
}

export interface ExportSettings {
  resolution: 720 | 1080;
  fps: 24 | 25 | 30 | 60;
}

export interface Project {
  id: string;
  name: string;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  clips: Clip[];
  format: AspectFormat;
  cuts: Cut[];
  speeds: SpeedRange[];
  words: Word[];
  transcript: TranscriptMeta | null;
  captions: CaptionSettings;
  framing: FramingSettings;
  faces: FacePoint[] | null;
  rotation: Rotation;
  audio: AudioSettings;
  music: MusicSettings;
  silence: SilenceSettings;
  export: ExportSettings;
}

/** Whether someone speaks in a clip: the user's answer, else the detection, else yes. */
export function clipHasVoice(clip: Clip): boolean {
  return clip.voice ?? clip.voiceDetected ?? true;
}

/** Words per caption that read well for each output shape. */
export function defaultCaptionWords(format: AspectFormat): number {
  return format === '16:9' ? 6 : format === '1:1' ? 4 : 3;
}

export function uid(): string {
  return crypto.randomUUID();
}

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    clips: [],
    format: '9:16',
    cuts: [],
    speeds: [],
    words: [],
    transcript: null,
    captions: {
      enabled: true,
      style: 'karaoke',
      position: 'bottom',
      size: 1,
      uppercase: true,
      highlight: '#ffd60a',
      maxWords: 3,
    },
    framing: { mode: 'center', punchIn: false, zoom: 1.15 },
    faces: null,
    rotation: 0,
    audio: { volume: 1, normalize: false },
    music: { enabled: false, name: null, volume: 0.35, ducking: 0.25 },
    silence: { thresholdDb: -40, minSilence: 0.5, padding: 0.12, mode: 'audio', live: false },
    export: { resolution: 1080, fps: 30 },
  };
}

/** Clip id given to the single video of projects created before multi-clip support. */
export const LEGACY_CLIP_ID = 'main';

/** Brings an older or partial document up to the current schema (used when reading Dexie). */
export function migrateProject(raw: Project & { source?: SourceInfo | null }): Project {
  const base = createProject(raw.name);
  const { source, ...rest } = raw;
  const clips = raw.clips ?? (source ? [{ id: LEGACY_CLIP_ID, source }] : []);
  return {
    ...base,
    ...rest,
    clips,
    captions: { ...base.captions, ...raw.captions },
    framing: { ...base.framing, ...raw.framing },
    audio: { ...base.audio, ...raw.audio },
    music: { ...base.music, ...raw.music },
    silence: { ...base.silence, ...raw.silence },
    export: { ...base.export, ...raw.export },
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Identifies a file without reading it, to check that a re-selected file is the same one. */
export function fingerprint(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/** Result of the audio analysis done in the media worker, cached in IndexedDB per file. */
export interface AudioAnalysis {
  fingerprint: string;
  duration: number;
  /** Max absolute amplitude per bucket, for the waveform. */
  peaks: Float32Array;
  peaksRate: number;
  /** Loudness in dBFS per frame, for silence detection and ducking. */
  frameDb: Float32Array;
  frameRate: number;
  /** Suggested silence threshold derived from the noise floor. */
  suggestedThresholdDb: number;
  createdAt: number;
}
