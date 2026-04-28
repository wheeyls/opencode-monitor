import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface SessionEntry {
  sessionId: string;
  directory: string;
  source: string;
  createdAt: string;
}

type SessionMap = Record<string, SessionEntry>;

interface Config {
  opencodeUrl?: string;
}

function loadConfig(): Config {
  const paths = [
    join(process.cwd(), "gh-monitor.json"),
    join(homedir(), ".config", "gh-monitor", "config.json"),
    join(homedir(), ".local", "share", "gh-monitor", "gh-monitor.json"),
    join(homedir(), ".local", "share", "devenv", "gh-monitor", "gh-monitor.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  }
  return {};
}

function loadSessions(): SessionMap {
  const paths = [
    join(homedir(), ".local", "share", "gh-monitor", "sessions.json"),
    join(homedir(), ".local", "share", "devenv", "gh-monitor", "sessions.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  }
  return {};
}

const STATUS_ICONS: Record<string, string> = {
  idle: "✅",
  busy: "⏳",
  retry: "🔄",
  "not found": "💀",
  unknown: "❓",
};

async function main(): Promise<void> {
  const config = loadConfig();
  const sessions = loadSessions();
  const baseUrl = config.opencodeUrl ?? "http://localhost:4096";

  if (Object.keys(sessions).length === 0) {
    console.log("No active sessions.");
    return;
  }

  const directories = [...new Set(Object.values(sessions).map(e => e.directory))];
  const allStatuses: Record<string, { type: string; message?: string; attempt?: number }> = {};

  for (const dir of directories) {
    try {
      const res = await fetch(`${baseUrl}/session/status?directory=${encodeURIComponent(dir)}`);
      if (res.ok) {
        const data = await res.json() as Record<string, { type: string; message?: string; attempt?: number }>;
        Object.assign(allStatuses, data);
      }
    } catch {}
  }

  const format = process.argv[2];

  const rows: Array<{ key: string; source: string; status: string; detail: string; sessionId: string; createdAt: string }> = [];
  for (const [key, entry] of Object.entries(sessions)) {
    const s = allStatuses[entry.sessionId];
    let status = "not found";
    let detail = "";
    if (s) {
      status = s.type;
      if (s.type === "retry") detail = `attempt ${s.attempt}: ${s.message}`;
    }
    rows.push({ key, source: entry.source, status, detail, sessionId: entry.sessionId, createdAt: entry.createdAt });
  }

  if (format === "--json") {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`${rows.length} session(s)\n`);
  for (const r of rows) {
    const icon = STATUS_ICONS[r.status] ?? "❓";
    const detail = r.detail ? ` (${r.detail})` : "";
    console.log(`${icon} ${r.key} [${r.status}]${detail}`);
    console.log(`   source: ${r.source}  session: ${r.sessionId}`);
    console.log(`   created: ${r.createdAt}`);
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
