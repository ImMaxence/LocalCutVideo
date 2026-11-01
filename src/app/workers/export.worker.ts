/// <reference lib="webworker" />
/**
 * Export worker: reads the clips of the sequence one after the other, renders the edit frame
 * by frame on an OffscreenCanvas (crop, framing, captions), encodes it with the browser's
 * hardware encoder through WebCodecs, mixes the audio (kept segments + ducked background
 * music) and muxes an MP4 with Mediabunny.
 * When a file handle is given, the MP4 is streamed straight to disk instead of RAM.
 */
import * as Comlink from 'comlink';
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
  type InputAudioTrack,
  type InputVideoTrack,
  type StreamTargetChunk,
} from 'mediabunny';
import { duckingEnvelope, envelopeAt } from '../engine/audio-analysis';
import { TimeStretcher } from '../engine/time-stretch';
import { drawBlurredBackground, drawCaptions, drawFrame, framingAt, loadCaptionFont, outputSize, zoomBeats } from '../engine/render';
import { PersonMask } from './person-mask';
import { TRANSITION_HALF } from '../engine/model';
import { drawTexts } from '../engine/thumbnail';
import { type Segment, buildCaptionPages, outputToSource, projectSegments, totalDuration, transitionShade } from '../engine/timeline-math';
import { Denoiser, loadRnnoise } from './denoise';
import { decodableAudioTrack } from './tracks';
import type { ExportClip, ExportProgress, ExportRequest, ExportResult, ExportWorkerApi, SoundPreview } from './worker-types';

const OUT_RATE = 48000;
const BLOCK = 4800;
const FADE = Math.round(OUT_RATE * 0.004);
/** Peak limiter: ceiling just under full scale, ~80 ms release. */
const CEILING = 0.97;
const RELEASE = 1 - Math.exp(-1 / (0.08 * OUT_RATE));

let cancelled = false;
let fontReady: Promise<void> | null = null;

/** Streaming linear-interpolation resampler for one channel. */
class LinearResampler {
  private pos = 0;
  private prev = 0;
  constructor(private readonly step: number) {}

  process(input: Float32Array): Float32Array {
    if (this.step === 1) return input;
    const out = new Float32Array(Math.ceil((input.length - this.pos) / this.step) + 2);
    let n = 0;
    let p = this.pos;
    while (p < input.length - 1) {
      const i0 = Math.floor(p);
      const frac = p - i0;
      const a = i0 < 0 ? this.prev : input[i0];
      const b = input[i0 + 1];
      out[n++] = a + (b - a) * frac;
      p += this.step;
    }
    this.pos = p - input.length;
    this.prev = input[input.length - 1] ?? this.prev;
    return out.subarray(0, n);
  }
}

/** Reads one audio sample as two planar channels (mono is duplicated). */
function readStereo(sample: AudioSample, frameOffset: number, frameCount: number): [Float32Array, Float32Array] {
  const left = new Float32Array(frameCount);
  sample.copyTo(left, { planeIndex: 0, format: 'f32-planar', frameOffset, frameCount });
  const right = new Float32Array(frameCount);
  if (sample.numberOfChannels > 1) sample.copyTo(right, { planeIndex: 1, format: 'f32-planar', frameOffset, frameCount });
  else right.set(left);
  return [left, right];
}

async function decodeMusic(file: File, maxFrames: number): Promise<[Float32Array, Float32Array] | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await decodableAudioTrack(input);
    if (!track) return null;
    const step = track.sampleRate / OUT_RATE;
    const resamplers = [new LinearResampler(step), new LinearResampler(step)];
    const parts: [Float32Array, Float32Array][] = [];
    let total = 0;
    for await (const sample of new AudioSampleSink(track).samples()) {
      const [l, r] = readStereo(sample, 0, sample.numberOfFrames);
      sample.close();
      const out: [Float32Array, Float32Array] = [resamplers[0].process(l).slice(), resamplers[1].process(r).slice()];
      parts.push(out);
      total += out[0].length;
      if (total >= maxFrames || cancelled) break;
    }
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    let offset = 0;
    for (const [l, r] of parts) {
      left.set(l, offset);
      right.set(r, offset);
      offset += l.length;
    }
    return total ? [left, right] : null;
  } finally {
    input.dispose();
  }
}

/**
 * Accumulates output audio in 100 ms blocks, mixes the music in, limits the peaks (so a raised
 * volume never clips) and hands blocks to the encoder, or keeps them (sound preview).
 */
class AudioWriter {
  private left = new Float32Array(BLOCK);
  private right = new Float32Array(BLOCK);
  private filled = 0;
  private written = 0;
  private limiter = 1;
  readonly kept: [Float32Array[], Float32Array[]] = [[], []];

  constructor(
    private readonly source: AudioSampleSource | null,
    private readonly totalFrames: number,
    private readonly music: [Float32Array, Float32Array] | null,
    private readonly envelope: Float32Array | null,
  ) {}

  async write(l: Float32Array, r: Float32Array): Promise<void> {
    let offset = 0;
    while (offset < l.length) {
      const n = Math.min(BLOCK - this.filled, l.length - offset);
      this.left.set(l.subarray(offset, offset + n), this.filled);
      this.right.set(r.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === BLOCK) await this.flush();
    }
  }

  async flush(): Promise<void> {
    const n = this.filled;
    if (!n) return;
    const data = new Float32Array(n * 2);
    for (let j = 0; j < n; j++) {
      let l = this.left[j];
      let r = this.right[j];
      if (this.music && this.envelope) {
        const g = this.written + j;
        const m = g % this.music[0].length;
        const t = g / OUT_RATE;
        const fade = Math.min(1, t / 0.5, (this.totalFrames - g) / OUT_RATE);
        const gain = envelopeAt(this.envelope, t) * Math.max(0, fade);
        l += this.music[0][m] * gain;
        r += this.music[1][m] * gain;
      }
      // Instant attack, smooth release: the gain drops on a peak and comes back slowly.
      const peak = Math.max(Math.abs(l), Math.abs(r));
      this.limiter = Math.min(peak > CEILING ? CEILING / peak : 1, this.limiter + (1 - this.limiter) * RELEASE);
      data[j] = l * this.limiter;
      data[n + j] = r * this.limiter;
    }
    if (this.source) {
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: OUT_RATE,
        timestamp: this.written / OUT_RATE,
      });
      await this.source.add(sample);
      sample.close();
    } else {
      this.kept[0].push(data.slice(0, n));
      this.kept[1].push(data.slice(n));
    }
    this.written += n;
    this.filled = 0;
  }
}

/** Opened source clip: its demuxer and tracks, shared by the video and audio passes. */
interface OpenClip {
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
}

/** A kept stretch of one clip, with its place on the output timeline (seconds) and its speed. */
interface AudioPiece {
  clip: number;
  start: number;
  end: number;
  outStart: number;
  outEnd: number;
  rate: number;
}

/** Splits kept segments (sequence time) at clip boundaries. */
function audioPieces(segments: Segment[], clips: ExportClip[]): AudioPiece[] {
  const pieces: AudioPiece[] = [];
  let out = 0;
  for (const seg of segments) {
    const rate = seg.rate ?? 1;
    clips.forEach((clip, i) => {
      const a = Math.max(seg.start, clip.start);
      const b = Math.min(seg.end, clip.start + clip.duration);
      if (b - a > 1e-4) {
        pieces.push({
          clip: i,
          start: a - clip.start,
          end: b - clip.start,
          outStart: out + (a - seg.start) / rate,
          outEnd: out + (b - seg.start) / rate,
          rate,
        });
      }
    });
    out += (seg.end - seg.start) / rate;
  }
  return pieces;
}

/** Volume of the clips' sound at an output time: lowered with the picture at transitions. */
type Fade = (outT: number) => number;

async function renderAudio(
  clips: OpenClip[],
  settings: ExportClip[],
  pieces: AudioPiece[],
  writer: AudioWriter,
  fade: Fade,
): Promise<void> {
  const sinks = clips.map((c) => (c.audio ? new AudioSampleSink(c.audio) : null));
  const rnnoise = settings.some((c) => c.denoise) ? await loadRnnoise() : null;
  for (const piece of pieces) {
    // Frame counts come from the absolute output position, so rounding never drifts.
    const pieceFrames = Math.round(piece.outEnd * OUT_RATE) - Math.round(piece.outStart * OUT_RATE);
    let produced = 0;
    const track = clips[piece.clip].audio;
    const sink = sinks[piece.clip];
    if (track && sink) {
      const rate = track.sampleRate;
      const resamplers = [new LinearResampler(rate / OUT_RATE), new LinearResampler(rate / OUT_RATE)];
      // Faster or slower parts are time-stretched, keeping the pitch of the voices.
      const stretcher = piece.rate !== 1 ? new TimeStretcher(piece.rate) : null;
      // The voice is cleaned before any time stretch, on the original sound.
      const denoiser = rnnoise && settings[piece.clip].denoise ? new Denoiser(rnnoise) : null;
      const startF = Math.round(piece.start * rate);
      const endF = Math.round(piece.end * rate);
      const gain = settings[piece.clip].gain;
      const firstFrame = Math.round(piece.outStart * OUT_RATE);
      const emit = async (l: Float32Array, r: Float32Array) => {
        const take = Math.min(l.length, pieceFrames - produced);
        // Tiny fades at every cut and clip boundary remove the clicks of jump cuts.
        for (let i = 0; i < take; i++) {
          const pos = produced + i;
          const g = Math.min(1, pos / FADE, (pieceFrames - 1 - pos) / FADE) * gain * fade((firstFrame + pos) / OUT_RATE);
          l[i] *= g;
          r[i] *= g;
        }
        if (take > 0) await writer.write(l.subarray(0, take), r.subarray(0, take));
        produced += Math.max(0, take);
      };
      for await (const sample of sink.samples(piece.start, piece.end)) {
        if (cancelled || produced >= pieceFrames) {
          sample.close();
          break;
        }
        const first = Math.round(sample.timestamp * rate);
        const a = Math.max(first, startF);
        const b = Math.min(first + sample.numberOfFrames, endF);
        if (b > a) {
          const [rawL, rawR] = readStereo(sample, a - first, b - a);
          let chunk: Float32Array[] = [resamplers[0].process(rawL).slice(), resamplers[1].process(rawR).slice()];
          if (denoiser) chunk = denoiser.push(chunk);
          if (stretcher) chunk = stretcher.push(chunk);
          await emit(chunk[0], chunk[1]);
        }
        sample.close();
      }
      if (denoiser && produced < pieceFrames && !cancelled) {
        let rest = denoiser.flush();
        if (stretcher) rest = stretcher.push(rest);
        await emit(rest[0], rest[1]);
      }
      denoiser?.destroy();
      if (stretcher && produced < pieceFrames && !cancelled) {
        const [sl, sr] = stretcher.flush();
        await emit(sl, sr);
      }
    }
    // Pad with silence so audio and video stay in sync (clip without audio, shorter audio track).
    while (produced < pieceFrames && !cancelled) {
      const n = Math.min(BLOCK, pieceFrames - produced);
      await writer.write(new Float32Array(n), new Float32Array(n));
      produced += n;
    }
  }
  await writer.flush();
}

const api: ExportWorkerApi = {
  async run(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<ExportResult> {
    cancelled = false;
    fontReady ??= loadCaptionFont(self.fonts, self.location.origin);
    await fontReady;

    const { project } = req;
    const segments = projectSegments(project);
    if (!segments.length) throw new Error('EMPTY_EDIT');
    const outDuration = totalDuration(segments);
    const { width, height } = outputSize(project.format, project.export.resolution);
    const fps = project.export.fps;

    const clips: OpenClip[] = [];
    for (const clip of req.clips) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(clip.file) });
      clips.push({
        input,
        video: await input.getPrimaryVideoTrack(),
        audio: clip.hasAudio ? await decodableAudioTrack(input) : null,
      });
    }
    const disposeAll = () => clips.forEach((c) => c.input.dispose());
    if (clips.some((c) => !c.video)) {
      disposeAll();
      throw new Error('NO_VIDEO_TRACK');
    }

    const codec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height, frameRate: fps });
    if (!codec) {
      disposeAll();
      throw new Error('NO_VIDEO_ENCODER');
    }
    const wantsAudio = clips.some((c) => c.audio) || (!!req.music && project.music.enabled);
    let audioCodec: 'aac' | 'opus' | null = null;
    if (wantsAudio) {
      if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: OUT_RATE })) audioCodec = 'aac';
      else if (await canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: OUT_RATE })) audioCodec = 'opus';
    }

    let writable: FileSystemWritableFileStream | null = null;
    if (req.target) {
      try {
        writable = await req.target.createWritable();
      } catch {
        writable = null;
      }
    }
    const target = writable
      ? new StreamTarget(writable as unknown as WritableStream<StreamTargetChunk>, { chunked: true })
      : new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const videoSource = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(videoSource, { frameRate: fps });

    let audioSource: AudioSampleSource | null = null;
    if (audioCodec) {
      audioSource = new AudioSampleSource({ codec: audioCodec, quality: QUALITY_HIGH });
      output.addAudioTrack(audioSource);
    }

    try {
      await output.start();
      const pages = buildCaptionPages(project.words, segments, project.captions.maxWords);
      const half = TRANSITION_HALF[project.transition ?? 'none'];
      const shadeAt = (outT: number) => transitionShade(req.transitionPoints, outT, half);
      const beats = zoomBeats(project, segments);
      const frames = Math.max(1, Math.round(outDuration * fps));
      const times = Array.from({ length: frames }, (_, k) => outputToSource(segments, k / fps));
      const clipOf = (t: number) => {
        let i = 0;
        while (i < req.clips.length - 1 && t >= req.clips[i].start + req.clips[i].duration) i++;
        return i;
      };

      // Background blur: the person mask runs on every frame, on the cropped frame.
      const blur = project.background?.mode === 'blur';
      const personMask = blur ? await PersonMask.create(self.location.origin, true) : null;
      const sharp = new OffscreenCanvas(width, height);
      const sharpCtx = sharp.getContext('2d')!;
      const work = new OffscreenCanvas(width, height);

      const renderVideo = async () => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        let k = 0;
        // Sequence times only move forward, so each clip is decoded in a single pass.
        while (k < frames && !cancelled) {
          const index = clipOf(times[k]);
          let end = k;
          while (end < frames && clipOf(times[end]) === index) end++;
          const clip = req.clips[index];
          const local = times.slice(k, end).map((t) => Math.min(Math.max(0, t - clip.start), Math.max(0, clip.duration - 0.001)));
          const sink = new CanvasSink(clips[index].video!, { poolSize: 2 });
          for await (const wrapped of sink.canvasesAtTimestamps(local)) {
            if (cancelled) break;
            const srcT = times[k];
            if (wrapped) {
              const framing = framingAt(project, beats, srcT);
              if (personMask) {
                drawFrame(sharpCtx, wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height, width, height, framing, project.rotation);
                const mask = personMask.mask(sharp);
                if (mask) drawBlurredBackground(ctx, sharp, mask, width, height, project.background.strength, work);
                else ctx.drawImage(sharp, 0, 0);
              } else {
                drawFrame(ctx, wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height, width, height, framing, project.rotation);
              }
            }
            drawCaptions(ctx, pages, srcT, project.captions, width, height);
            drawTexts(ctx, project.texts ?? [], srcT, width, height);
            const shade = shadeAt(k / fps);
            if (shade > 0) {
              ctx.fillStyle = `rgba(0, 0, 0, ${shade})`;
              ctx.fillRect(0, 0, width, height);
            }
            await videoSource.add(k / fps, 1 / fps);
            k++;
            if (k % 10 === 0 || k === frames) onProgress({ progress: k / frames, frame: k, frames });
          }
        }
      };

      const tasks = [renderVideo()];
      if (audioSource) {
        let music: [Float32Array, Float32Array] | null = null;
        let envelope: Float32Array | null = null;
        if (req.music && project.music.enabled) {
          music = await decodeMusic(req.music, Math.ceil(outDuration * OUT_RATE));
          envelope = req.frameDb
            ? duckingEnvelope(req.frameDb, segments, outDuration, project.silence.thresholdDb, project.music.volume, project.music.ducking)
            : new Float32Array(Math.ceil(outDuration * 100) + 1).fill(project.music.volume);
        }
        const writer = new AudioWriter(audioSource, Math.round(outDuration * OUT_RATE), music, envelope);
        tasks.push(renderAudio(clips, req.clips, audioPieces(segments, req.clips), writer, (t) => 1 - shadeAt(t)));
      }
      await Promise.all(tasks);
      if (cancelled) throw new Error('CANCELLED');

      personMask?.close();
      videoSource.close();
      audioSource?.close();
      await output.finalize();
    } catch (error) {
      await output.cancel().catch(() => undefined);
      throw error;
    } finally {
      disposeAll();
    }

    const result: ExportResult = {
      buffer: target instanceof BufferTarget ? target.buffer : null,
      streamed: !!writable,
      codec,
      width,
      height,
      duration: outDuration,
    };
    return result.buffer ? Comlink.transfer(result, [result.buffer]) : result;
  },

  /**
   * `seconds` of the exported sound from output time `from` (clips only, no music): volume,
   * leveling, noise reduction, speed changes and transitions, exactly as the export renders them.
   */
  async previewSound(req: ExportRequest, from: number, seconds: number): Promise<SoundPreview> {
    cancelled = false;
    const { project } = req;
    const segments = projectSegments(project);
    const to = from + seconds;
    const pieces = audioPieces(segments, req.clips).flatMap((p) => {
      const a = Math.max(p.outStart, from);
      const b = Math.min(p.outEnd, to);
      if (b - a < 0.01) return [];
      return [{ ...p, start: p.start + (a - p.outStart) * p.rate, end: p.start + (b - p.outStart) * p.rate, outStart: a - from, outEnd: b - from }];
    });
    const clips: OpenClip[] = [];
    for (const clip of req.clips) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(clip.file) });
      clips.push({ input, video: null, audio: clip.hasAudio ? await decodableAudioTrack(input) : null });
    }
    try {
      const half = TRANSITION_HALF[project.transition ?? 'none'];
      const writer = new AudioWriter(null, Math.round(seconds * OUT_RATE), null, null);
      await renderAudio(clips, req.clips, pieces, writer, (t) => 1 - transitionShade(req.transitionPoints, t + from, half));
      const join = (parts: Float32Array[]) => {
        const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const p of parts) {
          out.set(p, offset);
          offset += p.length;
        }
        return out;
      };
      const result: SoundPreview = { left: join(writer.kept[0]), right: join(writer.kept[1]), sampleRate: OUT_RATE };
      return Comlink.transfer(result, [result.left.buffer, result.right.buffer]);
    } finally {
      clips.forEach((c) => c.input.dispose());
    }
  },

  cancel(): void {
    cancelled = true;
  },
};

Comlink.expose(api);
