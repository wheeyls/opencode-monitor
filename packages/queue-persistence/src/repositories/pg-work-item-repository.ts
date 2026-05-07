import { WorkItem, type WorkItemKind, type WorkItemStatus } from "@arb/work-queue";
import type { WorkItemRepository } from "@arb/work-queue-app";
import { getCurrentClient } from "../pg-unit-of-work.js";
import type { PgPool } from "../pg.js";

interface WorkItemRow {
  id: string;
  user_id: string;
  thread_id: string;
  kind: string;
  sequence: number;
  payload: Record<string, unknown>;
  max_attempts: number;
  status: string;
  available_at: Date;
  attempt_count: number;
  claimed_by_client_id: string | null;
  lease_expires_at: Date | null;
  last_heartbeat_at: Date | null;
  last_error: string | null;
  completed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
}

function rowToEntity(row: WorkItemRow): WorkItem {
  return WorkItem.fromSnapshot({
    id: row.id,
    userId: row.user_id,
    threadId: row.thread_id,
    kind: row.kind as WorkItemKind,
    sequence: row.sequence,
    payload: row.payload,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    availableAt: row.available_at,
    status: row.status as WorkItemStatus,
    attemptCount: row.attempt_count,
    claimedByClientId: row.claimed_by_client_id,
    leaseExpiresAt: row.lease_expires_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    lastError: row.last_error,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
  });
}

export class PgWorkItemRepository implements WorkItemRepository {
  constructor(private pool: PgPool) {}

  private get client() {
    return getCurrentClient() ?? this.pool;
  }

  async save(item: WorkItem): Promise<void> {
    await this.client.query(
      `INSERT INTO work_items (
        id, user_id, thread_id, kind, sequence, payload, max_attempts,
        status, available_at, attempt_count, claimed_by_client_id,
        lease_expires_at, last_heartbeat_at, last_error, completed_at,
        failed_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (id) DO UPDATE SET
        status = $8, available_at = $9, attempt_count = $10,
        claimed_by_client_id = $11, lease_expires_at = $12,
        last_heartbeat_at = $13, last_error = $14, completed_at = $15,
        failed_at = $16, payload = $6`,
      [
        item.id, item.userId, item.threadId, item.kind, item.sequence,
        JSON.stringify(item.payload), item.maxAttempts, item.status,
        item.availableAt, item.attemptCount, item.claimedByClientId,
        item.leaseExpiresAt, item.lastHeartbeatAt, item.lastError,
        item.completedAt, item.failedAt, item.createdAt,
      ],
    );
  }

  async findById(id: string): Promise<WorkItem | null> {
    const { rows } = await this.client.query<WorkItemRow>(
      "SELECT * FROM work_items WHERE id = $1",
      [id],
    );
    return rows[0] ? rowToEntity(rows[0]) : null;
  }

  async findClaimable(userId: string): Promise<WorkItem[]> {
    const { rows } = await this.client.query<WorkItemRow>(
      `SELECT * FROM work_items
       WHERE user_id = $1 AND status = 'pending' AND available_at <= now()
       ORDER BY available_at, created_at`,
      [userId],
    );
    return rows.map(rowToEntity);
  }

  async findNonTerminalByUserId(userId: string): Promise<WorkItem[]> {
    const { rows } = await this.client.query<WorkItemRow>(
      `SELECT * FROM work_items
       WHERE user_id = $1 AND status NOT IN ('completed', 'dead')`,
      [userId],
    );
    return rows.map(rowToEntity);
  }

  async findExpiredLeases(): Promise<WorkItem[]> {
    const { rows } = await this.client.query<WorkItemRow>(
      `SELECT * FROM work_items
       WHERE status IN ('claimed', 'in_progress')
         AND lease_expires_at IS NOT NULL
         AND lease_expires_at <= now()`,
    );
    return rows.map(rowToEntity);
  }

  async findRetryable(): Promise<WorkItem[]> {
    const { rows } = await this.client.query<WorkItemRow>(
      `SELECT * FROM work_items
       WHERE status = 'failed' AND attempt_count < max_attempts`,
    );
    return rows.map(rowToEntity);
  }

  async findByThreadId(threadId: string): Promise<WorkItem[]> {
    const { rows } = await this.client.query<WorkItemRow>(
      "SELECT * FROM work_items WHERE thread_id = $1 ORDER BY sequence",
      [threadId],
    );
    return rows.map(rowToEntity);
  }

  async existsNonTerminal(threadId: string, dedupKey?: string): Promise<boolean> {
    if (!dedupKey) return false;
    const { rows } = await this.client.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM work_items
        WHERE thread_id = $1
          AND status NOT IN ('completed', 'dead')
          AND payload->>'dedupKey' = $2
      ) AS exists`,
      [threadId, dedupKey],
    );
    return rows[0]?.exists ?? false;
  }

  async findPendingByThreadId(threadId: string): Promise<WorkItem | null> {
    const { rows } = await this.client.query<WorkItemRow>(
      `SELECT * FROM work_items
       WHERE thread_id = $1 AND status = 'pending'
       ORDER BY sequence LIMIT 1`,
      [threadId],
    );
    return rows[0] ? rowToEntity(rows[0]) : null;
  }
}
