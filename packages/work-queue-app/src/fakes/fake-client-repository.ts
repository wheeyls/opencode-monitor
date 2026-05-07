import type { Client, Clock } from "@arb/work-queue";
import type { ClientRepository } from "../ports/client-repository.js";

export class FakeClientRepository implements ClientRepository {
  private clients: Map<string, Client> = new Map();
  private clock: Clock;

  constructor(clock: Clock) {
    this.clock = clock;
  }

  async save(client: Client): Promise<void> {
    this.clients.set(client.id, client);
  }

  async findById(id: string): Promise<Client | null> {
    return this.clients.get(id) ?? null;
  }

  async findActiveByUserId(userId: string): Promise<Client[]> {
    return [...this.clients.values()].filter(
      (client) =>
        client.userId === userId &&
        client.isAvailable(this.clock),
    );
  }

  /** Test helper: get all clients. */
  all(): Client[] {
    return [...this.clients.values()];
  }
}
