import { WorkItem, WorkThread, type Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { WorkThreadRepository } from "../ports/work-thread-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export interface IngestEventInput {
  userId: string;
  affinityKey: string;
  kind: "event" | "manual_kick";
  payload: Record<string, unknown>;
  dedupKey?: string;
}

export interface IngestEventResult {
  workItemId: string;
  threadId: string;
  deduplicated: boolean;
  coalesced: boolean;
}

export interface IngestEventDeps {
  workItems: WorkItemRepository;
  workThreads: WorkThreadRepository;
  ids: IdGenerator;
  clock: Clock;
  uow: UnitOfWork;
}

export async function ingestEvent(
  input: IngestEventInput,
  deps: IngestEventDeps,
): Promise<IngestEventResult> {
  return deps.uow.run(async () => {
    if (input.dedupKey) {
      const existing = await deps.workThreads.findByAffinityKey(input.userId, input.affinityKey);
      if (existing) {
        const isDup = await deps.workItems.existsNonTerminal(existing.id, input.dedupKey);
        if (isDup) {
          return { workItemId: "", threadId: existing.id, deduplicated: true, coalesced: false };
        }
      }
    }

    let thread = await deps.workThreads.findByAffinityKey(input.userId, input.affinityKey);
    if (!thread) {
      thread = new WorkThread({
        id: deps.ids.generate(),
        userId: input.userId,
        affinityKey: input.affinityKey,
      });
      await deps.workThreads.save(thread);
    }

    // Coalesce: if there's already a pending item for this thread, fold into it
    const pendingItem = await deps.workItems.findPendingByThreadId(thread.id);
    if (pendingItem) {
      pendingItem.coalesce(input.payload);
      await deps.workItems.save(pendingItem);
      return { workItemId: pendingItem.id, threadId: thread.id, deduplicated: false, coalesced: true };
    }

    const sequence = thread.allocateSequence();
    const now = deps.clock.now();

    const item = new WorkItem({
      id: deps.ids.generate(),
      userId: input.userId,
      threadId: thread.id,
      kind: input.kind,
      sequence,
      payload: { ...input.payload, dedupKey: input.dedupKey },
      createdAt: now,
      availableAt: now,
    });

    await deps.workItems.save(item);
    await deps.workThreads.save(thread);

    return { workItemId: item.id, threadId: thread.id, deduplicated: false, coalesced: false };
  });
}
