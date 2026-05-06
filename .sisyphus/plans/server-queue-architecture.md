# arb Server + Queue Architecture Plan

## Overview

Transform arb from a single-machine CLI into a multi-tenant web service with a work queue, allowing multiple consumer clients to process events independently.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  arb server                      │
│  (Next.js shell + TypeScript domain)             │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Pollers  │→ │  Queue   │← │  Dashboard    │  │
│  │ GH/Jira  │  │ (Postgres)│  │  (read model) │  │
│  └──────────┘  └────┬─────┘  └───────────────┘  │
│                     │                            │
│            ┌────────┴────────┐                   │
│            │  HTTP API       │                   │
│            │  claim/heartbeat│                   │
│            └────────┬────────┘                   │
└─────────────────────┼───────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
    ┌────┴───┐   ┌────┴───┐  ┌────┴───┐
    │ Client │   │ Client │  │ Client │
    │ (arb)  │   │ (arb)  │  │ (arb)  │
    │  ↓     │   │  ↓     │  │  ↓     │
    │OpenCode│   │OpenCode│  │OpenCode│
    └────────┘   └────────┘  └────────┘
```

## Monorepo Structure

```
/packages
  /arb-domain          # Pure TS — entities, state machines, policies
    /src
      /entities
        WorkItem.ts
        WorkThread.ts
        Client.ts
      /value-objects
        WorkItemStatus.ts
        Lease.ts
        AffinityKey.ts
      /policies
        RetryPolicy.ts
        AffinityPolicy.ts
        OrderingPolicy.ts

  /arb-application     # Use-cases + port interfaces (no DB, no framework)
    /src
      /ports
        WorkItemRepository.ts
        WorkThreadRepository.ts
        ClientRepository.ts
        Clock.ts
      /use-cases
        ingestEvent.ts
        claimWork.ts
        heartbeatWork.ts
        completeWork.ts
        failWork.ts
        registerClient.ts
        manualKick.ts
      /contracts        # Shared DTOs between server and CLI
        api.ts

  /arb-infra           # Postgres repos, poller adapters
    /src
      /db
        /migrations
        /repositories
      /pollers
      /jobs
        leaseReaper.ts
        retryScheduler.ts

/apps
  /arb-server          # Next.js thin shell
    /app               # App router pages + API routes
    /src
      /auth            # Google OAuth, @g2.com restriction
      /composition     # Wires use-cases to infra

  /arb-cli             # Current CLI, evolved
    /src
      /commands        # start, status, kick, jira, client
      /worker          # claim/heartbeat/dispatch loop
      /dispatch        # OpenCode integration (existing code)
```

## Core Domain Entities

### WorkThread
The affinity anchor — one PR, issue, or Jira ticket.

```ts
type WorkThread = {
  id: string
  userId: string
  affinityKey: string          // e.g. "github:g2crowd/ue:pr:39228"
  preferredClientId: string | null
  preferredClientExpiresAt: Date | null
  lastSessionRef: string | null  // opaque OpenCode session ID
  nextSequence: number
}
```

### WorkItem
The queue record.

```ts
type WorkItemStatus = "pending" | "claimed" | "in_progress" | "completed" | "failed" | "dead"

type WorkItem = {
  id: string
  userId: string
  threadId: string
  kind: "event" | "manual_kick"
  sequence: number
  status: WorkItemStatus
  payload: Record<string, unknown>
  availableAt: Date
  attemptCount: number
  maxAttempts: number             // default 3
  claimedByClientId: string | null
  leaseExpiresAt: Date | null
  lastHeartbeatAt: Date | null
  lastError: string | null
}
```

### Client
A registered arb consumer.

```ts
type Client = {
  id: string
  userId: string
  name: string
  status: "active" | "stale" | "offline"
  lastSeenAt: Date
  capabilities: Record<string, unknown>
}
```

## WorkItem State Machine

```
pending
  → claimed       (client claims via API)
  → dead          (admin action)

claimed
  → in_progress   (client confirms start)
  → pending       (lease expired before start)
  → failed        (client rejects)

in_progress
  → completed     (client reports success)
  → failed        (client reports error OR lease timeout)

failed
  → pending       (retryable, attemptCount < maxAttempts, set availableAt with backoff)
  → dead          (attempts exhausted or non-retryable)
```

### Retry backoff
- Attempt 1 → +30s
- Attempt 2 → +2m
- Attempt 3 → +10m
- Then dead

## Queue Semantics

### Claiming
Postgres `FOR UPDATE SKIP LOCKED` in a transaction:
1. Filter: `status = pending`, `availableAt <= now()`, matching `userId`
2. Exclude threads with an earlier non-terminal item (strict thread ordering)
3. Prefer items whose thread's `preferredClientId` matches the claiming client
4. Otherwise oldest by priority/availableAt/createdAt

### Leasing + Heartbeat
- Claim lease: 60s
- Client heartbeat: every 20s
- Server reaper: every 15-30s (reclaims expired leases)

### Ordering
- Strict FIFO within a WorkThread
- Best-effort oldest-first across threads
- No global FIFO guarantee

### Session Affinity (soft)
- On completion, set `thread.preferredClientId` to the completing client
- Store `lastSessionRef` (OpenCode session ID) so client can resume
- Preference decays after TTL (e.g. 24h)
- If preferred client is offline/stale, any client can claim

## Client-Server Protocol (HTTP)

```
POST /api/client/register     → { clientId }
POST /api/client/claim        → { kind: "work", workItem, lease, affinity } | { kind: "none", retryAfterMs }
POST /api/client/heartbeat    → 204
POST /api/work/:id/start      → 204
POST /api/work/:id/complete   → 204
POST /api/work/:id/fail       → 204
POST /api/work/manual-kick    → { workItemId }
```

Claim supports `waitSeconds` for long-polling.

## Auth

- Google OAuth via next-auth
- Restrict to @g2.com domain
- Each user generates API tokens (stored as hashes)
- CLI authenticates with `arbServerUrl` + `arbServerToken` in config

## Database

Postgres. SQLite is not suitable for concurrent claims and multi-tenant leasing.

## Testing Strategy

### 1. Domain unit tests (arb-domain)
- State transitions on WorkItem
- Retry policy + backoff calculation
- Affinity preference/decay
- Thread ordering rules
- Use fake clock everywhere

### 2. Application tests (arb-application)
- Use-cases with in-memory repo fakes
- Ingest deduplication
- Claim → start → complete flow
- Failed → retry → dead flow
- Manual kick creates correct work item

### 3. Postgres integration tests (arb-infra)
- Concurrent claim race conditions
- Lease expiry requeue (exactly once)
- Thread ordering enforcement
- Idempotent completion/failure

### 4. CLI worker tests (arb-cli)
- Mock server, verify register/claim/heartbeat loop
- Recovery after network errors
- Completion/failure reporting

### 5. Thin Next.js tests (arb-server)
- Auth + domain restriction
- Route wiring
- Dashboard rendering

## Migration Path

### Phase 1: Stabilize CLI boundaries
Extract `Dispatcher` interface. Current behavior = `LocalOpenCodeDispatcher`.

### Phase 2: Normalized events
CLI produces `NormalizedEvent` internally, even for local dispatch.

### Phase 3: Server as passive queue sink
New `ServerQueueDispatcher` — CLI polls, pushes to server instead of OpenCode.

### Phase 4: CLI worker mode
`arb client` command — claims from server, dispatches to local OpenCode.

### Phase 5: Server-side polling
Server owns GitHub/Jira polling per user. CLI becomes pure consumer.

### Phase 6: Deprecate direct dispatch
Local mode stays as dev fallback. Production = server-backed.

## Config Evolution

Current (local mode):
```json
{
  "org": "g2crowd",
  "workingDir": "~/code/ue",
  "triggerPhrases": ["/ai", "ai:"],
  "jira": { ... }
}
```

New (server mode):
```json
{
  "arbServerUrl": "https://arb.g2.com",
  "arbServerToken": "arb_tok_...",
  "workingDir": "~/code/ue",
  "reposDir": "~/code"
}
```

Presence of `arbServerUrl` switches to server mode. Without it, local mode.
