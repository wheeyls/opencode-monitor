import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { Client } from "../entities/client.js";
import { WorkThread } from "../entities/work-thread.js";
import { AffinityPolicy } from "../policies/affinity-policy.js";

function createThread(overrides: Partial<ConstructorParameters<typeof WorkThread>[0]> = {}): WorkThread {
  return new WorkThread({
    id: overrides.id ?? "thread-1",
    userId: overrides.userId ?? "user-1",
    affinityKey: overrides.affinityKey ?? "affinity-1",
  });
}

function createClient(overrides: Partial<ConstructorParameters<typeof Client>[0]> = {}): Client {
  return new Client({
    id: overrides.id ?? "client-1",
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "Client 1",
    capabilities: overrides.capabilities,
    registeredAt: overrides.registeredAt ?? new Date("2025-01-01T00:00:00Z"),
  });
}

describe("AffinityPolicy", () => {
  it("recordCompletion() sets thread preference with TTL", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const thread = createThread();
    const policy = new AffinityPolicy();

    policy.recordCompletion(thread, "client-42", "session-42", clock);

    expect(thread.preferredClientId).toBe("client-42");
    expect(thread.lastSessionRef).toBe("session-42");
    expect(thread.preferredClientExpiresAt).toEqual(
      new Date("2025-01-02T00:00:00Z"),
    );
  });

  it("score() returns 2 for the preferred client within TTL", () => {
    const clock = new FakeClock();
    const thread = createThread();
    const policy = new AffinityPolicy();

    policy.recordCompletion(thread, "client-1", "session-1", clock);

    expect(policy.score(thread, "client-1", clock)).toBe(2);
  });

  it("score() returns 0 for a non-preferred client while preference is active", () => {
    const clock = new FakeClock();
    const thread = createThread();
    const policy = new AffinityPolicy();

    policy.recordCompletion(thread, "client-1", "session-1", clock);

    expect(policy.score(thread, "client-2", clock)).toBe(0);
  });

  it("score() returns 1 when there is no preference or the preference has expired", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const thread = createThread();
    const policy = new AffinityPolicy({ preferenceTtlMs: 1_000 });

    expect(policy.score(thread, "client-1", clock)).toBe(1);

    policy.recordCompletion(thread, "client-1", "session-1", clock);
    clock.advance(1_000);

    expect(policy.score(thread, "client-1", clock)).toBe(1);
    expect(policy.score(thread, "client-2", clock)).toBe(1);
  });

  it("pickBest() returns the preferred client when available", () => {
    const clock = new FakeClock();
    const thread = createThread();
    const policy = new AffinityPolicy();
    const preferred = createClient({ id: "client-2", name: "Preferred" });
    const other = createClient({ id: "client-1", name: "Other" });

    policy.recordCompletion(thread, preferred.id, "session-1", clock);

    expect(policy.pickBest(thread, [other, preferred], clock)?.id).toBe(preferred.id);
  });

  it("pickBest() returns any available client when preference has expired", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const thread = createThread();
    const policy = new AffinityPolicy({ preferenceTtlMs: 1_000 });
    const clientA = createClient({ id: "client-a", name: "A" });
    const clientB = createClient({ id: "client-b", name: "B" });

    policy.recordCompletion(thread, clientA.id, "session-1", clock);
    clock.advance(1_001);

    const best = policy.pickBest(thread, [clientB, clientA], clock);

    expect(best).not.toBeNull();
    expect([clientA.id, clientB.id]).toContain(best!.id);
  });

  it("pickBest() returns null for empty candidates", () => {
    const clock = new FakeClock();
    const thread = createThread();
    const policy = new AffinityPolicy();

    expect(policy.pickBest(thread, [], clock)).toBeNull();
  });

  it("custom TTL overrides the default 24-hour preference window", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00Z"));
    const thread = createThread();
    const policy = new AffinityPolicy({ preferenceTtlMs: 60_000 });

    policy.recordCompletion(thread, "client-1", "session-1", clock);

    expect(thread.preferredClientExpiresAt).toEqual(
      new Date("2025-01-01T00:01:00Z"),
    );
    clock.advance(60_001);
    expect(policy.score(thread, "client-1", clock)).toBe(1);
  });
});
