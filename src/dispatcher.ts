import { createOpencode, type OpencodeClient } from "@opencode-ai/sdk";
import type { Session } from "@opencode-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { GitHubEvent } from "./poller.js";

interface SessionEntry {
  sessionId: string;
  repo: string;
  directory: string;
  createdAt: string;
}

type SessionMap = Record<string, SessionEntry>;

export interface DispatcherConfig {
  stateDir?: string;
  repoDirectories: Record<string, string>;
}

export class Dispatcher {
  private client: OpencodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private sessions: SessionMap;
  private sessionsFile: string;
  private repoDirectories: Record<string, string>;

  constructor(config: DispatcherConfig) {
    const stateDir = config.stateDir ?? join(homedir(), ".local", "share", "gh-monitor");
    mkdirSync(stateDir, { recursive: true });
    this.sessionsFile = join(stateDir, "sessions.json");
    this.repoDirectories = config.repoDirectories;

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

  async dispatch(event: GitHubEvent): Promise<void> {
    if (!this.client) throw new Error("Dispatcher not started");

    const key = this.sessionKey(event);
    const directory = this.repoDirectories[event.repo];
    if (!directory) {
      console.warn(`[dispatcher] No directory configured for ${event.repo}, skipping`);
      return;
    }

    const entry = this.sessions[key];
    let sessionId: string;

    if (entry) {
      sessionId = entry.sessionId;
      console.log(`[dispatcher] Resuming session ${sessionId} for ${key}`);
    } else {
      const session = await this.client.session.create({
        body: { title: this.sessionTitle(event) },
        query: { directory },
      });
      const data = session.data as Session;
      sessionId = data.id;
      this.sessions[key] = {
        sessionId,
        repo: event.repo,
        directory,
        createdAt: new Date().toISOString(),
      };
      this.saveSessions();
      console.log(`[dispatcher] Created session ${sessionId} for ${key}`);
    }

    const prompt = this.buildPrompt(event);
    console.log(`[dispatcher] Sending prompt to ${sessionId}: ${prompt.slice(0, 80)}...`);

    await this.client.session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });
  }

  private sessionKey(event: GitHubEvent): string {
    if (event.pr) return `${event.repo}#pr-${event.pr}`;
    if (event.issue) return `${event.repo}#issue-${event.issue}`;
    return `${event.repo}#${event.type}-${event.createdAt}`;
  }

  private sessionTitle(event: GitHubEvent): string {
    if (event.pr) return `PR #${event.pr} — ${event.repo}`;
    if (event.issue) return `Issue #${event.issue} — ${event.repo}`;
    return `${event.type} — ${event.repo}`;
  }

  private buildPrompt(event: GitHubEvent): string {
    const parts: string[] = [];

    switch (event.type) {
      case "pr_comment":
        parts.push(`New comment on PR #${event.pr}:`);
        parts.push(event.body);
        parts.push(`\nURL: ${event.url}`);
        parts.push(
          "\nReact to the comment with an emoji to acknowledge. " +
          "If this is a question, reply via GitHub comment. " +
          "If code changes are needed, make them and push. " +
          "Run the full test suite before pushing."
        );
        break;

      case "pr_review_comment":
        parts.push(`Inline review comment on PR #${event.pr}:`);
        if (event.file) parts.push(`File: ${event.file}:${event.line}`);
        if (event.diffHunk) parts.push(`\`\`\`diff\n${event.diffHunk}\n\`\`\``);
        parts.push(event.body);
        parts.push(`\nURL: ${event.url}`);
        parts.push(
          "\nReact to the comment with an emoji to acknowledge. " +
          "Address the feedback, push the fix, and reply on the comment."
        );
        break;

      case "new_issue":
        parts.push(`New issue #${event.issue}:`);
        parts.push(event.body);
        parts.push(`\nURL: ${event.url}`);
        parts.push(
          "\nWork on this issue. Follow the project's coding standards. " +
          "React to comments with an emoji to acknowledge. " +
          "Respond via GitHub comment when the task is a question, " +
          "or push code directly when changes are needed."
        );
        break;
    }

    return parts.join("\n\n");
  }

  private saveSessions(): void {
    writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
  }
}
