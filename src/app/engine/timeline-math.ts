import type { Cut, Project, Range, Word } from './model';
import { sequenceDuration } from './sequence';

/** Segments shorter than this are dropped: they would only produce a flash on screen. */
const MIN_SEGMENT = 1 / 30;

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

export function projectSegments(project: Project): Range[] {
  const duration = sequenceDuration(project.clips);
  return keptSegments(duration, removedRanges(duration, project.cuts, project.words));
}

export function totalDuration(segments: Range[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0);
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
export function sourceToOutput(segments: Range[], t: number): number {
  let out = 0;
  for (const s of segments) {
    if (t < s.start) return out;
    if (t < s.end) return out + (t - s.start);
    out += s.end - s.start;
  }
  return out;
}

export function outputToSource(segments: Range[], outT: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = s.end - s.start;
    if (outT < acc + len) return s.start + (outT - acc);
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last ? last.end : 0;
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
