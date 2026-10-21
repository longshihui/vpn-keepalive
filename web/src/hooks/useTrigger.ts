import { ref } from "vue";
import { triggerKeepalive } from "../api";
import type { TriggerResponse } from "../types";

/** 手动触发一次保活请求，等待请求完成并返回其结果。 */
export function useTrigger() {
  const triggering = ref(false);
  const error = ref<string | null>(null);

  const trigger = async (): Promise<TriggerResponse | null> => {
    if (triggering.value) return null;
    triggering.value = true;
    error.value = null;
    try {
      return await triggerKeepalive();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return null;
    } finally {
      triggering.value = false;
    }
  };

  return { triggering, error, trigger };
}
