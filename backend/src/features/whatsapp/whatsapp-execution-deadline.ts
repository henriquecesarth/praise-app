/**
 * WhatsAppExecutionDeadline
 *
 * Enforces execution time limits across scheduled WhatsApp jobs (cleanup & reconciliation),
 * guaranteeing that requests return safely within cron-job.org's 30-second connection envelope.
 *
 * Target HTTP response window: <= 24-25 seconds (providing a 5-6s safety buffer before the 30s cutoff).
 */
export class WhatsAppExecutionDeadline {
  readonly startTime: number;
  readonly deadlineAt: number;
  readonly safetyMarginMs: number;

  constructor(options: {
    startTime?: number;
    budgetMs?: number;
    deadlineAt?: number;
    safetyMarginMs?: number;
  } = {}) {
    this.startTime = options.startTime ?? Date.now();
    const budgetMs = options.budgetMs ?? 24_000;
    this.deadlineAt = options.deadlineAt ?? (this.startTime + budgetMs);
    this.safetyMarginMs = options.safetyMarginMs ?? 1_500;
  }

  /**
   * Raw remaining milliseconds until absolute deadline.
   */
  get remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }

  /**
   * Effective remaining milliseconds accounting for safety margin.
   */
  get effectiveRemainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now() - this.safetyMarginMs);
  }

  /**
   * Returns true if effective remaining time is at least requiredMs.
   */
  hasRemaining(requiredMs: number): boolean {
    return this.effectiveRemainingMs >= requiredMs;
  }

  /**
   * Returns true if effective remaining budget is exhausted.
   */
  isExpired(): boolean {
    return this.effectiveRemainingMs <= 0;
  }

  /**
   * Clamps a standard provider timeout to the remaining execution budget.
   * If available budget is below minimumOperationalMs, returns 0 (insufficient budget to start).
   */
  getClampedTimeoutMs(normalTimeoutMs: number, minimumOperationalMs: number = 1_000): number {
    const available = this.effectiveRemainingMs;
    if (available < minimumOperationalMs) {
      return 0;
    }
    return Math.min(normalTimeoutMs, available);
  }
}
