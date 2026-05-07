import type { WorkItem, WorkItemStatus } from "@arb/work-queue";

export interface WorkItemRepository {
  save(item: WorkItem): Promise<void>;
  findById(id: string): Promise<WorkItem | null>;

  /** Find pending items available for claiming (status=pending, availableAt <= now). */
  findClaimable(userId: string): Promise<WorkItem[]>;

  /** Find all non-terminal items (pending, claimed, in_progress, failed) for ordering checks. */
  findNonTerminalByUserId(userId: string): Promise<WorkItem[]>;

  /** Find items with expired leases (leaseExpiresAt <= now, status in [claimed, in_progress]). */
  findExpiredLeases(): Promise<WorkItem[]>;

  /** Find failed items eligible for retry scheduling. */
  findRetryable(): Promise<WorkItem[]>;

  /** Find by thread, useful for checking thread ordering and dedup. */
  findByThreadId(threadId: string): Promise<WorkItem[]>;

  /** Check if a non-terminal item already exists for this thread with the given dedup key. */
  existsNonTerminal(threadId: string, dedupKey?: string): Promise<boolean>;

  findPendingByThreadId(threadId: string): Promise<WorkItem | null>;
}
