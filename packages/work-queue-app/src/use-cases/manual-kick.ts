import type { Clock } from "@arb/work-queue";
import type { WorkThreadRepository } from "../ports/work-thread-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { ingestEvent, type IngestEventResult } from "./ingest-event.js";
import type { WorkItemRepository } from "../ports/work-item-repository.js";

export interface ManualKickInput {
  userId: string;
  affinityKey: string;
  message?: string;
}

export interface ManualKickDeps {
  workItems: WorkItemRepository;
  workThreads: WorkThreadRepository;
  ids: IdGenerator;
  clock: Clock;
  uow: UnitOfWork;
}

export async function manualKick(
  input: ManualKickInput,
  deps: ManualKickDeps,
): Promise<IngestEventResult> {
  return ingestEvent(
    {
      userId: input.userId,
      affinityKey: input.affinityKey,
      kind: "manual_kick",
      payload: {
        message: input.message ?? `Manual kick for ${input.affinityKey}`,
      },
    },
    deps,
  );
}
