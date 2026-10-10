export interface Config {
  urls: string[];
  url: string | null;
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
  outcome: RequestOutcome;
  detail: string;
}

export interface Status {
  status: "waiting" | "active" | "stopped";
  url: string | null;
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
