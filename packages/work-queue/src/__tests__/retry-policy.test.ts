import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { WorkItem } from "../entities/work-item.js";
import { RetryPolicy } from "../policies/retry-policy.js";

function createWorkItem(overrides: Partial<ConstructorParameters<typeof WorkItem>[0]> = {}): WorkItem {
  return new WorkItem({
    id: overrides.id ?? "item-1",
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

function failOnce(item: WorkItem, clock: FakeClock, clientId = "client-1"): void {
  item.claim(clientId, 60_000, clock);
  item.fail(`failed on attempt ${item.attemptCount}`, clock);
}

function resetForRetry(item: WorkItem, clock: FakeClock): void {
  item.scheduleRetry(clock.now());
}

describe("RetryPolicy", () => {
  it('canRetry() returns true when attemptCount < maxAttempts and status is "failed"', () => {
    const clock = new FakeClock();
    const item = createWorkItem({ maxAttempts: 3 });
    const policy = new RetryPolicy();

    failOnce(item, clock);

    expect(item.status).toBe("failed");
    expect(item.attemptCount).toBe(1);
    expect(policy.canRetry(item)).toBe(true);
  });

  it("canRetry() returns false when attempts are exhausted", () => {
    const clock = new FakeClock();
    const item = createWorkItem({ maxAttempts: 2 });
    const policy = new RetryPolicy();

    failOnce(item, clock);
    resetForRetry(item, clock);
    failOnce(item, clock, "client-2");

    expect(item.status).toBe("failed");
    expect(item.attemptCount).toBe(2);
    expect(policy.canRetry(item)).toBe(false);
  });

  it("nextAvailableAt() returns correct backoff delays for attempts 1, 2, and 3", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const item = createWorkItem({ maxAttempts: 4 });
    const policy = new RetryPolicy();

    failOnce(item, clock);
    expect(policy.nextAvailableAt(item, clock)).toEqual(
      new Date("2025-01-01T00:00:30Z"),
    );

    resetForRetry(item, clock);
    clock.advance(5_000);
    failOnce(item, clock, "client-2");
    expect(policy.nextAvailableAt(item, clock)).toEqual(
      new Date("2025-01-01T00:02:05Z"),
    );

    resetForRetry(item, clock);
    clock.advance(10_000);
    failOnce(item, clock, "client-3");
    expect(policy.nextAvailableAt(item, clock)).toEqual(
      new Date("2025-01-01T00:10:15Z"),
    );
  });

  it("nextAvailableAt() returns null when retries are exhausted", () => {
    const clock = new FakeClock();
    const item = createWorkItem({ maxAttempts: 3 });
    const policy = new RetryPolicy();

    failOnce(item, clock);
    resetForRetry(item, clock);
    failOnce(item, clock, "client-2");
    resetForRetry(item, clock);
    failOnce(item, clock, "client-3");

    expect(item.status).toBe("failed");
    expect(item.attemptCount).toBe(3);
    expect(policy.nextAvailableAt(item, clock)).toBeNull();
  });

  it("applyRetry() transitions item to pending with the correct availableAt", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const item = createWorkItem({ maxAttempts: 3 });
    const policy = new RetryPolicy();

    failOnce(item, clock);

    expect(policy.applyRetry(item, clock)).toBe("retried");
    expect(item.status).toBe("pending");
    expect(item.availableAt).toEqual(new Date("2025-01-01T00:00:30Z"));
    expect(item.attemptCount).toBe(1);
  });

  it("applyRetry() kills the item when retries are exhausted", () => {
    const clock = new FakeClock();
    const item = createWorkItem({ maxAttempts: 1 });
    const policy = new RetryPolicy();

    failOnce(item, clock);

    expect(policy.applyRetry(item, clock)).toBe("dead");
    expect(item.status).toBe("dead");
  });

  it("custom schedule overrides the default retry delays", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const item = createWorkItem({ maxAttempts: 3 });
    const policy = new RetryPolicy({ backoffMs: [5_000, 15_000, 45_000] });

    failOnce(item, clock);

    expect(policy.nextAvailableAt(item, clock)).toEqual(
      new Date("2025-01-01T00:00:05Z"),
    );
    expect(policy.applyRetry(item, clock)).toBe("retried");
    expect(item.availableAt).toEqual(new Date("2025-01-01T00:00:05Z"));
  });

  it("handles a full retry cycle: fail → retry → fail → retry → fail → dead", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const item = createWorkItem({ maxAttempts: 3 });
    const policy = new RetryPolicy();

    failOnce(item, clock);
    expect(policy.applyRetry(item, clock)).toBe("retried");
    expect(item.status).toBe("pending");
    expect(item.availableAt).toEqual(new Date("2025-01-01T00:00:30Z"));

    clock.set(item.availableAt);
    failOnce(item, clock, "client-2");
    expect(policy.applyRetry(item, clock)).toBe("retried");
    expect(item.status).toBe("pending");
    expect(item.availableAt).toEqual(new Date("2025-01-01T00:02:30Z"));

    clock.set(item.availableAt);
    failOnce(item, clock, "client-3");
    expect(policy.applyRetry(item, clock)).toBe("dead");
    expect(item.status).toBe("dead");
    expect(item.attemptCount).toBe(3);
  });
});
