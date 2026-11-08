import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Remote } from 'comlink';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { db, getClipFile } from '../core/db';
import { downloadBlob, queryReadPermission, requestReadPermission } from '../core/file-access';
import { IMAGE_MODELS, type ImageModelId } from '../core/image-models';
import { WorkersService, proxy } from '../core/workers.service';
import { ProgressEaser } from '../engine/progress';
import { FLUX_STEPS, fluxSize } from '../engine/flux';
import { sanaSize } from '../engine/sana';
import type { ImageProgress, ImageWorkerApi } from '../workers/worker-types';
import { type AspectFormat, type Project, type Rotation, migrateProject } from '../engine/model';
import { type Ctx2D, loadCaptionFont, rotatedSize, rotationMatrix } from '../engine/render';
import { placeClips } from '../engine/sequence';
import {
  THUMB_SIZES,
  type ThumbPosition,
  type ThumbStyle,
  type ThumbnailSettings,
  defaultThumbnail,
  drawThumbnail,
  frameScore,
  thumbnailName,
  visibleFraction,
} from '../engine/thumbnail';
import { formatTime } from '../engine/timeline-math';
import { Icon } from '../shared/icon';
import { DownloadProgress } from '../shared/download-progress';
import { LocalizePipe } from '../shared/localize';
import { ReportDownload } from '../shared/report-download';

interface Source {
  kind: 'video' | 'image';
  url: string;
  name: string;
}

/** A generated picture of the history. */
interface AiImage {
  id: number;
  url: string;
  blob: Blob;
  prompt: string;
  format: AspectFormat;
  model: ImageModelId;
}

interface Still {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** A suggested moment: its time and a small unrotated frame. */
interface Moment {
  t: number;
  frame: HTMLCanvasElement;
}

const PREVIEW_LONG_SIDE = 960;
const MOMENTS = 8;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;

/** Share of the generation reached at the end of each phase. */
const AI_PHASES: Record<ImageModelId, { text: number; steps: number; count: number; firstStepMs?: number }> = {
  sana: { text: 0.2, steps: 0.7, count: 2 },
  // Reading the text is short: the pace it gives would make the first step look stuck.
  flux: { text: 0.1, steps: 0.97, count: FLUX_STEPS, firstStepMs: 90_000 },
};
const AI_MODEL_KEY = 'lcv-ai-image-model';
const AI_TICK_MS = 200;

/** Generated pictures kept on this device. */
const AI_HISTORY = 24;

/** What the browser says when it cannot keep the model: disk full, or a private window. */
const MODEL_STORAGE_FAILURE = /on 'Cache'|quota/i;

/** What Transformers.js and the browser say when Hugging Face refuses or cannot serve the model. */
const MODEL_DOWNLOAD_FAILURE = /huggingface\.co\/|Failed to fetch|NetworkError/i;

/**
 * What the image model needs, whatever the browser: WebGPU with 16-bit floats (its weights use
 * them), on a computer's graphics card (phones run out of memory).
 */
async function hasImageGpu(): Promise<boolean> {
  if (/iPhone|iPad|iPod|Android/.test(navigator.userAgent)) return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = await gpu?.requestAdapter().catch(() => null);
  return !!adapter?.features.has('shader-f16');
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Waits for the next `seeked` of a video after moving it to `t`. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    video.addEventListener('seeked', () => resolve(), { once: true });
    video.currentTime = t;
  });
}

/**
 * Thumbnail maker. Picks a still from a video (suggesting its sharpest moments) or takes an
 * image, then adds a big title, color boost and framing, and downloads a JPG or PNG at the
 * size each platform expects. Opened from a project, it uses that project's video, rotation
 * and format. Everything is drawn on this device, nothing is uploaded.
 */
@Component({
  selector: 'app-thumbnail',
  imports: [TranslocoPipe, Icon, RouterLink, NgTemplateOutlet, LocalizePipe, DownloadProgress, ReportDownload],
  templateUrl: './thumbnail.html',
  styleUrl: './thumbnail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class Thumbnail {
  /** Project to take the video from (/thumbnail/:id) and its sequence time (?t=). */
  readonly id = input<string>();
  readonly t = input<string>();

  private readonly transloco = inject(TranslocoService);
  private readonly workers = inject(WorkersService);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly formatTime = formatTime;
  protected readonly formats: { id: AspectFormat; icon: string; key: string }[] = [
    { id: '16:9', icon: 'ratio-16-9', key: 'landscape' },
    { id: '9:16', icon: 'ratio-9-16', key: 'vertical' },
    { id: '1:1', icon: 'ratio-1-1', key: 'square' },
  ];
  protected readonly sizes = THUMB_SIZES;
  protected readonly styles: ThumbStyle[] = ['outline', 'shadow', 'box', 'highlight'];
  protected readonly positions: ThumbPosition[] = ['top', 'center', 'bottom'];
  protected readonly colors = ['#ffffff', '#ffd60a', '#111111'];
  protected readonly accents = ['#ffd60a', '#ff4d8d', '#39ff88', '#4dd8ff', '#ff7a1a'];

  protected readonly source = signal<Source | null>(null);
  protected readonly still = signal<Still | null>(null);
  protected readonly settings = signal<ThumbnailSettings>(defaultThumbnail(''));
  protected readonly duration = signal(0);
  protected readonly time = signal(0);
  protected readonly moments = signal<Moment[]>([]);
  protected readonly scanning = signal(false);
  protected readonly dragging = signal(false);
  protected readonly saved = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  /** The model used for the next picture. */
  protected readonly aiModel = signal<ImageModelId>('sana');
  protected readonly aiInfo = computed(() => IMAGE_MODELS[this.aiModel()]);
  protected readonly aiSupported = signal(false);
  protected readonly aiPrompt = signal('');
  protected readonly aiProgress = signal<ImageProgress | null>(null);
  /** The picture on screen comes from the AI: it can be generated again. */
  protected readonly aiGenerated = signal(false);
  /** The generated pictures, most recent first. */
  protected readonly aiImages = signal<AiImage[]>([]);
  protected readonly aiActive = signal<number | null>(null);
  protected readonly aiOutputSize = computed(() => (this.aiModel() === 'flux' ? fluxSize(this.settings().format) : sanaSize(this.settings().format)));

  protected readonly project = signal<Project | null>(null);
  protected readonly loadingProject = signal(false);
  /** The project's video needs a click to be read again (browser permission). */
  protected readonly permission = signal<{ handle: FileSystemFileHandle; at: number } | null>(null);

  protected readonly previewSize = computed(() => {
    const { width, height } = THUMB_SIZES[this.settings().format];
    const k = PREVIEW_LONG_SIDE / Math.max(width, height);
    return { width: Math.round(width * k), height: Math.round(height * k) };
  });
  /** Suggested moments drawn with the current rotation. */
  protected readonly momentUrls = computed(() => {
    const rotation = this.settings().rotation;
    return this.moments().map((m) => ({ t: m.t, url: turnedUrl(m.frame, rotation) }));
  });

  protected readonly skeletons = computed(() =>
    this.scanning() ? Array.from({ length: Math.max(0, MOMENTS - this.moments().length) }, (_, i) => i) : [],
  );

  private readonly fontReady = signal(false);
  private textTouched = false;
  private aiCancelled = false;
  private scanToken = 0;
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;
  private savedTimer = 0;
  private holdTimer = 0;

  constructor() {
    afterNextRender(() => void loadCaptionFont(document.fonts, location.origin).then(() => this.fontReady.set(true)));

    // Opened from a project: load it and its video at the editor's playhead.
    effect(() => {
      const id = this.id();
      if (id) untracked(() => void this.loadProject(id, Number(this.t()) || 0));
    });

    // Live preview.
    effect(() => {
      const s = this.settings();
      const still = this.still();
      const { width, height } = this.previewSize();
      this.fontReady();
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas || !still) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      drawThumbnail(canvas.getContext('2d') as unknown as Ctx2D, still.image, still.width, still.height, s, width, height);
    });

    afterNextRender(() => {
      void hasImageGpu().then((ok) => this.aiSupported.set(ok));
      this.restoreAiModel();
      void this.loadAiImages();
    });

    inject(DestroyRef).onDestroy(() => {
      this.workers.releaseImage();
      this.aiImages().forEach((image) => URL.revokeObjectURL(image.url));
      this.scanToken++;
      clearTimeout(this.savedTimer);
      clearTimeout(this.holdTimer);
      const url = this.source()?.url;
      if (url) URL.revokeObjectURL(url);
    });
  }

  // Sources ----------------------------------------------------------------------------------------

  private async loadProject(id: string, t: number): Promise<void> {
    this.loadingProject.set(true);
    try {
      const raw = await db.projects.get(id);
      if (!raw) return;
      const project = migrateProject(raw);
      this.project.set(project);
      this.patch({ rotation: project.rotation, format: project.format });
      const clips = placeClips(project.clips);
      const clip = clips.find((c) => t >= c.start && t < c.end) ?? clips[0];
      if (!clip) return;
      const stored = await getClipFile(id, clip.id);
      const at = Math.max(0, t - clip.start);
      if (!stored?.handle) return;
      if ((await queryReadPermission(stored.handle)) !== 'granted') {
        this.permission.set({ handle: stored.handle, at });
        return;
      }
      this.open(await stored.handle.getFile(), at);
    } catch {
      this.error.set('thumbnail.loadError');
    } finally {
      this.loadingProject.set(false);
    }
  }

  /** Must run from a click: browsers only grant file access on a user gesture. */
  protected async grant(): Promise<void> {
    const pending = this.permission();
    if (!pending || !(await requestReadPermission(pending.handle))) return;
    this.permission.set(null);
    this.open(await pending.handle.getFile(), pending.at);
  }

  protected onFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.open(file);
    input.value = '';
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(false);
    const file = e.dataTransfer?.files[0];
    if (file) this.open(file);
  }

  protected onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragging.set(true);
  }

  private open(file: File, at = 0): void {
    const old = this.source()?.url;
    if (old) URL.revokeObjectURL(old);
    this.scanToken++;
    this.error.set(null);
    this.aiGenerated.set(false);
    this.aiActive.set(null);
    this.still.set(null);
    this.moments.set([]);
    const kind = file.type.startsWith('image/') || IMAGE_FILE.test(file.name) ? 'image' : 'video';
    const url = URL.createObjectURL(file);
    this.source.set({ kind, url, name: file.name.replace(/\.[^.]+$/, '') });
    this.time.set(at);
    if (!this.textTouched) this.patch({ text: this.transloco.translate('thumbnail.defaultText') });
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => this.still.set({ image: img, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => this.error.set('thumbnail.readError');
      img.src = url;
    }
  }

  protected onMetadata(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) return;
    this.duration.set(video.duration || 0);
    video.currentTime = clamp(this.time(), 0, Math.max(0, video.duration - 0.05));
    void this.scan(this.source()!.url, video.duration);
  }

  /** Keeps the shown frame as a bitmap, so the title can change without touching the video. */
  protected async capture(): Promise<void> {
    const video = this.videoRef()?.nativeElement;
    if (!video?.videoWidth) return;
    this.time.set(video.currentTime);
    const bitmap = await createImageBitmap(video);
    const previous = this.still()?.image;
    this.still.set({ image: bitmap, width: bitmap.width, height: bitmap.height });
    if (previous instanceof ImageBitmap) previous.close();
  }

  protected seek(t: number): void {
    const video = this.videoRef()?.nativeElement;
    if (!video) return;
    const time = clamp(t, 0, Math.max(0, this.duration() - 0.05));
    this.time.set(time);
    video.currentTime = time;
  }

  /** Press and hold ‹ › to scroll through the frames: one by one, then faster and faster. */
  protected startHold(direction: 1 | -1, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.stopHold();
    let steps = 0;
    const tick = () => {
      steps++;
      const frames = steps < 12 ? 1 : steps < 30 ? 3 : 8;
      this.seek(this.time() + (direction * frames) / 30);
      this.holdTimer = window.setTimeout(tick, steps === 1 ? 400 : 70);
    };
    tick();
  }

  protected stopHold(): void {
    clearTimeout(this.holdTimer);
    this.holdTimer = 0;
  }

  /** Enter / Space on the buttons (a pointer press is already handled by the hold). */
  protected stepFromKeyboard(direction: 1 | -1, e: MouseEvent): void {
    if (e.detail === 0) this.seek(this.time() + direction / 30);
  }

  /** ← → move one frame, with Shift one second (outside of text fields). */
  protected onKey(e: KeyboardEvent): void {
    if (this.source()?.kind !== 'video' || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    this.seek(this.time() + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30));
  }

  protected isCurrent(t: number): boolean {
    return Math.abs(t - this.time()) < 0.05;
  }

  protected onScrub(e: Event): void {
    this.seek(Number((e.target as HTMLInputElement).value));
  }

  /**
   * Suggests the best stills: the video is split into MOMENTS parts and, in each, the sharpest
   * and best exposed of three frames is kept. Runs on a second, hidden video element.
   */
  private async scan(url: string, duration: number): Promise<void> {
    if (!duration || !isFinite(duration)) return;
    const token = ++this.scanToken;
    this.scanning.set(true);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('READ'));
      });
      const width = 192;
      const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
      const probe = document.createElement('canvas');
      probe.width = width;
      probe.height = height;
      const ctx = probe.getContext('2d', { willReadFrequently: true })!;
      const found: Moment[] = [];
      for (let i = 0; i < MOMENTS; i++) {
        const from = duration * (0.03 + (0.94 * i) / MOMENTS);
        const to = duration * (0.03 + (0.94 * (i + 1)) / MOMENTS);
        let best: { t: number; score: number; frame: HTMLCanvasElement } | null = null;
        for (const f of [0.2, 0.5, 0.8]) {
          if (token !== this.scanToken) return;
          const t = from + (to - from) * f;
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, width, height);
          const score = frameScore(ctx.getImageData(0, 0, width, height).data, width, height);
          if (!best || score > best.score) {
            const frame = document.createElement('canvas');
            frame.width = width;
            frame.height = height;
            frame.getContext('2d')!.drawImage(probe, 0, 0);
            best = { t, score, frame };
          }
        }
        found.push({ t: best!.t, frame: best!.frame });
        this.moments.set([...found]);
      }
    } catch {
      // Suggestions are a bonus: the scrubber still works.
    } finally {
      if (token === this.scanToken) this.scanning.set(false);
      video.removeAttribute('src');
      video.load();
    }
  }

  // Settings ---------------------------------------------------------------------------------------

  protected patch(values: Partial<ThumbnailSettings>): void {
    this.settings.update((s) => ({ ...s, ...values }));
  }

  protected setText(e: Event): void {
    this.textTouched = true;
    this.patch({ text: (e.target as HTMLTextAreaElement).value });
  }

  protected num(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  protected checked(e: Event): boolean {
    return (e.target as HTMLInputElement).checked;
  }

  protected rotate(direction: 1 | -1): void {
    const rotation = ((((this.settings().rotation + direction * 90) % 360) + 360) % 360) as Rotation;
    this.patch({ rotation, x: 0.5, y: 0.5 });
  }

  protected resetImage(): void {
    const d = defaultThumbnail('');
    this.patch({ x: 0.5, y: 0.5, zoom: 1, brightness: d.brightness, contrast: d.contrast, saturation: d.saturation, shade: d.shade });
  }

  /** Dragging the preview moves the picture inside the frame. */
  protected onPointerDown(e: PointerEvent): void {
    if (!this.still()) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const s = this.settings();
    this.drag = { x: e.clientX, y: e.clientY, sx: s.x, sy: s.y };
  }

  protected onPointerMove(e: PointerEvent): void {
    const still = this.still();
    if (!this.drag || !still) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const { fx, fy } = visibleFraction(still.width, still.height, this.settings(), rect.width, rect.height);
    this.patch({
      x: clamp(this.drag.sx - ((e.clientX - this.drag.x) / rect.width) * fx, fx / 2, 1 - fx / 2),
      y: clamp(this.drag.sy - ((e.clientY - this.drag.y) / rect.height) * fy, fy / 2, 1 - fy / 2),
    });
  }

  protected onPointerUp(): void {
    this.drag = null;
  }

  // Download ---------------------------------------------------------------------------------------

  protected async download(type: 'jpg' | 'png'): Promise<void> {
    const still = this.still();
    if (!still) return;
    const s = this.settings();
    const { width, height } = THUMB_SIZES[s.format];
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    drawThumbnail(canvas.getContext('2d') as unknown as Ctx2D, still.image, still.width, still.height, s, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    if (!blob) return;
    const name = thumbnailName(s.text, this.source()?.name ?? 'video', type);
    downloadBlob(blob, name);
    this.saved.set(name);
    clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => this.saved.set(null), 4000);
  }

  // AI picture ------------------------------------------------------------------------------------

  protected setPrompt(e: Event): void {
    this.aiPrompt.set((e.target as HTMLTextAreaElement).value);
  }

  protected async generate(): Promise<void> {
    const prompt = this.aiPrompt().trim();
    if (!prompt || this.aiProgress()) return;
    this.error.set(null);
    this.aiProgress.set({ stage: 'download', progress: 0 });
    this.aiCancelled = false;
    const format = this.settings().format;
    const model = this.aiModel();
    const plan = AI_PHASES[model];
    const stepEnd = (done: number) => plan.text + ((plan.steps - plan.text) * done) / plan.count;
    const easer = new ProgressEaser();
    const ticker = setInterval(() => {
      if (this.aiProgress()?.stage === 'generate') this.aiProgress.set({ stage: 'generate', progress: easer.value(performance.now()) });
    }, AI_TICK_MS);
    const report = (progress: number, next: number, expectedMs?: number) => {
      const now = performance.now();
      easer.report(progress, next, now, expectedMs);
      this.aiProgress.set({ stage: 'generate', progress: easer.value(now) });
    };
    try {
      await this.aiPhase((w) => w.download(model, proxy((p: ImageProgress) => this.aiProgress.set(p))));
      report(0, plan.text);
      const states = await this.aiPhase((w) => w.encode(model, prompt));
      report(plan.text, stepEnd(1), plan.firstStepMs);
      const latents = await this.aiPhase((w) =>
        w.denoise(model, states, format, proxy((done: number) => {
          if (done < plan.count) report(stepEnd(done), stepEnd(done + 1));
        })),
      );
      report(plan.steps, 1);
      const blob = await this.aiPhase((w) => w.decode(model, latents, format));
      this.show(await this.keepAiImage(blob, prompt, format, model));
    } catch (e) {
      if (this.aiCancelled || String((e as Error)?.message).includes('CANCELLED')) return;
      console.error('Image generation failed', e);
      const message = String((e as Error)?.message ?? e);
      this.error.set(MODEL_STORAGE_FAILURE.test(message) ? 'thumbnail.ai.storageError' : MODEL_DOWNLOAD_FAILURE.test(message) ? 'thumbnail.ai.downloadError' : 'thumbnail.ai.error');
    } finally {
      clearInterval(ticker);
      this.aiProgress.set(null);
    }
  }

  protected show(image: AiImage): void {
    this.open(new File([image.blob], 'ai.png', { type: 'image/png' }));
    this.patch({ format: image.format });
    this.aiPrompt.set(image.prompt);
    this.aiModel.set(image.model);
    this.aiGenerated.set(true);
    this.aiActive.set(image.id);
  }

  protected async removeAiImage(image: AiImage): Promise<void> {
    await db.aiImages.delete(image.id);
    URL.revokeObjectURL(image.url);
    this.aiImages.update((images) => images.filter((i) => i.id !== image.id));
    if (this.aiActive() === image.id) this.aiActive.set(null);
  }

  protected setAiModel(model: ImageModelId): void {
    this.aiModel.set(model);
    try {
      localStorage.setItem(AI_MODEL_KEY, model);
    } catch {
      // Private mode: back to the default on the next visit.
    }
  }

  private restoreAiModel(): void {
    try {
      if (localStorage.getItem(AI_MODEL_KEY) === 'flux') this.aiModel.set('flux');
    } catch {
      // Private mode: the default model.
    }
  }

  private toAiImage(id: number, blob: Blob, prompt: string, format: AspectFormat, model: ImageModelId): AiImage {
    return { id, url: URL.createObjectURL(blob), blob, prompt, format, model };
  }

  private async loadAiImages(): Promise<void> {
    const stored = await db.aiImages.orderBy('createdAt').reverse().limit(AI_HISTORY).toArray();
    this.aiImages.set(stored.map((s) => this.toAiImage(s.id!, s.blob, s.prompt, s.format, s.model ?? 'sana')));
  }

  /** Saves a new picture; the oldest ones beyond the limit are dropped. */
  private async keepAiImage(blob: Blob, prompt: string, format: AspectFormat, model: ImageModelId): Promise<AiImage> {
    const id = await db.aiImages.add({ blob, prompt, format, model, createdAt: Date.now() });
    const image = this.toAiImage(id, blob, prompt, format, model);
    const kept = [image, ...this.aiImages()];
    for (const old of kept.slice(AI_HISTORY)) {
      await db.aiImages.delete(old.id);
      URL.revokeObjectURL(old.url);
    }
    this.aiImages.set(kept.slice(0, AI_HISTORY));
    return image;
  }

  protected cancelGeneration(): void {
    this.aiCancelled = true;
    void this.workers.image.cancel();
  }

  /** Runs one phase in a fresh worker and ends it: only that gives the graphics memory back. */
  private async aiPhase<T>(run: (worker: Remote<ImageWorkerApi>) => Promise<T>): Promise<T> {
    if (this.aiCancelled) throw new Error('CANCELLED');
    try {
      return await run(this.workers.image);
    } finally {
      this.workers.releaseImage();
    }
  }

  protected startOver(): void {
    const url = this.source()?.url;
    if (url) URL.revokeObjectURL(url);
    this.scanToken++;
    this.source.set(null);
    this.still.set(null);
    this.moments.set([]);
  }
}

/** A small frame turned by `rotation`, as an image URL for the suggestions strip. */
function turnedUrl(frame: HTMLCanvasElement, rotation: Rotation): string {
  if (!rotation) return frame.toDataURL('image/jpeg', 0.75);
  const { width, height } = rotatedSize(frame.width, frame.height, rotation);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(...rotationMatrix(frame.width, frame.height, rotation));
  ctx.drawImage(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.75);
}
