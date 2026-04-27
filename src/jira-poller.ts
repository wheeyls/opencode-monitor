import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    updated: string;
    created: string;
    comment?: { comments: Array<{ id: string; body: string; author: { emailAddress: string }; updated: string }> };
  };
}

export interface JiraPollerConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  boardId: number;
  intervalMs: number;
  stateDir?: string;
  triggerPhrases?: string[];
}

export class JiraPoller {
  private baseUrl: string;
  private authHeader: string;
  private boardId: number;
  private intervalMs: number;
  private triggerPhrases: string[];
  private seen: Set<string>;
  private stateDir: string;
  private seenFile: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: JiraPollerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.authHeader = "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    this.boardId = config.boardId;
    this.intervalMs = config.intervalMs;
    this.triggerPhrases = (config.triggerPhrases ?? []).map(p => p.toLowerCase());
    this.stateDir = config.stateDir ?? join(homedir(), ".local", "share", "gh-monitor");
    this.seenFile = join(this.stateDir, "jira_seen.txt");

    mkdirSync(this.stateDir, { recursive: true });

    this.seen = existsSync(this.seenFile)
      ? new Set(readFileSync(this.seenFile, "utf-8").split("\n").filter(Boolean))
      : new Set();
  }

  start(onEvent: (event: MonitorEvent) => void): void {
    console.log(`[jira] Watching board ${this.boardId} every ${this.intervalMs / 1000}s`);
    this.poll(onEvent);
    this.timer = setInterval(() => this.poll(onEvent), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(onEvent: (event: MonitorEvent) => void): Promise<void> {
    try {
      const issues = await this.fetchBoardIssues();

      for (const issue of issues) {
        const issueText = `${issue.fields.summary}\n${issue.fields.description ?? ""}`;
        if (!this.matchesTrigger(issueText)) {
          this.checkCommentsForTrigger(issue, onEvent);
          continue;
        }

        if (this.markSeen(`issue_${issue.key}`)) continue;

        onEvent({
          source: "jira",
          type: "board_issue",
          key: `jira:${issue.key}`,
          body: `${issue.fields.summary}\n\n${issue.fields.description ?? ""}`,
          url: `${this.baseUrl}/browse/${issue.key}`,
          createdAt: issue.fields.created,
          meta: {
            issueKey: issue.key,
            status: issue.fields.status.name,
          },
        });
      }
    } catch (err) {
      console.error(`[jira] Poll error:`, (err as Error).message);
    }
  }

  private checkCommentsForTrigger(issue: JiraIssue, onEvent: (event: MonitorEvent) => void): void {
    const comments = issue.fields.comment?.comments ?? [];
    for (const comment of comments) {
      if (!this.matchesTrigger(comment.body)) continue;
      if (this.markSeen(`comment_${issue.key}_${comment.id}`)) continue;

      onEvent({
        source: "jira",
        type: "issue_comment",
        key: `jira:${issue.key}`,
        body: comment.body,
        url: `${this.baseUrl}/browse/${issue.key}?focusedCommentId=${comment.id}`,
        createdAt: comment.updated,
        meta: {
          issueKey: issue.key,
          commentId: comment.id,
          status: issue.fields.status.name,
        },
      });
    }
  }

  private async fetchBoardIssues(): Promise<JiraIssue[]> {
    const url = `${this.baseUrl}/rest/agile/1.0/board/${this.boardId}/issue?fields=summary,description,status,updated,created,comment&maxResults=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Jira API ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { issues: JiraIssue[] };
    return data.issues;
  }

  private matchesTrigger(text: string): boolean {
    if (this.triggerPhrases.length === 0) return true;
    const lower = text.toLowerCase();
    return this.triggerPhrases.some(phrase => lower.includes(phrase));
  }

  /** Returns true if already seen */
  private markSeen(key: string): boolean {
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    writeFileSync(this.seenFile, [...this.seen].join("\n"));
    return false;
  }
}
