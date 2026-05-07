#!/usr/bin/env node

import "dotenv/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Worker } from "./worker.js";
import type { MonitorEvent } from "./events.js";
import { loadConfig as loadConfigFile, expandHome } from "./config.js";

interface Config {
  arbServerUrl?: string;
  arbServerToken?: string;
  opencodeUrl?: string;
  owner?: string;
  workingDir?: string;
  reposDir?: string;
  repoDirectories?: Record<string, string>;
}

async function main() {
  const config = loadConfigFile(process.env.ARB_CONFIG_PATH) as Config;

  if (!config.arbServerUrl || !config.arbServerToken) {
    console.error("arb client requires arbServerUrl and arbServerToken in config");
    process.exit(1);
  }

  const repoDirectories: Record<string, string> = {};
  for (const [repo, dir] of Object.entries(config.repoDirectories ?? {})) {
    repoDirectories[repo] = expandHome(dir);
  }
  const reposDir = config.reposDir ? expandHome(config.reposDir) : undefined;
  const workingDir = config.workingDir ? expandHome(config.workingDir) : undefined;

  function resolveDirectory(event: MonitorEvent): string | undefined {
    if (workingDir) return workingDir;
    if (event.repo) {
      if (repoDirectories[event.repo]) return repoDirectories[event.repo];
      if (reposDir) {
        const dir = join(reposDir, event.repo.split("/").pop()!);
        return existsSync(dir) ? dir : undefined;
      }
    }
    return undefined;
  }

  const clientName = process.argv[2] ?? `${homedir().split("/").pop()}-${process.pid}`;

  const worker = new Worker({
    serverUrl: config.arbServerUrl,
    serverToken: config.arbServerToken,
    clientName,
    opencodeUrl: config.opencodeUrl,
    owner: config.owner,
    directoryResolver: resolveDirectory,
  });

  const shutdown = () => {
    worker.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await worker.start();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
