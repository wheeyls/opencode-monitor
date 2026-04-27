export interface MonitorEvent {
  source: "github" | "jira";
  type: string;
  key: string;
  repo?: string;
  body: string;
  url: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}
