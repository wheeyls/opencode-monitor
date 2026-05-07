import { OrderingPolicy, AffinityPolicy, type Clock } from "@arb/work-queue";
import type { WorkItem } from "@arb/work-queue";
import type { WorkItemRepository } from "../ports/work-item-repository.js";
import type { WorkThreadRepository } from "../ports/work-thread-repository.js";
import type { ClientRepository } from "../ports/client-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

const DEFAULT_LEASE_MS = 60_000;

export interface ClaimWorkInput {
  clientId: string;
  userId: string;
}

export type ClaimWorkResult =
  | { kind: "work"; workItem: WorkItem; leaseExpiresAt: Date; sessionRef: string | null }
  | { kind: "none" };

export interface ClaimWorkDeps {
  workItems: WorkItemRepository;
  workThreads: WorkThreadRepository;
  clients: ClientRepository;
  clock: Clock;
  uow: UnitOfWork;
  ordering?: OrderingPolicy;
  affinity?: AffinityPolicy;
  leaseMs?: number;
}

export async function claimWork(
  input: ClaimWorkInput,
  deps: ClaimWorkDeps,
): Promise<ClaimWorkResult> {
  const ordering = deps.ordering ?? new OrderingPolicy();
  const affinity = deps.affinity ?? new AffinityPolicy();
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;

  return deps.uow.run(async () => {
    // Touch client liveness
    const client = await deps.clients.findById(input.clientId);
    if (!client) {
      throw new Error(`Client not found: ${input.clientId}`);
    }
    client.touch(deps.clock);
    await deps.clients.save(client);

    // Get claimable items
    const pending = await deps.workItems.findClaimable(input.userId);
    const nonTerminal = await deps.workItems.findNonTerminalByUserId(input.userId);
    const claimable = ordering.claimable(pending, nonTerminal);

    if (claimable.length === 0) {
      return { kind: "none" };
    }

    // Score by affinity and pick the best
    let bestItem = claimable[0];
    let bestScore = -1;

    for (const item of claimable) {
      const thread = await deps.workThreads.findById(item.threadId);
      const score = thread ? affinity.score(thread, input.clientId, deps.clock) : 1;
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    // Claim it
    bestItem.claim(input.clientId, leaseMs, deps.clock);
    await deps.workItems.save(bestItem);

    // Get session ref from thread for the client to resume
    const thread = await deps.workThreads.findById(bestItem.threadId);
    const sessionRef = thread?.lastSessionRef ?? null;

    return {
      kind: "work",
      workItem: bestItem,
      leaseExpiresAt: bestItem.leaseExpiresAt!,
      sessionRef,
    };
  });
}
