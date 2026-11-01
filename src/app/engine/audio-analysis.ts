import type { Cut, Range, SilenceSettings } from './model';
import { uid } from './model';
import { outputToSource } from './timeline-math';

export const ANALYSIS_SAMPLE_RATE = 16000;
export const FRAME_RATE = 50;
export const PEAKS_RATE = 100;

/** Loudness (dBFS) of each 20 ms frame of the 16 kHz mono signal. */
export function computeFrameDb(pcm: Float32Array): Float32Array {
  const size = ANALYSIS_SAMPLE_RATE / FRAME_RATE;
  const frames = Math.ceil(pcm.length / size);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * size;
    const end = Math.min(pcm.length, start + size);
    for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    out[f] = 20 * Math.log10(rms + 1e-9);
  }
  return out;
}

export function computePeaks(pcm: Float32Array): Float32Array {
  const size = ANALYSIS_SAMPLE_RATE / PEAKS_RATE;
  const count = Math.ceil(pcm.length / size);
  const out = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let max = 0;
    const end = Math.min(pcm.length, (b + 1) * size);
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(pcm[i]);
      if (v > max) max = v;
    }
    out[b] = max;
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? -90;
}

/** A threshold sitting between the noise floor and the speech level of this recording. */
export function suggestThreshold(frameDb: Float32Array): number {
  if (!frameDb.length) return -40;
  const smoothed = smoothDb(frameDb);
  const floor = Math.max(percentile(smoothed, 0.1), -80);
  const speech = percentile(smoothed, 0.9);
  const threshold = floor + Math.max(6, (speech - floor) * 0.3);
  return Math.round(Math.min(-20, Math.max(-60, threshold)));
}

/** Loudness averaged over ±2 frames (100 ms) in the power domain, so syllables do not flicker. */
export function smoothDb(frameDb: Float32Array, radius = 2): Float32Array {
  const power = frameDb.map((db) => 10 ** (db / 10));
  const out = new Float32Array(frameDb.length);
  for (let f = 0; f < frameDb.length; f++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, f - radius); k <= Math.min(frameDb.length - 1, f + radius); k++) {
      sum += power[k];
      n++;
    }
    out[f] = 10 * Math.log10(sum / n + 1e-12);
  }
  return out;
}

export type SilencePreset = 'gentle' | 'normal' | 'tight';

/** One-click silence settings, from keeping natural pauses to a fast-paced edit. */
export const SILENCE_PRESETS: { id: SilencePreset; minSilence: number; padding: number }[] = [
  { id: 'gentle', minSilence: 0.8, padding: 0.2 },
  { id: 'normal', minSilence: 0.5, padding: 0.12 },
  { id: 'tight', minSilence: 0.3, padding: 0.06 },
];

/** Speech shorter than this inside a pause (click, breath, cutlery) does not break the pause. */
const MIN_SPEECH = 0.15;
/** Speech must rise this much above the threshold to start, which avoids chattering on noise. */
const HYSTERESIS_DB = 3;

/** Turns pauses (start/end in seconds) into cuts, keeping breathing room around the speech. */
function pausesToCuts(pauses: Range[], duration: number, s: SilenceSettings): Cut[] {
  const cuts: Cut[] = [];
  for (const p of pauses) {
    if (p.end - p.start < s.minSilence) continue;
    // Word endings fade out slowly, so more room is kept after speech than before it.
    const a = p.start <= 0.001 ? 0 : p.start + s.padding * 1.5;
    const b = p.end >= duration - 0.001 ? duration : p.end - s.padding;
    if (b - a > 0.05) cuts.push({ id: uid(), start: a, end: b, reason: 'silence' });
  }
  return cuts;
}

/** Pauses found from the loudness: smoothed, with hysteresis, ignoring tiny noises. */
export function detectSilences(frameDb: Float32Array, duration: number, s: SilenceSettings): Cut[] {
  const db = smoothDb(frameDb);
  const speech = new Uint8Array(db.length);
  let speaking = false;
  for (let f = 0; f < db.length; f++) {
    speaking = speaking ? db[f] >= s.thresholdDb : db[f] >= s.thresholdDb + HYSTERESIS_DB;
    speech[f] = speaking ? 1 : 0;
  }
  // Remove speech blips that are too short to be words.
  const minFrames = Math.round(MIN_SPEECH * FRAME_RATE);
  for (let f = 0; f < speech.length; ) {
    if (!speech[f]) {
      f++;
      continue;
    }
    let end = f;
    while (end < speech.length && speech[end]) end++;
    if (end - f < minFrames) speech.fill(0, f, end);
    f = end;
  }
  const pauses: Range[] = [];
  let start = -1;
  for (let f = 0; f <= speech.length; f++) {
    const quiet = f < speech.length && !speech[f];
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) {
      pauses.push({ start: start / FRAME_RATE, end: Math.min(duration, f / FRAME_RATE) });
      start = -1;
    }
  }
  return pausesToCuts(pauses, duration, s);
}

/**
 * Pauses found from the transcript: the gaps between the words Whisper heard. Background
 * noise, music or room tone do not fool it, which makes it the better choice once transcribed.
 */
export function detectSilencesFromWords(words: { start: number; end: number }[], duration: number, s: SilenceSettings): Cut[] {
  const sorted = words.slice().sort((a, b) => a.start - b.start);
  const pauses: Range[] = [];
  let cursor = 0;
  for (const w of sorted) {
    if (w.start > cursor) pauses.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (duration > cursor) pauses.push({ start: cursor, end: duration });
  return pausesToCuts(pauses, duration, s);
}

/**
 * Cuts for a clip without voice (street, nature, ambience): only real dead air is removed,
 * i.e. long stretches close to the noise floor. A recording that is silent from start to end
 * has nothing to compare with and is left alone (the picture is what matters there).
 */
export function detectDeadAir(frameDb: Float32Array, duration: number, s: SilenceSettings): Cut[] {
  if (!frameDb.length) return [];
  const db = smoothDb(frameDb, 5);
  const loud = percentile(db, 0.95);
  if (loud < -55) return [];
  const threshold = Math.min(percentile(db, 0.05) + 6, loud - 25);
  const pauses: Range[] = [];
  let start = -1;
  for (let f = 0; f <= db.length; f++) {
    const quiet = f < db.length && db[f] < threshold;
    if (quiet && start < 0) start = f;
    if (!quiet && start >= 0) {
      pauses.push({ start: start / FRAME_RATE, end: Math.min(duration, f / FRAME_RATE) });
      start = -1;
    }
  }
  // Ambience needs longer pauses and more room than speech before a cut feels right.
  return pausesToCuts(pauses, duration, { ...s, minSilence: Math.max(1, s.minSilence * 3), padding: Math.max(0.25, s.padding * 2) });
}

/** Loudness the leveling brings each clip to (95th percentile of the 20 ms loudness). */
export const LEVEL_TARGET_DB = -20;

/** Gain that brings the loud parts of a recording to LEVEL_TARGET_DB (between ×0.25 and ×4). */
export function levelingGain(frameDb: Float32Array): number {
  if (!frameDb.length) return 1;
  const loud = percentile(smoothDb(frameDb), 0.95);
  if (loud < -70) return 1;
  return Math.min(4, Math.max(0.25, 10 ** ((LEVEL_TARGET_DB - loud) / 20)));
}

/**
 * A sample where Whisper confidently heard real words. Measured on speech: −0.5 to −0.85 on
 * average per token; on street or nature ambience: below −1.2, or one or two words only.
 */
export function isSpoken(s: { noSpeech: number; logprob: number; words: number; invented: boolean }): boolean {
  return !s.invented && s.words >= 3 && s.logprob > -1 && s.noSpeech < 0.6;
}

/**
 * Decides whether a clip has speech from a few samples of it: someone speaks when Whisper
 * confidently hears words in at least a quarter of them, so a single distant voice in a long
 * ambience does not turn it into a talking clip.
 */
export function hasVoice(samples: { noSpeech: number; logprob: number; words: number; invented: boolean }[]): boolean {
  if (!samples.length) return false;
  const spoken = samples.filter(isSpoken).length;
  return spoken >= Math.max(1, Math.ceil(samples.length * 0.25));
}

/**
 * Splits the recording into chunks of at most 30 s for Whisper, cutting at the quietest
 * frame near each boundary so no word is split in half. Silent chunks are flagged so they
 * can be skipped (Whisper tends to hallucinate text on silence).
 */
export function whisperChunks(frameDb: Float32Array, duration: number, thresholdDb: number): (Range & { silent: boolean })[] {
  const chunks: (Range & { silent: boolean })[] = [];
  let start = 0;
  while (start < duration - 0.05) {
    let end = Math.min(duration, start + 29);
    if (end < duration) {
      let best = end;
      let bestDb = Infinity;
      for (let t = start + 18; t <= end; t += 1 / FRAME_RATE) {
        const db = frameDb[Math.floor(t * FRAME_RATE)] ?? -90;
        if (db < bestDb) {
          bestDb = db;
          best = t;
        }
      }
      end = best;
    }
    let loud = 0;
    for (let f = Math.floor(start * FRAME_RATE); f < Math.floor(end * FRAME_RATE); f++) {
      if ((frameDb[f] ?? -90) >= thresholdDb) loud++;
    }
    chunks.push({ start, end, silent: loud < FRAME_RATE * 0.3 });
    start = end;
  }
  return chunks;
}

/**
 * Joins per-clip arrays sampled at `rate` into one sequence array. Each part is padded or
 * trimmed to exactly its clip duration so later clips stay aligned with sequence time.
 */
export function concatAligned(parts: { duration: number; data: Float32Array }[], rate: number, fill = 0): Float32Array {
  const sizes = parts.map((p) => Math.round(p.duration * rate));
  const out = new Float32Array(sizes.reduce((a, b) => a + b, 0)).fill(fill);
  let offset = 0;
  parts.forEach((p, i) => {
    out.set(p.data.subarray(0, sizes[i]), offset);
    offset += sizes[i];
  });
  return out;
}

export const ENVELOPE_RATE = 100;

/**
 * Background music gain over the OUTPUT timeline (100 values per second): full volume in
 * pauses, lowered while someone speaks, with a fast attack and a slow release.
 */
export function duckingEnvelope(
  frameDb: Float32Array,
  segments: Range[],
  outDuration: number,
  thresholdDb: number,
  volume: number,
  ducking: number,
): Float32Array {
  const count = Math.ceil(outDuration * ENVELOPE_RATE) + 1;
  const env = new Float32Array(count);
  const attack = 1 - Math.exp(-1 / (0.12 * ENVELOPE_RATE));
  const release = 1 - Math.exp(-1 / (0.6 * ENVELOPE_RATE));
  let gain = volume;
  for (let i = 0; i < count; i++) {
    const src = outputToSource(segments, i / ENVELOPE_RATE);
    const f = Math.floor(src * FRAME_RATE);
    // Look slightly ahead so the music is already down when the first word starts.
    let speaking = false;
    for (let k = 0; k < 8 && !speaking; k++) speaking = (frameDb[f + k] ?? -90) >= thresholdDb;
    const target = speaking ? volume * ducking : volume;
    gain += (target - gain) * (target < gain ? attack : release);
    env[i] = gain;
  }
  return env;
}

export function envelopeAt(env: Float32Array, outT: number): number {
  const pos = outT * ENVELOPE_RATE;
  const i = Math.floor(pos);
  const a = env[Math.min(env.length - 1, Math.max(0, i))] ?? 0;
  const b = env[Math.min(env.length - 1, Math.max(0, i + 1))] ?? a;
  return a + (b - a) * (pos - i);
}

/**
 * Streaming box-filter resampler: averages the source samples falling into each output
 * period. Good enough for speech analysis and cheap enough for hour-long files.
 */
export class Downsampler {
  private acc = 0;
  private count = 0;
  private last = 0;
  private nextBoundary: number;
  private srcIndex = 0;
  private out: Float32Array;
  private written = 0;

  constructor(
    private readonly ratio: number,
    expectedOutput: number,
  ) {
    this.nextBoundary = ratio;
    this.out = new Float32Array(Math.max(1024, Math.ceil(expectedOutput)));
  }

  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.acc += samples[i];
      this.count++;
      this.srcIndex++;
      while (this.srcIndex >= this.nextBoundary) {
        const v = this.count ? this.acc / this.count : this.last;
        this.last = v;
        this.emit(v);
        this.acc = 0;
        this.count = 0;
        this.nextBoundary += this.ratio;
      }
    }
  }

  private emit(v: number): void {
    if (this.written >= this.out.length) {
      const grown = new Float32Array(Math.ceil(this.out.length * 1.5));
      grown.set(this.out);
      this.out = grown;
    }
    this.out[this.written++] = v;
  }

  result(): Float32Array {
    return this.out.slice(0, this.written);
  }
}
