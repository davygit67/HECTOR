/** Retry failed acquisition without a tight restart loop. One lucky frame does
 * not reset the delay; require a sustained stream before returning to baseline. */
export class RecoveryBackoff {
  private attempts = 0;
  private frames = 0;
  private healthySince: number | undefined;
  constructor(private baseMs = 2000) {
    if (!Number.isFinite(baseMs) || baseMs < 1 || baseMs > 10000) throw new Error('Retry delay must be 1–10000 ms.');
  }
  nextDelay() {
    this.frames = 0; this.healthySince = undefined;
    return Math.min(10000, this.baseMs * 2 ** Math.min(this.attempts++, 16));
  }
  frame(now = performance.now()) {
    this.healthySince ??= now;
    if (++this.frames >= 5 && now - this.healthySince >= 2000) this.attempts = 0;
  }
}
