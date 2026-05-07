import type { WorkItem } from "@arb/work-queue";
import type { WorkItemRepository } from "../../ports/work-item-repository.js";

export class FakeWorkItemRepository implements WorkItemRepository {
  private items: Map<string, WorkItem> = new Map();

  async save(item: WorkItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async findById(id: string): Promise<WorkItem | null> {
    return this.items.get(id) ?? null;
  }

  async findClaimable(userId: string): Promise<WorkItem[]> {
    const now = new Date();
    return [...this.items.values()].filter(
      (item) =>
        item.userId === userId &&
        item.status === "pending" &&
        item.availableAt.getTime() <= now.getTime(),
    );
  }

  async findNonTerminalByUserId(userId: string): Promise<WorkItem[]> {
    return [...this.items.values()].filter(
      (item) =>
        item.userId === userId &&
        item.status !== "completed" &&
        item.status !== "dead",
    );
  }

  async findExpiredLeases(): Promise<WorkItem[]> {
    const now = new Date();
    return [...this.items.values()].filter(
      (item) =>
        (item.status === "claimed" || item.status === "in_progress") &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt.getTime() <= now.getTime(),
    );
  }

  async findRetryable(): Promise<WorkItem[]> {
    return [...this.items.values()].filter((item) => item.isRetryable);
  }

  async findByThreadId(threadId: string): Promise<WorkItem[]> {
    return [...this.items.values()].filter((item) => item.threadId === threadId);
  }

  async findPendingByThreadId(threadId: string): Promise<WorkItem | null> {
    return [...this.items.values()].find(
      (item) => item.threadId === threadId && item.status === "pending",
    ) ?? null;
  }

  async existsNonTerminal(threadId: string, dedupKey?: string): Promise<boolean> {
    if (!dedupKey) return false;
    return [...this.items.values()].some(
      (item) =>
        item.threadId === threadId &&
        item.status !== "completed" &&
        item.status !== "dead" &&
        (item.payload as Record<string, unknown>).dedupKey === dedupKey,
    );
  }

  /** Test helper: get all items. */
  all(): WorkItem[] {
    return [...this.items.values()];
  }
}
