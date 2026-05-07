import { FakeClock } from "@arb/work-queue";
import { describe, it, expect } from "vitest";
import {
  FakeClientRepository,
  FakeIdGenerator,
} from "./fakes/index.js";
import { registerClient } from "../use-cases/register-client.js";

function createDeps() {
  const clock = new FakeClock(new Date("2025-04-05T06:07:08.000Z"));

  return {
    clock,
    ids: new FakeIdGenerator(),
    clients: new FakeClientRepository(clock),
  };
}

describe("registerClient", () => {
  it("creates a client with the correct id, user id, and name", async () => {
    const deps = createDeps();

    const result = await registerClient(
      {
        userId: "user-1",
        name: "worker-a",
      },
      deps,
    );

    expect(result).toEqual({ clientId: "id-1" });

    const client = await deps.clients.findById(result.clientId);
    expect(client).not.toBeNull();
    expect(client?.id).toBe("id-1");
    expect(client?.userId).toBe("user-1");
    expect(client?.name).toBe("worker-a");
  });

  it("uses the id generator for client ids", async () => {
    const deps = createDeps();

    const first = await registerClient(
      {
        userId: "user-1",
        name: "worker-a",
      },
      deps,
    );

    const second = await registerClient(
      {
        userId: "user-1",
        name: "worker-b",
      },
      deps,
    );

    expect(first.clientId).toBe("id-1");
    expect(second.clientId).toBe("id-2");
  });

  it("sets registeredAt from the clock", async () => {
    const deps = createDeps();

    const result = await registerClient(
      {
        userId: "user-1",
        name: "worker-a",
      },
      deps,
    );

    const client = await deps.clients.findById(result.clientId);

    expect(client?.registeredAt).toEqual(new Date("2025-04-05T06:07:08.000Z"));
    expect(client?.lastSeenAt).toEqual(new Date("2025-04-05T06:07:08.000Z"));
  });

  it("stores client capabilities", async () => {
    const deps = createDeps();

    const result = await registerClient(
      {
        userId: "user-1",
        name: "worker-a",
        capabilities: {
          maxConcurrency: 3,
          regions: ["us-east-1", "eu-west-1"],
          supportsManualKick: true,
        },
      },
      deps,
    );

    const client = await deps.clients.findById(result.clientId);

    expect(client?.capabilities).toEqual({
      maxConcurrency: 3,
      regions: ["us-east-1", "eu-west-1"],
      supportsManualKick: true,
    });
  });
});
