import type { Clock } from "../clock.js";
import type { WorkItem } from "../entities/work-item.js";

export interface RetrySchedule {
  /** Backoff delays in ms, indexed by attempt number (0-based). */
  backoffMs: number[];
}

const DEFAULT_SCHEDULE: RetrySchedule = {
  backoffMs: [
    30_000,     // Attempt 1 → retry after 30s
    120_000,    // Attempt 2 → retry after 2m
    600_000,    // Attempt 3 → retry after 10m
  ],
};

export class RetryPolicy {
  private schedule: RetrySchedule;

  constructor(schedule?: RetrySchedule) {
    this.schedule = schedule ?? DEFAULT_SCHEDULE;
  }

  /** Whether the work item can be retried. */
  canRetry(item: WorkItem): boolean {
    return item.isRetryable;
  }

  /** Calculate the next availableAt for a retry, or null if retries exhausted. */
  nextAvailableAt(item: WorkItem, clock: Clock): Date | null {
    if (!this.canRetry(item)) return null;

    // attemptCount is 1-based (incremented on claim), backoffMs is 0-based
    const backoffIndex = item.attemptCount - 1;
    const delayMs = backoffIndex < this.schedule.backoffMs.length
      ? this.schedule.backoffMs[backoffIndex]
      : this.schedule.backoffMs[this.schedule.backoffMs.length - 1]; // use last value as ceiling

    return new Date(clock.now().getTime() + delayMs);
  }

  /**
   * Apply retry logic to a failed work item.
   * Either schedules a retry or kills it.
   */
  applyRetry(item: WorkItem, clock: Clock): "retried" | "dead" {
    const nextAt = this.nextAvailableAt(item, clock);
    if (nextAt) {
      item.scheduleRetry(nextAt);
      return "retried";
    }
    item.kill();
    return "dead";
  }
}
