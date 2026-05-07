import { AffinityPolicy, type Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { WorkThreadRepository } from "../ports/work-thread-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export interface CompleteWorkInput {
  workItemId: string;
  clientId: string;
  sessionRef?: string | null;
}

export interface CompleteWorkDeps {
  workItems: WorkItemRepository;
  workThreads: WorkThreadRepository;
  clock: Clock;
  uow: UnitOfWork;
  affinity?: AffinityPolicy;
}

export async function completeWork(
  input: CompleteWorkInput,
  deps: CompleteWorkDeps,
): Promise<void> {
  const affinity = deps.affinity ?? new AffinityPolicy();

  return deps.uow.run(async () => {
    const item = await deps.workItems.findById(input.workItemId);
    if (!item) {
      throw new Error(`Work item not found: ${input.workItemId}`);
    }
    if (item.claimedByClientId !== input.clientId) {
      throw new Error(
        `Work item ${input.workItemId} is not claimed by ${input.clientId}`,
      );
    }

    item.complete(deps.clock);
    await deps.workItems.save(item);

    // Update thread affinity so this client is preferred for future work on this thread
    const thread = await deps.workThreads.findById(item.threadId);
    if (thread) {
      affinity.recordCompletion(thread, input.clientId, input.sessionRef ?? null, deps.clock);
      await deps.workThreads.save(thread);
    }
  });
}
