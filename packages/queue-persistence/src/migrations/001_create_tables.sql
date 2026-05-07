CREATE TABLE IF NOT EXISTS work_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  affinity_key TEXT NOT NULL,
  preferred_client_id TEXT,
  preferred_client_expires_at TIMESTAMPTZ,
  last_session_ref TEXT,
  next_sequence INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, affinity_key)
);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES work_threads(id),
  kind TEXT NOT NULL DEFAULT 'event',
  sequence INTEGER NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  max_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'pending',
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  claimed_by_client_id TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_items_claimable
  ON work_items (user_id, status, available_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_work_items_thread_id
  ON work_items (thread_id);

CREATE INDEX IF NOT EXISTS idx_work_items_lease_expires
  ON work_items (lease_expires_at)
  WHERE status IN ('claimed', 'in_progress') AND lease_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '{}',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
