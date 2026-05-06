import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { MonitorEvent } from "./events.js";

export class EventFormatter {
  private systemPrompt: string | null = null;
  private systemPromptLoaded = false;
  private promptDir: string;
  private owner: string;

  constructor(opts: { promptDir: string; owner: string }) {
    this.promptDir = opts.promptDir;
    this.owner = opts.owner;
  }

  buildInitialPrompt(event: MonitorEvent): string {
    const system = this.loadSystemPrompt();
    const eventText = this.formatEvent(event);

    if (system) {
      return `${system}\n\n---\n\n${eventText}`;
    }
    return eventText;
  }

  formatEvent(event: MonitorEvent): string {
    const meta = event.meta ?? {};
    if (meta.kick) {
      const msg = (meta.kickMessage as string) || `User-initiated check-in. Review the current state of ${event.key} and continue any outstanding work.`;
      return `[kick] ${event.key}\n\n${msg}\n\nURL: ${event.url}`;
    }

    const parts: string[] = [];

    parts.push(`[${event.source}] ${event.type}: ${event.key}`);
    parts.push(event.body);
    parts.push(`URL: ${event.url}`);

    if (event.source === "github") {
      if (meta.file) parts.push(`File: ${meta.file}:${meta.line ?? ""}`);
      if (meta.diffHunk) parts.push(`\`\`\`diff\n${meta.diffHunk}\n\`\`\``);
    }

    if (event.source === "jira") {
      if (meta.issueKey) parts.push(`Issue: ${meta.issueKey}`);
      if (meta.status) parts.push(`Status: ${meta.status}`);
    }

    return parts.join("\n\n");
  }

  private loadSystemPrompt(): string | null {
    if (this.systemPromptLoaded) return this.systemPrompt;
    this.systemPromptLoaded = true;

    const filePath = join(this.promptDir, "system.md");
    if (!existsSync(filePath)) {
      console.warn(`[dispatcher] No system prompt at ${filePath}`);
      return null;
    }

    const raw = readFileSync(filePath, "utf-8");
    this.systemPrompt = raw.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      if (key === "owner") return this.owner;
      return `{{${key}}}`;
    });
    return this.systemPrompt;
  }
}
