import { computed, onScopeDispose, ref } from "vue";
import { fetchStatus } from "../api";
import type { Status } from "../types";

const POLL_INTERVAL_MS = 2000;

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return days > 0
    ? `${days}天 ${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/** 轮询运行状态并派生展示用的格式化字段。 */
export function useStatus() {
  const status = ref<Status | null>(null);
  const error = ref<string | null>(null);
  const now = ref(Date.now());

  const refresh = async (): Promise<void> => {
    try {
      status.value = await fetchStatus();
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  };

  const timer = window.setInterval(() => {
    now.value = Date.now();
    void refresh();
  }, POLL_INTERVAL_MS);
  void refresh();
  onScopeDispose(() => window.clearInterval(timer));

  const uptime = computed(() => {
    const value = status.value;
    if (!value) return "—";
    return formatDuration(now.value - Date.parse(value.startedAt));
  });

  const countdown = computed(() => {
    const value = status.value;
    if (!value || !value.nextRequestAt || value.status !== "active") return "—";
    return formatDuration(Date.parse(value.nextRequestAt) - now.value);
  });

  const statusText = computed(() => {
    switch (status.value?.status) {
      case "active":
        return "保活中";
      case "waiting":
        return "待机（未配置地址）";
      case "stopped":
        return "已停止";
      default:
        return "—";
    }
  });

  return { status, error, uptime, countdown, statusText, refresh };
}
