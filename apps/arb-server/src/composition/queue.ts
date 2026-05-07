import { type Clock, RetryPolicy, AffinityPolicy, OrderingPolicy } from "@arb/work-queue";
import type { WorkItemRepository, WorkThreadRepository, ClientRepository, IdGenerator, UnitOfWork } from "@arb/work-queue-app";
import {
  FakeWorkItemRepository, FakeWorkThreadRepository, FakeClientRepository,
  FakeIdGenerator, FakeUnitOfWork,
  ingestEvent, type IngestEventInput,
  claimWork, type ClaimWorkInput,
  startWork, type StartWorkInput,
  heartbeatWork, type HeartbeatWorkInput,
  completeWork, type CompleteWorkInput,
  failWork, type FailWorkInput,
  registerClient, type RegisterClientInput,
  manualKick, type ManualKickInput,
} from "@arb/work-queue-app";

class RealClock implements Clock {
  now() { return new Date(); }
}

// ── Singleton wiring ────────────────────────────────────────────────────
// Turbopack creates separate module instances for API routes vs Server
// Components. Attach singletons to globalThis so all codepaths share
// the same state.

interface QueueSingletons {
  clock: Clock;
  workItems: WorkItemRepository;
  workThreads: WorkThreadRepository;
  clients: ClientRepository;
  ids: IdGenerator;
  uow: UnitOfWork;
  retryPolicy: RetryPolicy;
  affinityPolicy: AffinityPolicy;
  orderingPolicy: OrderingPolicy;
  pgPool?: import("pg").Pool;
}

const g = globalThis as unknown as { __arb_queue?: QueueSingletons };

function buildSingletons(): QueueSingletons {
  const clock = new RealClock();
  const retryPolicy = new RetryPolicy();
  const affinityPolicy = new AffinityPolicy();
  const orderingPolicy = new OrderingPolicy();

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPool, PgWorkItemRepository, PgWorkThreadRepository, PgClientRepository, PgUnitOfWork, PgIdGenerator, migrate, LeaseReaper, RetryScheduler } = require("@arb/queue-persistence");
    const pool = createPool(databaseUrl);
    console.log("[queue] Using Postgres persistence");

    migrate(pool).catch((err: Error) => console.error("[queue] Migration failed:", err.message));

    const workItems = new PgWorkItemRepository(pool);
    const workThreads = new PgWorkThreadRepository(pool);
    const clients = new PgClientRepository(pool, clock);

    const reaper = new LeaseReaper(workItems, clock);
    reaper.start();
    const scheduler = new RetryScheduler(workItems, clock);
    scheduler.start();

    return {
      clock, workItems, workThreads, clients,
      ids: new PgIdGenerator(),
      uow: new PgUnitOfWork(pool),
      retryPolicy, affinityPolicy, orderingPolicy,
      pgPool: pool,
    };
  }

  console.log("[queue] Using in-memory persistence (set DATABASE_URL for Postgres)");
  return {
    clock,
    workItems: new FakeWorkItemRepository(),
    workThreads: new FakeWorkThreadRepository(),
    clients: new FakeClientRepository(clock),
    ids: new FakeIdGenerator(),
    uow: new FakeUnitOfWork(),
    retryPolicy, affinityPolicy, orderingPolicy,
  };
}

if (!g.__arb_queue) {
  g.__arb_queue = buildSingletons();
}

const { clock, workItems, workThreads, clients, ids, uow, retryPolicy, affinityPolicy, orderingPolicy } = g.__arb_queue;

export { clock, workItems, workThreads, clients };
export const pgPool = g.__arb_queue.pgPool;

// ── Use-case wrappers ───────────────────────────────────────────────────

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
