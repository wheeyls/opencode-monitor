import { RetryPolicy, type Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

export interface FailWorkInput {
  workItemId: string;
  clientId: string;
  error: string;
}

export interface FailWorkResult {
  outcome: "retried" | "dead";
}

export interface FailWorkDeps {
  workItems: WorkItemRepository;
  clock: Clock;
  uow: UnitOfWork;
  retryPolicy?: RetryPolicy;
}

export async function failWork(
  input: FailWorkInput,
  deps: FailWorkDeps,
): Promise<FailWorkResult> {
  const retryPolicy = deps.retryPolicy ?? new RetryPolicy();

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

    item.fail(input.error, deps.clock);
    const outcome = retryPolicy.applyRetry(item, deps.clock);
    await deps.workItems.save(item);

    return { outcome };
  });
}
