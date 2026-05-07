import type { UnitOfWork } from "@arb/work-queue-app";
import type { PgPool, PgClient } from "./pg.js";

let currentClient: PgClient | null = null;

export function getCurrentClient(): PgClient | null {
  return currentClient;
}

export class PgUnitOfWork implements UnitOfWork {
  constructor(private pool: PgPool) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const previousClient = currentClient;
    currentClient = client;
    try {
      await client.query("BEGIN");
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      currentClient = previousClient;
      client.release();
    }
  }
}
