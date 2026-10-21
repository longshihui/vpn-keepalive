import type {
  Config,
  ConfigResponse,
  LogsResponse,
  Status,
  TriggerResponse,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }
  return body as T;
}

export function fetchConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>("/api/config");
}

export function updateConfig(config: Config): Promise<ConfigResponse> {
  return request<ConfigResponse>("/api/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });
}

export function fetchStatus(): Promise<Status> {
  return request<Status>("/api/status");
}

export function fetchLogs(lines = 200): Promise<LogsResponse> {
  return request<LogsResponse>(`/api/logs?lines=${lines}`);
}

export function triggerKeepalive(): Promise<TriggerResponse> {
  return request<TriggerResponse>("/api/trigger", { method: "POST" });
}
