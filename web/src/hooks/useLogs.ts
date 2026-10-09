import { onScopeDispose, ref } from "vue";
import { fetchLogs } from "../api";
import type { LogsResponse } from "../types";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_LINES = 200;

/** 轮询控制台日志（keepalive.log 尾部）。 */
export function useLogs(lines = DEFAULT_LINES) {
  const logs = ref<LogsResponse | null>(null);
  const error = ref<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      logs.value = await fetchLogs(lines);
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  };

  const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
  void refresh();
  onScopeDispose(() => window.clearInterval(timer));

  return { logs, error, refresh };
}
