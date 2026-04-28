import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { MonitorEvent } from "./events.js";
import { GitHubPoller } from "./poller.js";
import { JiraPoller } from "./jira-poller.js";
import { Dispatcher } from "./dispatcher.js";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  jql: string;
}

interface Config {
  org?: string;
  repoDirectories: Record<string, string>;
  owner?: string;
  intervalMs?: number;
  triggerPhrases?: string[];
  opencodeUrl?: string;
  jira?: JiraConfig;
  jiraWorkingDir?: string;
}

function loadConfig(): Config {
  const paths = [
    join(process.cwd(), "gh-monitor.json"),
    join(homedir(), ".config", "gh-monitor", "config.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      console.log(`[config] Loading ${p}`);
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  }

  throw new Error(
    `No config found. Create gh-monitor.json or ~/.config/gh-monitor/config.json`
  );
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

async function main(): Promise<void> {
  const config = loadConfig();
  const intervalMs = config.intervalMs ?? 60_000;

  const repoDirectories: Record<string, string> = {};
  for (const [repo, dir] of Object.entries(config.repoDirectories)) {
    repoDirectories[repo] = expandHome(dir);
  }

  const jiraWorkingDir = config.jiraWorkingDir ? expandHome(config.jiraWorkingDir) : undefined;

  const dispatcher = new Dispatcher({
    serverUrl: config.opencodeUrl,
    owner: config.owner,
    directoryResolver: (event: MonitorEvent) => {
      if (event.source === "jira") return jiraWorkingDir;
      return event.repo ? repoDirectories[event.repo] : undefined;
    },
  });

  const onEvent = async (event: MonitorEvent) => {
    console.log(`[event] ${event.source}/${event.type} ${event.key}: ${event.body.slice(0, 80)}`);
    try {
      await dispatcher.dispatch(event);
    } catch (err) {
      console.error(`[dispatch] Failed:`, (err as Error).message);
    }
  };

  const githubPoller = new GitHubPoller({
    org: config.org,
    owner: config.owner,
    intervalMs,
    triggerPhrases: config.triggerPhrases,
  });
  githubPoller.start(onEvent);

  if (config.jira) {
    const apiToken = config.jira.apiToken || process.env.JIRA_API_TOKEN;
    if (!apiToken) {
      console.warn("[jira] No API token — set jira.apiToken in config or JIRA_API_TOKEN env var");
    } else {
      const jiraPoller = new JiraPoller({
        ...config.jira,
        apiToken,
        intervalMs,
        triggerPhrases: config.triggerPhrases,
      });
      jiraPoller.start(onEvent);
    }
  }

  const shutdown = async () => {
    console.log("\nShutting down...");
    githubPoller.stop();
    await dispatcher.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
