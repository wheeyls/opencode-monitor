import { ServerClient, type ClaimResult } from "./server-client.js";
import { Dispatcher } from "./dispatcher.js";
import type { MonitorEvent } from "./events.js";

interface WorkerConfig {
  serverUrl: string;
  serverToken: string;
  clientName: string;
  opencodeUrl?: string;
  owner?: string;
  promptDir?: string;
  directoryResolver: (event: MonitorEvent) => string | undefined;
  pollIntervalMs?: number;
}

export class Worker {
  private server: ServerClient;
  private dispatcher: Dispatcher;
  private clientId: string | null = null;
  private running = false;
  private pollIntervalMs: number;
  private clientName: string;
  private abortController: AbortController | null = null;

  constructor(private config: WorkerConfig) {
    this.server = new ServerClient({
      serverUrl: config.serverUrl,
      token: config.serverToken,
    });
    this.dispatcher = new Dispatcher({
      serverUrl: config.opencodeUrl,
      owner: config.owner,
      promptDir: config.promptDir,
      directoryResolver: config.directoryResolver,
    });
    this.pollIntervalMs = config.pollIntervalMs ?? 5_000;
    this.clientName = config.clientName;
  }

  async start(): Promise<void> {
    this.clientId = await this.server.register(this.clientName);
    console.log(`[worker] Registered as ${this.clientId} (${this.clientName})`);
    this.running = true;

    while (this.running) {
      try {
        await this.poll();
      } catch (err) {
        console.error(`[worker] Poll error:`, (err as Error).message);
      }

      if (this.running) {
        this.abortController = new AbortController();
        await sleep(this.pollIntervalMs, this.abortController.signal);
        this.abortController = null;
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
    console.log("[worker] Stopped.");
  }

  private async poll(): Promise<void> {
    if (!this.clientId) return;

    const result = await this.server.claim(this.clientId);
    if (result.kind === "none") return;

    const { workItem, sessionRef } = result;
    console.log(`[worker] Claimed ${workItem.id} (thread=${workItem.threadId}, seq=${workItem.sequence})`);

    await this.server.start(workItem.id, this.clientId);
    console.log(`[worker] Started ${workItem.id}`);

    const heartbeatInterval = setInterval(async () => {
      try {
        await this.server.heartbeat(workItem.id, this.clientId!);
      } catch (err) {
        console.error(`[worker] Heartbeat failed:`, (err as Error).message);
      }
    }, 20_000);

    try {
      const event = this.payloadToEvent(workItem.payload);
      await this.dispatcher.dispatch(event);

      clearInterval(heartbeatInterval);
      await this.server.complete(workItem.id, this.clientId, sessionRef ?? undefined);
      console.log(`[worker] Completed ${workItem.id}`);
    } catch (err) {
      clearInterval(heartbeatInterval);
      const errorMsg = (err as Error).message;
      console.error(`[worker] Failed ${workItem.id}:`, errorMsg);

      try {
        await this.server.fail(workItem.id, this.clientId, errorMsg);
      } catch (failErr) {
        console.error(`[worker] Could not report failure:`, (failErr as Error).message);
      }
    }
  }

  private payloadToEvent(payload: Record<string, unknown>): MonitorEvent {
    return {
      source: (payload.source as "github" | "jira") ?? "github",
      type: (payload.type as string) ?? "unknown",
      key: (payload.key as string) ?? "unknown",
      repo: payload.repo as string | undefined,
      body: (payload.body as string) ?? "",
      url: (payload.url as string) ?? "",
      createdAt: (payload.createdAt as string) ?? new Date().toISOString(),
      meta: payload.meta as Record<string, unknown> | undefined,
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
