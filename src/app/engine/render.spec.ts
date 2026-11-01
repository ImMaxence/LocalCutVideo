import { describe, expect, it } from 'vitest';
import { createProject, type Project, type Rotation } from './model';
import { cropRect, framingAt, outputSize, rotatedSize, rotationMatrix, zoomBeats } from './render';

const source = (duration: number) => ({
  name: 'a.mp4',
  size: 1,
  lastModified: 1,
  type: 'video/mp4',
  duration,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  videoCodec: 'avc1',
});

function project(duration = 20): Project {
  const p = createProject('test');
  p.clips = [{ id: 'a', source: source(duration) }];
  return p;
}

describe('output size', () => {
  it('gives even sizes for every shape', () => {
    expect(outputSize('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('1:1', 720)).toEqual({ width: 720, height: 720 });
    expect(outputSize('16:9', 540)).toEqual({ width: 960, height: 540 });
  });
});

describe('rotation', () => {
  it('swaps the sides for quarter turns', () => {
    expect(rotatedSize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedSize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 });
  });

  it('maps the corners of the picture onto the turned frame (clockwise)', () => {
    const apply = (rotation: Rotation, x: number, y: number) => {
      const [a, b, c, d, e, f] = rotationMatrix(4, 2, rotation);
      return [a * x + c * y + e, b * x + d * y + f];
    };
    // The top-left corner goes to the top-right after a clockwise quarter turn.
    expect(apply(90, 0, 0)).toEqual([2, 0]);
    expect(apply(90, 4, 2)).toEqual([0, 4]);
    expect(apply(180, 0, 0)).toEqual([4, 2]);
    expect(apply(270, 0, 0)).toEqual([0, 4]);
    expect(apply(0, 3, 1)).toEqual([3, 1]);
  });
});

describe('crop', () => {
  it('keeps the output shape and stays inside the picture', () => {
    for (const f of [
      { x: 0.5, y: 0.5, zoom: 1 },
      { x: 0, y: 0, zoom: 1.2 },
      { x: 1, y: 1, zoom: 1.5 },
    ]) {
      const r = cropRect(1920, 1080, 9 / 16, f);
      expect(r.sw / r.sh).toBeCloseTo(9 / 16);
      expect(r.sx).toBeGreaterThanOrEqual(0);
      expect(r.sy).toBeGreaterThanOrEqual(0);
      expect(r.sx + r.sw).toBeLessThanOrEqual(1920 + 1e-6);
      expect(r.sy + r.sh).toBeLessThanOrEqual(1080 + 1e-6);
    }
  });
});

describe('smart zoom', () => {
  it('changes on cuts', () => {
    const segments = [
      { start: 0, end: 4 },
      { start: 6, end: 12 },
      { start: 13, end: 20 },
    ];
    expect(zoomBeats(project(), segments)).toEqual([6, 13]);
  });

  it('falls back on sentences, then on a steady rhythm', () => {
    const p = project(13);
    p.words = [
      { id: '1', text: 'Hello.', start: 0, end: 1, deleted: false },
      { id: '2', text: 'Next', start: 3, end: 3.5, deleted: false },
    ];
    expect(zoomBeats(p, [{ start: 0, end: 13 }])).toEqual([3]);
    expect(zoomBeats(project(13), [{ start: 0, end: 13 }])).toEqual([4, 8, 12]);
  });

  it('alternates the zoom between beats', () => {
    const p = project();
    p.framing.punchIn = true;
    p.framing.zoom = 1.2;
    expect(framingAt(p, [5, 10], 2).zoom).toBe(1);
    expect(framingAt(p, [5, 10], 6).zoom).toBe(1.2);
    expect(framingAt(p, [5, 10], 11).zoom).toBe(1);
  });
});
