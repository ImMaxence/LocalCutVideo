import { describe, expect, it } from 'vitest';
import { DownloadMeter, formatBytes, formatSpeed } from './download-stats';

/** Browsers differ on the kind of space before the unit. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('download stats', () => {
  it('gives no speed before there is enough to measure', () => {
    const meter = new DownloadMeter();
    expect(meter.add(0, 100, 0).speed).toBeNull();
    expect(meter.add(10, 100, 200).speed).toBeNull();
  });

  it('measures the speed and what is left', () => {
    const meter = new DownloadMeter();
    meter.add(0, 10_000_000, 0);
    const stats = meter.add(2_000_000, 10_000_000, 1000);
    expect(stats.speed).toBe(2_000_000);
    expect(stats.left).toBe(8_000_000);
    expect(stats.loaded).toBe(2_000_000);
  });

  it('follows the recent speed', () => {
    const meter = new DownloadMeter();
    meter.add(0, 1e9, 0);
    meter.add(1_000_000, 1e9, 1000);
    for (let t = 2000; t <= 10_000; t += 1000) meter.add(1_000_000 + ((t - 1000) / 1000) * 5_000_000, 1e9, t);
    expect(meter.add(46_000_000 + 5_000_000, 1e9, 11_000).speed).toBeCloseTo(5_000_000, -2);
  });

  it('never leaves a negative amount', () => {
    expect(new DownloadMeter().add(120, 100, 0).left).toBe(0);
  });

  it('writes sizes and speeds in the reader language', () => {
    expect(plain(formatBytes(3_100_000_000, 'fr'))).toBe('3,1 Go');
    expect(plain(formatBytes(845_000_000, 'en'))).toBe('845 MB');
    expect(plain(formatSpeed(12_400_000, 'en'))).toBe('12 MB/s');
    expect(plain(formatSpeed(2_500_000, 'en'))).toBe('2.5 MB/s');
  });
});
