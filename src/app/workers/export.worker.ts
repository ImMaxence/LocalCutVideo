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
import type { Range } from '../engine/model';
import { drawCaptions, drawFrame, framingAt, loadCaptionFont, outputSize, zoomBeats } from '../engine/render';
import { buildCaptionPages, outputToSource, projectSegments, totalDuration } from '../engine/timeline-math';
import { decodableAudioTrack } from './tracks';
import type { ExportClip, ExportProgress, ExportRequest, ExportResult, ExportWorkerApi } from './worker-types';

const OUT_RATE = 48000;
const BLOCK = 4800;
const FADE = Math.round(OUT_RATE * 0.004);

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

/** Accumulates output audio in 100 ms blocks, mixes the music in and hands blocks to the encoder. */
class AudioWriter {
  private left = new Float32Array(BLOCK);
  private right = new Float32Array(BLOCK);
  private filled = 0;
  private written = 0;

  constructor(
    private readonly source: AudioSampleSource,
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
      data[j] = Math.max(-1, Math.min(1, l));
      data[n + j] = Math.max(-1, Math.min(1, r));
    }
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: OUT_RATE,
      timestamp: this.written / OUT_RATE,
    });
    await this.source.add(sample);
    sample.close();
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

/** A kept stretch of one clip, with its place on the output timeline (seconds). */
interface AudioPiece {
  clip: number;
  start: number;
  end: number;
  outStart: number;
  outEnd: number;
}

/** Splits kept segments (sequence time) at clip boundaries. */
function audioPieces(segments: Range[], clips: ExportClip[]): AudioPiece[] {
  const pieces: AudioPiece[] = [];
  let out = 0;
  for (const seg of segments) {
    clips.forEach((clip, i) => {
      const a = Math.max(seg.start, clip.start);
      const b = Math.min(seg.end, clip.start + clip.duration);
      if (b - a > 1e-4) {
        pieces.push({ clip: i, start: a - clip.start, end: b - clip.start, outStart: out + (a - seg.start), outEnd: out + (b - seg.start) });
      }
    });
    out += seg.end - seg.start;
  }
  return pieces;
}

async function renderAudio(clips: OpenClip[], pieces: AudioPiece[], writer: AudioWriter): Promise<void> {
  const sinks = clips.map((c) => (c.audio ? new AudioSampleSink(c.audio) : null));
  for (const piece of pieces) {
    // Frame counts come from the absolute output position, so rounding never drifts.
    const pieceFrames = Math.round(piece.outEnd * OUT_RATE) - Math.round(piece.outStart * OUT_RATE);
    let produced = 0;
    const track = clips[piece.clip].audio;
    const sink = sinks[piece.clip];
    if (track && sink) {
      const rate = track.sampleRate;
      const resamplers = [new LinearResampler(rate / OUT_RATE), new LinearResampler(rate / OUT_RATE)];
      const startF = Math.round(piece.start * rate);
      const endF = Math.round(piece.end * rate);
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
          const l = resamplers[0].process(rawL).slice();
          const r = resamplers[1].process(rawR).slice();
          const take = Math.min(l.length, pieceFrames - produced);
          // Tiny fades at every cut and clip boundary remove the clicks of jump cuts.
          for (let i = 0; i < take; i++) {
            const pos = produced + i;
            const g = Math.min(1, pos / FADE, (pieceFrames - 1 - pos) / FADE);
            l[i] *= g;
            r[i] *= g;
          }
          await writer.write(l.subarray(0, take), r.subarray(0, take));
          produced += take;
        }
        sample.close();
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
      const beats = zoomBeats(project, segments);
      const frames = Math.max(1, Math.round(outDuration * fps));
      const times = Array.from({ length: frames }, (_, k) => outputToSource(segments, k / fps));
      const clipOf = (t: number) => {
        let i = 0;
        while (i < req.clips.length - 1 && t >= req.clips[i].start + req.clips[i].duration) i++;
        return i;
      };

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
              drawFrame(ctx, wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height, width, height, framingAt(project, beats, srcT));
            }
            drawCaptions(ctx, pages, srcT, project.captions, width, height);
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
        tasks.push(renderAudio(clips, audioPieces(segments, req.clips), writer));
      }
      await Promise.all(tasks);
      if (cancelled) throw new Error('CANCELLED');

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

  cancel(): void {
    cancelled = true;
  },
};

Comlink.expose(api);
