/**
 * Multi-clip sequence. Clips are played back to back; every time stored in the project
 * (cuts, words, face track) is a SEQUENCE time. When clips are reordered or removed, those
 * times are remapped so each item stays attached to the clip it belongs to.
 */
import type { Clip, Project } from './model';
import { uid } from './model';

export interface PlacedClip extends Clip {
  index: number;
  start: number;
  end: number;
}

export function placeClips(clips: Clip[]): PlacedClip[] {
  let start = 0;
  return clips.map((clip, index) => {
    const placed = { ...clip, index, start, end: start + clip.source.duration };
    start = placed.end;
    return placed;
  });
}

export function sequenceDuration(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + c.source.duration, 0);
}

/** Index of the clip playing at a sequence time (the last clip past the end). */
export function clipIndexAt(placed: PlacedClip[], t: number): number {
  for (let i = 0; i < placed.length; i++) if (t < placed[i].end) return i;
  return Math.max(0, placed.length - 1);
}

/** Rewrites cuts, speeds, words and face track after the clip list changed from `before` to `after`. */
export function remapTimeline(draft: Project, before: Clip[], after: Clip[]): void {
  const oldPlaced = placeClips(before);
  const newPlaced = new Map(placeClips(after).map((c) => [c.id, c]));
  const map = (t: number, clip: PlacedClip): number | null => {
    const target = newPlaced.get(clip.id);
    if (!target) return null;
    const local = Math.min(Math.max(t, clip.start), clip.end) - clip.start;
    return local > target.end - target.start + 1e-6 ? null : target.start + local;
  };

  draft.words = draft.words
    .flatMap((w) => {
      const clip = oldPlaced[clipIndexAt(oldPlaced, (w.start + w.end) / 2)];
      const start = clip && map(w.start, clip);
      const end = clip && map(w.end, clip);
      return start == null || end == null ? [] : [{ ...w, start, end }];
    })
    .sort((a, b) => a.start - b.start);

  // A cut or speed change spanning a clip boundary is split so each piece follows its own clip.
  const follow = <T extends { id: string; start: number; end: number }>(ranges: T[]): T[] =>
    ranges
      .flatMap((range) =>
        oldPlaced
          .filter((c) => c.end > range.start && c.start < range.end)
          .flatMap((clip, piece) => {
            const start = map(Math.max(range.start, clip.start), clip);
            const end = map(Math.min(range.end, clip.end), clip);
            if (start == null || end == null || end - start < 0.01) return [];
            return [{ ...range, id: piece === 0 ? range.id : uid(), start, end }];
          }),
      )
      .sort((a, b) => a.start - b.start);
  draft.cuts = follow(draft.cuts);
  draft.speeds = follow(draft.speeds ?? []);
  draft.texts = follow(draft.texts ?? []);

  if (draft.faces) {
    const faces = draft.faces
      .flatMap((p) => {
        const clip = oldPlaced[clipIndexAt(oldPlaced, p.t)];
        const t = clip && map(p.t, clip);
        return t == null ? [] : [{ ...p, t }];
      })
      .sort((a, b) => a.t - b.t);
    draft.faces = faces.length ? faces : null;
  }
}

/** Moves the clip at `from` to index `to`, returning a new array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const copy = items.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item);
  return copy;
}
