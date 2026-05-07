import { FakeClock } from "@arb/work-queue";
import { describe, it, expect } from "vitest";
import {
  FakeIdGenerator,
  FakeUnitOfWork,
  FakeWorkItemRepository,
  FakeWorkThreadRepository,
} from "./fakes/index.js";
import { manualKick } from "../use-cases/manual-kick.js";

function createDeps() {
  const clock = new FakeClock(new Date("2025-03-04T05:06:07.000Z"));

  return {
    clock,
    ids: new FakeIdGenerator(),
    uow: new FakeUnitOfWork(),
    workItems: new FakeWorkItemRepository(),
    workThreads: new FakeWorkThreadRepository(),
  };
}

describe("manualKick", () => {
  it("creates a work item with kind manual_kick", async () => {
    const deps = createDeps();

    const result = await manualKick(
      {
        userId: "user-1",
        affinityKey: "account-123",
        message: "Reprocess this account",
      },
      deps,
    );

    const item = await deps.workItems.findById(result.workItemId);

    expect(item).not.toBeNull();
    expect(item?.kind).toBe("manual_kick");
  });

  it("stores the provided message in the payload", async () => {
    const deps = createDeps();

    const result = await manualKick(
      {
        userId: "user-1",
        affinityKey: "account-123",
        message: "Run a manual sync",
      },
      deps,
    );

    const item = await deps.workItems.findById(result.workItemId);

    expect(item?.payload).toEqual({
      message: "Run a manual sync",
      dedupKey: undefined,
    });
  });

  it("uses the default message when none is provided", async () => {
    const deps = createDeps();

    const result = await manualKick(
      {
        userId: "user-1",
        affinityKey: "account-123",
      },
      deps,
    );

    const item = await deps.workItems.findById(result.workItemId);

    expect(item?.payload).toEqual({
      message: "Manual kick for account-123",
      dedupKey: undefined,
    });
  });

  it("coalesces into existing pending item for the same affinity key", async () => {
    const deps = createDeps();

    const first = await manualKick(
      {
        userId: "user-1",
        affinityKey: "account-123",
        message: "First kick",
      },
      deps,
    );

    const second = await manualKick(
      {
        userId: "user-1",
        affinityKey: "account-123",
        message: "Second kick",
      },
      deps,
    );

    expect(second.coalesced).toBe(true);
    expect(first.threadId).toBe(second.threadId);
    expect(deps.workThreads.all()).toHaveLength(1);

    const items = await deps.workItems.findByThreadId(first.threadId);
    expect(items).toHaveLength(1);
    expect(items[0].payload.coalescedEvents).toEqual([
      { message: "Second kick" },
    ]);
  });
});
