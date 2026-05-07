// Ports
export type { WorkItemRepository } from "./ports/work-item-repository.js";
export type { WorkThreadRepository } from "./ports/work-thread-repository.js";
export type { ClientRepository } from "./ports/client-repository.js";
export type { IdGenerator } from "./ports/id-generator.js";
export type { UnitOfWork } from "./ports/unit-of-work.js";

// Use-cases
export { ingestEvent } from "./use-cases/ingest-event.js";
export type { IngestEventInput, IngestEventResult, IngestEventDeps } from "./use-cases/ingest-event.js";

export { claimWork } from "./use-cases/claim-work.js";
export type { ClaimWorkInput, ClaimWorkResult, ClaimWorkDeps } from "./use-cases/claim-work.js";

export { startWork } from "./use-cases/start-work.js";
export type { StartWorkInput, StartWorkDeps } from "./use-cases/start-work.js";

export { heartbeatWork } from "./use-cases/heartbeat-work.js";
export type { HeartbeatWorkInput, HeartbeatWorkDeps } from "./use-cases/heartbeat-work.js";

export { completeWork } from "./use-cases/complete-work.js";
export type { CompleteWorkInput, CompleteWorkDeps } from "./use-cases/complete-work.js";

export { failWork } from "./use-cases/fail-work.js";
export type { FailWorkInput, FailWorkResult, FailWorkDeps } from "./use-cases/fail-work.js";

export { registerClient } from "./use-cases/register-client.js";
export type { RegisterClientInput, RegisterClientResult, RegisterClientDeps } from "./use-cases/register-client.js";

export { manualKick } from "./use-cases/manual-kick.js";
export type { ManualKickInput, ManualKickDeps } from "./use-cases/manual-kick.js";

// In-memory fakes (for dev servers and composition roots)
export { FakeWorkItemRepository } from "./fakes/fake-work-item-repository.js";
export { FakeWorkThreadRepository } from "./fakes/fake-work-thread-repository.js";
export { FakeClientRepository } from "./fakes/fake-client-repository.js";
export { FakeIdGenerator } from "./fakes/fake-id-generator.js";
export { FakeUnitOfWork } from "./fakes/fake-unit-of-work.js";
