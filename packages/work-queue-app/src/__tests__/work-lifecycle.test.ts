import {
  FakeClock,
  RetryPolicy,
  type Client,
  type WorkItem,
  type WorkThread,
} from "@arb/work-queue";
import { describe, it, expect } from "vitest";
import {
  FakeClientRepository,
  FakeIdGenerator,
  FakeUnitOfWork,
  FakeWorkItemRepository,
  FakeWorkThreadRepository,
} from "./fakes/index.js";
import { claimWork, type ClaimWorkResult } from "../use-cases/claim-work.js";
import { startWork } from "../use-cases/start-work.js";
import { heartbeatWork } from "../use-cases/heartbeat-work.js";
import { completeWork } from "../use-cases/complete-work.js";
import { failWork } from "../use-cases/fail-work.js";
import { ingestEvent } from "../use-cases/ingest-event.js";
import { registerClient } from "../use-cases/register-client.js";

class TestHarness {
  readonly userId = "user-1";
  readonly clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
  readonly ids = new FakeIdGenerator();
  readonly uow = new FakeUnitOfWork();
  readonly workItems = new FakeWorkItemRepository();
  readonly workThreads = new FakeWorkThreadRepository();
  readonly clients = new FakeClientRepository(this.clock);

  async ingestItem(affinityKey: string): Promise<{ workItem: WorkItem; thread: WorkThread }> {
    const result = await ingestEvent(
      {
        userId: this.userId,
        affinityKey,
        kind: "event",
        payload: { affinityKey },
      },
      {
        workItems: this.workItems,
        workThreads: this.workThreads,
        ids: this.ids,
        clock: this.clock,
        uow: this.uow,
      },
    );

    return {
      workItem: await this.getRequiredWorkItem(result.workItemId),
      thread: await this.getRequiredThread(result.threadId),
    };
  }

  async registerTestClient(name: string): Promise<Client> {
    const result = await registerClient(
      {
        userId: this.userId,
        name,
      },
      {
        clients: this.clients,
        ids: this.ids,
        clock: this.clock,
      },
    );

    return this.getRequiredClient(result.clientId);
  }

  async claim(clientId: string): Promise<ClaimWorkResult> {
    return claimWork(
      {
        clientId,
        userId: this.userId,
      },
      {
        workItems: this.workItems,
        workThreads: this.workThreads,
        clients: this.clients,
        clock: this.clock,
        uow: this.uow,
      },
    );
  }

  async start(workItemId: string, clientId: string): Promise<void> {
    return startWork(
      {
        workItemId,
        clientId,
      },
      {
        workItems: this.workItems,
        clock: this.clock,
        uow: this.uow,
      },
    );
  }

  async heartbeat(workItemId: string, clientId: string, leaseMs?: number): Promise<void> {
    return heartbeatWork(
      {
        workItemId,
        clientId,
      },
      {
        workItems: this.workItems,
        clients: this.clients,
        clock: this.clock,
        uow: this.uow,
        leaseMs,
      },
    );
  }

  async complete(workItemId: string, clientId: string, sessionRef?: string | null): Promise<void> {
    return completeWork(
      {
        workItemId,
        clientId,
        sessionRef,
      },
      {
        workItems: this.workItems,
        workThreads: this.workThreads,
        clock: this.clock,
        uow: this.uow,
      },
    );
  }

  async fail(
    workItemId: string,
    clientId: string,
    error: string,
    retryPolicy?: RetryPolicy,
  ): Promise<{ outcome: "retried" | "dead" }> {
    return failWork(
      {
        workItemId,
        clientId,
        error,
      },
      {
        workItems: this.workItems,
        clock: this.clock,
        uow: this.uow,
        retryPolicy,
      },
    );
  }

  advance(ms: number): void {
    this.clock.advance(ms);
  }

  async getRequiredWorkItem(id: string): Promise<WorkItem> {
    const item = await this.workItems.findById(id);
    if (!item) {
      throw new Error(`Expected work item to exist: ${id}`);
    }
    return item;
  }

  async getRequiredThread(id: string): Promise<WorkThread> {
    const thread = await this.workThreads.findById(id);
    if (!thread) {
      throw new Error(`Expected thread to exist: ${id}`);
    }
    return thread;
  }

  async getRequiredClient(id: string): Promise<Client> {
    const client = await this.clients.findById(id);
    if (!client) {
      throw new Error(`Expected client to exist: ${id}`);
    }
    return client;
  }
}

function expectWork(result: ClaimWorkResult): Extract<ClaimWorkResult, { kind: "work" }> {
  expect(result.kind).toBe("work");
  if (result.kind !== "work") {
    throw new Error("Expected claimWork to return work");
  }
  return result;
}

describe("claimWork", () => {
  it('returns { kind: "none" } when no work is available', async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");

    await expect(harness.claim(client.id)).resolves.toEqual({ kind: "none" });
  });

  it('returns { kind: "work" } with the correct work item when pending items exist', async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    const result = expectWork(await harness.claim(client.id));

    expect(result.workItem.id).toBe(workItem.id);
    expect(result.workItem.status).toBe("claimed");
    expect(result.workItem.claimedByClientId).toBe(client.id);
    expect(result.leaseExpiresAt.toISOString()).toBe("2025-01-01T00:01:00.000Z");
    expect(result.sessionRef).toBeNull();
  });

  it("throws when client not found", async () => {
    const harness = new TestHarness();
    await harness.ingestItem("thread-a");

    await expect(harness.claim("missing-client")).rejects.toThrow(
      "Client not found: missing-client",
    );
  });

  it("respects thread ordering so sequence 1 must complete before sequence 2 is claimable", async () => {
    const harness = new TestHarness();
    const clientA = await harness.registerTestClient("worker-a");
    const clientB = await harness.registerTestClient("worker-b");

    const first = await harness.ingestItem("thread-a");

    const firstClaim = expectWork(await harness.claim(clientA.id));
    expect(firstClaim.workItem.id).toBe(first.workItem.id);

    await harness.start(first.workItem.id, clientA.id);
    await harness.complete(first.workItem.id, clientA.id);

    // Second item can only be ingested after first is complete (coalescing would fold it otherwise)
    const second = await harness.ingestItem("thread-a");

    const secondClaim = expectWork(await harness.claim(clientB.id));
    expect(secondClaim.workItem.id).toBe(second.workItem.id);
  });

  it("prefers affinity-matched work for the preferred client", async () => {
    const harness = new TestHarness();
    const preferredClient = await harness.registerTestClient("preferred-worker");
    await harness.registerTestClient("other-worker");

    const neutral = await harness.ingestItem("thread-neutral");
    harness.advance(1_000);
    const preferred = await harness.ingestItem("thread-preferred");

    preferred.thread.setPreference(
      preferredClient.id,
      "session-preferred",
      60_000,
      harness.clock,
    );
    await harness.workThreads.save(preferred.thread);

    const result = expectWork(await harness.claim(preferredClient.id));

    expect(neutral.workItem.id).not.toBe(preferred.workItem.id);
    expect(result.workItem.id).toBe(preferred.workItem.id);
    expect(result.sessionRef).toBe("session-preferred");
  });

  it("touches client liveness on claim", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const initialLastSeenAt = client.lastSeenAt.getTime();

    harness.advance(15_000);
    await harness.claim(client.id);

    const updatedClient = await harness.getRequiredClient(client.id);
    expect(updatedClient.lastSeenAt.getTime()).toBe(harness.clock.now().getTime());
    expect(updatedClient.lastSeenAt.getTime()).toBeGreaterThan(initialLastSeenAt);
  });
});

describe("startWork", () => {
  it("transitions a claimed item to in_progress", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    harness.advance(5_000);
    await harness.start(workItem.id, client.id);

    const updatedItem = await harness.getRequiredWorkItem(workItem.id);
    expect(updatedItem.status).toBe("in_progress");
    expect(updatedItem.lastHeartbeatAt?.getTime()).toBe(harness.clock.now().getTime());
  });

  it("throws when work item is not found", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");

    await expect(harness.start("missing-work-item", client.id)).rejects.toThrow(
      "Work item not found: missing-work-item",
    );
  });

  it("throws when the client does not match the claimer", async () => {
    const harness = new TestHarness();
    const claimer = await harness.registerTestClient("worker-a");
    const otherClient = await harness.registerTestClient("worker-b");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(claimer.id);

    await expect(harness.start(workItem.id, otherClient.id)).rejects.toThrow(
      `Work item ${workItem.id} is claimed by ${claimer.id}, not ${otherClient.id}`,
    );
  });
});

describe("heartbeatWork", () => {
  it("extends the lease on an in_progress item", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    await harness.start(workItem.id, client.id);

    const claimedItem = await harness.getRequiredWorkItem(workItem.id);
    const originalLeaseExpiresAt = claimedItem.leaseExpiresAt;

    harness.advance(30_000);
    await harness.heartbeat(workItem.id, client.id, 90_000);

    const updatedItem = await harness.getRequiredWorkItem(workItem.id);
    expect(updatedItem.status).toBe("in_progress");
    expect(updatedItem.lastHeartbeatAt?.getTime()).toBe(harness.clock.now().getTime());
    expect(updatedItem.leaseExpiresAt?.getTime()).toBe(
      harness.clock.now().getTime() + 90_000,
    );
    expect(updatedItem.leaseExpiresAt?.getTime()).toBeGreaterThan(
      originalLeaseExpiresAt?.getTime() ?? 0,
    );
  });

  it("throws when work item is not found", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");

    await expect(harness.heartbeat("missing-work-item", client.id)).rejects.toThrow(
      "Work item not found: missing-work-item",
    );
  });

  it("throws when the client does not match", async () => {
    const harness = new TestHarness();
    const claimer = await harness.registerTestClient("worker-a");
    const otherClient = await harness.registerTestClient("worker-b");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(claimer.id);
    await harness.start(workItem.id, claimer.id);

    await expect(harness.heartbeat(workItem.id, otherClient.id)).rejects.toThrow(
      `Work item ${workItem.id} is not claimed by ${otherClient.id}`,
    );
  });

  it("touches client liveness", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    await harness.start(workItem.id, client.id);

    const lastSeenAfterClaim = (await harness.getRequiredClient(client.id)).lastSeenAt.getTime();

    harness.advance(10_000);
    await harness.heartbeat(workItem.id, client.id);

    const updatedClient = await harness.getRequiredClient(client.id);
    expect(updatedClient.lastSeenAt.getTime()).toBe(harness.clock.now().getTime());
    expect(updatedClient.lastSeenAt.getTime()).toBeGreaterThan(lastSeenAfterClaim);
  });
});

describe("completeWork", () => {
  it("transitions work to completed", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    await harness.start(workItem.id, client.id);
    harness.advance(20_000);
    await harness.complete(workItem.id, client.id);

    const updatedItem = await harness.getRequiredWorkItem(workItem.id);
    expect(updatedItem.status).toBe("completed");
    expect(updatedItem.completedAt?.getTime()).toBe(harness.clock.now().getTime());
    expect(updatedItem.leaseExpiresAt).toBeNull();
  });

  it("updates thread affinity preference and stores sessionRef", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem, thread } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    await harness.start(workItem.id, client.id);
    await harness.complete(workItem.id, client.id, "session-123");

    const updatedThread = await harness.getRequiredThread(thread.id);
    expect(updatedThread.preferredClientId).toBe(client.id);
    expect(updatedThread.lastSessionRef).toBe("session-123");
    expect(updatedThread.preferredClientExpiresAt).not.toBeNull();
    expect(updatedThread.prefersClient(client.id, harness.clock)).toBe(true);
  });

  it("throws when the client does not match", async () => {
    const harness = new TestHarness();
    const claimer = await harness.registerTestClient("worker-a");
    const otherClient = await harness.registerTestClient("worker-b");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(claimer.id);
    await harness.start(workItem.id, claimer.id);

    await expect(harness.complete(workItem.id, otherClient.id)).rejects.toThrow(
      `Work item ${workItem.id} is not claimed by ${otherClient.id}`,
    );
  });
});

describe("failWork", () => {
  it('transitions to retryable state and returns { outcome: "retried" }', async () => {
    const harness = new TestHarness();
    const retryPolicy = new RetryPolicy({ backoffMs: [10_000, 20_000, 30_000] });
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(client.id);
    await harness.start(workItem.id, client.id);
    const failedAt = harness.clock.now().getTime();

    await expect(harness.fail(workItem.id, client.id, "boom", retryPolicy)).resolves.toEqual({
      outcome: "retried",
    });

    const updatedItem = await harness.getRequiredWorkItem(workItem.id);
    expect(updatedItem.status).toBe("pending");
    expect(updatedItem.lastError).toBe("boom");
    expect(updatedItem.failedAt?.getTime()).toBe(failedAt);
    expect(updatedItem.availableAt.getTime()).toBe(failedAt + 10_000);
  });

  it('returns { outcome: "dead" } after max retries are exhausted', async () => {
    const harness = new TestHarness();
    const retryPolicy = new RetryPolicy({ backoffMs: [10, 20, 30] });
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    for (let attempt = 0; attempt < 2; attempt++) {
      const claimResult = expectWork(await harness.claim(client.id));
      expect(claimResult.workItem.id).toBe(workItem.id);
      await harness.start(workItem.id, client.id);
      await expect(harness.fail(workItem.id, client.id, `retry-${attempt}`, retryPolicy)).resolves.toEqual({
        outcome: "retried",
      });
    }

    const finalClaim = expectWork(await harness.claim(client.id));
    expect(finalClaim.workItem.id).toBe(workItem.id);
    await harness.start(workItem.id, client.id);

    await expect(harness.fail(workItem.id, client.id, "final-error", retryPolicy)).resolves.toEqual({
      outcome: "dead",
    });

    const updatedItem = await harness.getRequiredWorkItem(workItem.id);
    expect(updatedItem.status).toBe("dead");
    expect(updatedItem.attemptCount).toBe(3);
    expect(updatedItem.lastError).toBe("final-error");
  });

  it("throws when the client does not match", async () => {
    const harness = new TestHarness();
    const claimer = await harness.registerTestClient("worker-a");
    const otherClient = await harness.registerTestClient("worker-b");
    const { workItem } = await harness.ingestItem("thread-a");

    await harness.claim(claimer.id);
    await harness.start(workItem.id, claimer.id);

    await expect(harness.fail(workItem.id, otherClient.id, "boom")).rejects.toThrow(
      `Work item ${workItem.id} is not claimed by ${otherClient.id}`,
    );
  });
});

describe("work lifecycle flows", () => {
  it("runs the happy path: ingest → claim → start → heartbeat → complete", async () => {
    const harness = new TestHarness();
    const client = await harness.registerTestClient("worker-a");
    const { workItem, thread } = await harness.ingestItem("thread-a");

    const claimResult = expectWork(await harness.claim(client.id));
    expect(claimResult.workItem.id).toBe(workItem.id);
    expect(claimResult.sessionRef).toBeNull();

    await harness.start(workItem.id, client.id);
    harness.advance(5_000);
    await harness.heartbeat(workItem.id, client.id);
    await harness.complete(workItem.id, client.id, "session-happy");

    const finalItem = await harness.getRequiredWorkItem(workItem.id);
    const finalThread = await harness.getRequiredThread(thread.id);
    expect(finalItem.status).toBe("completed");
    expect(finalThread.preferredClientId).toBe(client.id);
    expect(finalThread.lastSessionRef).toBe("session-happy");
  });

  it("runs the retry path: ingest → claim → start → fail → claim → start → complete", async () => {
    const harness = new TestHarness();
    const retryPolicy = new RetryPolicy({ backoffMs: [1_000, 2_000, 3_000] });
    const client = await harness.registerTestClient("worker-a");
    const { workItem, thread } = await harness.ingestItem("thread-a");

    const firstClaim = expectWork(await harness.claim(client.id));
    expect(firstClaim.workItem.id).toBe(workItem.id);

    await harness.start(workItem.id, client.id);
    await expect(harness.fail(workItem.id, client.id, "temporary", retryPolicy)).resolves.toEqual({
      outcome: "retried",
    });

    const retryItem = await harness.getRequiredWorkItem(workItem.id);
    expect(retryItem.status).toBe("pending");

    const secondClaim = expectWork(await harness.claim(client.id));
    expect(secondClaim.workItem.id).toBe(workItem.id);

    await harness.start(workItem.id, client.id);
    await harness.complete(workItem.id, client.id, "session-retry");

    const finalItem = await harness.getRequiredWorkItem(workItem.id);
    const finalThread = await harness.getRequiredThread(thread.id);
    expect(finalItem.status).toBe("completed");
    expect(finalItem.attemptCount).toBe(2);
    expect(finalThread.lastSessionRef).toBe("session-retry");
  });

  it('runs the dead path: ingest → claim → fail → claim → fail → claim → fail → dead with maxAttempts=3', async () => {
    const harness = new TestHarness();
    const retryPolicy = new RetryPolicy({ backoffMs: [1_000, 2_000, 3_000] });
    const client = await harness.registerTestClient("worker-a");
    const { workItem } = await harness.ingestItem("thread-a");

    for (let attempt = 1; attempt <= 2; attempt++) {
      const claimResult = expectWork(await harness.claim(client.id));
      expect(claimResult.workItem.id).toBe(workItem.id);
      await expect(harness.fail(workItem.id, client.id, `failure-${attempt}`, retryPolicy)).resolves.toEqual({
        outcome: "retried",
      });
    }

    const finalClaim = expectWork(await harness.claim(client.id));
    expect(finalClaim.workItem.id).toBe(workItem.id);

    await expect(harness.fail(workItem.id, client.id, "failure-3", retryPolicy)).resolves.toEqual({
      outcome: "dead",
    });

    const finalItem = await harness.getRequiredWorkItem(workItem.id);
    expect(finalItem.status).toBe("dead");
    expect(finalItem.attemptCount).toBe(3);
    await expect(harness.claim(client.id)).resolves.toEqual({ kind: "none" });
  });
});
