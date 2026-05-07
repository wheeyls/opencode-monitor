import { RetryPolicy, type Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "@arb/work-queue-app";

export class RetryScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryPolicy: RetryPolicy;

  constructor(
    private workItems: WorkItemRepository,
    private clock: Clock,
    private intervalMs: number = 30_000,
    retryPolicy?: RetryPolicy,
  ) {
    this.retryPolicy = retryPolicy ?? new RetryPolicy();
  }

  start(): void {
    this.timer = setInterval(() => this.schedule(), this.intervalMs);
    console.log(`[retry-scheduler] Running every ${this.intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async schedule(): Promise<number> {
    const retryable = await this.workItems.findRetryable();
    let count = 0;
    for (const item of retryable) {
      try {
        const outcome = this.retryPolicy.applyRetry(item, this.clock);
        await this.workItems.save(item);
        count++;
        console.log(`[retry-scheduler] ${item.id} → ${outcome}`);
      } catch (err) {
        console.error(`[retry-scheduler] Failed to retry ${item.id}:`, (err as Error).message);
      }
    }
    return count;
  }
}
