export interface Config {
  urls: string[];
  intervalMinutes: number;
  timeoutMs: number;
}

export interface ConfigResponse {
  config: Config;
  configPath: string;
}

export interface LogsResponse {
  lines: string[];
  total: number;
  logPath: string;
}

export type RequestOutcome =
  "success" | "http-error" | "timeout" | "network-error";

export interface RequestResult {
  at: string;
  url: string;
  outcome: RequestOutcome;
  detail: string;
}

export interface TriggerResponse {
  lastRequest: RequestResult | null;
}

export interface Status {
  status: "waiting" | "active" | "stopped";
  urlsCount: number;
  startedAt: string;
  updatedAt: string;
  nextRequestAt: string | null;
  lastRequest: RequestResult | null;
  error: string | null;
  uptimeMs: number;
  dataRoot: string;
  configPath: string;
  logPath: string;
  pid: number;
  version: string;
}
