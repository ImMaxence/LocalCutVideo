import type { FacePoint } from './model';

export interface FaceSample {
  t: number;
  /** Face center and width, normalized to the source frame. Null when no face was found. */
  face: { x: number; y: number; w: number } | null;
}

/**
 * Turns raw per-frame detections into a camera path that behaves like a calm operator:
 * gaps are filled, jitter is averaged out, and the frame only moves when the face leaves
 * a dead zone around the current position.
 */
export function smoothFaceTrack(samples: FaceSample[]): FacePoint[] | null {
  const found = samples.filter((s) => s.face);
  if (found.length < Math.max(2, samples.length * 0.1)) return null;

  // 1. Fill gaps: interpolate between the detections around them (the subject keeps moving
  //    while the detector misses it), hold the nearest one at the edges.
  const filled = samples.map((s) => ({ t: s.t, x: 0, y: 0 }));
  let prev = -1;
  samples.forEach((s, i) => {
    if (!s.face) return;
    filled[i].x = s.face.x;
    filled[i].y = s.face.y;
    const from = prev >= 0 ? samples[prev].face! : s.face;
    for (let k = prev + 1; k < i; k++) {
      const a = prev >= 0 ? (k - prev) / (i - prev) : 1;
      filled[k].x = from.x + (s.face.x - from.x) * a;
      filled[k].y = from.y + (s.face.y - from.y) * a;
    }
    prev = i;
  });
  for (let k = prev + 1; k < samples.length; k++) {
    filled[k].x = samples[prev].face!.x;
    filled[k].y = samples[prev].face!.y;
  }

  // 2. Moving average over about one second.
  const radius = 2;
  const averaged = filled.map((p, i) => {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(filled.length - 1, i + radius); k++) {
      x += filled[k].x;
      y += filled[k].y;
      n++;
    }
    return { t: p.t, x: x / n, y: y / n };
  });

  // 3. Dead zone: hold still until the subject really moves, then ease toward it.
  const deadZone = 0.05;
  let cx = averaged[0].x;
  let cy = averaged[0].y;
  return averaged.map((p) => {
    if (Math.abs(p.x - cx) > deadZone) cx += (p.x - cx) * 0.35;
    if (Math.abs(p.y - cy) > deadZone) cy += (p.y - cy) * 0.35;
    return { t: p.t, x: cx, y: cy };
  });
}

export function faceAt(track: FacePoint[], t: number): { x: number; y: number } {
  if (!track.length) return { x: 0.5, y: 0.5 };
  if (t <= track[0].t) return track[0];
  const lastPoint = track[track.length - 1];
  if (t >= lastPoint.t) return lastPoint;
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  // Smoothstep easing between keyframes avoids visible speed changes.
  const e = k * k * (3 - 2 * k);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}
