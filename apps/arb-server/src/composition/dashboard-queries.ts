import type { WorkItem, WorkThread, Client, Clock } from "@arb/work-queue";
import type { WorkItemRepository, WorkThreadRepository, ClientRepository } from "@arb/work-queue-app";
import { clock, workItems, workThreads, clients, pgPool } from "./queue";

type HasAll<T> = { all?: () => T[] };

export async function getQueueSummary() {
  if (pgPool) {
    const { rows } = await pgPool.query<{ status: string; count: string }>(
      "SELECT status, count(*)::int as count FROM work_items GROUP BY status",
    );
    const summary: Record<string, number> = { total: 0, pending: 0, claimed: 0, in_progress: 0, completed: 0, failed: 0, dead: 0 };
    for (const row of rows) {
      summary[row.status] = parseInt(row.count, 10);
      summary.total += parseInt(row.count, 10);
    }
    return summary;
  }

  const items = (workItems as HasAll<WorkItem>).all!();
  return {
    total: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    claimed: items.filter((i) => i.status === "claimed").length,
    in_progress: items.filter((i) => i.status === "in_progress").length,
    completed: items.filter((i) => i.status === "completed").length,
    failed: items.filter((i) => i.status === "failed").length,
    dead: items.filter((i) => i.status === "dead").length,
  };
}

export async function getActiveClients() {
  if (pgPool) {
    const { rows } = await pgPool.query<{
      id: string; user_id: string; name: string; last_seen_at: Date;
    }>("SELECT id, user_id, name, last_seen_at FROM clients ORDER BY last_seen_at DESC");
    const now = new Date();
    return rows.map((r) => {
      const elapsed = now.getTime() - r.last_seen_at.getTime();
      const status = elapsed >= 300_000 ? "offline" : elapsed >= 60_000 ? "stale" : "active";
      return { id: r.id, userId: r.user_id, name: r.name, status, lastSeenAt: r.last_seen_at.toISOString() };
    });
  }

  return (clients as HasAll<Client>).all!().map((c) => ({
    id: c.id,
    userId: c.userId,
    name: c.name,
    status: c.status(clock),
    lastSeenAt: c.lastSeenAt.toISOString(),
  }));
}

export async function getRecentItems(limit = 50) {
  if (pgPool) {
    const { rows } = await pgPool.query<{
      id: string; thread_id: string; kind: string; status: string;
      sequence: number; attempt_count: number; created_at: Date;
      payload: Record<string, unknown>; claimed_by_client_id: string | null;
      last_error: string | null; affinity_key: string | null;
    }>(
      `SELECT wi.*, wt.affinity_key
       FROM work_items wi
       LEFT JOIN work_threads wt ON wi.thread_id = wt.id
       ORDER BY wi.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => formatItem(r.id, r.affinity_key ?? r.thread_id, r.payload ?? {}, r.kind, r.status, r.sequence, r.attempt_count, r.created_at, r.claimed_by_client_id, r.last_error));
  }

  const threadMap = new Map((workThreads as HasAll<WorkThread>).all!().map((t) => [t.id, t]));
  return (workItems as HasAll<WorkItem>).all!()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((i) => {
      const thread = threadMap.get(i.threadId);
      return formatItem(i.id, thread?.affinityKey ?? i.threadId, i.payload, i.kind, i.status, i.sequence, i.attemptCount, i.createdAt, i.claimedByClientId, i.lastError);
    });
}

export async function getThreads() {
  if (pgPool) {
    const { rows } = await pgPool.query<{
      id: string; user_id: string; affinity_key: string;
      preferred_client_id: string | null; last_session_ref: string | null;
      next_sequence: number;
    }>("SELECT * FROM work_threads ORDER BY affinity_key");
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, affinityKey: r.affinity_key,
      preferredClientId: r.preferred_client_id, lastSessionRef: r.last_session_ref,
      nextSequence: r.next_sequence,
    }));
  }

  return (workThreads as HasAll<WorkThread>).all!().map((t) => ({
    id: t.id, userId: t.userId, affinityKey: t.affinityKey,
    preferredClientId: t.preferredClientId, lastSessionRef: t.lastSessionRef,
    nextSequence: t.nextSequence,
  }));
}

function formatItem(
  id: string, affinityKey: string, payload: Record<string, unknown>,
  kind: string, status: string, sequence: number, attemptCount: number,
  createdAt: Date | string, claimedByClientId: string | null, lastError: string | null,
) {
  return {
    id, affinityKey,
    source: (payload.source as string) ?? null,
    type: (payload.type as string) ?? null,
    kind, status, sequence, attemptCount,
    createdAt: typeof createdAt === "string" ? createdAt : createdAt.toISOString(),
    body: truncate((payload.body as string) ?? "", 120),
    url: (payload.url as string) ?? null,
    claimedByClientId, lastError,
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
