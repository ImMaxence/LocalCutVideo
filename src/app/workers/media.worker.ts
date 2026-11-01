/// <reference lib="webworker" />
/**
 * Media worker: probes the source file and extracts its audio as 16 kHz mono PCM in RAM
 * (the format Whisper expects), plus the waveform peaks and loudness frames. Decoding goes
 * through WebCodecs via Mediabunny, reading the file lazily from disk: nothing is uploaded
 * and the video is never copied in full into memory.
 */
import * as Comlink from 'comlink';
import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import {
  ANALYSIS_SAMPLE_RATE,
  Downsampler,
  FRAME_RATE,
  PEAKS_RATE,
  computeFrameDb,
  computePeaks,
  suggestThreshold,
} from '../engine/audio-analysis';
import type { SourceInfo } from '../engine/model';
import { decodableAudioTrack } from './tracks';
import type { AudioExtraction, MediaWorkerApi } from './worker-types';

const api: MediaWorkerApi = {
  async probe(file: File): Promise<SourceInfo> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw new Error('NO_VIDEO_TRACK');
      if (!(await video.canDecode())) throw new Error('UNSUPPORTED_CODEC');
      const audio = await decodableAudioTrack(input);
      const duration = await input.computeDuration();
      const stats = await video.computePacketStats(120);
      return {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
        duration,
        width: video.displayWidth,
        height: video.displayHeight,
        fps: Math.round(stats.averagePacketRate * 100) / 100 || 30,
        hasAudio: !!audio,
        videoCodec: video.codec,
      };
    } finally {
      input.dispose();
    }
  },

  async thumbnail(file: File, at: number): Promise<Blob | null> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const video = await input.getPrimaryVideoTrack();
      if (!video) return null;
      const sink = new CanvasSink(video, { width: 320, height: 180, fit: 'cover' });
      const frame = await sink.getCanvas(at);
      if (!frame) return null;
      return await (frame.canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    } finally {
      input.dispose();
    }
  },

  async extractAudio(file: File, onProgress: (p: number) => void): Promise<AudioExtraction> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    try {
      const duration = await input.computeDuration();
      const track = await decodableAudioTrack(input);
      let pcm: Float32Array = new Float32Array(Math.ceil(duration * ANALYSIS_SAMPLE_RATE));
      if (track) {
        const resampler = new Downsampler(track.sampleRate / ANALYSIS_SAMPLE_RATE, duration * ANALYSIS_SAMPLE_RATE);
        const sink = new AudioSampleSink(track);
        let lastReport = 0;
        let channel = new Float32Array(0);
        let mono = new Float32Array(0);
        for await (const sample of sink.samples()) {
          const frames = sample.numberOfFrames;
          if (mono.length < frames) {
            mono = new Float32Array(frames);
            channel = new Float32Array(frames);
          }
          const view = mono.subarray(0, frames);
          view.fill(0);
          for (let c = 0; c < sample.numberOfChannels; c++) {
            const ch = channel.subarray(0, frames);
            sample.copyTo(ch, { planeIndex: c, format: 'f32-planar' });
            for (let i = 0; i < frames; i++) view[i] += ch[i] / sample.numberOfChannels;
          }
          resampler.push(view);
          if (sample.timestamp - lastReport > 2) {
            lastReport = sample.timestamp;
            onProgress(Math.min(0.99, sample.timestamp / duration));
          }
          sample.close();
        }
        pcm = resampler.result();
      }
      const frameDb = computeFrameDb(pcm);
      const peaks = computePeaks(pcm);
      onProgress(1);
      const result: AudioExtraction = {
        pcm,
        peaks,
        peaksRate: PEAKS_RATE,
        frameDb,
        frameRate: FRAME_RATE,
        suggestedThresholdDb: suggestThreshold(frameDb),
        duration,
      };
      return Comlink.transfer(result, [pcm.buffer, peaks.buffer, frameDb.buffer]);
    } finally {
      input.dispose();
    }
  },
};

Comlink.expose(api);
