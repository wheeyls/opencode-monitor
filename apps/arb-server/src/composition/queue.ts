/**
 * Composition root — wires use-cases to in-memory repositories.
 *
 * This is a singleton: one set of repos for the lifetime of the server process.
 * When we add Postgres, we swap these fakes for real repo implementations.
 * The use-cases don't change at all.
 */

import { FakeClock, type Clock, RetryPolicy, AffinityPolicy, OrderingPolicy } from "@arb/work-queue";
import type { WorkItemRepository, WorkThreadRepository, ClientRepository, IdGenerator, UnitOfWork } from "@arb/work-queue-app";
import {
  ingestEvent, type IngestEventInput,
  claimWork, type ClaimWorkInput,
  startWork, type StartWorkInput,
  heartbeatWork, type HeartbeatWorkInput,
  completeWork, type CompleteWorkInput,
  failWork, type FailWorkInput,
  registerClient, type RegisterClientInput,
  manualKick, type ManualKickInput,
} from "@arb/work-queue-app";

// In-memory fakes — imported from the test fakes for now.
// These are perfectly functional for a dev server.
// We re-implement them here to avoid importing from __tests__.
import { WorkItem, WorkThread, Client } from "@arb/work-queue";

// ── In-memory repositories ──────────────────────────────────────────────

class InMemoryWorkItemRepository implements WorkItemRepository {
  private items = new Map<string, WorkItem>();

  async save(item: WorkItem) { this.items.set(item.id, item); }
  async findById(id: string) { return this.items.get(id) ?? null; }

  async findClaimable(userId: string) {
    const now = clock.now();
    return [...this.items.values()].filter(
      (i) => i.userId === userId && i.status === "pending" && i.availableAt.getTime() <= now.getTime(),
    );
  }

  async findNonTerminalByUserId(userId: string) {
    return [...this.items.values()].filter(
      (i) => i.userId === userId && i.status !== "completed" && i.status !== "dead",
    );
  }

  async findExpiredLeases() {
    const now = clock.now();
    return [...this.items.values()].filter(
      (i) => (i.status === "claimed" || i.status === "in_progress") &&
        i.leaseExpiresAt !== null && i.leaseExpiresAt.getTime() <= now.getTime(),
    );
  }

  async findRetryable() {
    return [...this.items.values()].filter((i) => i.isRetryable);
  }

  async findByThreadId(threadId: string) {
    return [...this.items.values()].filter((i) => i.threadId === threadId);
  }

  async findPendingByThreadId(threadId: string) {
    return [...this.items.values()].find(
      (i) => i.threadId === threadId && i.status === "pending",
    ) ?? null;
  }

  async existsNonTerminal(threadId: string, dedupKey?: string) {
    if (!dedupKey) return false;
    return [...this.items.values()].some(
      (i) => i.threadId === threadId && i.status !== "completed" && i.status !== "dead" &&
        (i.payload as Record<string, unknown>).dedupKey === dedupKey,
    );
  }

  all() { return [...this.items.values()]; }
}

class InMemoryWorkThreadRepository implements WorkThreadRepository {
  private threads = new Map<string, WorkThread>();

  async save(thread: WorkThread) { this.threads.set(thread.id, thread); }
  async findById(id: string) { return this.threads.get(id) ?? null; }

  async findByAffinityKey(userId: string, affinityKey: string) {
    for (const t of this.threads.values()) {
      if (t.userId === userId && t.affinityKey === affinityKey) return t;
    }
    return null;
  }

  all() { return [...this.threads.values()]; }
}

class InMemoryClientRepository implements ClientRepository {
  private clients = new Map<string, Client>();

  async save(client: Client) { this.clients.set(client.id, client); }
  async findById(id: string) { return this.clients.get(id) ?? null; }

  async findActiveByUserId(userId: string) {
    return [...this.clients.values()].filter(
      (c) => c.userId === userId && c.isAvailable(clock),
    );
  }

  all() { return [...this.clients.values()]; }
}

class IncrementingIdGenerator implements IdGenerator {
  private counter = 0;
  generate() { return `id-${++this.counter}`; }
}

class PassthroughUnitOfWork implements UnitOfWork {
  async run<T>(fn: () => Promise<T>) { return fn(); }
}

// ── Singleton instances ─────────────────────────────────────────────────
// Turbopack creates separate module instances for API routes vs Server
// Components. Attach singletons to globalThis so all codepaths share the
// same in-memory state.

class RealClock implements Clock {
  now() { return new Date(); }
}

interface QueueSingletons {
  clock: RealClock;
  workItems: InMemoryWorkItemRepository;
  workThreads: InMemoryWorkThreadRepository;
  clients: InMemoryClientRepository;
  ids: IncrementingIdGenerator;
  uow: PassthroughUnitOfWork;
  retryPolicy: RetryPolicy;
  affinityPolicy: AffinityPolicy;
  orderingPolicy: OrderingPolicy;
}

const g = globalThis as unknown as { __arb_queue?: QueueSingletons };

if (!g.__arb_queue) {
  g.__arb_queue = {
    clock: new RealClock(),
    workItems: new InMemoryWorkItemRepository(),
    workThreads: new InMemoryWorkThreadRepository(),
    clients: new InMemoryClientRepository(),
    ids: new IncrementingIdGenerator(),
    uow: new PassthroughUnitOfWork(),
    retryPolicy: new RetryPolicy(),
    affinityPolicy: new AffinityPolicy(),
    orderingPolicy: new OrderingPolicy(),
  };
}

const { clock, workItems, workThreads, clients, ids, uow, retryPolicy, affinityPolicy, orderingPolicy } = g.__arb_queue;

// ── Exported use-case wrappers ──────────────────────────────────────────

export async function handleIngestEvent(input: IngestEventInput) {
  return ingestEvent(input, { workItems, workThreads, ids, clock, uow });
}

export async function handleClaimWork(input: ClaimWorkInput) {
  return claimWork(input, { workItems, workThreads, clients, clock, uow, ordering: orderingPolicy, affinity: affinityPolicy });
}

export async function handleStartWork(input: StartWorkInput) {
  return startWork(input, { workItems, clock, uow });
}

export async function handleHeartbeatWork(input: HeartbeatWorkInput) {
  return heartbeatWork(input, { workItems, clients, clock, uow });
}

export async function handleCompleteWork(input: CompleteWorkInput) {
  return completeWork(input, { workItems, workThreads, clock, uow, affinity: affinityPolicy });
}

export async function handleFailWork(input: FailWorkInput) {
  return failWork(input, { workItems, clock, uow, retryPolicy });
}

export async function handleRegisterClient(input: RegisterClientInput) {
  return registerClient(input, { clients, ids, clock });
}

export async function handleManualKick(input: ManualKickInput) {
  return manualKick(input, { workItems, workThreads, ids, clock, uow });
}

// ── Read-model queries for the dashboard ────────────────────────────────

export function getQueueSummary() {
  const items = workItems.all();
  const summary = {
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    claimed: items.filter((i) => i.status === "claimed").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    completed: items.filter((i) => i.status === "completed").length,
    failed: items.filter((i) => i.status === "failed").length,
    dead: items.filter((i) => i.status === "dead").length,
  };
  return summary;
}

export function getActiveClients() {
  return clients.all().map((c) => ({
    id: c.id,
    userId: c.userId,
    name: c.name,
    status: c.status(clock),
    lastSeenAt: c.lastSeenAt.toISOString(),
  }));
}

export function getRecentItems(limit = 50) {
  const threadMap = new Map(workThreads.all().map((t) => [t.id, t]));

  return workItems
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((i) => {
      const thread = threadMap.get(i.threadId);
      const payload = i.payload as Record<string, unknown>;
      return {
        id: i.id,
        affinityKey: thread?.affinityKey ?? i.threadId,
        source: (payload.source as string) ?? null,
        type: (payload.type as string) ?? null,
        kind: i.kind,
        status: i.status,
        sequence: i.sequence,
        attemptCount: i.attemptCount,
        createdAt: i.createdAt.toISOString(),
        body: truncate((payload.body as string) ?? "", 120),
        url: (payload.url as string) ?? null,
        claimedByClientId: i.claimedByClientId,
        lastError: i.lastError,
      };
    });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

export function getThreads() {
  return workThreads.all().map((t) => ({
    id: t.id,
    userId: t.userId,
    affinityKey: t.affinityKey,
    preferredClientId: t.preferredClientId,
    lastSessionRef: t.lastSessionRef,
    nextSequence: t.nextSequence,
  }));
}
