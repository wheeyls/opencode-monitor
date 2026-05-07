import type { Clock } from "../clock.js";

export type ClientStatus = "active" | "stale" | "offline";

export interface ClientProps {
  id: string;
  userId: string;
  name: string;
  capabilities?: Record<string, unknown>;
  registeredAt: Date;
}

/**
 * Thresholds for client liveness.
 * A client is stale after staleness threshold, offline after offline threshold.
 */
export interface LivenessConfig {
  staleAfterMs: number;
  offlineAfterMs: number;
}

const DEFAULT_LIVENESS: LivenessConfig = {
  staleAfterMs: 60_000,      // 1 minute without heartbeat → stale
  offlineAfterMs: 300_000,   // 5 minutes → offline
};

export class Client {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly capabilities: Record<string, unknown>;
  readonly registeredAt: Date;
  private _lastSeenAt: Date;
  private _livenessConfig: LivenessConfig;

  constructor(props: ClientProps, livenessConfig?: LivenessConfig) {
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name;
    this.capabilities = props.capabilities ?? {};
    this.registeredAt = props.registeredAt;
    this._lastSeenAt = props.registeredAt;
    this._livenessConfig = livenessConfig ?? DEFAULT_LIVENESS;
  }

  static fromSnapshot(snapshot: {
    id: string;
    userId: string;
    name: string;
    capabilities: Record<string, unknown>;
    registeredAt: Date;
    lastSeenAt: Date;
  }, livenessConfig?: LivenessConfig): Client {
    const client = new Client({
      id: snapshot.id,
      userId: snapshot.userId,
      name: snapshot.name,
      capabilities: snapshot.capabilities,
      registeredAt: snapshot.registeredAt,
    }, livenessConfig);
    client._lastSeenAt = snapshot.lastSeenAt;
    return client;
  }

  get lastSeenAt(): Date {
    return this._lastSeenAt;
  }

  /** Record that this client was seen (heartbeat, claim, any activity). */
  touch(clock: Clock): void {
    this._lastSeenAt = clock.now();
  }

  /** Compute current liveness status based on elapsed time. */
  status(clock: Clock): ClientStatus {
    const elapsed = clock.now().getTime() - this._lastSeenAt.getTime();
    if (elapsed >= this._livenessConfig.offlineAfterMs) return "offline";
    if (elapsed >= this._livenessConfig.staleAfterMs) return "stale";
    return "active";
  }

  /** Check if this client is available to receive work. */
  isAvailable(clock: Clock): boolean {
    return this.status(clock) === "active";
  }
}
