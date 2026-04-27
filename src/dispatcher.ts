import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import type { Session } from "@opencode-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

interface SessionEntry {
  sessionId: string;
  directory: string;
  createdAt: string;
}

type SessionMap = Record<string, SessionEntry>;

export interface DispatcherConfig {
  stateDir?: string;
  directoryResolver: (event: MonitorEvent) => string | undefined;
}

export class Dispatcher {
  private client: OpencodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private sessions: SessionMap;
  private sessionsFile: string;
  private resolveDirectory: (event: MonitorEvent) => string | undefined;

  constructor(config: DispatcherConfig) {
    const stateDir = config.stateDir ?? join(homedir(), ".local", "share", "gh-monitor");
    mkdirSync(stateDir, { recursive: true });
    this.sessionsFile = join(stateDir, "sessions.json");
    this.resolveDirectory = config.directoryResolver;

    this.sessions = existsSync(this.sessionsFile)
      ? JSON.parse(readFileSync(this.sessionsFile, "utf-8"))
      : {};
  }

  async start(): Promise<void> {
    const opencode = await createOpencode();
    this.client = opencode.client;
    this.server = opencode.server;
    console.log(`[dispatcher] Connected to OpenCode at ${opencode.server.url}`);
  }

  async stop(): Promise<void> {
    this.server?.close();
  }

  async dispatch(event: MonitorEvent): Promise<void> {
    if (!this.client) throw new Error("Dispatcher not started");

    const directory = this.resolveDirectory(event);
    if (!directory) {
      console.warn(`[dispatcher] No directory for ${event.key}, skipping`);
      return;
    }

    const entry = this.sessions[event.key];
    let sessionId: string;

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
      this.sessions[event.key] = {
        sessionId,
        directory,
        createdAt: new Date().toISOString(),
      };
      this.saveSessions();
      console.log(`[dispatcher] Created session ${sessionId} for ${event.key}`);
    }

    const prompt = this.buildPrompt(event);
    console.log(`[dispatcher] Sending to ${sessionId}: ${prompt.slice(0, 80)}...`);

    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });
  }

  private buildPrompt(event: MonitorEvent): string {
    const parts: string[] = [];

    parts.push(`[${event.source}] ${event.type}: ${event.key}`);
    parts.push(event.body);
    parts.push(`URL: ${event.url}`);

    if (event.source === "github") {
      const meta = event.meta ?? {};
      if (meta.file) parts.push(`File: ${meta.file}:${meta.line ?? ""}`);
      if (meta.diffHunk) parts.push(`\`\`\`diff\n${meta.diffHunk}\n\`\`\``);
    }

    parts.push(
      "React to the comment with an emoji to acknowledge. " +
      "If this is a question, reply via comment. " +
      "If code changes are needed, make them and push. " +
      "Run tests before pushing."
    );

    return parts.join("\n\n");
  }

  private saveSessions(): void {
    writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
  }
}
