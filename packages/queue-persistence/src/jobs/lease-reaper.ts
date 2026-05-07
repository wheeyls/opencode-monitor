import type { Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "@arb/work-queue-app";

export class LeaseReaper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private workItems: WorkItemRepository,
    private clock: Clock,
    private intervalMs: number = 15_000,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.reap(), this.intervalMs);
    console.log(`[lease-reaper] Running every ${this.intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async reap(): Promise<number> {
    const expired = await this.workItems.findExpiredLeases();
    let count = 0;
    for (const item of expired) {
      try {
        item.expireLease();
        await this.workItems.save(item);
        count++;
        console.log(`[lease-reaper] Expired lease on ${item.id} → ${item.status}`);
      } catch (err) {
        console.error(`[lease-reaper] Failed to expire ${item.id}:`, (err as Error).message);
      }
    }
    return count;
  }
}
