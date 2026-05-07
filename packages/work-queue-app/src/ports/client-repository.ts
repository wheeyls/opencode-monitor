import type { Client } from "@arb/work-queue";

export interface ClientRepository {
  save(client: Client): Promise<void>;
  findById(id: string): Promise<Client | null>;
  findActiveByUserId(userId: string): Promise<Client[]>;
}
