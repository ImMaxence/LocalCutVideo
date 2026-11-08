const FIRST_STEP_MS = 8000;

/**
 * Percentage that keeps moving during long steps. A model only reports between two steps, up
 * to 30 s apart: in between it eases toward the end of the running step, at the pace of the
 * previous ones, without ever passing it.
 */
export class ProgressEaser {
  private from = 0;
  private to = 0;
  private at = 0;
  private startedAt = 0;
  private expected = FIRST_STEP_MS;

  /** `expectedMs` overrides the pace when a step is known to differ from the previous ones. */
  report(progress: number, next: number, now: number, expectedMs?: number): void {
    this.startedAt ||= now;
    this.from = Math.max(progress, this.value(now));
    this.to = Math.max(next, this.from);
    this.at = now;
    this.expected = expectedMs ?? (progress > 0 ? Math.max(300, ((now - this.startedAt) / progress) * (this.to - this.from)) : FIRST_STEP_MS);
  }

  value(now: number): number {
    if (!this.at) return 0;
    return this.from + (this.to - this.from) * (1 - Math.exp((-2 * (now - this.at)) / this.expected));
  }
}
