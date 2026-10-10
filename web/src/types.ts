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

export interface Settings {
  configDir: string | null;
  logDir: string | null;
}

export interface ResolvedDirs {
  configDir: string;
  logDir: string;
}

export interface SettingsResponse {
  settings: Settings;
  resolved: ResolvedDirs;
  settingsPath: string;
}

export interface DirEntry {
  name: string;
  path: string;
}

export interface DirsResponse {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
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
  configPath: string;
  logPath: string;
  pid: number;
  version: string;
}
