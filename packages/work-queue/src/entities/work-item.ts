import type { Clock } from "../clock.js";

export type WorkItemStatus =
  | "pending"
  | "claimed"
  | "in_progress"
  | "completed"
  | "failed"
  | "dead";

export type WorkItemKind = "event" | "manual_kick";

export interface WorkItemProps {
  id: string;
  userId: string;
  threadId: string;
  kind: WorkItemKind;
  sequence: number;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  createdAt: Date;
  availableAt: Date;
}

const VALID_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  pending: ["claimed", "dead"],
  claimed: ["in_progress", "pending", "failed"],
  in_progress: ["completed", "failed"],
  failed: ["pending", "dead"],
  completed: [],
  dead: [],
};

export class WorkItem {
  readonly id: string;
  readonly userId: string;
  readonly threadId: string;
  readonly kind: WorkItemKind;
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
  readonly maxAttempts: number;
  readonly createdAt: Date;

  private _status: WorkItemStatus = "pending";
  private _availableAt: Date;
  private _attemptCount: number = 0;
  private _claimedByClientId: string | null = null;
  private _leaseExpiresAt: Date | null = null;
  private _lastHeartbeatAt: Date | null = null;
  private _lastError: string | null = null;
  private _completedAt: Date | null = null;
  private _failedAt: Date | null = null;

  constructor(props: WorkItemProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.threadId = props.threadId;
    this.kind = props.kind;
    this.sequence = props.sequence;
    this.payload = props.payload;
    this.maxAttempts = props.maxAttempts ?? 3;
    this.createdAt = props.createdAt;
    this._availableAt = props.availableAt;
  }

  static fromSnapshot(snapshot: {
    id: string;
    userId: string;
    threadId: string;
    kind: WorkItemKind;
    sequence: number;
    payload: Record<string, unknown>;
    maxAttempts: number;
    createdAt: Date;
    availableAt: Date;
    status: WorkItemStatus;
    attemptCount: number;
    claimedByClientId: string | null;
    leaseExpiresAt: Date | null;
    lastHeartbeatAt: Date | null;
    lastError: string | null;
    completedAt: Date | null;
    failedAt: Date | null;
  }): WorkItem {
    const item = new WorkItem({
      id: snapshot.id,
      userId: snapshot.userId,
      threadId: snapshot.threadId,
      kind: snapshot.kind,
      sequence: snapshot.sequence,
      payload: snapshot.payload,
      maxAttempts: snapshot.maxAttempts,
      createdAt: snapshot.createdAt,
      availableAt: snapshot.availableAt,
    });
    item._status = snapshot.status;
    item._attemptCount = snapshot.attemptCount;
    item._claimedByClientId = snapshot.claimedByClientId;
    item._leaseExpiresAt = snapshot.leaseExpiresAt;
    item._lastHeartbeatAt = snapshot.lastHeartbeatAt;
    item._lastError = snapshot.lastError;
    item._completedAt = snapshot.completedAt;
    item._failedAt = snapshot.failedAt;
    return item;
  }

  get status(): WorkItemStatus {
    return this._status;
  }
  get availableAt(): Date {
    return this._availableAt;
  }
  get attemptCount(): number {
    return this._attemptCount;
  }
  get claimedByClientId(): string | null {
    return this._claimedByClientId;
  }
  get leaseExpiresAt(): Date | null {
    return this._leaseExpiresAt;
  }
  get lastHeartbeatAt(): Date | null {
    return this._lastHeartbeatAt;
  }
  get lastError(): string | null {
    return this._lastError;
  }
  get completedAt(): Date | null {
    return this._completedAt;
  }
  get failedAt(): Date | null {
    return this._failedAt;
  }

  get isTerminal(): boolean {
    return this._status === "completed" || this._status === "dead";
  }

  get isRetryable(): boolean {
    return this._status === "failed" && this._attemptCount < this.maxAttempts;
  }

  /**
   * Coalesce a new event into this pending work item.
   * Appends to a coalescedEvents array in the payload so the
   * consumer sees all accumulated events in one dispatch.
   */
  coalesce(newPayload: Record<string, unknown>): void {
    if (this._status !== "pending") {
      throw new Error(
        `Cannot coalesce into work item in status "${this._status}"`,
      );
    }
    const existing = (this.payload.coalescedEvents as Record<string, unknown>[]) ?? [];
    existing.push(newPayload);
    (this.payload as Record<string, unknown>).coalescedEvents = existing;
  }

  /** Client claims this work item. Sets lease expiry. */
  claim(clientId: string, leaseMs: number, clock: Clock): void {
    this.transition("claimed");
    this._claimedByClientId = clientId;
    this._leaseExpiresAt = new Date(clock.now().getTime() + leaseMs);
    this._attemptCount++;
  }

  /** Client confirms work has started. */
  start(clock: Clock): void {
    this.transition("in_progress");
    this._lastHeartbeatAt = clock.now();
  }

  /** Extend the lease via heartbeat. */
  heartbeat(leaseMs: number, clock: Clock): void {
    if (this._status !== "in_progress") {
      throw new Error(
        `Cannot heartbeat work item in status "${this._status}"`,
      );
    }
    this._lastHeartbeatAt = clock.now();
    this._leaseExpiresAt = new Date(clock.now().getTime() + leaseMs);
  }

  /** Client reports successful completion. */
  complete(clock: Clock): void {
    this.transition("completed");
    this._completedAt = clock.now();
    this._leaseExpiresAt = null;
  }

  /** Client reports failure or lease timeout. */
  fail(error: string, clock: Clock): void {
    this.transition("failed");
    this._lastError = error;
    this._failedAt = clock.now();
    this._leaseExpiresAt = null;
    this._claimedByClientId = null;
  }

  /** Schedule retry with new availableAt, or transition to dead. */
  scheduleRetry(availableAt: Date): void {
    if (this._status !== "failed") {
      throw new Error(
        `Cannot schedule retry for work item in status "${this._status}"`,
      );
    }
    if (!this.isRetryable) {
      throw new Error(
        `Work item has exhausted retries (${this._attemptCount}/${this.maxAttempts})`,
      );
    }
    this.transition("pending");
    this._availableAt = availableAt;
  }

  /** Mark as permanently dead. */
  kill(): void {
    if (this._status === "failed") {
      this.transition("dead");
    } else if (this._status === "pending") {
      this.transition("dead");
    } else {
      throw new Error(
        `Cannot kill work item in status "${this._status}"`,
      );
    }
  }

  /** Lease expired — return to pending for re-claim. */
  expireLease(): void {
    if (this._status === "claimed") {
      this.transition("pending");
      this._leaseExpiresAt = null;
      this._claimedByClientId = null;
    } else if (this._status === "in_progress") {
      this.fail("Lease expired", { now: () => this._leaseExpiresAt! } as Clock);
    } else {
      throw new Error(
        `Cannot expire lease for work item in status "${this._status}"`,
      );
    }
  }

  /** Check if lease has expired at the given time. */
  isLeaseExpired(clock: Clock): boolean {
    if (this._leaseExpiresAt === null) return false;
    return clock.now().getTime() >= this._leaseExpiresAt.getTime();
  }

  private transition(to: WorkItemStatus): void {
    const allowed = VALID_TRANSITIONS[this._status];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid transition: "${this._status}" → "${to}"`,
      );
    }
    this._status = to;
  }
}
