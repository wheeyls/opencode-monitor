import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { WorkItem } from "../entities/work-item.js";
import { OrderingPolicy } from "../policies/ordering-policy.js";

function createWorkItem(overrides: Partial<ConstructorParameters<typeof WorkItem>[0]> = {}): WorkItem {
  return new WorkItem({
    id: overrides.id ?? `item-${overrides.threadId ?? "thread-1"}-${overrides.sequence ?? 1}`,
    userId: overrides.userId ?? "user-1",
    threadId: overrides.threadId ?? "thread-1",
    kind: overrides.kind ?? "event",
    sequence: overrides.sequence ?? 1,
    payload: overrides.payload ?? {},
    maxAttempts: overrides.maxAttempts,
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00Z"),
    availableAt: overrides.availableAt ?? new Date("2025-01-01T00:00:00Z"),
  });
}

function claimItem(item: WorkItem, clock: FakeClock, clientId = "client-1"): void {
  item.claim(clientId, 60_000, clock);
}

function startItem(item: WorkItem, clock: FakeClock, clientId = "client-1"): void {
  item.claim(clientId, 60_000, clock);
  item.start(clock);
}

function failItem(item: WorkItem, clock: FakeClock, clientId = "client-1"): void {
  item.claim(clientId, 60_000, clock);
  item.fail("boom", clock);
}

function completeItem(item: WorkItem, clock: FakeClock, clientId = "client-1"): void {
  item.claim(clientId, 60_000, clock);
  item.start(clock);
  item.complete(clock);
}

describe("OrderingPolicy", () => {
  it("claimable() returns items when no blocking items exist", () => {
    const policy = new OrderingPolicy();
    const itemA = createWorkItem({ id: "item-a", threadId: "thread-a", sequence: 1 });
    const itemB = createWorkItem({ id: "item-b", threadId: "thread-b", sequence: 1 });

    const claimable = policy.claimable([itemA, itemB], [itemA, itemB]);

    expect(claimable.map((item) => item.id)).toEqual(["item-a", "item-b"]);
  });

  it("claimable() blocks higher-sequence items when lower-sequence items are claimed, in_progress, or failed", () => {
    const clock = new FakeClock();
    const policy = new OrderingPolicy();

    const claimedLower = createWorkItem({ id: "claimed-lower", threadId: "thread-claimed", sequence: 1 });
    const claimedHigher = createWorkItem({ id: "claimed-higher", threadId: "thread-claimed", sequence: 2 });
    claimItem(claimedLower, clock);

    const startedLower = createWorkItem({ id: "started-lower", threadId: "thread-started", sequence: 1 });
    const startedHigher = createWorkItem({ id: "started-higher", threadId: "thread-started", sequence: 2 });
    startItem(startedLower, clock, "client-2");

    const failedLower = createWorkItem({ id: "failed-lower", threadId: "thread-failed", sequence: 1 });
    const failedHigher = createWorkItem({ id: "failed-higher", threadId: "thread-failed", sequence: 2 });
    failItem(failedLower, clock, "client-3");

    const claimable = policy.claimable(
      [claimedHigher, startedHigher, failedHigher],
      [claimedLower, claimedHigher, startedLower, startedHigher, failedLower, failedHigher],
    );

    expect(claimable).toEqual([]);
  });

  it("claimable() allows items when lower-sequence items are terminal (completed or dead)", () => {
    const clock = new FakeClock();
    const policy = new OrderingPolicy();

    const completedLower = createWorkItem({ id: "completed-lower", threadId: "thread-completed", sequence: 1 });
    const completedHigher = createWorkItem({ id: "completed-higher", threadId: "thread-completed", sequence: 2 });
    completeItem(completedLower, clock);

    const deadLower = createWorkItem({ id: "dead-lower", threadId: "thread-dead", sequence: 1 });
    const deadHigher = createWorkItem({ id: "dead-higher", threadId: "thread-dead", sequence: 2 });
    deadLower.kill();

    const claimable = policy.claimable(
      [completedHigher, deadHigher],
      [completedHigher, deadHigher],
    );

    expect(claimable.map((item) => item.id)).toEqual([
      "completed-higher",
      "dead-higher",
    ]);
  });

  it("claimable() orders results by availableAt, then createdAt", () => {
    const policy = new OrderingPolicy();
    const late = createWorkItem({
      id: "late",
      threadId: "thread-late",
      sequence: 1,
      createdAt: new Date("2025-01-01T00:00:30Z"),
      availableAt: new Date("2025-01-01T00:02:00Z"),
    });
    const earlyCreatedLater = createWorkItem({
      id: "early-created-later",
      threadId: "thread-early-later",
      sequence: 1,
      createdAt: new Date("2025-01-01T00:00:20Z"),
      availableAt: new Date("2025-01-01T00:01:00Z"),
    });
    const earlyCreatedSooner = createWorkItem({
      id: "early-created-sooner",
      threadId: "thread-early-sooner",
      sequence: 1,
      createdAt: new Date("2025-01-01T00:00:10Z"),
      availableAt: new Date("2025-01-01T00:01:00Z"),
    });

    const claimable = policy.claimable(
      [late, earlyCreatedLater, earlyCreatedSooner],
      [late, earlyCreatedLater, earlyCreatedSooner],
    );

    expect(claimable.map((item) => item.id)).toEqual([
      "early-created-sooner",
      "early-created-later",
      "late",
    ]);
  });

  it("blocking in one thread does not affect claimable items in other threads", () => {
    const clock = new FakeClock();
    const policy = new OrderingPolicy();

    const blockedLower = createWorkItem({ id: "blocked-lower", threadId: "thread-a", sequence: 1 });
    const blockedHigher = createWorkItem({ id: "blocked-higher", threadId: "thread-a", sequence: 2 });
    claimItem(blockedLower, clock);

    const otherThreadItem = createWorkItem({ id: "other-thread-item", threadId: "thread-b", sequence: 1 });

    const claimable = policy.claimable(
      [blockedHigher, otherThreadItem],
      [blockedLower, blockedHigher, otherThreadItem],
    );

    expect(claimable.map((item) => item.id)).toEqual(["other-thread-item"]);
  });

  it("returns an empty array for empty input", () => {
    const policy = new OrderingPolicy();

    expect(policy.claimable([], [])).toEqual([]);
  });

  it("for a single thread with sequences 1, 2, 3 only sequence 1 is claimable when 1 is pending", () => {
    const policy = new OrderingPolicy();
    const item1 = createWorkItem({ id: "item-1", threadId: "thread-1", sequence: 1 });
    const item2 = createWorkItem({ id: "item-2", threadId: "thread-1", sequence: 2 });
    const item3 = createWorkItem({ id: "item-3", threadId: "thread-1", sequence: 3 });

    const claimable = policy.claimable([item1, item2, item3], [item1, item2, item3]);

    expect(claimable.map((item) => item.id)).toEqual(["item-1"]);
  });

  it("if sequence 1 is completed and sequence 2 is pending, sequence 2 is claimable", () => {
    const clock = new FakeClock();
    const policy = new OrderingPolicy();
    const item1 = createWorkItem({ id: "item-1", threadId: "thread-1", sequence: 1 });
    const item2 = createWorkItem({ id: "item-2", threadId: "thread-1", sequence: 2 });
    const item3 = createWorkItem({ id: "item-3", threadId: "thread-1", sequence: 3 });

    completeItem(item1, clock);

    const claimable = policy.claimable([item2, item3], [item2, item3]);

    expect(claimable.map((item) => item.id)).toEqual(["item-2"]);
  });
});
