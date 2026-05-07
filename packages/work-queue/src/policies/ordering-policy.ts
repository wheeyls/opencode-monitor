import type { WorkItem } from "../entities/work-item.js";

/**
 * Ordering policy for work items.
 *
 * Rules:
 * 1. Strict FIFO within a thread — lower sequence number first.
 *    A thread's item with sequence N blocks sequence N+1 until N is terminal.
 * 2. Best-effort oldest-first across threads — by availableAt, then createdAt.
 * 3. No global FIFO guarantee.
 */
export class OrderingPolicy {
  /**
   * Given a set of pending items, determine which are claimable.
   * An item is claimable only if no earlier non-terminal item exists in the same thread.
   *
   * @param pendingItems Items in "pending" status with availableAt <= now
   * @param nonTerminalItems All non-terminal items (pending, claimed, in_progress, failed) — used to check thread blocking
   * @returns Items that can be claimed, sorted by best-effort cross-thread ordering
   */
  claimable(pendingItems: WorkItem[], nonTerminalItems: WorkItem[]): WorkItem[] {
    // For each thread, find the minimum sequence among non-terminal items
    const threadMinSequence = new Map<string, number>();
    for (const item of nonTerminalItems) {
      const current = threadMinSequence.get(item.threadId);
      if (current === undefined || item.sequence < current) {
        threadMinSequence.set(item.threadId, item.sequence);
      }
    }

    // An item is claimable only if its sequence equals the thread's min non-terminal sequence
    const claimableItems = pendingItems.filter((item) => {
      const minSeq = threadMinSequence.get(item.threadId);
      return minSeq === undefined || item.sequence <= minSeq;
    });

    // Sort: oldest availableAt first, then createdAt as tiebreaker
    return claimableItems.sort((a, b) => {
      const byAvailable = a.availableAt.getTime() - b.availableAt.getTime();
      if (byAvailable !== 0) return byAvailable;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
}
