import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
}

function extractText(node: AdfNode | string | null): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  let text = node.text ?? "";
  if (node.content) {
    text += node.content.map(extractText).join("");
  }
  return text;
}

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: AdfNode | string | null;
    status: { name: string };
    updated: string;
    created: string;
    comment?: { comments: Array<{ id: string; body: AdfNode | string; author: { emailAddress: string }; updated: string }> };
  };
}

export interface JiraPollerConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
  intervalMs: number;
  stateDir?: string;
  triggerPhrases?: string[];
}

export class JiraPoller {
  private baseUrl: string;
  private authHeader: string;
  private jql: string;
  private intervalMs: number;
  private triggerPhrases: string[];
  private seen: Set<string>;
  private stateDir: string;
  private seenFile: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: JiraPollerConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.authHeader = "Basic " + Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
    this.jql = config.jql;
    this.intervalMs = config.intervalMs;
    this.triggerPhrases = (config.triggerPhrases ?? []).map(p => p.toLowerCase());
    this.stateDir = config.stateDir ?? join(homedir(), ".local", "share", "arb");
    this.seenFile = join(this.stateDir, "jira_seen.txt");

    mkdirSync(this.stateDir, { recursive: true });

    this.seen = existsSync(this.seenFile)
      ? new Set(readFileSync(this.seenFile, "utf-8").split("\n").filter(Boolean))
      : new Set();
  }

  start(onEvent: (event: MonitorEvent) => void): void {
    console.log(`[jira] Watching JQL: ${this.jql}`);
    console.log(`[jira] Polling every ${this.intervalMs / 1000}s`);
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
      const issues = await this.fetchIssues();

      for (const issue of issues) {
        const descriptionText = extractText(issue.fields.description);
        const issueText = `${issue.fields.summary}\n${descriptionText}`;

        if (this.matchesTrigger(issueText) && !this.markSeen(`issue_${issue.key}`)) {
          onEvent({
            source: "jira",
            type: "epic_issue",
            key: `jira:${issue.key}`,
            body: `${issue.fields.summary}\n\n${descriptionText}`,
            url: `${this.baseUrl}/browse/${issue.key}`,
            createdAt: issue.fields.created,
            meta: {
              issueKey: issue.key,
              status: issue.fields.status.name,
            },
          });
        }

        this.checkCommentsForTrigger(issue, onEvent);
      }
    } catch (err) {
      console.error(`[jira] Poll error:`, (err as Error).message);
    }
  }

  private checkCommentsForTrigger(issue: JiraIssue, onEvent: (event: MonitorEvent) => void): void {
    const comments = issue.fields.comment?.comments ?? [];
    for (const comment of comments) {
      const commentText = extractText(comment.body);
      if (!this.matchesTrigger(commentText)) continue;
      if (this.markSeen(`comment_${issue.key}_${comment.id}`)) continue;

      onEvent({
        source: "jira",
        type: "issue_comment",
        key: `jira:${issue.key}`,
        body: commentText,
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

  private async fetchIssues(): Promise<JiraIssue[]> {
    const params = new URLSearchParams({
      jql: this.jql,
      fields: "summary,description,status,updated,created,comment",
      maxResults: "50",
    });
    const url = `${this.baseUrl}/rest/api/3/search/jql?${params}`;
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
