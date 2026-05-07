import { Client, type Clock } from "@arb/work-queue";
import type { ClientRepository } from "@arb/work-queue-app";
import { getCurrentClient } from "../pg-unit-of-work.js";
import type { PgPool } from "../pg.js";

interface ClientRow {
  id: string;
  user_id: string;
  name: string;
  capabilities: Record<string, unknown>;
  registered_at: Date;
  last_seen_at: Date;
}

function rowToEntity(row: ClientRow): Client {
  return Client.fromSnapshot({
    id: row.id,
    userId: row.user_id,
    name: row.name,
    capabilities: row.capabilities,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  });
}

export class PgClientRepository implements ClientRepository {
  constructor(private pool: PgPool, private clock: Clock) {}

  private get client() {
    return getCurrentClient() ?? this.pool;
  }

  async save(entity: Client): Promise<void> {
    await this.client.query(
      `INSERT INTO clients (id, user_id, name, capabilities, registered_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         last_seen_at = $6, capabilities = $4`,
      [
        entity.id, entity.userId, entity.name,
        JSON.stringify(entity.capabilities),
        entity.registeredAt, entity.lastSeenAt,
      ],
    );
  }

  async findById(id: string): Promise<Client | null> {
    const { rows } = await this.client.query<ClientRow>(
      "SELECT * FROM clients WHERE id = $1",
      [id],
    );
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findActiveByUserId(userId: string): Promise<Client[]> {
    const staleThreshold = new Date(this.clock.now().getTime() - 60_000);
    const { rows } = await this.client.query<ClientRow>(
      `SELECT * FROM clients
       WHERE user_id = $1 AND last_seen_at > $2`,
      [userId, staleThreshold],
    );
    return rows.map(rowToEntity);
  }
}
