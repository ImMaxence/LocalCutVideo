/**
 * Voice noise reduction with RNNoise (WebAssembly) on 48 kHz audio, in 10 ms frames. The module
 * (about 5 MB, model included) is served by this site and only loaded when the option is used.
 */
import type { DenoiseState, Rnnoise } from '@shiguredo/rnnoise-wasm';

type RnnoiseModule = typeof import('@shiguredo/rnnoise-wasm');

let loading: Promise<Rnnoise> | null = null;

export function loadRnnoise(): Promise<Rnnoise> {
  loading ??= (import(/* @vite-ignore */ `${self.location.origin}/rnnoise/rnnoise.js`) as Promise<RnnoiseModule>).then((m) => m.Rnnoise.load());
  return loading;
}

/** RNNoise on each channel of a stream. It returns exactly as many samples as it is given. */
export class Denoiser {
  private readonly states: DenoiseState[];
  private readonly frames: Float32Array[];
  private filled = 0;

  constructor(
    rnnoise: Rnnoise,
    private readonly channels = 2,
  ) {
    this.states = Array.from({ length: channels }, () => rnnoise.createDenoiseState());
    this.frames = Array.from({ length: channels }, () => new Float32Array(rnnoise.frameSize));
  }

  /** Denoised samples for every complete frame so far (the rest waits for the next chunk). */
  push(chunk: Float32Array[]): Float32Array[] {
    const size = this.frames[0].length;
    const n = chunk[0].length;
    const out = this.frames.map(() => new Float32Array(Math.floor((this.filled + n) / size) * size));
    let written = 0;
    for (let offset = 0; offset < n; ) {
      const take = Math.min(size - this.filled, n - offset);
      for (let c = 0; c < this.channels; c++) this.frames[c].set((chunk[c] ?? chunk[0]).subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === size) {
        this.process();
        for (let c = 0; c < this.channels; c++) out[c].set(this.frames[c], written);
        written += size;
        this.filled = 0;
      }
    }
    return out;
  }

  /** The last, incomplete frame (padded with silence for RNNoise, returned at its real length). */
  flush(): Float32Array[] {
    const n = this.filled;
    if (!n) return this.frames.map(() => new Float32Array(0));
    this.frames.forEach((f) => f.fill(0, n));
    this.process();
    this.filled = 0;
    return this.frames.map((f) => f.slice(0, n));
  }

  destroy(): void {
    this.states.forEach((s) => s.destroy());
  }

  /** RNNoise expects 16-bit PCM values. */
  private process(): void {
    for (let c = 0; c < this.channels; c++) {
      const frame = this.frames[c];
      for (let i = 0; i < frame.length; i++) frame[i] *= 32768;
      this.states[c].processFrame(frame);
      for (let i = 0; i < frame.length; i++) frame[i] /= 32768;
    }
  }
}
