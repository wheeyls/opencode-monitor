import type { MonitorEvent } from "./events.js";
import type { DispatcherPort, SessionStatus } from "./dispatcher-port.js";
import { EventFormatter } from "./event-formatter.js";

export interface ServerDispatcherConfig {
  arbServerUrl: string;
  arbServerToken: string;
  promptDir?: string;
  owner?: string;
}

/**
 * Dispatches events to the arb server queue instead of directly to OpenCode.
 * The server queues work items for consumption by arb clients.
 */
export class ServerQueueDispatcher implements DispatcherPort {
  private serverUrl: string;
  private token: string;
  private formatter: EventFormatter;

  constructor(config: ServerDispatcherConfig) {
    this.serverUrl = config.arbServerUrl.replace(/\/$/, "");
    this.token = config.arbServerToken;
    this.formatter = new EventFormatter({
      promptDir: config.promptDir ?? "prompts",
      owner: config.owner ?? "the user",
    });

    console.log(`[dispatcher] Connecting to arb server at ${this.serverUrl}`);
  }

  async dispatch(event: MonitorEvent): Promise<void> {
    const prompt = this.formatter.formatEvent(event);

    const res = await fetch(`${this.serverUrl}/api/work/enqueue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        source: event.source,
        type: event.type,
        key: event.key,
        repo: event.repo,
        body: prompt,
        url: event.url,
        meta: event.meta,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`arb server ${res.status}: ${text}`);
    }

    console.log(`[dispatcher] Enqueued ${event.key} to arb server`);
  }

  async getStatus(): Promise<SessionStatus[]> {
    try {
      const res = await fetch(`${this.serverUrl}/api/queue/summary`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (!res.ok) return [];
      return await res.json() as SessionStatus[];
    } catch {
      return [];
    }
  }

  async stop(): Promise<void> {}

  get trackedSessionCount(): number {
    return 0; // Server tracks this, not the client
  }
}
