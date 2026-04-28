import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

export interface PollerConfig {
  org?: string;
  owner?: string;
  intervalMs: number;
  stateDir?: string;
  triggerPhrases?: string[];
}

function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8", timeout: 30_000 }).trim();
}

function ghJson<T>(args: string): T {
  const raw = gh(args);
  return raw ? JSON.parse(raw) as T : [] as unknown as T;
}

interface SearchResult {
  number: number;
  title: string;
  body: string;
  html_url: string;
  updated_at: string;
  created_at: string;
  repository_url: string;
  pull_request?: unknown;
  comments: number;
}

function repoFromUrl(repositoryUrl: string): string {
  const parts = repositoryUrl.split("/");
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export class GitHubPoller {
  private seen: Set<string>;
  private stateDir: string;
  private seenFile: string;
  private lastPollFile: string;
  private lastPoll: string;
  private owner: string;
  private org: string;
  private intervalMs: number;
  private triggerPhrases: string[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PollerConfig) {
    this.org = config.org ?? "g2crowd";
    this.intervalMs = config.intervalMs;
    this.triggerPhrases = (config.triggerPhrases ?? []).map(p => p.toLowerCase());
    this.stateDir = config.stateDir ?? join(homedir(), ".local", "share", "gh-monitor");
    this.seenFile = join(this.stateDir, "seen.txt");
    this.lastPollFile = join(this.stateDir, "last_poll.txt");

    mkdirSync(this.stateDir, { recursive: true });

    this.seen = existsSync(this.seenFile)
      ? new Set(readFileSync(this.seenFile, "utf-8").split("\n").filter(Boolean))
      : new Set();

    this.lastPoll = existsSync(this.lastPollFile)
      ? readFileSync(this.lastPollFile, "utf-8").trim()
      : new Date().toISOString();

    this.owner = config.owner ?? gh("api user --jq .login");
  }

  start(onEvent: (event: MonitorEvent) => void): void {
    console.log(`[github] Watching org:${this.org} as ${this.owner} every ${this.intervalMs / 1000}s`);
    this.poll(onEvent);
    this.timer = setInterval(() => this.poll(onEvent), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private poll(onEvent: (event: MonitorEvent) => void): void {
    const since = this.lastPoll.split("T")[0];
    const now = new Date().toISOString();

    try {
      this.pollMyIssues(since, onEvent);
      this.pollMyPRs(since, onEvent);
      this.pollCommentedIssues(since, onEvent);
      this.pollCommentedPRs(since, onEvent);
    } catch (err) {
      console.error(`[github] Poll error:`, (err as Error).message);
    }

    this.lastPoll = now;
    writeFileSync(this.lastPollFile, now);
  }

  private pollMyIssues(since: string, onEvent: (e: MonitorEvent) => void): void {
    const results = ghJson<{ items: SearchResult[] }>(
      `api "search/issues?q=author:${this.owner}+org:${this.org}+is:issue+is:open+updated:>${since}&sort=updated&per_page=50"`
    );

    for (const item of results.items ?? []) {
      const text = `${item.title}\n${item.body ?? ""}`;
      if (!this.matchesTrigger(text)) continue;
      if (this.markSeen(`issue_${item.html_url}`)) continue;

      const repo = repoFromUrl(item.repository_url);
      onEvent({
        source: "github",
        type: "new_issue",
        key: `${repo}#issue-${item.number}`,
        repo,
        body: `${item.title}\n\n${item.body ?? ""}`,
        url: item.html_url,
        createdAt: item.created_at,
        meta: { issue: item.number },
      });
    }
  }

  private pollMyPRs(since: string, onEvent: (e: MonitorEvent) => void): void {
    const results = ghJson<{ items: SearchResult[] }>(
      `api "search/issues?q=author:${this.owner}+org:${this.org}+is:pr+is:open+updated:>${since}&sort=updated&per_page=50"`
    );

    for (const item of results.items ?? []) {
      const text = `${item.title}\n${item.body ?? ""}`;
      if (!this.matchesTrigger(text)) continue;
      if (this.markSeen(`pr_${item.html_url}`)) continue;

      const repo = repoFromUrl(item.repository_url);
      onEvent({
        source: "github",
        type: "new_pr",
        key: `${repo}#pr-${item.number}`,
        repo,
        body: `${item.title}\n\n${item.body ?? ""}`,
        url: item.html_url,
        createdAt: item.created_at,
        meta: { pr: item.number },
      });
    }
  }

  private pollCommentedIssues(since: string, onEvent: (e: MonitorEvent) => void): void {
    const results = ghJson<{ items: SearchResult[] }>(
      `api "search/issues?q=commenter:${this.owner}+org:${this.org}+is:issue+is:open+updated:>${since}&sort=updated&per_page=50"`
    );

    for (const item of results.items ?? []) {
      if (this.markSeen(`commented_issue_${item.html_url}_${item.updated_at}`)) continue;

      const repo = repoFromUrl(item.repository_url);
      this.fetchNewComments(repo, item.number, "issue", onEvent);
    }
  }

  private pollCommentedPRs(since: string, onEvent: (e: MonitorEvent) => void): void {
    const results = ghJson<{ items: SearchResult[] }>(
      `api "search/issues?q=commenter:${this.owner}+org:${this.org}+is:pr+is:open+updated:>${since}&sort=updated&per_page=50"`
    );

    for (const item of results.items ?? []) {
      if (this.markSeen(`commented_pr_${item.html_url}_${item.updated_at}`)) continue;

      const repo = repoFromUrl(item.repository_url);
      this.fetchNewComments(repo, item.number, "pr", onEvent);
    }
  }

  private fetchNewComments(repo: string, number: number, kind: "issue" | "pr", onEvent: (e: MonitorEvent) => void): void {
    try {
      const comments = ghJson<Array<{
        id: number; body: string; created_at: string; html_url: string;
        user: { login: string };
      }>>(`api "repos/${repo}/issues/${number}/comments?per_page=100"`);

      for (const c of comments) {
        if (c.user.login !== this.owner) continue;
        if (!this.matchesTrigger(c.body)) continue;
        if (this.markSeen(`comment_${c.id}`)) continue;

        onEvent({
          source: "github",
          type: kind === "pr" ? "pr_comment" : "issue_comment",
          key: `${repo}#${kind}-${number}`,
          repo,
          body: c.body,
          url: c.html_url,
          createdAt: c.created_at,
          meta: { [kind]: number, commentId: c.id },
        });
      }
    } catch (err) {
      console.error(`[github] Error fetching comments for ${repo}#${number}:`, (err as Error).message);
    }
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
