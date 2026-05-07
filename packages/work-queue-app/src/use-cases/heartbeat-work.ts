import type { Clock } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { ClientRepository } from "../ports/client-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

const DEFAULT_LEASE_MS = 60_000;

export interface HeartbeatWorkInput {
  workItemId: string;
  clientId: string;
}

export interface HeartbeatWorkDeps {
  workItems: WorkItemRepository;
  clients: ClientRepository;
  clock: Clock;
  uow: UnitOfWork;
  leaseMs?: number;
}

export async function heartbeatWork(
  input: HeartbeatWorkInput,
  deps: HeartbeatWorkDeps,
): Promise<void> {
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;

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

    item.heartbeat(leaseMs, deps.clock);
    await deps.workItems.save(item);

    // Also touch client liveness
    const client = await deps.clients.findById(input.clientId);
    if (client) {
      client.touch(deps.clock);
      await deps.clients.save(client);
    }
  });
}
