#!/usr/bin/env node
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";
import { JiraClient } from "./jira-client.js";
import { createDispatcher } from "./create-dispatcher.js";

const USAGE = `Usage: arb-kick <source> <key> [message]

Manually dispatch an event to an arb session.

Sources:
  jira <issue-key>              Fetch a Jira ticket and dispatch it
  github <owner/repo>#<number>  Fetch a GitHub issue or PR and dispatch it

If the session already exists, an optional message is sent as instructions.
Without a message, it defaults to asking the agent to check in on the ticket.

Examples:
  arb-kick jira LABS-919
  arb-kick jira LABS-919 "Focus on the performance regression"
  arb-kick github g2crowd/ue#39049`;

interface Config {
  org?: string;
  repoDirectories?: Record<string, string>;
  reposDir?: string;
  owner?: string;
  opencodeUrl?: string;
  arbServerUrl?: string;
  arbServerToken?: string;
  jira?: { baseUrl: string; email: string; apiToken: string };
  workingDir?: string;
  jiraWorkingDir?: string; // deprecated, use workingDir
}

function loadConfig(): Config {
  const paths = [
    join(process.cwd(), "arb.json"),
    join(homedir(), ".config", "arb", "config.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  }

  throw new Error("No arb config found");
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

function gh(args: string): string {
  return execSync(`gh ${args}`, { encoding: "utf-8", timeout: 30_000 }).trim();
}

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

async function fetchJiraEvent(issueKey: string, config: Config): Promise<MonitorEvent> {
  const client = new JiraClient();
  const result = await client.getIssue(issueKey, ["summary", "description", "status", "created"]) as {
    key: string;
    fields: {
      summary: string;
      description: AdfNode | string | null;
      status: { name: string };
      created: string;
    };
  };

  const description = extractText(result.fields.description);

  return {
    source: "jira",
    type: "epic_issue",
    key: `jira:${result.key}`,
    body: `${result.fields.summary}\n\n${description}`,
    url: `${config.jira!.baseUrl}/browse/${result.key}`,
    createdAt: result.fields.created,
    meta: {
      issueKey: result.key,
      status: result.fields.status.name,
    },
  };
}

async function fetchGitHubEvent(ref: string): Promise<MonitorEvent> {
  const match = ref.match(/^(.+?)#(\d+)$/);
  if (!match) {
    throw new Error(`Invalid GitHub reference: ${ref}. Expected owner/repo#number`);
  }

  const [, repo, numberStr] = match;
  const number = parseInt(numberStr, 10);

  const json = gh(`api repos/${repo}/issues/${number} --jq '{title: .title, body: .body, html_url: .html_url, created_at: .created_at, pull_request: .pull_request}'`);
  const issue = JSON.parse(json) as {
    title: string;
    body: string | null;
    html_url: string;
    created_at: string;
    pull_request: unknown | null;
  };

  const isPR = issue.pull_request != null;

  return {
    source: "github",
    type: isPR ? "new_pr" : "new_issue",
    key: `${repo}#${isPR ? "pr" : "issue"}-${number}`,
    repo,
    body: `${issue.title}\n\n${issue.body ?? ""}`,
    url: issue.html_url,
    createdAt: issue.created_at,
    meta: { [isPR ? "pr" : "issue"]: number },
  };
}

async function main(): Promise<void> {
  const [source, ...rest] = process.argv.slice(2);

  if (!source || source === "--help" || source === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const key = rest[0];
  if (!key) {
    console.error("Error: missing key argument\n");
    console.log(USAGE);
    process.exit(1);
  }

  const userMessage = rest.slice(1).join(" ") || null;

  const config = loadConfig();

  const repoDirectories: Record<string, string> = {};
  for (const [repo, dir] of Object.entries(config.repoDirectories ?? {})) {
    repoDirectories[repo] = expandHome(dir);
  }
  const reposDir = config.reposDir ? expandHome(config.reposDir) : undefined;
  const workingDir = (config.workingDir ?? config.jiraWorkingDir)
    ? expandHome((config.workingDir ?? config.jiraWorkingDir)!)
    : undefined;

  let event: MonitorEvent;

  switch (source) {
    case "jira":
      event = await fetchJiraEvent(key, config);
      break;
    case "github":
      event = await fetchGitHubEvent(key);
      break;
    default:
      console.error(`Unknown source: ${source}\n`);
      console.log(USAGE);
      process.exit(1);
  }

  event.meta = {
    ...event.meta,
    kick: true,
    kickMessage: userMessage,
  };

  console.log(`[kick] Dispatching ${event.source}/${event.type}: ${event.key}`);

  const dispatcher = createDispatcher({
    arbServerUrl: config.arbServerUrl,
    arbServerToken: config.arbServerToken,
    opencodeUrl: config.opencodeUrl,
    owner: config.owner,
    directoryResolver: (e: MonitorEvent) => {
      if (workingDir) return workingDir;
      if (e.repo) {
        if (repoDirectories[e.repo]) return repoDirectories[e.repo];
        if (reposDir) {
          const dir = join(reposDir, e.repo.split("/").pop()!);
          return existsSync(dir) ? dir : undefined;
        }
      }
      return undefined;
    },
  });

  await dispatcher.dispatch(event);
  console.log(`[kick] Done`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
});
