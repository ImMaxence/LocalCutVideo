/** Time over which the speed is measured: long enough not to jump, short enough to follow changes. */
const SPEED_WINDOW_MS = 3000;
const MIN_SPEED_SAMPLE_MS = 500;

export interface DownloadStats {
  loaded: number;
  total: number;
  left: number;
  /** Bytes per second, null until there is enough to measure. */
  speed: number | null;
}

/** Measures the speed of a download from successive byte counts. */
export class DownloadMeter {
  private samples: { at: number; loaded: number }[] = [];

  add(loaded: number, total: number, now: number): DownloadStats {
    this.samples.push({ at: now, loaded });
    while (this.samples.length > 2 && now - this.samples[1].at >= SPEED_WINDOW_MS) this.samples.shift();
    const first = this.samples[0];
    const elapsed = now - first.at;
    return {
      loaded,
      total,
      left: Math.max(0, total - loaded),
      speed: elapsed >= MIN_SPEED_SAMPLE_MS ? (Math.max(0, loaded - first.loaded) * 1000) / elapsed : null,
    };
  }
}

const unit = (value: number, name: string, digits: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: 'unit', unit: name, maximumFractionDigits: digits }).format(value);

/** A size in the reader's language: 845 Mo, 3,1 Go. */
export function formatBytes(bytes: number, locale: string): string {
  return bytes >= 1e9 ? unit(bytes / 1e9, 'gigabyte', 2, locale) : unit(bytes / 1e6, 'megabyte', bytes < 1e7 ? 1 : 0, locale);
}

/** A speed in the reader's language: 12 Mo/s. */
export function formatSpeed(bytesPerSecond: number, locale: string): string {
  const megabytes = bytesPerSecond / 1e6;
  return unit(megabytes, 'megabyte-per-second', megabytes < 10 ? 1 : 0, locale);
}
