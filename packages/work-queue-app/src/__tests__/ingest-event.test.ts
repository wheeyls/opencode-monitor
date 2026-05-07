import { FakeClock } from "@arb/work-queue";
import { describe, it, expect } from "vitest";
import {
  FakeIdGenerator,
  FakeUnitOfWork,
  FakeWorkItemRepository,
  FakeWorkThreadRepository,
} from "./fakes/index.js";
import { ingestEvent } from "../use-cases/ingest-event.js";

function createDeps() {
  const clock = new FakeClock(new Date("2025-02-03T04:05:06.000Z"));

  return {
    clock,
    ids: new FakeIdGenerator(),
    uow: new FakeUnitOfWork(),
    workItems: new FakeWorkItemRepository(),
    workThreads: new FakeWorkThreadRepository(),
  };
}

describe("ingestEvent", () => {
  it("creates a new work thread and work item with the expected fields", async () => {
    const deps = createDeps();

    const result = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "account-123",
        kind: "event",
        payload: { eventName: "invoice.created", amount: 42 },
      },
      deps,
    );

    expect(result).toEqual({
      workItemId: "id-2",
      threadId: "id-1",
      deduplicated: false,
      coalesced: false,
    });

    const threads = deps.workThreads.all();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.id).toBe("id-1");
    expect(threads[0]?.userId).toBe("user-1");
    expect(threads[0]?.affinityKey).toBe("account-123");
    expect(threads[0]?.nextSequence).toBe(2);

    const item = await deps.workItems.findById(result.workItemId);
    expect(item).not.toBeNull();
    expect(item?.threadId).toBe("id-1");
    expect(item?.userId).toBe("user-1");
    expect(item?.kind).toBe("event");
    expect(item?.sequence).toBe(1);
    expect(item?.payload).toEqual({
      eventName: "invoice.created",
      amount: 42,
      dedupKey: undefined,
    });
    expect(item?.createdAt).toEqual(new Date("2025-02-03T04:05:06.000Z"));
    expect(item?.availableAt).toEqual(new Date("2025-02-03T04:05:06.000Z"));
  });

  it("coalesces into existing pending item for the same affinity key", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { order: 1 },
      },
      deps,
    );

    deps.clock.advance(1_000);

    const second = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { order: 2 },
      },
      deps,
    );

    expect(second.coalesced).toBe(true);
    expect(second.threadId).toBe(first.threadId);
    expect(second.workItemId).toBe(first.workItemId);
    expect(deps.workThreads.all()).toHaveLength(1);

    const items = await deps.workItems.findByThreadId(first.threadId);
    expect(items).toHaveLength(1);

    const item = items[0];
    expect(item.payload.coalescedEvents).toEqual([{ order: 2 }]);
  });

  it("creates new item after prior item is completed (no coalescing)", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { order: 1 },
      },
      deps,
    );

    const firstItem = await deps.workItems.findById(first.workItemId);
    firstItem!.claim("client-1", 30_000, deps.clock);
    firstItem!.start(deps.clock);
    firstItem!.complete(deps.clock);

    deps.clock.advance(1_000);

    const second = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { order: 2 },
      },
      deps,
    );

    expect(second.coalesced).toBe(false);
    expect(second.workItemId).not.toBe(first.workItemId);
    expect(second.threadId).toBe(first.threadId);

    const items = await deps.workItems.findByThreadId(first.threadId);
    expect(items).toHaveLength(2);
  });

  it("returns deduplicated when a non-terminal item exists with the same dedup key", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { source: "webhook" },
        dedupKey: "evt-123",
      },
      deps,
    );

    const second = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { source: "webhook" },
        dedupKey: "evt-123",
      },
      deps,
    );

    expect(first.workItemId).toBe("id-2");
    expect(second).toEqual({
      workItemId: "",
      threadId: first.threadId,
      deduplicated: true,
      coalesced: false,
    });
    expect(deps.workThreads.all()).toHaveLength(1);
    expect(deps.workItems.all()).toHaveLength(1);
  });

  it("allows a new item when the prior item with the same dedup key is terminal", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { source: "webhook" },
        dedupKey: "evt-123",
      },
      deps,
    );

    const firstItem = await deps.workItems.findById(first.workItemId);
    expect(firstItem).not.toBeNull();

    firstItem?.claim("client-1", 30_000, deps.clock);
    firstItem?.start(deps.clock);
    firstItem?.complete(deps.clock);

    deps.clock.advance(1_000);

    const second = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { source: "webhook", retry: true },
        dedupKey: "evt-123",
      },
      deps,
    );

    expect(second.deduplicated).toBe(false);
    expect(second.threadId).toBe(first.threadId);

    const items = await deps.workItems.findByThreadId(first.threadId);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.sequence)).toEqual([1, 2]);
    expect(items.map((item) => item.status)).toEqual(["completed", "pending"]);
  });

  it("creates different threads for different affinity keys", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "alpha",
        kind: "event",
        payload: { index: 1 },
      },
      deps,
    );

    const second = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "beta",
        kind: "event",
        payload: { index: 2 },
      },
      deps,
    );

    expect(first.threadId).not.toBe(second.threadId);
    expect(deps.workThreads.all()).toHaveLength(2);
  });

  it("separates threads by user even when the affinity key matches", async () => {
    const deps = createDeps();

    const first = await ingestEvent(
      {
        userId: "user-1",
        affinityKey: "shared-key",
        kind: "event",
        payload: { index: 1 },
      },
      deps,
    );

    const second = await ingestEvent(
      {
        userId: "user-2",
        affinityKey: "shared-key",
        kind: "event",
        payload: { index: 2 },
      },
      deps,
    );

    expect(first.threadId).not.toBe(second.threadId);
    expect(deps.workThreads.all()).toHaveLength(2);
    expect(deps.workThreads.all().map((thread) => thread.userId)).toEqual([
      "user-1",
      "user-2",
    ]);
  });
});
