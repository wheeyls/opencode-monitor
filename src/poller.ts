import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";

export interface PollerConfig {
  repos: string[];
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

export class GitHubPoller {
  private seen: Set<string>;
  private lastPoll: string;
  private stateDir: string;
  private seenFile: string;
  private lastPollFile: string;
  private owner: string;
  private repos: string[];
  private intervalMs: number;
  private triggerPhrases: string[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PollerConfig) {
    this.repos = config.repos;
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
    console.log(`[github] Watching ${this.repos.length} repos as ${this.owner} every ${this.intervalMs / 1000}s`);
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
    const since = this.lastPoll;
    const now = new Date().toISOString();

    for (const repo of this.repos) {
      try {
        this.pollPrComments(repo, since, onEvent);
        this.pollPrReviewComments(repo, since, onEvent);
        this.pollIssues(repo, since, onEvent);
      } catch (err) {
        console.error(`[poller] Error polling ${repo}:`, (err as Error).message);
      }
    }

    this.lastPoll = now;
    writeFileSync(this.lastPollFile, now);
  }

  private pollPrComments(repo: string, since: string, onEvent: (e: MonitorEvent) => void): void {
    const prs = ghJson<Array<{ number: number }>>(
      `pr list --repo ${repo} --author ${this.owner} --state open --json number`
    );

    for (const pr of prs) {
      const comments = ghJson<Array<{
        id: number; body: string; created_at: string; html_url: string;
        user: { login: string };
      }>>(`api "repos/${repo}/issues/${pr.number}/comments?since=${since}&per_page=100"`);

      for (const c of comments) {
        if (c.user.login !== this.owner) continue;
        if (!this.matchesTrigger(c.body)) continue;
        if (this.markSeen(`comment_${c.id}`)) continue;

        onEvent({
          source: "github",
          type: "pr_comment",
          key: `${repo}#pr-${pr.number}`,
          repo,
          body: c.body,
          url: c.html_url,
          createdAt: c.created_at,
          meta: { pr: pr.number, commentId: c.id },
        });
      }
    }
  }

  private pollPrReviewComments(repo: string, since: string, onEvent: (e: MonitorEvent) => void): void {
    const prs = ghJson<Array<{ number: number }>>(
      `pr list --repo ${repo} --author ${this.owner} --state open --json number`
    );

    for (const pr of prs) {
      const comments = ghJson<Array<{
        id: number; body: string; path: string; line: number | null;
        diff_hunk: string; created_at: string; html_url: string;
        user: { login: string };
      }>>(`api "repos/${repo}/pulls/${pr.number}/comments?since=${since}&per_page=100"`);

      for (const c of comments) {
        if (c.user.login !== this.owner) continue;
        if (!this.matchesTrigger(c.body)) continue;
        if (this.markSeen(`review_${c.id}`)) continue;

        onEvent({
          source: "github",
          type: "pr_review_comment",
          key: `${repo}#pr-${pr.number}`,
          repo,
          body: c.body,
          url: c.html_url,
          createdAt: c.created_at,
          meta: { pr: pr.number, commentId: c.id, file: c.path, line: c.line, diffHunk: c.diff_hunk },
        });
      }
    }
  }

  private pollIssues(repo: string, since: string, onEvent: (e: MonitorEvent) => void): void {
    const issues = ghJson<Array<{
      number: number; title: string; body: string;
      created_at: string; html_url: string;
      pull_request?: unknown;
    }>>(`api "repos/${repo}/issues?since=${since}&state=open&creator=${this.owner}&per_page=50"`);

    for (const iss of issues) {
      if (iss.pull_request) continue;
      const issueText = `${iss.title}\n${iss.body ?? ""}`;
      if (!this.matchesTrigger(issueText)) continue;
      if (this.markSeen(`issue_${iss.number}`)) continue;

      onEvent({
        source: "github",
        type: "new_issue",
        key: `${repo}#issue-${iss.number}`,
        repo,
        body: `${iss.title}\n\n${iss.body ?? ""}`,
        url: iss.html_url,
        createdAt: iss.created_at,
        meta: { issue: iss.number },
      });
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
