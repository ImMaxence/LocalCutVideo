import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { envelopeAt } from '../../engine/audio-analysis';
import { type Ctx2D, drawCaptions, drawFrame, framingAt, loadCaptionFont, outputSize } from '../../engine/render';
import { clipIndexAt } from '../../engine/sequence';
import { formatTime, nextKeptTime, segmentIndexAt, sourceToOutput } from '../../engine/timeline-math';
import { Icon } from '../../shared/icon';
import { EditorStore, type PlayerApi } from '../editor.store';

interface VideoSource {
  id: string;
  url: string;
}

/**
 * Live preview. One hidden <video> per clip plays the sequence back to back; every animation
 * frame is composed on a canvas with the same render functions as the export worker (crop,
 * framing, zoom, captions). Playback jumps over cuts, and the music follows the ducking curve.
 * The clips' sound goes through Web Audio (volume per clip, then a limiter), so the volume can
 * be raised above 100 % without clipping, like in the export.
 */
@Component({
  selector: 'app-preview',
  imports: [TranslocoPipe, Icon],
  templateUrl: './preview.html',
  styleUrl: './preview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Preview implements PlayerApi {
  protected readonly store = inject(EditorStore);
  private readonly transloco = inject(TranslocoService);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly videoRefs = viewChildren<ElementRef<HTMLVideoElement>>('video');
  private readonly musicRef = viewChild.required<ElementRef<HTMLAudioElement>>('music');

  protected readonly formatTime = formatTime;
  protected readonly outputTime = computed(() => sourceToOutput(this.store.segments(), this.store.currentTime()));
  /** The preview is drawn at a reduced resolution to stay light; the export uses the full one. */
  protected readonly size = computed(() => outputSize(this.store.project()?.format ?? '16:9', this.store.previewQuality()));
  protected readonly qualities = [360, 540, 720] as const;
  protected readonly videos = signal<VideoSource[]>([]);
  protected readonly musicUrl = computed(() => {
    const file = this.store.musicFile();
    return file ? URL.createObjectURL(file) : null;
  });

  private readonly urls = new Map<string, { file: File; url: string }>();
  private active = 0;
  private isPlaying = false;
  private dirty = true;
  private raf = 0;
  private lastSync = 0;
  private lastFrameTime = -1;
  private audio: { ctx: AudioContext; out: AudioNode; gains: WeakMap<HTMLVideoElement, GainNode> } | null = null;

  constructor() {
    // One object URL per clip file, revoked when the clip goes away.
    effect(() => {
      const files = this.store.clipFiles();
      for (const [id, entry] of this.urls) {
        if (files.get(id) !== entry.file) {
          URL.revokeObjectURL(entry.url);
          this.urls.delete(id);
        }
      }
      for (const [id, file] of files) {
        if (!this.urls.has(id)) this.urls.set(id, { file, url: URL.createObjectURL(file) });
      }
      this.videos.set([...this.urls].map(([id, entry]) => ({ id, url: entry.url })));
    });
    effect((onCleanup) => {
      const url = this.musicUrl();
      onCleanup(() => url && URL.revokeObjectURL(url));
    });
    // Redraw whenever the edit changes while paused.
    effect(() => {
      this.store.project();
      this.store.captionPages();
      this.size();
      this.dirty = true;
    });

    afterNextRender(() => {
      this.store.registerPlayer(this);
      void loadCaptionFont(document.fonts, location.origin).then(() => (this.dirty = true));
      const loop = () => {
        this.tick();
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });

    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.raf);
      void this.audio?.ctx.close();
      this.store.registerPlayer(null);
      this.urls.forEach((entry) => URL.revokeObjectURL(entry.url));
    });
  }

  private element(index: number): HTMLVideoElement | undefined {
    const id = this.store.clips()[index]?.id;
    return this.videoRefs().find((ref) => ref.nativeElement.dataset['clip'] === id)?.nativeElement;
  }

  private sequenceTime(): number {
    const clip = this.store.clips()[this.active];
    return clip ? clip.start + (this.element(this.active)?.currentTime ?? 0) : 0;
  }

  // PlayerApi --------------------------------------------------------------------------------

  seek(t: number): void {
    const clips = this.store.clips();
    if (!clips.length) return;
    const index = clipIndexAt(clips, t);
    if (index !== this.active) {
      this.element(this.active)?.pause();
      this.active = index;
    }
    const video = this.element(index);
    if (video) {
      video.currentTime = Math.max(0, t - clips[index].start);
      if (this.isPlaying) {
        this.syncVolume();
        void video.play().catch(() => undefined);
      }
    }
    this.store.currentTime.set(t);
    this.dirty = true;
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  private play(): void {
    const segments = this.store.segments();
    if (!segments.length) return;
    let t = this.sequenceTime();
    if (nextKeptTime(segments, t + 0.05) === null) t = segments[0].start;
    this.isPlaying = true;
    this.store.playing.set(true);
    this.seek(t);
  }

  private pause(): void {
    this.isPlaying = false;
    this.store.playing.set(false);
    this.element(this.active)?.pause();
    this.musicRef().nativeElement.pause();
    this.store.currentTime.set(this.sequenceTime());
    this.dirty = true;
  }

  // Render loop --------------------------------------------------------------------------------

  private tick(): void {
    const clips = this.store.clips();
    const video = this.element(this.active);
    if (this.isPlaying && video && clips.length) {
      const clip = clips[this.active];
      const t = this.sequenceTime();
      if (video.ended || video.currentTime >= clip.end - clip.start - 0.04) {
        // End of this clip: continue with the next one, or stop at the end of the sequence.
        if (this.active < clips.length - 1) this.seek(clips[this.active + 1].start);
        else this.pause();
      } else {
        const segments = this.store.segments();
        const next = nextKeptTime(segments, t);
        if (next === null) this.pause();
        else if (next > t + 0.02) this.seek(next);
      }
      if (this.isPlaying) {
        // The rest of the UI (transcript, timeline, clock) only needs ~25 updates per second.
        const now = performance.now();
        if (now - this.lastSync > 40) {
          this.lastSync = now;
          this.store.currentTime.set(this.sequenceTime());
        }
        this.syncMusic();
        this.syncVolume();
      }
      // Only redraw when the video actually shows a new frame (not on every screen refresh).
      if (video.currentTime !== this.lastFrameTime) this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.lastFrameTime = video?.currentTime ?? -1;
      this.draw(this.isPlaying ? this.sequenceTime() : this.store.currentTime());
    }
  }

  /**
   * Routes a clip's <video> through its gain node. The audio context is created on the first
   * play (a user gesture), and an element can only be routed once, so the nodes are kept.
   */
  private route(video: HTMLVideoElement): GainNode | null {
    try {
      if (!this.audio) {
        const ctx = new AudioContext();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        limiter.connect(ctx.destination);
        this.audio = { ctx, out: limiter, gains: new WeakMap() };
      }
      let gain = this.audio.gains.get(video);
      if (!gain) {
        gain = this.audio.ctx.createGain();
        this.audio.ctx.createMediaElementSource(video).connect(gain).connect(this.audio.out);
        this.audio.gains.set(video, gain);
      }
      if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume();
      return gain;
    } catch {
      return null;
    }
  }

  /** Applies the volume of the playing clip (overall volume × leveling). */
  private syncVolume(): void {
    const video = this.element(this.active);
    const clip = this.store.clips()[this.active];
    if (!video || !clip) return;
    const gain = this.store.clipGains().get(clip.id) ?? 1;
    const node = this.route(video);
    if (!node) video.volume = Math.min(1, gain);
    else if (node.gain.value !== gain) node.gain.value = gain;
  }

  private syncMusic(): void {
    const music = this.musicRef().nativeElement;
    const envelope = this.store.musicEnvelope();
    if (!envelope || !music.duration) {
      if (!music.paused) music.pause();
      return;
    }
    const outT = sourceToOutput(this.store.segments(), this.sequenceTime());
    const expected = outT % music.duration;
    if (Math.abs(music.currentTime - expected) > 0.3) music.currentTime = expected;
    music.volume = Math.min(1, Math.max(0, envelopeAt(envelope, outT)));
    if (music.paused) void music.play().catch(() => undefined);
  }

  private draw(t: number): void {
    const p = this.store.project();
    const canvas = this.canvasRef().nativeElement;
    if (!p) return;
    const { width, height } = this.size();
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    const segments = this.store.segments();
    const video = this.element(this.active);
    if (video && video.readyState >= 2 && video.videoWidth) {
      drawFrame(ctx, video, video.videoWidth, video.videoHeight, width, height, framingAt(p, this.store.zoomBeats(), t), p.rotation);
    }
    drawCaptions(ctx, this.store.captionPages(), t, p.captions, width, height);

    // Paused inside a cut: show it, so scrubbing the timeline stays understandable.
    if (!this.isPlaying && segments.length && segmentIndexAt(segments, t) === -1) {
      ctx.fillStyle = 'rgba(232, 51, 107, 0.22)';
      ctx.fillRect(0, 0, width, height);
      const size = Math.round(Math.min(width, height) * 0.032);
      const label = `✂ ${this.transloco.translate('editor.preview.cut')}`;
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      const pad = size * 0.6;
      const w = ctx.measureText(label).width + pad * 2;
      ctx.fillStyle = '#e8336b';
      ctx.beginPath();
      ctx.roundRect(size, size, w, size * 1.9, size);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, size + pad, size * 2.3);
    }
  }

  protected markDirty(): void {
    this.dirty = true;
  }

  protected step(seconds: number): void {
    this.store.seek(this.store.currentTime() + seconds);
  }
}
