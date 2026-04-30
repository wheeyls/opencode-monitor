#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, existsSync, statSync } from "node:fs";
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
  intervalMs?: number;
}

interface OpenCodeSession {
  id: string;
  title: string;
  summary?: { additions: number; deletions: number; files: number };
  time: { created: number; updated: number };
}

interface OpenCodeMessage {
  info: {
    role: string;
    time: { created: number; completed?: number };
  };
  parts: Array<{ type: string; text?: string }>;
}

const STATE_DIR = join(homedir(), ".local", "share", "arb");

function loadConfig(): Config {
  const paths = [
    join(process.cwd(), "arb.json"),
    join(homedir(), ".config", "arb", "config.json"),
    join(STATE_DIR, "arb.json"),
    join(homedir(), ".local", "share", "devenv", "arb", "arb.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  }
  return {};
}

function loadSessions(): SessionMap {
  const paths = [
    join(STATE_DIR, "sessions.json"),
    join(homedir(), ".local", "share", "devenv", "arb", "sessions.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf-8"));
  }
  return {};
}

function ago(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function seenCounts(): { github: number; jira: number } {
  let github = 0;
  let jira = 0;
  const seenFile = join(STATE_DIR, "seen.txt");
  if (existsSync(seenFile)) {
    github = readFileSync(seenFile, "utf-8").split("\n").filter(Boolean).length;
  }
  const jiraSeenFile = join(STATE_DIR, "jira_seen.txt");
  if (existsSync(jiraSeenFile)) {
    jira = readFileSync(jiraSeenFile, "utf-8").split("\n").filter(Boolean).length;
  }
  return { github, jira };
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
  const intervalMs = config.intervalMs ?? 60_000;
  const now = Date.now();
  const format = process.argv[2];

  // --- Poller health ---
  const lastPollFile = join(STATE_DIR, "last_poll.txt");
  let lastPollTime: Date | null = null;
  if (existsSync(lastPollFile)) {
    lastPollTime = new Date(readFileSync(lastPollFile, "utf-8").trim());
  }

  // --- OpenCode connectivity ---
  let opencodeOk = false;
  try {
    const res = await fetch(`${baseUrl}/session`, { signal: AbortSignal.timeout(3000) });
    opencodeOk = res.ok;
  } catch {}

  // --- Session statuses from OpenCode ---
  const directories = [...new Set(Object.values(sessions).map(e => e.directory))];
  const allStatuses: Record<string, { type: string; message?: string; attempt?: number }> = {};
  for (const dir of directories) {
    try {
      const res = await fetch(`${baseUrl}/session/status?directory=${encodeURIComponent(dir)}`);
      if (res.ok) {
        Object.assign(allStatuses, await res.json() as Record<string, { type: string }>);
      }
    } catch {}
  }

  // --- Enrich each session with OpenCode data ---
  interface Row {
    key: string;
    source: string;
    status: string;
    detail: string;
    sessionId: string;
    createdAt: string;
    messages?: number;
    lastActivity?: number;
    summary?: { additions: number; deletions: number; files: number };
  }

  const rows: Row[] = [];
  const fetches = Object.entries(sessions).map(async ([key, entry]) => {
    const s = allStatuses[entry.sessionId];
    let status = "not found";
    let detail = "";
    if (s) {
      status = s.type;
      if (s.type === "retry") detail = `attempt ${s.attempt}: ${s.message}`;
    }

    const row: Row = { key, source: entry.source, status, detail, sessionId: entry.sessionId, createdAt: entry.createdAt };

    try {
      const [sessionRes, msgRes] = await Promise.all([
        fetch(`${baseUrl}/session/${entry.sessionId}`),
        fetch(`${baseUrl}/session/${entry.sessionId}/message`),
      ]);
      if (sessionRes.ok) {
        const data = await sessionRes.json() as OpenCodeSession;
        row.summary = data.summary;
        row.lastActivity = data.time.updated;
      }
      if (msgRes.ok) {
        const msgs = await msgRes.json() as OpenCodeMessage[];
        row.messages = msgs.length;
      }
    } catch {}

    return row;
  });

  rows.push(...await Promise.all(fetches));

  // --- JSON output ---
  if (format === "--json") {
    console.log(JSON.stringify({ poller: { lastPoll: lastPollTime?.toISOString(), intervalMs, opencodeOk }, sessions: rows }, null, 2));
    return;
  }

  // --- Human output ---
  const seen = seenCounts();

  // Header
  console.log("arb status");
  console.log("─".repeat(50));

  // Poller
  if (lastPollTime) {
    const elapsed = now - lastPollTime.getTime();
    const nextIn = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));
    if (elapsed < intervalMs * 3) {
      console.log(`  poller:    ✅ active (last poll ${ago(elapsed)}, next in ~${nextIn}s)`);
    } else {
      console.log(`  poller:    ⚠️  stale (last poll ${ago(elapsed)})`);
    }
  } else {
    console.log("  poller:    ❌ no state (never polled)");
  }

  // OpenCode
  console.log(`  opencode:  ${opencodeOk ? "✅ connected" : "❌ unreachable"} (${baseUrl})`);

  // Seen events
  console.log(`  seen:      ${seen.github} github, ${seen.jira} jira`);

  // Sessions
  console.log("");
  if (rows.length === 0) {
    console.log("  No tracked sessions.");
  } else {
    console.log(`  ${rows.length} session(s):`);
    console.log("");

    for (const r of rows) {
      const icon = STATUS_ICONS[r.status] ?? "❓";
      const detail = r.detail ? ` (${r.detail})` : "";
      const msgCount = r.messages != null ? `${r.messages} msgs` : "?";
      const activityStr = r.lastActivity ? ago(now - r.lastActivity) : "unknown";
      console.log(`  ${icon} ${r.key} [${r.status}]${detail}`);

      const stats: string[] = [`${msgCount}`, `active ${activityStr}`];
      if (r.summary && r.summary.files > 0) {
        stats.push(`+${r.summary.additions}/-${r.summary.deletions} in ${r.summary.files} files`);
      }
      console.log(`     ${stats.join("  ·  ")}`);
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
