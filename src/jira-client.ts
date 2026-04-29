import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

function loadJiraConfig(): JiraConfig {
  const paths = [
    join(process.cwd(), "arb.json"),
    join(homedir(), ".config", "arb", "config.json"),
    join(homedir(), ".local", "share", "arb", "arb.json"),
    join(homedir(), ".local", "share", "devenv", "arb", "arb.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      const configDir = dirname(p);
      const realConfigDir = dirname(realpathSync(p));
      for (const dir of new Set([configDir, realConfigDir])) {
        const envFile = join(dir, ".env");
        if (existsSync(envFile)) {
          for (const line of readFileSync(envFile, "utf-8").split("\n")) {
            const match = line.match(/^([A-Z_]+)=(.+)$/);
            if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
          }
        }
      }
      const config = JSON.parse(readFileSync(p, "utf-8"));
      if (!config.jira) throw new Error("No jira config in " + p);
      const apiToken = config.jira.apiToken || process.env.JIRA_API_TOKEN;
      if (!apiToken) throw new Error("No Jira API token — set jira.apiToken in config or JIRA_API_TOKEN env var");
      return {
        baseUrl: config.jira.baseUrl.replace(/\/$/, ""),
        email: config.jira.email,
        apiToken,
      };
    }
  }

  throw new Error("No arb config found");
}

export class JiraClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config?: JiraConfig) {
    const c = config ?? loadJiraConfig();
    this.baseUrl = c.baseUrl;
    this.authHeader = "Basic " + Buffer.from(`${c.email}:${c.apiToken}`).toString("base64");
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return {};

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Jira API ${res.status}: ${text}`);
    }

    return text ? JSON.parse(text) : {};
  }

  async getIssue(issueKey: string, fields?: string[]): Promise<unknown> {
    const params = new URLSearchParams();
    if (fields) params.set("fields", fields.join(","));
    const qs = params.toString();
    return this.request("GET", `/rest/api/3/issue/${issueKey}${qs ? "?" + qs : ""}`);
  }

  async addComment(issueKey: string, body: string): Promise<unknown> {
    return this.request("POST", `/rest/api/3/issue/${issueKey}/comment`, {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: body }],
          },
        ],
      },
    });
  }

  async transition(issueKey: string, transitionId: string): Promise<unknown> {
    return this.request("POST", `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: transitionId },
    });
  }

  async editIssue(issueKey: string, fields: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", `/rest/api/3/issue/${issueKey}`, { fields });
  }

  async createIssue(fields: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `/rest/api/3/issue`, { fields });
  }

  async search(jql: string, fields?: string[], maxResults = 50): Promise<unknown> {
    const params = new URLSearchParams({
      jql,
      maxResults: String(maxResults),
    });
    if (fields) params.set("fields", fields.join(","));
    return this.request("GET", `/rest/api/3/search/jql?${params}`);
  }

  async getTransitions(issueKey: string): Promise<unknown> {
    return this.request("GET", `/rest/api/3/issue/${issueKey}/transitions`);
  }
}
