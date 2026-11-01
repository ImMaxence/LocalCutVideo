/**
 * Pitch-preserving time stretch (WSOLA), used by the export for sped-up or slowed-down parts:
 * windowed frames of the input are laid one after the other at a fixed output hop, and each
 * frame is taken where it best continues the previous one, so voices keep their pitch at 0.5×
 * or 2× instead of sounding deep or squeaky. Streaming: input and output come in chunks.
 */
const FRAME = 1536; // 32 ms at 48 kHz
const HOP = FRAME / 2;
const TOLERANCE = 384; // how far around the ideal position a frame may be taken (8 ms)

const WINDOW = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));

export class TimeStretcher {
  private input: Float32Array[];
  /** Absolute index of input[c][0] (older samples are dropped). */
  private base = 0;
  private length = 0;
  /** Ideal start of the next frame in the input, and actual start of the previous one. */
  private target = 0;
  private previous = -1;
  private readonly ola: Float32Array[];

  /** `rate` 2 plays twice as fast (half the duration). */
  constructor(
    private readonly rate: number,
    private readonly channels = 2,
  ) {
    this.input = Array.from({ length: channels }, () => new Float32Array(FRAME * 8));
    this.ola = Array.from({ length: channels }, () => new Float32Array(FRAME));
  }

  push(chunk: Float32Array[]): Float32Array[] {
    this.append(chunk);
    return this.drain();
  }

  /** Remaining output once the input is complete. */
  flush(): Float32Array[] {
    this.append(Array.from({ length: this.channels }, () => new Float32Array(FRAME + TOLERANCE * 2)));
    return this.drain();
  }

  private append(chunk: Float32Array[]): void {
    const n = chunk[0].length;
    if (this.length + n > this.input[0].length) {
      // Drop what no future frame can use, then grow if still needed.
      const used = Math.min(this.previous + HOP, Math.floor(this.target) - TOLERANCE) - this.base;
      const drop = Math.max(0, Math.min(this.length, used));
      const size = Math.max(this.input[0].length, (this.length - drop + n) * 2);
      this.input = this.input.map((buf) => {
        const next = new Float32Array(size);
        next.set(buf.subarray(drop, this.length));
        return next;
      });
      this.base += drop;
      this.length -= drop;
    }
    for (let c = 0; c < this.channels; c++) this.input[c].set(chunk[c] ?? chunk[0], this.length);
    this.length += n;
  }

  private drain(): Float32Array[] {
    const out: Float32Array[][] = Array.from({ length: this.channels }, () => []);
    const end = this.base + this.length;
    while (true) {
      const ideal = Math.round(this.target);
      const needed = Math.max(ideal + TOLERANCE + FRAME, this.previous + HOP + HOP);
      // flush() pads with silence, so the last real samples get their frames too.
      if (needed > end) break;
      const start = this.previous < 0 ? ideal : this.bestStart(ideal);
      const offset = start - this.base;
      for (let c = 0; c < this.channels; c++) {
        const ola = this.ola[c];
        const src = this.input[c];
        for (let i = 0; i < FRAME; i++) ola[i] += src[offset + i] * WINDOW[i];
        out[c].push(ola.slice(0, HOP));
        ola.copyWithin(0, HOP);
        ola.fill(0, FRAME - HOP);
      }
      this.previous = start;
      this.target += HOP * this.rate;
    }
    return out.map((parts) => {
      const total = parts.reduce((n, p) => n + p.length, 0);
      const joined = new Float32Array(total);
      let pos = 0;
      for (const p of parts) {
        joined.set(p, pos);
        pos += p.length;
      }
      return joined;
    });
  }

  /** Start near `ideal` whose overlap best matches the natural continuation of the last frame. */
  private bestStart(ideal: number): number {
    const natural = this.previous + HOP - this.base;
    const lo = Math.max(this.base, ideal - TOLERANCE);
    const hi = ideal + TOLERANCE;
    const score = (start: number, stride: number) => {
      let sum = 0;
      const a = start - this.base;
      for (let c = 0; c < this.channels; c++) {
        const x = this.input[c];
        for (let i = 0; i < HOP; i += stride) sum += x[a + i] * x[natural + i];
      }
      return sum;
    };
    // Coarse search every 8 samples, then refine around the best one.
    let best = ideal;
    let bestScore = -Infinity;
    for (let s = lo; s <= hi; s += 8) {
      const v = score(s, 4);
      if (v > bestScore) {
        bestScore = v;
        best = s;
      }
    }
    const center = best;
    bestScore = -Infinity;
    for (let s = Math.max(lo, center - 7); s <= Math.min(hi, center + 7); s++) {
      const v = score(s, 1);
      if (v > bestScore) {
        bestScore = v;
        best = s;
      }
    }
    return best;
  }
}
