import { WorkThread } from "@arb/work-queue";
import type { WorkThreadRepository } from "@arb/work-queue-app";
import { getCurrentClient } from "../pg-unit-of-work.js";
import type { PgPool } from "../pg.js";

interface WorkThreadRow {
  id: string;
  user_id: string;
  affinity_key: string;
  preferred_client_id: string | null;
  preferred_client_expires_at: Date | null;
  last_session_ref: string | null;
  next_sequence: number;
}

function rowToEntity(row: WorkThreadRow): WorkThread {
  return WorkThread.fromSnapshot({
    id: row.id,
    userId: row.user_id,
    affinityKey: row.affinity_key,
    preferredClientId: row.preferred_client_id,
    preferredClientExpiresAt: row.preferred_client_expires_at,
    lastSessionRef: row.last_session_ref,
    nextSequence: row.next_sequence,
  });
}

export class PgWorkThreadRepository implements WorkThreadRepository {
  constructor(private pool: PgPool) {}

  private get client() {
    return getCurrentClient() ?? this.pool;
  }

  async save(thread: WorkThread): Promise<void> {
    await this.client.query(
      `INSERT INTO work_threads (
        id, user_id, affinity_key, preferred_client_id,
        preferred_client_expires_at, last_session_ref, next_sequence
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        preferred_client_id = $4, preferred_client_expires_at = $5,
        last_session_ref = $6, next_sequence = $7`,
      [
        thread.id, thread.userId, thread.affinityKey,
        thread.preferredClientId, thread.preferredClientExpiresAt,
        thread.lastSessionRef, thread.nextSequence,
      ],
    );
  }

  async findById(id: string): Promise<WorkThread | null> {
    const { rows } = await this.client.query<WorkThreadRow>(
      "SELECT * FROM work_threads WHERE id = $1",
      [id],
    );
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findByAffinityKey(userId: string, affinityKey: string): Promise<WorkThread | null> {
    const { rows } = await this.client.query<WorkThreadRow>(
      "SELECT * FROM work_threads WHERE user_id = $1 AND affinity_key = $2",
      [userId, affinityKey],
    );
    return rows[0] ? rowToEntity(rows[0]) : null;
  }
}
