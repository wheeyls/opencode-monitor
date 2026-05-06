import type { MonitorEvent } from "./events.js";

export interface SessionStatus {
  key: string;
  sessionId: string;
  source: string;
  status: string;
  detail?: string;
}

export interface DispatcherPort {
  dispatch(event: MonitorEvent): Promise<void>;
  getStatus(): Promise<SessionStatus[]>;
  stop(): Promise<void>;
  readonly trackedSessionCount: number;
}
