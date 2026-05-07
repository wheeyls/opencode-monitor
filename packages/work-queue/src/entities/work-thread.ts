import type { Clock } from "../clock.js";

export interface WorkThreadProps {
  id: string;
  userId: string;
  affinityKey: string;
}

export class WorkThread {
  readonly id: string;
  readonly userId: string;
  readonly affinityKey: string;

  private _preferredClientId: string | null = null;
  private _preferredClientExpiresAt: Date | null = null;
  private _lastSessionRef: string | null = null;
  private _nextSequence: number = 1;

  constructor(props: WorkThreadProps) {
    this.id = props.id;
    this.userId = props.userId;
    this.affinityKey = props.affinityKey;
  }

  static fromSnapshot(snapshot: {
    id: string;
    userId: string;
    affinityKey: string;
    preferredClientId: string | null;
    preferredClientExpiresAt: Date | null;
    lastSessionRef: string | null;
    nextSequence: number;
  }): WorkThread {
    const thread = new WorkThread({
      id: snapshot.id,
      userId: snapshot.userId,
      affinityKey: snapshot.affinityKey,
    });
    thread._preferredClientId = snapshot.preferredClientId;
    thread._preferredClientExpiresAt = snapshot.preferredClientExpiresAt;
    thread._lastSessionRef = snapshot.lastSessionRef;
    thread._nextSequence = snapshot.nextSequence;
    return thread;
  }

  get preferredClientId(): string | null {
    return this._preferredClientId;
  }
  get preferredClientExpiresAt(): Date | null {
    return this._preferredClientExpiresAt;
  }
  get lastSessionRef(): string | null {
    return this._lastSessionRef;
  }
  get nextSequence(): number {
    return this._nextSequence;
  }

  /** Allocate the next sequence number for a new work item. */
  allocateSequence(): number {
    return this._nextSequence++;
  }

  /** Set client preference after successful completion. */
  setPreference(clientId: string, sessionRef: string | null, ttlMs: number, clock: Clock): void {
    this._preferredClientId = clientId;
    this._preferredClientExpiresAt = new Date(clock.now().getTime() + ttlMs);
    this._lastSessionRef = sessionRef;
  }

  /** Clear preference explicitly. */
  clearPreference(): void {
    this._preferredClientId = null;
    this._preferredClientExpiresAt = null;
  }

  /** Check if the given client is the preferred client (and preference hasn't expired). */
  prefersClient(clientId: string, clock: Clock): boolean {
    if (this._preferredClientId !== clientId) return false;
    if (this._preferredClientExpiresAt === null) return false;
    return clock.now().getTime() < this._preferredClientExpiresAt.getTime();
  }

  /** Check if the preference has expired. */
  isPreferenceExpired(clock: Clock): boolean {
    if (this._preferredClientExpiresAt === null) return true;
    return clock.now().getTime() >= this._preferredClientExpiresAt.getTime();
  }
}
