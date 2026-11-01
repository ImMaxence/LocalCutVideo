import { type Cut, type Project, type Range, type SpeedRange, type Word, uid } from './model';
import { sequenceDuration } from './sequence';

/** Segments shorter than this are dropped: they would only produce a flash on screen. */
const MIN_SEGMENT = 1 / 30;

/** A kept part of the sequence and its playback rate (1 when absent). */
export interface Segment extends Range {
  rate?: number;
}

const rateOf = (s: Segment) => s.rate ?? 1;

export function mergeRanges(ranges: Range[], gap = 0): Range[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push(r);
    }
  }
  return merged;
}

/**
 * Ranges removed by deleted words. Consecutive deleted words are merged with the pause
 * between them, like deleting a sentence in a text editor removes its spaces too.
 */
export function deletedWordRanges(words: Word[]): Range[] {
  const ranges: Range[] = [];
  let current: Range | null = null;
  for (const w of words) {
    if (w.deleted) {
      if (current) current.end = w.end;
      else current = { start: w.start, end: w.end };
    } else if (current) {
      ranges.push(current);
      current = null;
    }
  }
  if (current) ranges.push(current);
  return ranges;
}

export function removedRanges(duration: number, cuts: Cut[], words: Word[]): Range[] {
  return mergeRanges([...cuts, ...deletedWordRanges(words)], 0.01)
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }))
    .filter((r) => r.end - r.start > 0.001);
}

export function keptSegments(duration: number, removed: Range[]): Range[] {
  const kept: Range[] = [];
  let cursor = 0;
  for (const r of removed) {
    if (r.start - cursor >= MIN_SEGMENT) kept.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (duration - cursor >= MIN_SEGMENT) kept.push({ start: cursor, end: duration });
  return kept;
}

/** Splits the kept segments where the speed changes, each piece carrying its rate. */
export function applySpeeds(kept: Range[], speeds: SpeedRange[]): Segment[] {
  const sorted = speeds.filter((s) => s.end > s.start && s.rate !== 1).sort((a, b) => a.start - b.start);
  if (!sorted.length) return kept;
  const out: Segment[] = [];
  for (const k of kept) {
    let cursor = k.start;
    for (const s of sorted) {
      if (s.end <= cursor || s.start >= k.end) continue;
      if (s.start > cursor) out.push({ start: cursor, end: s.start });
      const end = Math.min(s.end, k.end);
      out.push({ start: Math.max(cursor, s.start), end, rate: s.rate });
      cursor = end;
    }
    if (cursor < k.end) out.push({ start: cursor, end: k.end });
  }
  return out.filter((s) => s.end - s.start > 1e-4);
}

/** Speed ranges with [start, end) taken out: overlapping ones are trimmed or split in two. */
export function withoutRange(speeds: SpeedRange[], start: number, end: number): SpeedRange[] {
  return speeds.flatMap((s) => {
    if (s.end <= start || s.start >= end) return [s];
    const parts: SpeedRange[] = [];
    if (start - s.start >= MIN_SEGMENT) parts.push({ ...s, end: start });
    if (s.end - end >= MIN_SEGMENT) parts.push({ ...s, id: parts.length ? uid() : s.id, start: end });
    return parts;
  });
}

export function projectSegments(project: Project): Segment[] {
  const duration = sequenceDuration(project.clips);
  return applySpeeds(keptSegments(duration, removedRanges(duration, project.cuts, project.words)), project.speeds ?? []);
}

/** Length of the edited video: kept parts, shortened or stretched by their speed. */
export function totalDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start) / rateOf(s), 0);
}

/** Index of the kept segment containing a source time, or -1 when the time is cut. */
export function segmentIndexAt(segments: Range[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Source time to output time. Times inside a cut snap to the start of the next segment. */
export function sourceToOutput(segments: Segment[], t: number): number {
  let out = 0;
  for (const s of segments) {
    if (t < s.start) return out;
    if (t < s.end) return out + (t - s.start) / rateOf(s);
    out += (s.end - s.start) / rateOf(s);
  }
  return out;
}

export function outputToSource(segments: Segment[], outT: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = (s.end - s.start) / rateOf(s);
    if (outT < acc + len) return s.start + (outT - acc) * rateOf(s);
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
}

/**
 * Output times where the picture jumps: between kept parts that do not follow each other, and
 * where a new clip starts. Speed changes are not jumps.
 */
export function cutPoints(segments: Segment[], clipStarts: number[]): number[] {
  const points: number[] = [];
  let out = 0;
  segments.forEach((s, i) => {
    const prev = segments[i - 1];
    const contiguous = !!prev && s.start - prev.end <= 1e-4;
    if (prev && (!contiguous || clipStarts.some((c) => Math.abs(c - s.start) < 1e-4))) points.push(out);
    for (const c of clipStarts) if (c > s.start + 1e-4 && c < s.end - 1e-4) points.push(out + (c - s.start) / rateOf(s));
    out += (s.end - s.start) / rateOf(s);
  });
  return points.sort((a, b) => a - b);
}

/** How dark the picture is at output time `t` (0 = untouched, 1 = black) for transitions of `half` seconds. */
export function transitionShade(points: number[], t: number, half: number): number {
  if (half <= 0 || !points.length) return 0;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  let distance = Math.abs(points[lo] - t);
  if (lo > 0) distance = Math.min(distance, Math.abs(points[lo - 1] - t));
  return distance >= half ? 0 : 1 - distance / half;
}

/** Where playback should jump when it enters a cut, or null at the end of the edit. */
export function nextKeptTime(segments: Range[], t: number): number | null {
  for (const s of segments) {
    if (t < s.start) return s.start;
    if (t < s.end) return t;
  }
  return null;
}

export interface CaptionPage {
  start: number;
  end: number;
  words: Word[];
}

/**
 * Groups visible words into the short "pages" shown on screen at once. A page breaks on
 * punctuation, on long pauses, on cuts, or when it reaches the configured word count.
 */
export function buildCaptionPages(words: Word[], segments: Range[], maxWords: number): CaptionPage[] {
  const visible = words.filter((w) => {
    if (w.deleted) return false;
    return segmentIndexAt(segments, (w.start + w.end) / 2) !== -1;
  });
  const pages: CaptionPage[] = [];
  let page: Word[] = [];
  let pageSegment = -1;
  const flush = () => {
    if (page.length) {
      pages.push({ start: page[0].start, end: page[page.length - 1].end, words: page });
    }
    page = [];
  };
  for (const w of visible) {
    const seg = segmentIndexAt(segments, (w.start + w.end) / 2);
    const prev = page[page.length - 1];
    const charCount = page.reduce((n, p) => n + p.text.length + 1, 0) + w.text.length;
    if (
      prev &&
      (page.length >= maxWords ||
        w.start - prev.end > 0.7 ||
        seg !== pageSegment ||
        /[.!?…]$/.test(prev.text) ||
        charCount > maxWords * 9)
    ) {
      flush();
    }
    if (!page.length) pageSegment = seg;
    page.push(w);
  }
  flush();
  // Keep each page on screen until the next one starts when the gap is short (no flicker).
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    const hold = pages[i].end + 0.5;
    pages[i].end = next ? Math.min(Math.max(pages[i].end, next.start), hold) : hold;
  }
  return pages;
}

export function pageAt(pages: CaptionPage[], t: number): CaptionPage | null {
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = pages[mid];
    if (t < p.start) hi = mid - 1;
    else if (t >= p.end) lo = mid + 1;
    else return p;
  }
  return null;
}

export function formatTime(seconds: number, withTenths = false): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const base = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  return withTenths ? `${base}.${Math.floor((s % 1) * 10)}` : base;
}
