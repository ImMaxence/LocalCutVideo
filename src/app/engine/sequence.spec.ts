import { describe, expect, it } from 'vitest';
import { type Clip, createProject } from './model';
import { clipIndexAt, moveItem, placeClips, remapTimeline } from './sequence';

const clip = (id: string, duration: number): Clip => ({
  id,
  source: { name: `${id}.mp4`, size: 1, lastModified: 1, type: 'video/mp4', duration, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: 'avc1' },
});

describe('sequence', () => {
  const a = clip('a', 10);
  const b = clip('b', 5);

  it('plays the clips back to back', () => {
    const placed = placeClips([a, b]);
    expect(placed.map((c) => [c.start, c.end])).toEqual([
      [0, 10],
      [10, 15],
    ]);
    expect(clipIndexAt(placed, 9.9)).toBe(0);
    expect(clipIndexAt(placed, 10)).toBe(1);
    expect(clipIndexAt(placed, 99)).toBe(1);
  });

  it('moves cuts, speed changes and words with their clip when reordering', () => {
    const p = createProject('test');
    p.clips = [a, b];
    p.cuts = [{ id: 'c', start: 12, end: 13, reason: 'manual' }];
    p.speeds = [{ id: 's', start: 2, end: 4, rate: 2 }];
    p.words = [{ id: 'w', text: 'hi', start: 11, end: 11.5, deleted: false }];
    const after = moveItem(p.clips, 1, 0);
    remapTimeline(p, p.clips, after);
    expect(p.cuts.map((c) => [c.start, c.end])).toEqual([[2, 3]]);
    expect(p.speeds.map((s) => [s.start, s.end, s.rate])).toEqual([[7, 9, 2]]);
    expect(p.words.map((w) => [w.start, w.end])).toEqual([[1, 1.5]]);
  });

  it('splits a cut spanning two clips and drops what belonged to a removed clip', () => {
    const p = createProject('test');
    p.clips = [a, b];
    p.cuts = [{ id: 'c', start: 8, end: 12, reason: 'manual' }];
    remapTimeline(p, p.clips, [b]);
    expect(p.cuts.map((c) => [c.start, c.end])).toEqual([[0, 2]]);
  });
});
