import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { Session } from "@opencode-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";
import type { DispatcherPort, SessionStatus } from "./dispatcher-port.js";
import { EventFormatter } from "./event-formatter.js";

interface SessionEntry {
  sessionId: string;
  directory: string;
  source: string;
  createdAt: string;
}

type SessionMap = Record<string, SessionEntry>;

export interface DispatcherConfig {
  stateDir?: string;
  serverUrl?: string;
  promptDir?: string;
  owner?: string;
  directoryResolver: (event: MonitorEvent) => string | undefined;
}

export class Dispatcher implements DispatcherPort {
  private client: OpencodeClient;
  private sessions: SessionMap;
  private sessionsFile: string;
  private resolveDirectory: (event: MonitorEvent) => string | undefined;
  private formatter: EventFormatter;

  constructor(config: DispatcherConfig) {
    const stateDir = config.stateDir ?? join(homedir(), ".local", "share", "arb");
    mkdirSync(stateDir, { recursive: true });
    this.sessionsFile = join(stateDir, "sessions.json");
    this.resolveDirectory = config.directoryResolver;
    this.formatter = new EventFormatter({
      promptDir: config.promptDir ?? join(process.cwd(), "prompts"),
      owner: config.owner ?? "the user",
    });

    this.client = createOpencodeClient({
      baseUrl: config.serverUrl ?? "http://localhost:4096",
    });

    this.sessions = existsSync(this.sessionsFile)
      ? JSON.parse(readFileSync(this.sessionsFile, "utf-8"))
      : {};

    console.log(`[dispatcher] Connecting to OpenCode at ${config.serverUrl ?? "http://localhost:4096"}`);
    this.startPermissionAutoApprover();
  }

  async stop(): Promise<void> {}

  private startPermissionAutoApprover(): void {
    const trackedSessionIds = () => new Set(Object.values(this.sessions).map(e => e.sessionId));

    (async () => {
      try {
        const result = await this.client.event.subscribe({});
        for await (const event of result.stream) {
          const data = event as { type?: string; properties?: Record<string, unknown> };
          if (data.type !== "permission.updated") continue;

          const props = data.properties as { id: string; sessionID: string; title: string };
          if (!trackedSessionIds().has(props.sessionID)) continue;

          console.log(`[dispatcher] Auto-approving permission: ${props.title}`);
          try {
            await this.client.postSessionIdPermissionsPermissionId({
              path: { id: props.sessionID, permissionID: props.id },
              body: { response: "always" },
            });
          } catch (err) {
            console.error(`[dispatcher] Failed to approve permission:`, (err as Error).message);
          }
        }
      } catch (err) {
        console.error(`[dispatcher] Event stream error:`, (err as Error).message);
        setTimeout(() => this.startPermissionAutoApprover(), 5000);
      }
    })();
  }

  async getStatus(): Promise<SessionStatus[]> {
    const results: SessionStatus[] = [];

    if (Object.keys(this.sessions).length === 0) return results;

    const directories = [...new Set(Object.values(this.sessions).map(e => e.directory))];
    const allStatuses: Record<string, { type: string; message?: string; attempt?: number }> = {};

    for (const dir of directories) {
      try {
        const res = await this.client.session.status({ query: { directory: dir } });
        const data = (res.data ?? {}) as Record<string, { type: string; message?: string; attempt?: number }>;
        Object.assign(allStatuses, data);
      } catch {}
    }

    for (const [key, entry] of Object.entries(this.sessions)) {
      const s = allStatuses[entry.sessionId];
      if (!s) {
        results.push({ key, sessionId: entry.sessionId, source: entry.source, status: "not found" });
      } else if (s.type === "retry") {
        results.push({ key, sessionId: entry.sessionId, source: entry.source, status: "retry", detail: `attempt ${s.attempt}: ${s.message}` });
      } else {
        results.push({ key, sessionId: entry.sessionId, source: entry.source, status: s.type });
      }
    }

    return results;
  }

  get trackedSessionCount(): number {
    return Object.keys(this.sessions).length;
  }

  async dispatch(event: MonitorEvent): Promise<void> {
    const directory = this.resolveDirectory(event);
    if (!directory) {
      console.warn(`[dispatcher] No directory for ${event.key}, skipping`);
      return;
    }

    const entry = this.sessions[event.key] ?? this.resolveLinkedSession(event);
    let sessionId: string;
    let isNew = false;

    if (entry) {
      sessionId = entry.sessionId;
      console.log(`[dispatcher] Resuming session ${sessionId} for ${event.key}`);
    } else {
      const session = await this.client.session.create({
        body: { title: `${event.key}` },
        query: { directory },
      });
      const data = session.data as Session;
      sessionId = data.id;
      isNew = true;
      this.sessions[event.key] = {
        sessionId,
        directory,
        source: event.source,
        createdAt: new Date().toISOString(),
      };
      this.saveSessions();
      console.log(`[dispatcher] Created session ${sessionId} for ${event.key}`);
    }

    const prompt = isNew
      ? this.formatter.buildInitialPrompt(event)
      : this.formatter.formatEvent(event);

    console.log(`[dispatcher] Sending to ${sessionId}: ${prompt.slice(0, 80)}...`);

    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });
  }

  private resolveLinkedSession(event: MonitorEvent): SessionEntry | undefined {
    if (event.source !== "github") return undefined;

    const searchText = [
      event.body,
      event.meta?.parentTitle as string ?? "",
      event.meta?.parentBody as string ?? "",
    ].join("\n");

    const match = searchText.match(/\[([A-Z][A-Z0-9]+-\d+)\]/);
    if (!match) return undefined;

    const jiraKey = `jira:${match[1]}`;
    const entry = this.sessions[jiraKey];
    if (entry) {
      console.log(`[dispatcher] Linked ${event.key} → ${jiraKey} (found ${match[1]} in PR)`);
    }
    return entry;
  }

  private saveSessions(): void {
    writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
  }
}
