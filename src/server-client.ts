interface ServerClientConfig {
  serverUrl: string;
  token: string;
}

interface ClaimResultWork {
  kind: "work";
  workItem: {
    id: string;
    threadId: string;
    kind: string;
    sequence: number;
    payload: Record<string, unknown>;
  };
  leaseExpiresAt: string;
  sessionRef: string | null;
}

interface ClaimResultNone {
  kind: "none";
}

export type ClaimResult = ClaimResultWork | ClaimResultNone;

export class ServerClient {
  private url: string;
  private token: string;

  constructor(config: ServerClientConfig) {
    this.url = config.serverUrl.replace(/\/$/, "");
    this.token = config.token;
  }

  async register(name: string): Promise<string> {
    const res = await this.post("/api/client/register", { name });
    const data = await res.json() as { clientId: string };
    return data.clientId;
  }

  async claim(clientId: string): Promise<ClaimResult> {
    const res = await this.post("/api/client/claim", { clientId });
    return await res.json() as ClaimResult;
  }

  async heartbeat(workItemId: string, clientId: string): Promise<void> {
    await this.post("/api/client/heartbeat", { workItemId, clientId });
  }

  async start(workItemId: string, clientId: string): Promise<void> {
    await this.post(`/api/work/${workItemId}/start`, { clientId });
  }

  async complete(workItemId: string, clientId: string, sessionRef?: string): Promise<void> {
    await this.post(`/api/work/${workItemId}/complete`, { clientId, sessionRef });
  }

  async fail(workItemId: string, clientId: string, error: string): Promise<void> {
    await this.post(`/api/work/${workItemId}/fail`, { clientId, error });
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`arb server ${res.status} ${path}: ${text}`);
    }

    return res;
  }
}
