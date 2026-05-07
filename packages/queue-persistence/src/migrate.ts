import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgPool } from "./pg.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(pool: PgPool): Promise<void> {
  const sql = readFileSync(
    join(__dirname, "migrations", "001_create_tables.sql"),
    "utf-8",
  );
  await pool.query(sql);
}
