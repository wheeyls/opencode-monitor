import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { WorkThread } from "../entities/work-thread.js";

function buildWorkThread(): WorkThread {
  return new WorkThread({
    id: "thread-1",
    userId: "user-1",
    affinityKey: "affinity-1",
  });
}

describe("WorkThread", () => {
  it("allocateSequence() returns incrementing values starting at 1", () => {
    const thread = buildWorkThread();

    expect(thread.allocateSequence()).toBe(1);
    expect(thread.allocateSequence()).toBe(2);
    expect(thread.allocateSequence()).toBe(3);
    expect(thread.nextSequence).toBe(4);
  });

  it("setPreference() stores clientId, sessionRef, and computes expiresAt", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);

    expect(thread.preferredClientId).toBe("client-1");
    expect(thread.lastSessionRef).toBe("session-1");
    expect(thread.preferredClientExpiresAt).toEqual(new Date("2025-01-01T00:00:30.000Z"));
  });

  it("prefersClient() returns true for matching client within TTL", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);
    clock.advance(29_999);

    expect(thread.prefersClient("client-1", clock)).toBe(true);
  });

  it("prefersClient() returns false for different client", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);

    expect(thread.prefersClient("client-2", clock)).toBe(false);
  });

  it("prefersClient() returns false after TTL expires", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);
    clock.advance(30_000);

    expect(thread.prefersClient("client-1", clock)).toBe(false);
  });

  it("clearPreference() resets preference", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);
    thread.clearPreference();

    expect(thread.preferredClientId).toBeNull();
    expect(thread.preferredClientExpiresAt).toBeNull();
  });

  it("isPreferenceExpired() returns true when no preference set", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock();

    expect(thread.isPreferenceExpired(clock)).toBe(true);
  });

  it("isPreferenceExpired() returns true after TTL", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);
    clock.advance(30_000);

    expect(thread.isPreferenceExpired(clock)).toBe(true);
  });

  it("isPreferenceExpired() returns false within TTL", () => {
    const thread = buildWorkThread();
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));

    thread.setPreference("client-1", "session-1", 30_000, clock);
    clock.advance(29_999);

    expect(thread.isPreferenceExpired(clock)).toBe(false);
  });
});
