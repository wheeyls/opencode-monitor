import type { Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export interface StartWorkInput {
  workItemId: string;
  clientId: string;
}

export interface StartWorkDeps {
  workItems: WorkItemRepository;
  clock: Clock;
  uow: UnitOfWork;
}

export async function startWork(
  input: StartWorkInput,
  deps: StartWorkDeps,
): Promise<void> {
  return deps.uow.run(async () => {
    const item = await deps.workItems.findById(input.workItemId);
    if (!item) {
      throw new Error(`Work item not found: ${input.workItemId}`);
    }
    if (item.claimedByClientId !== input.clientId) {
      throw new Error(
        `Work item ${input.workItemId} is claimed by ${item.claimedByClientId}, not ${input.clientId}`,
      );
    }

    item.start(deps.clock);
    await deps.workItems.save(item);
  });
}
