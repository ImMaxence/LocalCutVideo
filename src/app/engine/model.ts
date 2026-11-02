/**
 * The project document. It is the single contract shared by the auto-save, the timeline,
 * the preview and the export worker. Editing is non-destructive: the source file is never
 * modified, the project only describes what to keep and how to render it.
 *
 * A project is a sequence of one or more clips played back to back. Every time below is a
 * SEQUENCE time in seconds (clip 2 starts where clip 1 ends) unless stated otherwise.
 */

import type { TitleStyle } from './thumbnail';

export const SCHEMA_VERSION = 2;

export type AspectFormat = '16:9' | '9:16' | '1:1';
export type CutReason = 'silence' | 'manual';
export type CaptionStyle = 'karaoke' | 'clean' | 'boxed';
export type CaptionPosition = 'top' | 'center' | 'bottom';
export type FramingMode = 'center' | 'face';
export type WhisperModel = 'tiny' | 'base' | 'small';
/** What happens where the video jumps (cuts, clip changes): nothing, a quick or a slow dip to black. */
export type TransitionStyle = 'none' | 'dip' | 'black';

/** Half the length of each transition, in seconds (darkening before the cut, brightening after). */
export const TRANSITION_HALF: Record<TransitionStyle, number> = { none: 0, dip: 0.12, black: 0.35 };

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

/** Text shown over the video between two sequence times, styled like thumbnail titles. */
export interface TextOverlay extends TitleStyle {
  id: string;
  start: number;
  end: number;
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

/** Background behind the person: untouched, or blurred (the person stays sharp). */
export interface BackgroundSettings {
  mode: 'none' | 'blur';
  /** 0..1 */
  strength: number;
}

/** Sound of the clips themselves: overall volume and per-clip leveling. */
export interface AudioSettings {
  /** Linear gain on the clips' sound (1 = unchanged, up to 3). */
  volume: number;
  /** Brings every clip to the same loudness (recordings made at different levels). */
  normalize: boolean;
  /** Removes background noise from the voice (RNNoise), on clips with voice, at export. */
  denoise: boolean;
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
  texts: TextOverlay[];
  words: Word[];
  transcript: TranscriptMeta | null;
  captions: CaptionSettings;
  framing: FramingSettings;
  faces: FacePoint[] | null;
  rotation: Rotation;
  transition: TransitionStyle;
  background: BackgroundSettings;
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
    texts: [],
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
    transition: 'none',
    background: { mode: 'none', strength: 0.6 },
    audio: { volume: 1, normalize: false, denoise: false },
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
    background: { ...base.background, ...raw.background },
    music: { ...base.music, ...raw.music },
    silence: { ...base.silence, ...raw.silence },
    export: { ...base.export, ...raw.export },
    schemaVersion: SCHEMA_VERSION,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRange = (v: unknown): v is Range => isObject(v) && finite(v['start']) && finite(v['end']);
const listOf = (v: unknown, item: (x: unknown) => boolean) => v === undefined || (Array.isArray(v) && v.every(item));
const oneOf = (v: unknown, values: readonly unknown[]) => v === undefined || values.includes(v);

/** A settings group of a file: every known setting it has keeps the type of its default. */
function sameShape(raw: unknown, defaults: object): boolean {
  if (raw === undefined) return true;
  if (!isObject(raw)) return false;
  return Object.entries(defaults).every(([key, d]) => {
    const v = raw[key];
    return v === undefined || typeof v === typeof d || (d === null && (v === null || typeof v === 'string'));
  });
}

/**
 * Checks a project read from an outside file (.lcv.json) before it is saved: wrong types would
 * otherwise break the editor or the export. Missing fields are fine, migrateProject fills them.
 */
export function isProjectShape(raw: unknown): raw is Project {
  if (!isObject(raw)) return false;
  const base = createProject('');
  const clip = (c: unknown) =>
    isObject(c) &&
    typeof c['id'] === 'string' &&
    isObject(c['source']) &&
    typeof c['source']['name'] === 'string' &&
    finite(c['source']['size']) &&
    finite(c['source']['duration']);
  const word = (w: unknown) => isRange(w) && typeof (w as Word).text === 'string';
  const face = (f: unknown) => isObject(f) && finite(f['t']) && finite(f['x']) && finite(f['y']);
  return (
    (raw['name'] === undefined || typeof raw['name'] === 'string') &&
    Array.isArray(raw['clips']) &&
    raw['clips'].every(clip) &&
    listOf(raw['cuts'], isRange) &&
    listOf(raw['speeds'], (s) => isRange(s) && finite((s as SpeedRange).rate) && (s as SpeedRange).rate > 0) &&
    listOf(raw['texts'], isRange) &&
    listOf(raw['words'], word) &&
    (raw['faces'] === null || listOf(raw['faces'], face)) &&
    (raw['transcript'] == null || isObject(raw['transcript'])) &&
    oneOf(raw['format'], ['16:9', '9:16', '1:1']) &&
    oneOf(raw['rotation'], [0, 90, 180, 270]) &&
    oneOf(raw['transition'], Object.keys(TRANSITION_HALF)) &&
    (['captions', 'framing', 'background', 'audio', 'music', 'silence', 'export'] as const).every((k) => sameShape(raw[k], base[k])) &&
    oneOf((raw['export'] as Partial<ExportSettings> | undefined)?.resolution, [720, 1080]) &&
    oneOf((raw['export'] as Partial<ExportSettings> | undefined)?.fps, [24, 25, 30, 60])
  );
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
