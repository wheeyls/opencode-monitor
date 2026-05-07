import { Client, type Clock } from "@arb/work-queue";
import type { ClientRepository } from "../ports/client-repository.js";
import type { IdGenerator } from "../ports/id-generator.js";

export interface RegisterClientInput {
  userId: string;
  name: string;
  capabilities?: Record<string, unknown>;
}

export interface RegisterClientResult {
  clientId: string;
}

export interface RegisterClientDeps {
  clients: ClientRepository;
  ids: IdGenerator;
  clock: Clock;
}

export async function registerClient(
  input: RegisterClientInput,
  deps: RegisterClientDeps,
): Promise<RegisterClientResult> {
  const client = new Client({
    id: deps.ids.generate(),
    userId: input.userId,
    name: input.name,
    capabilities: input.capabilities,
    registeredAt: deps.clock.now(),
  });

  await deps.clients.save(client);

  return { clientId: client.id };
}
