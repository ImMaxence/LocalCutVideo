import { describe, expect, it } from 'vitest';
import type { Cut, SpeedRange, Word } from './model';
import {
  applySpeeds,
  buildCaptionPages,
  cutPoints,
  deletedWordRanges,
  formatTime,
  keptSegments,
  mergeRanges,
  nextKeptTime,
  outputToSource,
  removedRanges,
  segmentIndexAt,
  sourceToOutput,
  totalDuration,
  transitionShade,
  withoutRange,
} from './timeline-math';

const cut = (start: number, end: number): Cut => ({ id: `c${start}`, start, end, reason: 'manual' });
const word = (text: string, start: number, end: number, deleted = false): Word => ({ id: `${text}${start}`, text, start, end, deleted });
const speed = (start: number, end: number, rate: number, id = 's'): SpeedRange => ({ id, start, end, rate });

describe('cuts', () => {
  it('merges overlapping ranges', () => {
    expect(
      mergeRanges([
        { start: 5, end: 6 },
        { start: 1, end: 3 },
        { start: 2.5, end: 4 },
      ]),
    ).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 6 },
    ]);
  });

  it('keeps what is not cut', () => {
    const removed = removedRanges(10, [cut(2, 3), cut(6, 7)], []);
    expect(keptSegments(10, removed)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
      { start: 7, end: 10 },
    ]);
  });

  it('drops kept slivers shorter than a frame', () => {
    const removed = [
      { start: 2, end: 5 },
      { start: 5.01, end: 6 },
    ];
    expect(keptSegments(10, removed)).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 10 },
    ]);
  });

  it('removes consecutive deleted words with the pause between them', () => {
    const words = [word('a', 0, 0.5), word('b', 0.6, 1, true), word('c', 1.2, 1.6, true), word('d', 2, 2.4)];
    expect(deletedWordRanges(words)).toEqual([{ start: 0.6, end: 1.6 }]);
  });

  it('clamps cuts to the sequence', () => {
    expect(removedRanges(5, [cut(-1, 1), cut(4.5, 9)], [])).toEqual([
      { start: 0, end: 1 },
      { start: 4.5, end: 5 },
    ]);
  });
});

describe('output time', () => {
  const segments = keptSegments(10, removedRanges(10, [cut(2, 4)], []));

  it('removes the cut time from the duration', () => {
    expect(totalDuration(segments)).toBeCloseTo(8);
  });

  it('maps source time to output time and back', () => {
    expect(sourceToOutput(segments, 5)).toBeCloseTo(3);
    expect(outputToSource(segments, 3)).toBeCloseTo(5);
    // A time inside a cut snaps to where the next kept part starts.
    expect(sourceToOutput(segments, 3)).toBeCloseTo(2);
  });

  it('jumps over cuts during playback', () => {
    expect(nextKeptTime(segments, 3)).toBe(4);
    expect(nextKeptTime(segments, 5)).toBe(5);
    expect(nextKeptTime(segments, 10)).toBeNull();
  });

  it('finds the kept part of a time', () => {
    expect(segmentIndexAt(segments, 1)).toBe(0);
    expect(segmentIndexAt(segments, 3)).toBe(-1);
    expect(segmentIndexAt(segments, 9.9)).toBe(1);
  });
});

describe('speed changes', () => {
  it('splits kept parts where the speed changes', () => {
    expect(applySpeeds([{ start: 0, end: 10 }], [speed(2, 4, 2)])).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4, rate: 2 },
      { start: 4, end: 10 },
    ]);
  });

  it('shortens sped-up parts and stretches slowed-down ones', () => {
    expect(totalDuration(applySpeeds([{ start: 0, end: 10 }], [speed(2, 4, 2)]))).toBeCloseTo(9);
    expect(totalDuration(applySpeeds([{ start: 0, end: 10 }], [speed(2, 4, 0.5)]))).toBeCloseTo(12);
  });

  it('only applies to the parts that are kept', () => {
    const segments = applySpeeds(
      [
        { start: 0, end: 2 },
        { start: 4, end: 10 },
      ],
      [speed(1, 5, 2)],
    );
    expect(segments).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2, rate: 2 },
      { start: 4, end: 5, rate: 2 },
      { start: 5, end: 10 },
    ]);
    expect(totalDuration(segments)).toBeCloseTo(1 + 0.5 + 0.5 + 5);
  });

  it('maps times through speed changes both ways', () => {
    const segments = applySpeeds([{ start: 0, end: 10 }], [speed(2, 6, 2)]);
    expect(sourceToOutput(segments, 4)).toBeCloseTo(3);
    expect(outputToSource(segments, 6)).toBeCloseTo(8);
    for (const t of [0, 1, 2, 3, 5.5, 6, 9]) expect(outputToSource(segments, sourceToOutput(segments, t))).toBeCloseTo(t);
  });

  it('trims or splits a speed change that overlaps a new one', () => {
    const list = withoutRange([speed(0, 10, 2, 'a')], 4, 6);
    expect(list.map(({ start, end, rate }) => ({ start, end, rate }))).toEqual([
      { start: 0, end: 4, rate: 2 },
      { start: 6, end: 10, rate: 2 },
    ]);
    expect(list[0].id).toBe('a');
    expect(list[1].id).not.toBe('a');
    expect(withoutRange([speed(0, 10, 2)], 0, 10)).toEqual([]);
    expect(withoutRange([speed(0, 2, 2)], 4, 6)).toHaveLength(1);
  });
});

describe('captions', () => {
  const words = ['Hello', 'there.', 'How', 'are', 'you', 'today'].map((t, i) => word(t, i * 0.5, i * 0.5 + 0.4));

  it('breaks pages on punctuation and on the word count', () => {
    const pages = buildCaptionPages(words, [{ start: 0, end: 10 }], 3);
    expect(pages.map((p) => p.words.map((w) => w.text).join(' '))).toEqual(['Hello there.', 'How are you', 'today']);
  });

  it('hides deleted words and words in cut parts', () => {
    const edited = words.map((w, i) => (i === 1 ? { ...w, deleted: true } : w));
    const pages = buildCaptionPages(edited, [{ start: 0, end: 2 }], 6);
    expect(pages.flatMap((p) => p.words.map((w) => w.text))).toEqual(['Hello', 'How', 'are']);
  });

  it('formats times', () => {
    expect(formatTime(75.4)).toBe('1:15');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(9.87, true)).toBe('0:09.8');
  });
});

describe('transitions', () => {
  it('finds the jumps of the edit, not the speed changes', () => {
    const segments = applySpeeds(
      [
        { start: 0, end: 4 },
        { start: 6, end: 20 },
      ],
      [speed(8, 10, 2)],
    );
    // A cut at output 4, then a clip starting at source 15 (output 4 + 2 + 1 + 5 = 12).
    expect(cutPoints(segments, [15])).toEqual([4, 12]);
  });

  it('darkens around each jump', () => {
    const points = [4, 12];
    expect(transitionShade(points, 4, 0.2)).toBe(1);
    expect(transitionShade(points, 4.1, 0.2)).toBeCloseTo(0.5);
    expect(transitionShade(points, 11.9, 0.2)).toBeCloseTo(0.5);
    expect(transitionShade(points, 8, 0.2)).toBe(0);
    expect(transitionShade(points, 4, 0)).toBe(0);
    expect(transitionShade([], 4, 0.2)).toBe(0);
  });
});
