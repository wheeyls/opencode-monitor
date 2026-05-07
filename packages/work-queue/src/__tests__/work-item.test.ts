import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { WorkItem, type WorkItemProps } from "../entities/work-item.js";

function buildWorkItem(overrides: Partial<WorkItemProps> = {}): WorkItem {
  const createdAt = overrides.createdAt ?? new Date("2025-01-01T00:00:00Z");

  return new WorkItem({
    id: overrides.id ?? "work-item-1",
    userId: overrides.userId ?? "user-1",
    threadId: overrides.threadId ?? "thread-1",
    kind: overrides.kind ?? "event",
    sequence: overrides.sequence ?? 1,
    payload: overrides.payload ?? { hello: "world" },
    maxAttempts: overrides.maxAttempts,
    createdAt,
    availableAt: overrides.availableAt ?? createdAt,
  });
}

function claimItem(item: WorkItem, clock: FakeClock, leaseMs = 30_000): void {
  item.claim("client-1", leaseMs, clock);
}

function claimAndStart(item: WorkItem, clock: FakeClock, leaseMs = 30_000): void {
  claimItem(item, clock, leaseMs);
  item.start(clock);
}

describe("WorkItem", () => {
  describe("claim", () => {
    it("transitions from pending to claimed and records lease details", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem({
        createdAt: new Date("2025-01-01T09:59:00Z"),
        availableAt: new Date("2025-01-01T09:59:00Z"),
      });

      item.claim("client-123", 60_000, clock);

      expect(item.status).toBe("claimed");
      expect(item.claimedByClientId).toBe("client-123");
      expect(item.attemptCount).toBe(1);
      expect(item.leaseExpiresAt).toEqual(new Date("2025-01-01T10:01:00Z"));
      expect(item.lastHeartbeatAt).toBeNull();
    });

    it("increments attemptCount on each claim", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      item.claim("client-1", 10_000, clock);
      expect(item.attemptCount).toBe(1);

      item.expireLease();
      clock.advance(5_000);

      item.claim("client-2", 10_000, clock);
      expect(item.attemptCount).toBe(2);
      expect(item.claimedByClientId).toBe("client-2");
      expect(item.leaseExpiresAt).toEqual(new Date("2025-01-01T10:00:15Z"));
    });
  });

  describe("start", () => {
    it("transitions from claimed to in_progress and records the first heartbeat time", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      item.claim("client-1", 30_000, clock);
      clock.advance(2_000);

      item.start(clock);

      expect(item.status).toBe("in_progress");
      expect(item.lastHeartbeatAt).toEqual(new Date("2025-01-01T10:00:02Z"));
      expect(item.leaseExpiresAt).toEqual(new Date("2025-01-01T10:00:30Z"));
    });
  });

  describe("heartbeat", () => {
    it("extends the lease and records the heartbeat timestamp", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock, 10_000);
      expect(item.leaseExpiresAt).toEqual(new Date("2025-01-01T10:00:10Z"));

      clock.advance(4_000);
      item.heartbeat(20_000, clock);

      expect(item.status).toBe("in_progress");
      expect(item.lastHeartbeatAt).toEqual(new Date("2025-01-01T10:00:04Z"));
      expect(item.leaseExpiresAt).toEqual(new Date("2025-01-01T10:00:24Z"));
    });

    it("throws when the work item is not in_progress", () => {
      const clock = new FakeClock();
      const pendingItem = buildWorkItem();

      expect(() => pendingItem.heartbeat(10_000, clock)).toThrow(
        'Cannot heartbeat work item in status "pending"',
      );

      const claimedItem = buildWorkItem();
      claimedItem.claim("client-1", 10_000, clock);

      expect(() => claimedItem.heartbeat(10_000, clock)).toThrow(
        'Cannot heartbeat work item in status "claimed"',
      );
    });
  });

  describe("complete", () => {
    it("transitions from in_progress to completed and clears the lease", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock, 20_000);
      clock.advance(7_000);

      item.complete(clock);

      expect(item.status).toBe("completed");
      expect(item.completedAt).toEqual(new Date("2025-01-01T10:00:07Z"));
      expect(item.leaseExpiresAt).toBeNull();
      expect(item.isTerminal).toBe(true);
    });
  });

  describe("fail", () => {
    it("transitions from claimed to failed and captures error details", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      item.claim("client-1", 30_000, clock);
      clock.advance(3_000);

      item.fail("claim rejected", clock);

      expect(item.status).toBe("failed");
      expect(item.lastError).toBe("claim rejected");
      expect(item.failedAt).toEqual(new Date("2025-01-01T10:00:03Z"));
      expect(item.leaseExpiresAt).toBeNull();
      expect(item.claimedByClientId).toBeNull();
      expect(item.isRetryable).toBe(true);
    });

    it("transitions from in_progress to failed and preserves the last heartbeat", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock, 30_000);
      clock.advance(5_000);
      item.heartbeat(30_000, clock);
      clock.advance(1_000);

      item.fail("processor crashed", clock);

      expect(item.status).toBe("failed");
      expect(item.lastError).toBe("processor crashed");
      expect(item.failedAt).toEqual(new Date("2025-01-01T10:00:06Z"));
      expect(item.lastHeartbeatAt).toEqual(new Date("2025-01-01T10:00:05Z"));
      expect(item.leaseExpiresAt).toBeNull();
      expect(item.claimedByClientId).toBeNull();
    });
  });

  describe("scheduleRetry", () => {
    it("transitions from failed to pending and updates availableAt", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock);
      clock.advance(1_000);
      item.fail("temporary outage", clock);

      const retryAt = new Date("2025-01-01T10:05:00Z");
      item.scheduleRetry(retryAt);

      expect(item.status).toBe("pending");
      expect(item.availableAt).toEqual(retryAt);
      expect(item.lastError).toBe("temporary outage");
      expect(item.failedAt).toEqual(new Date("2025-01-01T10:00:01Z"));
    });

    it("throws when retries are exhausted", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem({ maxAttempts: 2 });

      claimAndStart(item, clock);
      item.fail("first failure", clock);
      item.scheduleRetry(new Date("2025-01-01T10:01:00Z"));

      clock.advance(60_000);
      claimAndStart(item, clock);
      item.fail("second failure", clock);

      expect(item.attemptCount).toBe(2);
      expect(item.isRetryable).toBe(false);
      expect(() => item.scheduleRetry(new Date("2025-01-01T10:02:00Z"))).toThrow(
        "Work item has exhausted retries (2/2)",
      );
    });

    it("throws when the item is not failed", () => {
      const item = buildWorkItem();

      expect(() => item.scheduleRetry(new Date("2025-01-01T10:02:00Z"))).toThrow(
        'Cannot schedule retry for work item in status "pending"',
      );
    });
  });

  describe("kill", () => {
    it("transitions from pending to dead", () => {
      const item = buildWorkItem();

      item.kill();

      expect(item.status).toBe("dead");
      expect(item.isTerminal).toBe(true);
    });

    it("transitions from failed to dead", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock);
      item.fail("fatal", clock);
      item.kill();

      expect(item.status).toBe("dead");
      expect(item.lastError).toBe("fatal");
      expect(item.isTerminal).toBe(true);
    });
  });

  describe("expireLease", () => {
    it("transitions from claimed to pending and clears claim metadata", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      item.claim("client-1", 15_000, clock);
      item.expireLease();

      expect(item.status).toBe("pending");
      expect(item.claimedByClientId).toBeNull();
      expect(item.leaseExpiresAt).toBeNull();
      expect(item.attemptCount).toBe(1);
    });

    it('fails in_progress work with a "Lease expired" error at the lease expiry time', () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      claimAndStart(item, clock, 12_000);
      clock.advance(3_000);

      item.expireLease();

      expect(item.status).toBe("failed");
      expect(item.lastError).toBe("Lease expired");
      expect(item.failedAt).toEqual(new Date("2025-01-01T10:00:12Z"));
      expect(item.leaseExpiresAt).toBeNull();
      expect(item.claimedByClientId).toBeNull();
    });

    it("throws from states that do not have an active lease transition", () => {
      const clock = new FakeClock();

      const pendingItem = buildWorkItem();
      expect(() => pendingItem.expireLease()).toThrow(
        'Cannot expire lease for work item in status "pending"',
      );

      const failedItem = buildWorkItem();
      claimAndStart(failedItem, clock);
      failedItem.fail("boom", clock);
      expect(() => failedItem.expireLease()).toThrow(
        'Cannot expire lease for work item in status "failed"',
      );

      const completedItem = buildWorkItem();
      claimAndStart(completedItem, clock);
      completedItem.complete(clock);
      expect(() => completedItem.expireLease()).toThrow(
        'Cannot expire lease for work item in status "completed"',
      );

      const deadItem = buildWorkItem();
      deadItem.kill();
      expect(() => deadItem.expireLease()).toThrow(
        'Cannot expire lease for work item in status "dead"',
      );
    });
  });

  describe("lease helpers", () => {
    it("detects lease expiry only after a lease exists and the deadline has passed", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      expect(item.isLeaseExpired(clock)).toBe(false);

      item.claim("client-1", 10_000, clock);
      expect(item.isLeaseExpired(clock)).toBe(false);

      clock.advance(9_999);
      expect(item.isLeaseExpired(clock)).toBe(false);

      clock.advance(1);
      expect(item.isLeaseExpired(clock)).toBe(true);
    });
  });

  describe("state helpers", () => {
    it("reports terminal state for completed and dead items only", () => {
      const clock = new FakeClock();

      const completedItem = buildWorkItem();
      claimAndStart(completedItem, clock);
      completedItem.complete(clock);

      const deadItem = buildWorkItem();
      deadItem.kill();

      const failedItem = buildWorkItem();
      claimAndStart(failedItem, clock);
      failedItem.fail("retry me", clock);

      expect(completedItem.isTerminal).toBe(true);
      expect(deadItem.isTerminal).toBe(true);
      expect(failedItem.isTerminal).toBe(false);
    });

    it("reports failed items as non-retryable when attemptCount reaches maxAttempts", () => {
      const clock = new FakeClock();
      const item = buildWorkItem({ maxAttempts: 1 });

      claimAndStart(item, clock);
      item.fail("no retries left", clock);

      expect(item.attemptCount).toBe(1);
      expect(item.status).toBe("failed");
      expect(item.isRetryable).toBe(false);
    });
  });

  describe("full lifecycles", () => {
    it("supports the happy path from pending to completed", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem();

      item.claim("client-1", 45_000, clock);
      clock.advance(1_000);
      item.start(clock);
      clock.advance(2_000);
      item.complete(clock);

      expect(item.status).toBe("completed");
      expect(item.attemptCount).toBe(1);
      expect(item.completedAt).toEqual(new Date("2025-01-01T10:00:03Z"));
      expect(item.lastHeartbeatAt).toEqual(new Date("2025-01-01T10:00:01Z"));
      expect(item.isTerminal).toBe(true);
    });

    it("supports retrying until the item is eventually killed", () => {
      const clock = new FakeClock(new Date("2025-01-01T10:00:00Z"));
      const item = buildWorkItem({ maxAttempts: 2 });

      item.claim("client-1", 20_000, clock);
      item.start(clock);
      clock.advance(1_000);
      item.fail("first failure", clock);
      item.scheduleRetry(new Date("2025-01-01T10:01:00Z"));

      clock.set(new Date("2025-01-01T10:01:00Z"));
      item.claim("client-2", 20_000, clock);
      item.start(clock);
      clock.advance(1_000);
      item.fail("second failure", clock);
      item.kill();

      expect(item.status).toBe("dead");
      expect(item.attemptCount).toBe(2);
      expect(item.lastError).toBe("second failure");
      expect(item.failedAt).toEqual(new Date("2025-01-01T10:01:01Z"));
      expect(item.isRetryable).toBe(false);
      expect(item.isTerminal).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("rejects invalid transitions from pending", () => {
      const clock = new FakeClock();
      const item = buildWorkItem();

      expect(() => item.start(clock)).toThrow(
        'Invalid transition: "pending" → "in_progress"',
      );
      expect(() => item.complete(clock)).toThrow(
        'Invalid transition: "pending" → "completed"',
      );
      expect(() => item.fail("boom", clock)).toThrow(
        'Invalid transition: "pending" → "failed"',
      );
    });

    it("rejects invalid transitions from claimed", () => {
      const clock = new FakeClock();
      const item = buildWorkItem();

      item.claim("client-1", 10_000, clock);

      expect(() => item.complete(clock)).toThrow(
        'Invalid transition: "claimed" → "completed"',
      );
      expect(() => item.kill()).toThrow(
        'Cannot kill work item in status "claimed"',
      );
    });

    it("rejects invalid transitions from in_progress", () => {
      const clock = new FakeClock();
      const item = buildWorkItem();

      claimAndStart(item, clock);

      expect(() => item.scheduleRetry(new Date("2025-01-01T10:01:00Z"))).toThrow(
        'Cannot schedule retry for work item in status "in_progress"',
      );
      expect(() => item.claim("client-2", 10_000, clock)).toThrow(
        'Invalid transition: "in_progress" → "claimed"',
      );
      expect(() => item.kill()).toThrow(
        'Cannot kill work item in status "in_progress"',
      );
    });

    it("rejects all mutation attempts from completed", () => {
      const clock = new FakeClock();
      const item = buildWorkItem();

      claimAndStart(item, clock);
      item.complete(clock);

      const actions = [
        () => item.claim("client-2", 10_000, clock),
        () => item.start(clock),
        () => item.heartbeat(10_000, clock),
        () => item.complete(clock),
        () => item.fail("boom", clock),
        () => item.scheduleRetry(new Date("2025-01-01T10:01:00Z")),
        () => item.kill(),
        () => item.expireLease(),
      ];

      for (const action of actions) {
        expect(action).toThrow();
      }
    });

    it("rejects all mutation attempts from dead", () => {
      const clock = new FakeClock();
      const item = buildWorkItem();

      item.kill();

      const actions = [
        () => item.claim("client-2", 10_000, clock),
        () => item.start(clock),
        () => item.heartbeat(10_000, clock),
        () => item.complete(clock),
        () => item.fail("boom", clock),
        () => item.scheduleRetry(new Date("2025-01-01T10:01:00Z")),
        () => item.kill(),
        () => item.expireLease(),
      ];

      for (const action of actions) {
        expect(action).toThrow();
      }
    });
  });
});
