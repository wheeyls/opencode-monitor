import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { GitHubPoller, type PollerConfig } from "./poller.js";
import { Dispatcher, type DispatcherConfig } from "./dispatcher.js";

interface Config {
  repos: string[];
  repoDirectories: Record<string, string>;
  owner?: string;
  intervalMs?: number;
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
    `No config found. Create gh-monitor.json in the project root or ~/.config/gh-monitor/config.json\n\n` +
    `Example:\n` +
    JSON.stringify(
      {
        repos: ["g2crowd/ue", "g2crowd/buyer_intent_api"],
        repoDirectories: {
          "g2crowd/ue": "~/code/ue",
          "g2crowd/buyer_intent_api": "~/code/buyer_intent_api",
        },
        intervalMs: 60000,
      },
      null,
      2
    )
  );
}

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

async function main(): Promise<void> {
  const config = loadConfig();

  const repoDirectories: Record<string, string> = {};
  for (const [repo, dir] of Object.entries(config.repoDirectories)) {
    repoDirectories[repo] = expandHome(dir);
  }

  const dispatcher = new Dispatcher({ repoDirectories });
  await dispatcher.start();

  const poller = new GitHubPoller({
    repos: config.repos,
    owner: config.owner,
    intervalMs: config.intervalMs ?? 60_000,
  });

  poller.start(async (event) => {
    console.log(`[event] ${event.type} on ${event.repo}: ${event.body.slice(0, 80)}`);
    try {
      await dispatcher.dispatch(event);
    } catch (err) {
      console.error(`[dispatch] Failed:`, (err as Error).message);
    }
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    poller.stop();
    await dispatcher.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    poller.stop();
    await dispatcher.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
