import { describe, expect, it } from "vitest";

import { FakeClock } from "../clock.js";
import { Client } from "../entities/client.js";

function buildClient(
  registeredAt: Date = new Date("2025-01-01T00:00:00.000Z"),
  livenessConfig?: { staleAfterMs: number; offlineAfterMs: number },
): Client {
  return new Client(
    {
      id: "client-1",
      userId: "user-1",
      name: "Worker Client",
      registeredAt,
    },
    livenessConfig,
  );
}

describe("Client", () => {
  it("new client starts with lastSeenAt = registeredAt", () => {
    const registeredAt = new Date("2025-01-01T00:00:00.000Z");
    const client = buildClient(registeredAt);

    expect(client.lastSeenAt).toEqual(registeredAt);
  });

  it("touch() updates lastSeenAt", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:01:00.000Z"));
    const client = buildClient(new Date("2025-01-01T00:00:00.000Z"));

    client.touch(clock);

    expect(client.lastSeenAt).toEqual(new Date("2025-01-01T00:01:00.000Z"));
  });

  it("status() returns active immediately after touch", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:01:00.000Z"));
    const client = buildClient(new Date("2025-01-01T00:00:00.000Z"));

    client.touch(clock);

    expect(client.status(clock)).toBe("active");
  });

  it("status() returns stale after staleAfterMs", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const client = buildClient(clock.now());

    clock.advance(60_000);

    expect(client.status(clock)).toBe("stale");
  });

  it("status() returns offline after offlineAfterMs", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const client = buildClient(clock.now());

    clock.advance(300_000);

    expect(client.status(clock)).toBe("offline");
  });

  it("isAvailable() returns true when active, false when stale/offline", () => {
    const activeClock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const activeClient = buildClient(activeClock.now());

    activeClock.advance(59_999);
    expect(activeClient.isAvailable(activeClock)).toBe(true);

    const staleClock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const staleClient = buildClient(staleClock.now());

    staleClock.advance(60_000);
    expect(staleClient.isAvailable(staleClock)).toBe(false);

    const offlineClock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const offlineClient = buildClient(offlineClock.now());

    offlineClock.advance(300_000);
    expect(offlineClient.isAvailable(offlineClock)).toBe(false);
  });

  it("custom livenessConfig overrides defaults", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const client = buildClient(clock.now(), {
      staleAfterMs: 5_000,
      offlineAfterMs: 15_000,
    });

    clock.advance(4_999);
    expect(client.status(clock)).toBe("active");

    clock.advance(1);
    expect(client.status(clock)).toBe("stale");

    clock.advance(10_000);
    expect(client.status(clock)).toBe("offline");
  });

  it("default config: stale after 60s, offline after 5m", () => {
    const clock = new FakeClock(new Date("2025-01-01T00:00:00.000Z"));
    const client = buildClient(clock.now());

    clock.advance(59_999);
    expect(client.status(clock)).toBe("active");

    clock.advance(1);
    expect(client.status(clock)).toBe("stale");

    clock.advance(239_999);
    expect(client.status(clock)).toBe("stale");

    clock.advance(1);
    expect(client.status(clock)).toBe("offline");
  });
});
