import { createHash, randomBytes } from "node:crypto";

export interface UserConfig {
  org?: string;
  owner?: string;
  repos?: string[];
  triggerPhrases?: string[];
  jira?: {
    baseUrl?: string;
    email?: string;
    jql?: string;
  };
}

export interface UserSettings {
  email: string;
  displayName: string;
  config: UserConfig;
  apiTokenHash: string | null;
  createdAt: string;
  updatedAt: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return `arb_${randomBytes(24).toString("base64url")}`;
}

// ── In-memory store ─────────────────────────────────────────────────────

class InMemoryUserSettingsStore {
  private users = new Map<string, UserSettings>();

  get(email: string): UserSettings | null {
    return this.users.get(email) ?? null;
  }

  getOrCreate(email: string, displayName?: string): UserSettings {
    let user = this.users.get(email);
    if (!user) {
      const now = new Date().toISOString();
      user = {
        email,
        displayName: displayName ?? email.split("@")[0],
        config: {},
        apiTokenHash: null,
        createdAt: now,
        updatedAt: now,
      };
      this.users.set(email, user);
    }
    return user;
  }

  updateConfig(email: string, config: UserConfig): UserSettings {
    const user = this.getOrCreate(email);
    user.config = config;
    user.updatedAt = new Date().toISOString();
    return user;
  }

  generateToken(email: string): { token: string; settings: UserSettings } {
    const user = this.getOrCreate(email);
    const token = generateToken();
    user.apiTokenHash = hashToken(token);
    user.updatedAt = new Date().toISOString();
    return { token, settings: user };
  }

  findByTokenHash(tokenHash: string): UserSettings | null {
    for (const user of this.users.values()) {
      if (user.apiTokenHash === tokenHash) return user;
    }
    return null;
  }

  verifyToken(token: string): UserSettings | null {
    const hash = hashToken(token);
    return this.findByTokenHash(hash);
  }
}

// ── Postgres store ──────────────────────────────────────────────────────

class PgUserSettingsStore {
  private pool: import("pg").Pool;

  constructor(pool: import("pg").Pool) {
    this.pool = pool;
  }

  async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        email TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        api_token_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async get(email: string): Promise<UserSettings | null> {
    const { rows } = await this.pool.query(
      "SELECT * FROM user_settings WHERE email = $1",
      [email],
    );
    return rows[0] ? this.rowToSettings(rows[0]) : null;
  }

  async getOrCreate(email: string, displayName?: string): Promise<UserSettings> {
    const { rows } = await this.pool.query(
      `INSERT INTO user_settings (email, display_name)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = user_settings.email
       RETURNING *`,
      [email, displayName ?? email.split("@")[0]],
    );
    return this.rowToSettings(rows[0]);
  }

  async updateConfig(email: string, config: UserConfig): Promise<UserSettings> {
    const { rows } = await this.pool.query(
      `UPDATE user_settings SET config = $2, updated_at = now()
       WHERE email = $1 RETURNING *`,
      [email, JSON.stringify(config)],
    );
    if (!rows[0]) {
      const created = await this.getOrCreate(email);
      return this.updateConfig(email, config).then(() => ({ ...created, config }));
    }
    return this.rowToSettings(rows[0]);
  }

  async generateToken(email: string): Promise<{ token: string; settings: UserSettings }> {
    const token = generateToken();
    const hash = hashToken(token);
    await this.getOrCreate(email);
    const { rows } = await this.pool.query(
      `UPDATE user_settings SET api_token_hash = $2, updated_at = now()
       WHERE email = $1 RETURNING *`,
      [email, hash],
    );
    return { token, settings: this.rowToSettings(rows[0]) };
  }

  async verifyToken(token: string): Promise<UserSettings | null> {
    const hash = hashToken(token);
    const { rows } = await this.pool.query(
      "SELECT * FROM user_settings WHERE api_token_hash = $1",
      [hash],
    );
    return rows[0] ? this.rowToSettings(rows[0]) : null;
  }

  private rowToSettings(row: Record<string, unknown>): UserSettings {
    return {
      email: row.email as string,
      displayName: row.display_name as string,
      config: row.config as UserConfig,
      apiTokenHash: row.api_token_hash as string | null,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}

// ── Unified interface ───────────────────────────────────────────────────

export interface UserSettingsStore {
  get(email: string): Promise<UserSettings | null> | UserSettings | null;
  getOrCreate(email: string, displayName?: string): Promise<UserSettings> | UserSettings;
  updateConfig(email: string, config: UserConfig): Promise<UserSettings> | UserSettings;
  generateToken(email: string): Promise<{ token: string; settings: UserSettings }> | { token: string; settings: UserSettings };
  verifyToken(token: string): Promise<UserSettings | null> | UserSettings | null;
}

// ── Singleton ───────────────────────────────────────────────────────────

const g = globalThis as unknown as { __arb_user_settings?: UserSettingsStore };

export function getUserSettingsStore(pgPool?: import("pg").Pool): UserSettingsStore {
  if (!g.__arb_user_settings) {
    if (pgPool) {
      const store = new PgUserSettingsStore(pgPool);
      store.ensureTable().catch((err) => console.error("[user-settings] Table creation failed:", err.message));
      g.__arb_user_settings = store;
    } else {
      g.__arb_user_settings = new InMemoryUserSettingsStore();
    }
  }
  return g.__arb_user_settings;
}
