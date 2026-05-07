import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_PATHS = [
  join(process.cwd(), "arb.json"),
  join(homedir(), ".config", "arb", "config.json"),
];

export function loadConfig(explicitPath?: string): Record<string, unknown> {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`Config file not found: ${explicitPath}`);
    }
    console.log(`[config] Loading ${explicitPath}`);
    return JSON.parse(readFileSync(explicitPath, "utf-8"));
  }

  for (const p of DEFAULT_PATHS) {
    if (existsSync(p)) {
      console.log(`[config] Loading ${p}`);
      return JSON.parse(readFileSync(p, "utf-8"));
    }
  }

  throw new Error("No config found. Create arb.json or ~/.config/arb/config.json");
}

export function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}
