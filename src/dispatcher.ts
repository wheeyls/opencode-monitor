import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { Session } from "@opencode-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

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

export class Dispatcher {
  private client: OpencodeClient;
  private sessions: SessionMap;
  private sessionsFile: string;
  private promptDir: string;
  private resolveDirectory: (event: MonitorEvent) => string | undefined;
  private owner: string;
  private systemPrompt: string | null = null;
  private systemPromptLoaded = false;

  constructor(config: DispatcherConfig) {
    const stateDir = config.stateDir ?? join(homedir(), ".local", "share", "gh-monitor");
    mkdirSync(stateDir, { recursive: true });
    this.sessionsFile = join(stateDir, "sessions.json");
    this.promptDir = config.promptDir ?? join(process.cwd(), "prompts");
    this.resolveDirectory = config.directoryResolver;
    this.owner = config.owner ?? "the user";

    this.client = createOpencodeClient({
      baseUrl: config.serverUrl ?? "http://localhost:4096",
    });

    this.sessions = existsSync(this.sessionsFile)
      ? JSON.parse(readFileSync(this.sessionsFile, "utf-8"))
      : {};

    console.log(`[dispatcher] Connecting to OpenCode at ${config.serverUrl ?? "http://localhost:4096"}`);
  }

  async stop(): Promise<void> {}

  async getStatus(): Promise<Array<{ key: string; sessionId: string; source: string; status: string; detail?: string }>> {
    const results: Array<{ key: string; sessionId: string; source: string; status: string; detail?: string }> = [];
    const sessionIds = Object.values(this.sessions).map(e => e.sessionId);

    if (sessionIds.length === 0) return results;

    let statuses: Record<string, { type: string; message?: string; attempt?: number }> = {};
    try {
      const res = await this.client.session.status({});
      statuses = (res.data ?? {}) as Record<string, { type: string; message?: string; attempt?: number }>;
    } catch {
      return Object.entries(this.sessions).map(([key, entry]) => ({
        key,
        sessionId: entry.sessionId,
        source: entry.source,
        status: "unknown",
      }));
    }

    for (const [key, entry] of Object.entries(this.sessions)) {
      const s = statuses[entry.sessionId];
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

    const entry = this.sessions[event.key];
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
      ? this.buildInitialPrompt(event)
      : this.formatEvent(event);

    console.log(`[dispatcher] Sending to ${sessionId}: ${prompt.slice(0, 80)}...`);

    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });
  }

  private buildInitialPrompt(event: MonitorEvent): string {
    const system = this.loadSystemPrompt();
    const eventText = this.formatEvent(event);

    if (system) {
      return `${system}\n\n---\n\n${eventText}`;
    }
    return eventText;
  }

  private loadSystemPrompt(): string | null {
    if (this.systemPromptLoaded) return this.systemPrompt;
    this.systemPromptLoaded = true;

    const filePath = join(this.promptDir, "system.md");
    if (!existsSync(filePath)) {
      console.warn(`[dispatcher] No system prompt at ${filePath}`);
      return null;
    }

    const raw = readFileSync(filePath, "utf-8");
    this.systemPrompt = raw.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      if (key === "owner") return this.owner;
      return `{{${key}}}`;
    });
    return this.systemPrompt;
  }

  private formatEvent(event: MonitorEvent): string {
    const parts: string[] = [];

    parts.push(`[${event.source}] ${event.type}: ${event.key}`);
    parts.push(event.body);
    parts.push(`URL: ${event.url}`);

    if (event.source === "github") {
      const meta = event.meta ?? {};
      if (meta.file) parts.push(`File: ${meta.file}:${meta.line ?? ""}`);
      if (meta.diffHunk) parts.push(`\`\`\`diff\n${meta.diffHunk}\n\`\`\``);
    }

    if (event.source === "jira") {
      const meta = event.meta ?? {};
      if (meta.issueKey) parts.push(`Issue: ${meta.issueKey}`);
      if (meta.status) parts.push(`Status: ${meta.status}`);
    }

    return parts.join("\n\n");
  }

  private saveSessions(): void {
    writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
  }
}
