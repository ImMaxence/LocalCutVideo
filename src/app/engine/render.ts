/**
 * Frame composition shared by the live preview (main thread) and the export worker, so
 * what you see is exactly what gets encoded: crop for the output format, auto-framing,
 * punch-in zoom and burned-in captions.
 */
import { faceAt } from './framing';
import type { AspectFormat, CaptionSettings, ExportSettings, Project, Range, Word } from './model';
import { type CaptionPage, pageAt } from './timeline-math';

/** Both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D satisfy this. */
export type Ctx2D = OffscreenCanvasRenderingContext2D;

export const CAPTION_FONT = 'LCV Captions';

export function aspectRatio(format: AspectFormat): number {
  return format === '16:9' ? 16 / 9 : format === '9:16' ? 9 / 16 : 1;
}

/** Frame size for a short side of `resolution` pixels (1080 → 1920×1080 in 16:9), always even. */
export function outputSize(format: AspectFormat, resolution: ExportSettings['resolution'] | number): { width: number; height: number } {
  const short = resolution;
  const long = Math.round((resolution * 16) / 9 / 2) * 2;
  if (format === '16:9') return { width: long, height: short };
  if (format === '9:16') return { width: short, height: long };
  return { width: short, height: short };
}

export interface Framing {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Times where the smart zoom toggles. Cuts (and clip changes) are the natural moments for a
 * punch-in; an uncut video falls back to sentence starts, then to a steady 4 s rhythm.
 */
export function zoomBeats(project: Project, segments: Range[]): number[] {
  const beats = new Set<number>(segments.slice(1).map((s) => s.start));
  let clipStart = 0;
  project.clips.forEach((c, i) => {
    if (i > 0) beats.add(clipStart);
    clipStart += c.source.duration;
  });
  if (beats.size) return [...beats].sort((a, b) => a - b);

  const words = project.words.filter((w) => !w.deleted);
  const sentences: number[] = [];
  let last = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (prev && /[.!?…]$/.test(prev.text) && w.start - last >= 1.5) {
      sentences.push(w.start);
      last = w.start;
    }
  });
  if (sentences.length) return sentences;

  const steady: number[] = [];
  for (let t = 4; t < clipStart; t += 4) steady.push(t);
  return steady;
}

export function framingAt(project: Project, beats: number[], srcT: number): Framing {
  const center =
    project.framing.mode === 'face' && project.faces?.length ? faceAt(project.faces, srcT) : { x: 0.5, y: 0.5 };
  let zoom = 1;
  if (project.framing.punchIn) {
    let passed = 0;
    while (passed < beats.length && beats[passed] <= srcT) passed++;
    if (passed % 2 === 1) zoom = project.framing.zoom;
  }
  return { ...center, zoom };
}

export function cropRect(srcW: number, srcH: number, outAspect: number, f: Framing) {
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > outAspect) sw = srcH * outAspect;
  else sh = srcW / outAspect;
  sw /= f.zoom;
  sh /= f.zoom;
  // Faces sit slightly above the center of the frame (headroom), like a camera operator would do.
  const sx = clamp(f.x * srcW - sw / 2, 0, srcW - sw);
  const sy = clamp(f.y * srcH - sh * 0.42, 0, srcH - sh);
  return { sx, sy, sw, sh };
}

export function drawFrame(
  ctx: Ctx2D,
  image: CanvasImageSource,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
  framing: Framing,
): void {
  const { sx, sy, sw, sh } = cropRect(srcW, srcH, outW / outH, framing);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
}

interface LaidOutWord {
  word: Word;
  text: string;
  x: number;
  width: number;
}

export function drawCaptions(ctx: Ctx2D, pages: CaptionPage[], t: number, s: CaptionSettings, outW: number, outH: number): void {
  if (!s.enabled) return;
  const page = pageAt(pages, t);
  if (!page) return;

  const base = Math.min(outW, outH) * (s.style === 'karaoke' ? 0.075 : 0.058) * s.size;
  const fontSize = Math.round(base);
  ctx.font = `800 ${fontSize}px "${CAPTION_FONT}", "Arial Black", system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  // A wider gap than a plain space leaves room for the "pop" of the active word.
  const space = Math.max(ctx.measureText(' ').width, fontSize * 0.3);
  const maxWidth = outW * 0.86;

  const lines: LaidOutWord[][] = [[]];
  let lineWidth = 0;
  for (const word of page.words) {
    const text = s.uppercase ? word.text.toLocaleUpperCase() : word.text;
    const width = ctx.measureText(text).width;
    const line = lines[lines.length - 1];
    if (line.length && lineWidth + space + width > maxWidth) {
      lines.push([]);
      lineWidth = 0;
    }
    const current = lines[lines.length - 1];
    current.push({ word, text, x: 0, width });
    lineWidth += (current.length > 1 ? space : 0) + width;
  }

  const lineHeight = fontSize * 1.22;
  const blockHeight = lines.length * lineHeight;
  const vertical = outH > outW;
  let top: number;
  if (s.position === 'top') top = outH * 0.12;
  else if (s.position === 'center') top = (outH - blockHeight) / 2;
  else top = outH * (vertical ? 0.72 : 0.86) - blockHeight;

  const activeIndex = page.words.findIndex((w, i) => t >= w.start && t < (page.words[i + 1]?.start ?? page.end));
  const active = page.words[activeIndex];

  lines.forEach((line, li) => {
    const total = line.reduce((n, w) => n + w.width, 0) + space * (line.length - 1);
    let x = (outW - total) / 2;
    const baseline = top + li * lineHeight + fontSize;
    for (const item of line) {
      item.x = x;
      x += item.width + space;
    }

    if (s.style === 'boxed') {
      const padX = fontSize * 0.35;
      const padY = fontSize * 0.18;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      ctx.beginPath();
      ctx.roundRect(line[0].x - padX, baseline - fontSize - padY + fontSize * 0.1, total + padX * 2, lineHeight + padY, fontSize * 0.22);
      ctx.fill();
    }

    for (const item of line) {
      const isActive = item.word === active;
      ctx.save();
      if (s.style === 'karaoke' && isActive) {
        const cx = item.x + item.width / 2;
        const cy = baseline - fontSize * 0.35;
        ctx.translate(cx, cy);
        ctx.scale(1.06, 1.06);
        ctx.translate(-cx, -cy);
      }
      if (s.style === 'karaoke') {
        ctx.lineJoin = 'round';
        ctx.lineWidth = fontSize * 0.2;
        ctx.strokeStyle = '#000';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = fontSize * 0.25;
        ctx.shadowOffsetY = fontSize * 0.06;
        ctx.strokeText(item.text, item.x, baseline);
        ctx.shadowColor = 'transparent';
      } else if (s.style === 'clean') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = fontSize * 0.2;
        ctx.shadowOffsetY = fontSize * 0.04;
      }
      ctx.fillStyle = isActive && s.style !== 'clean' ? s.highlight : '#ffffff';
      ctx.fillText(item.text, item.x, baseline);
      ctx.restore();
    }
  });
}

/** Loads the caption font into a document or a worker so preview and export match. */
export async function loadCaptionFont(fonts: FontFaceSet, origin: string): Promise<void> {
  const faces = [
    new FontFace(CAPTION_FONT, `url(${origin}/fonts/montserrat-latin-800-normal.woff2)`, {
      weight: '800',
      unicodeRange: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122',
    }),
    new FontFace(CAPTION_FONT, `url(${origin}/fonts/montserrat-latin-ext-800-normal.woff2)`, {
      weight: '800',
      unicodeRange: 'U+0100-024F, U+0259, U+1E00-1EFF, U+2020, U+20A0-20AB, U+20AD-20CF, U+2113, U+2C60-2C7F, U+A720-A7FF',
    }),
  ];
  await Promise.all(
    faces.map(async (face) => {
      try {
        await face.load();
        fonts.add(face);
      } catch {
        // The fallback fonts in drawCaptions still produce readable captions.
      }
    }),
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
