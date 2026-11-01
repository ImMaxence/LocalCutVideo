/**
 * Thumbnail composition (YouTube, Shorts, square post): a still of the video, cropped and
 * zoomed, color-boosted, with a big title whose *starred* words stand out. Plain canvas code,
 * so the preview and the downloaded image are the very same drawing. The same titles are used
 * for the free texts shown over the video.
 */
import type { AspectFormat, Rotation, TextOverlay } from './model';
import { CAPTION_FONT, type Ctx2D, rotatedSize, rotationMatrix } from './render';

export type ThumbStyle = 'outline' | 'shadow' | 'box' | 'highlight';
export type ThumbPosition = 'top' | 'center' | 'bottom';

/** Look of a title: on thumbnails and for texts over the video. */
export interface TitleStyle {
  text: string;
  style: ThumbStyle;
  /** Title size, 1 = thumbnail size. It shrinks by itself when the title is long. */
  size: number;
  position: ThumbPosition;
  align: 'left' | 'center';
  color: string;
  accent: string;
  uppercase: boolean;
  /** Slight slant of the title, a classic of video thumbnails. */
  tilt: boolean;
}

export interface ThumbnailSettings extends TitleStyle {
  format: AspectFormat;
  /** Point of the picture kept in the middle of the frame (0..1 of the turned picture). */
  x: number;
  y: number;
  /** 1 = the picture just fills the frame. */
  zoom: number;
  rotation: Rotation;
  /** Color corrections, 1 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Darkens the edges and the side of the title so it stays readable (0..1). */
  shade: number;
}

/** Recommended upload sizes: YouTube (1280×720), Shorts / TikTok / Reels cover, square post. */
export const THUMB_SIZES: Record<AspectFormat, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

export function defaultThumbnail(text: string): ThumbnailSettings {
  return {
    format: '16:9',
    x: 0.5,
    y: 0.5,
    zoom: 1,
    rotation: 0,
    brightness: 1.05,
    contrast: 1.1,
    saturation: 1.25,
    shade: 0.5,
    text,
    style: 'outline',
    size: 1,
    position: 'bottom',
    align: 'center',
    color: '#ffffff',
    accent: '#ffd60a',
    uppercase: true,
    tilt: false,
  };
}

export interface TitleWord {
  text: string;
  accent: boolean;
  /** The user started a new line before this word. */
  newLine: boolean;
}

/** Splits the title into words. Text between *asterisks* (one or several words) is the accent. */
export function parseTitle(text: string): TitleWord[] {
  const words: TitleWord[] = [];
  let accent = false;
  text.split('\n').forEach((line, i) => {
    let newLine = i > 0;
    for (const token of line.split(/\s+/).filter(Boolean)) {
      if (/^\*+$/.test(token)) {
        accent = !accent;
        continue;
      }
      const word = token.replace(/\*/g, '');
      if (token.startsWith('*')) accent = true;
      if (word) {
        words.push({ text: word, accent, newLine });
        newLine = false;
      }
      if (token.endsWith('*')) accent = false;
    }
  });
  return words;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Part of the turned picture shown in the frame, as fractions of its width and height. */
export function visibleFraction(imgW: number, imgH: number, s: ThumbnailSettings, outW: number, outH: number): { fx: number; fy: number } {
  const turned = rotatedSize(imgW, imgH, s.rotation);
  let sw = turned.width;
  let sh = turned.height;
  if (sw / sh > outW / outH) sw = sh * (outW / outH);
  else sh = sw / (outW / outH);
  return { fx: sw / s.zoom / turned.width, fy: sh / s.zoom / turned.height };
}

/** Draws the whole thumbnail on a canvas of outW×outH pixels. */
export function drawThumbnail(ctx: Ctx2D, image: CanvasImageSource, imgW: number, imgH: number, s: ThumbnailSettings, outW: number, outH: number): void {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);

  // The picture: turned, cropped around (x, y), zoomed and color-boosted in one draw.
  const turned = rotatedSize(imgW, imgH, s.rotation);
  const { fx, fy } = visibleFraction(imgW, imgH, s, outW, outH);
  const sw = fx * turned.width;
  const sh = fy * turned.height;
  const sx = clamp(s.x * turned.width - sw / 2, 0, turned.width - sw);
  const sy = clamp(s.y * turned.height - sh / 2, 0, turned.height - sh);
  const k = outW / sw;
  const [a, b, c, d, e, f] = rotationMatrix(imgW, imgH, s.rotation);
  ctx.filter = `brightness(${s.brightness}) contrast(${s.contrast}) saturate(${s.saturation})`;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(k * a, k * b, k * c, k * d, k * (e - sx), k * (f - sy));
  ctx.drawImage(image, 0, 0, imgW, imgH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';

  const hasTitle = parseTitle(s.text).length > 0;
  if (s.shade > 0) {
    const vignette = ctx.createRadialGradient(outW / 2, outH / 2, Math.min(outW, outH) * 0.3, outW / 2, outH / 2, Math.hypot(outW, outH) / 2);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, `rgba(0, 0, 0, ${0.6 * s.shade})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, outW, outH);
    if (hasTitle && s.position !== 'center') {
      const top = s.position === 'top';
      const side = ctx.createLinearGradient(0, top ? 0 : outH, 0, top ? outH * 0.65 : outH * 0.35);
      side.addColorStop(0, `rgba(0, 0, 0, ${0.7 * s.shade})`);
      side.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = side;
      ctx.fillRect(0, 0, outW, outH);
    }
  }
  drawTitle(ctx, s, outW, outH);
  ctx.restore();
}

interface PlacedWord extends TitleWord {
  width: number;
}

/** Free texts shown at source time `t`; with `fade`, they fade in and out over 0.2 s. */
export function drawTexts(ctx: Ctx2D, texts: TextOverlay[], t: number, outW: number, outH: number, fade = true): void {
  for (const text of texts) {
    if (t < text.start || t >= text.end) continue;
    ctx.save();
    if (fade) ctx.globalAlpha = Math.max(0, Math.min(1, (t - text.start) / 0.2, (text.end - t) / 0.2));
    drawTitle(ctx, text, outW, outH);
    ctx.restore();
  }
}

/** Draws a title (its *starred* words in the accent color), shrinking it until it fits. */
export function drawTitle(ctx: Ctx2D, s: TitleStyle, outW: number, outH: number): void {
  const words = parseTitle(s.uppercase ? s.text.toLocaleUpperCase() : s.text);
  if (!words.length) return;
  const maxWidth = outW * (s.align === 'center' ? 0.88 : 0.84);
  const maxHeight = outH * (s.position === 'center' ? 0.7 : 0.5);
  const font = (px: number) => `800 ${px}px "${CAPTION_FONT}", "Arial Black", system-ui, sans-serif`;

  // Largest size that fits: long titles shrink instead of leaving the frame.
  let size = Math.round(Math.min(outW, outH) * 0.15 * s.size);
  let lines: PlacedWord[][] = [];
  let space = 0;
  for (let attempt = 0; attempt < 24; attempt++) {
    ctx.font = font(size);
    space = ctx.measureText(' ').width;
    lines = [];
    let width = 0;
    let fits = true;
    for (const w of words) {
      const placed = { ...w, width: ctx.measureText(w.text).width };
      if (placed.width > maxWidth) fits = false;
      const line = lines[lines.length - 1];
      if (!line || w.newLine || width + space + placed.width > maxWidth) {
        lines.push([placed]);
        width = placed.width;
      } else {
        line.push(placed);
        width += space + placed.width;
      }
    }
    if (fits && lines.length * size * 1.08 <= maxHeight) break;
    size = Math.max(12, Math.round(size * 0.92));
  }

  const lineHeight = size * 1.08;
  const blockHeight = lines.length * lineHeight;
  const margin = outH * 0.07;
  const top = s.position === 'top' ? margin : s.position === 'center' ? (outH - blockHeight) / 2 : outH - margin - blockHeight;
  const left = outW * 0.06;

  ctx.save();
  if (s.tilt) {
    ctx.translate(outW / 2, top + blockHeight / 2);
    ctx.rotate(-0.05);
    ctx.translate(-outW / 2, -(top + blockHeight / 2));
  }
  ctx.font = font(size);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const pad = size * 0.16;
  const box = (x: number, baseline: number, width: number) => {
    ctx.beginPath();
    ctx.roundRect(x - pad, baseline - size * 0.84, width + pad * 2, size * 1.02, size * 0.14);
    ctx.fill();
  };

  lines.forEach((line, i) => {
    const total = line.reduce((n, w) => n + w.width, 0) + space * (line.length - 1);
    const xs: number[] = [];
    let cursor = s.align === 'center' ? (outW - total) / 2 : left;
    for (const w of line) {
      xs.push(cursor);
      cursor += w.width + space;
    }
    const baseline = top + i * lineHeight + size * 0.86;
    if (s.style === 'box') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      box(xs[0], baseline, total);
    }
    if (s.style === 'highlight') {
      // One marker stroke per run of highlighted words on the line.
      ctx.fillStyle = s.accent;
      for (let j = 0; j < line.length; j++) {
        if (!line[j].accent) continue;
        let k = j;
        while (k + 1 < line.length && line[k + 1].accent) k++;
        box(xs[j], baseline, xs[k] + line[k].width - xs[j]);
        j = k;
      }
    }
    line.forEach((w, j) => {
      const x = xs[j];
      ctx.save();
      const marked = s.style === 'highlight' && w.accent;
      if (s.style === 'shadow') {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = size * 0.3;
        ctx.shadowOffsetY = size * 0.06;
      } else if (s.style !== 'box' && !marked) {
        // A thick dark outline: readable on any picture, even at the size of a phone feed.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
        ctx.shadowBlur = size * 0.12;
        ctx.shadowOffsetY = size * 0.04;
        ctx.lineWidth = size * 0.18;
        ctx.strokeStyle = '#000';
        ctx.strokeText(w.text, x, baseline);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = marked ? '#111' : w.accent ? s.accent : s.color;
      ctx.fillText(w.text, x, baseline);
      ctx.restore();
    });
  });
  ctx.restore();
}

/**
 * How good a still looks as a thumbnail: sharp (variance of the Laplacian), well exposed and
 * contrasted. Computed on a small grayscale version of the frame.
 */
export function frameScore(data: Uint8ClampedArray, width: number, height: number): number {
  const gray = new Float32Array(width * height);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
    gray[i] = v;
    sum += v;
  }
  const mean = sum / gray.length;
  let variance = 0;
  let lap = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      lap += l;
      lapSq += l * l;
      n++;
    }
  }
  for (const v of gray) variance += (v - mean) ** 2;
  const sharpness = n ? lapSq / n - (lap / n) ** 2 : 0;
  const contrast = Math.sqrt(variance / gray.length);
  return Math.log10(1 + sharpness * 1e4) + contrast * 2 - Math.abs(mean - 0.48) * 3;
}

/** File name for the downloaded image, from the title. */
export function thumbnailName(text: string, fallback: string, ext: 'jpg' | 'png'): string {
  const slug =
    text
      .replace(/\*/g, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback;
  return `${slug}-thumbnail.${ext}`;
}
