import { describe, expect, it } from 'vitest';
import {
  Downsampler,
  FRAME_RATE,
  computeFrameDb,
  concatAligned,
  detectDeadAir,
  detectSilences,
  detectSilencesFromWords,
  duckingEnvelope,
  envelopeAt,
  hasVoice,
  isSpoken,
  levelingGain,
  whisperChunks,
} from './audio-analysis';
import type { SilenceSettings } from './model';

const settings: SilenceSettings = { thresholdDb: -40, minSilence: 0.5, padding: 0.1, mode: 'audio', live: false };

/** Loudness track of `seconds`, at `base` dB with [from, to, dB] stretches. */
function track(seconds: number, base: number, parts: [number, number, number][]): Float32Array {
  const db = new Float32Array(seconds * FRAME_RATE).fill(base);
  for (const [from, to, level] of parts) db.fill(level, from * FRAME_RATE, to * FRAME_RATE);
  return db;
}

describe('loudness', () => {
  it('measures a sine wave at its RMS level', () => {
    const pcm = Float32Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000));
    const db = computeFrameDb(pcm);
    expect(db).toHaveLength(FRAME_RATE);
    expect(db[10]).toBeCloseTo(-9.03, 1);
  });

  it('downsamples 48 kHz to 16 kHz', () => {
    const down = new Downsampler(3, 1600);
    down.push(new Float32Array(4800).fill(0.5));
    const out = down.result();
    expect(out).toHaveLength(1600);
    expect(out[800]).toBeCloseTo(0.5);
  });

  it('joins clips padded or trimmed to their duration', () => {
    const joined = concatAligned(
      [
        { duration: 1, data: new Float32Array(3).fill(1) },
        { duration: 1, data: new Float32Array(6).fill(2) },
      ],
      4,
      -1,
    );
    expect([...joined]).toEqual([1, 1, 1, -1, 2, 2, 2, 2]);
  });
});

describe('silence detection', () => {
  it('cuts pauses, keeping more room after speech than before it', () => {
    const db = track(7.2, -80, [
      [0, 2, -20],
      [4, 6, -20],
    ]);
    const cuts = detectSilences(db, 7.2, settings);
    expect(cuts).toHaveLength(2);
    expect(cuts[0].start).toBeGreaterThan(2.1);
    expect(cuts[0].start).toBeLessThan(2.3);
    expect(cuts[0].end).toBeGreaterThan(3.8);
    expect(cuts[0].end).toBeLessThan(3.95);
    // The trailing silence is cut up to the very end.
    expect(cuts[1].end).toBe(7.2);
  });

  it('ignores clicks inside a pause and pauses that are too short', () => {
    const db = track(8, -80, [
      [0, 2, -20],
      [3, 3.06, -20],
      [4, 6, -20],
      [6.3, 8, -20],
    ]);
    const cuts = detectSilences(db, 8, settings);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].start).toBeLessThan(3);
    expect(cuts[0].end).toBeGreaterThan(3.06);
  });

  it('cuts the gaps between the words of the transcript', () => {
    const cuts = detectSilencesFromWords(
      [
        { start: 0.5, end: 1 },
        { start: 3, end: 3.5 },
      ],
      5,
      settings,
    );
    expect(cuts.map((c) => [+c.start.toFixed(2), +c.end.toFixed(2)])).toEqual([
      [0, 0.4],
      [1.15, 2.9],
      [3.65, 5],
    ]);
  });
});

describe('clips without voice', () => {
  it('only cuts real dead air', () => {
    const db = track(30, -55, [
      [5, 7, -30],
      [10, 13, -72],
      [20, 22, -30],
    ]);
    const cuts = detectDeadAir(db, 30, settings);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].start).toBeGreaterThan(10);
    expect(cuts[0].end).toBeLessThan(13);
  });

  it('keeps steady ambience', () => {
    expect(detectDeadAir(track(30, -55, [[5, 7, -30]]), 30, settings)).toEqual([]);
  });

  it('leaves a clip with no sound at all untouched', () => {
    expect(detectDeadAir(track(30, -90, []), 30, settings)).toEqual([]);
  });
});

describe('leveling', () => {
  it('brings the loud parts to -20 dB, within ×0.25 and ×4', () => {
    expect(levelingGain(track(10, -30, []))).toBeCloseTo(10 ** (10 / 20), 2);
    expect(levelingGain(track(10, -10, []))).toBeCloseTo(10 ** (-10 / 20), 2);
    expect(levelingGain(track(10, -60, []))).toBe(4);
    expect(levelingGain(track(10, -90, []))).toBe(1);
  });
});

describe('voice detection', () => {
  const spoken = { noSpeech: 0.1, logprob: -0.6, words: 12, invented: false };
  const noise = { noSpeech: 0.3, logprob: -1.8, words: 4, invented: false };

  it('trusts confident transcriptions only', () => {
    expect(isSpoken(spoken)).toBe(true);
    expect(isSpoken(noise)).toBe(false);
    expect(isSpoken({ ...spoken, words: 1 })).toBe(false);
    expect(isSpoken({ ...spoken, invented: true })).toBe(false);
  });

  it('needs speech in a quarter of the samples', () => {
    expect(hasVoice([spoken, noise, noise])).toBe(true);
    expect(hasVoice([spoken, noise, noise, noise, noise, noise])).toBe(false);
    expect(hasVoice([spoken, spoken, noise, noise, noise, noise])).toBe(true);
    expect(hasVoice([])).toBe(false);
  });
});

describe('Whisper chunks', () => {
  it('covers the recording with chunks of at most 30 s, flagging silent ones', () => {
    const db = track(70, -80, [[0, 40, -20]]);
    const chunks = whisperChunks(db, 70, -40);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)!.end).toBe(70);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start).toBe(chunks[i - 1].end);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(29);
    expect(chunks[0].silent).toBe(false);
    expect(chunks.at(-1)!.silent).toBe(true);
  });
});

describe('music ducking', () => {
  it('lowers the music while someone speaks', () => {
    const db = track(10, -80, [[4, 6, -20]]);
    const env = duckingEnvelope(db, [{ start: 0, end: 10 }], 10, -40, 0.4, 0.25);
    expect(envelopeAt(env, 1)).toBeCloseTo(0.4);
    expect(envelopeAt(env, 5.5)).toBeCloseTo(0.1, 2);
    expect(envelopeAt(env, 9.5)).toBeGreaterThan(0.35);
  });
});
