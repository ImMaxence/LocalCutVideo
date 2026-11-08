import { describe, expect, it } from 'vitest';
import { ProgressEaser } from './progress';

describe('eased progress', () => {
  it('moves during a step without passing its end', () => {
    const easer = new ProgressEaser();
    easer.report(0, 0.25, 1000);
    expect(easer.value(1000)).toBe(0);
    expect(easer.value(5000)).toBeGreaterThan(0.1);
    expect(easer.value(600_000)).toBeLessThanOrEqual(0.25);
  });

  it('never goes back', () => {
    const easer = new ProgressEaser();
    easer.report(0, 0.5, 1);
    const shown = easer.value(4000);
    easer.report(0.1, 0.5, 4000);
    expect(easer.value(4000)).toBeGreaterThanOrEqual(shown);
  });

  it('follows the pace of the previous steps', () => {
    const easer = new ProgressEaser();
    easer.report(0, 0.5, 1);
    easer.report(0.5, 1, 1001);
    expect(easer.value(1500)).toBeGreaterThan(0.75);
  });
});
