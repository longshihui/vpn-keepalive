<script setup lang="ts">
import { computed } from "vue";
import { NButton, NCard, NTag, NText, useMessage } from "naive-ui";
import type { RequestOutcome, Status } from "../types";
import { useTrigger } from "../hooks/useTrigger";

const props = defineProps<{
  status: Status | null;
  statusText: string;
  uptime: string;
  countdown: string;
}>();

const emit = defineEmits<{ triggered: [] }>();

const message = useMessage();
const trigger = useTrigger();

const statusTag = computed(() => {
  switch (props.status?.status) {
    case "active":
      return { type: "success" as const, dot: "#18a058" };
    case "waiting":
      return { type: "warning" as const, dot: "#f0a020" };
    default:
      return { type: "default" as const, dot: "#d0d0d0" };
  }
});

const outcomeTag: Record<
  RequestOutcome,
  { label: string; type: "success" | "warning" | "error" }
> = {
  success: { label: "成功", type: "success" },
  "http-error": { label: "HTTP 错误", type: "error" },
  timeout: { label: "超时", type: "warning" },
  "network-error": { label: "网络错误", type: "error" },
};

const formatTime = (iso: string): string => new Date(iso).toLocaleTimeString();

const onTrigger = async (): Promise<void> => {
  const response = await trigger.trigger();
  if (!response) {
    message.error(trigger.error.value ?? "触发失败");
    return;
  }
  const last = response.lastRequest;
  if (!last) message.info("已触发保活请求");
  else if (last.outcome === "success")
    message.success(`保活请求成功（${last.detail}）：${last.url}`);
  else
    message.error(
      `保活请求失败（${outcomeTag[last.outcome].label}）：${last.url}`,
    );
  emit("triggered");
};
</script>

<template>
  <n-card title="运行状态" size="small">
    <template #header-extra>
      <div class="header-extra">
        <n-tag :type="statusTag.type" size="small" round>
          <template #icon>
            <span
              class="dot"
              :style="{ background: statusTag.dot }"
              aria-hidden="true"
            ></span>
          </template>
          {{ statusText }}
        </n-tag>
        <n-button
          size="small"
          type="primary"
          secondary
          :loading="trigger.triggering.value"
          :disabled="status?.status !== 'active'"
          @click="onTrigger"
        >
          立即保活
        </n-button>
      </div>
    </template>

    <template v-if="status">
      <div class="url-row">
        <span class="stat-label">保活地址</span>
        <span v-if="status.urlsCount > 0" class="stat-value">
          {{ status.urlsCount }} 个
          <span class="stat-sub">· 每次随机选取</span>
        </span>
        <span v-else class="stat-empty">未配置</span>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat-label">运行时长</span>
          <span class="stat-value mono">{{ uptime }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">下次请求</span>
          <span v-if="status.status === 'active'" class="stat-value mono">
            {{ countdown }}
          </span>
          <span v-else class="stat-empty">—</span>
        </div>
        <div class="stat">
          <span class="stat-label">最近请求</span>
          <div v-if="status.lastRequest" class="last-request">
            <div class="last-request-main">
              <n-tag
                size="small"
                :type="outcomeTag[status.lastRequest.outcome].type"
              >
                {{ outcomeTag[status.lastRequest.outcome].label }}
              </n-tag>
              <span class="detail mono">
                {{ formatTime(status.lastRequest.at) }}
              </span>
            </div>
            <n-text
              class="last-request-url mono"
              :title="status.lastRequest.url"
            >
              {{ status.lastRequest.url }}
            </n-text>
          </div>
          <span v-else class="stat-empty">—</span>
        </div>
      </div>
    </template>
    <p v-else class="empty">状态加载中…</p>

    <template #footer>
      <div class="meta">
        <span class="meta-item">PID {{ status?.pid ?? "—" }}</span>
        <span class="meta-item">v{{ status?.version ?? "—" }}</span>
        <span class="meta-item mono" :title="status?.dataRoot ?? ''">
          {{ status?.dataRoot ?? "—" }}
        </span>
        <span class="meta-item mono" :title="status?.configPath ?? ''">
          {{ status?.configPath ?? "—" }}
        </span>
      </div>
    </template>
  </n-card>
</template>

<style scoped>
.header-extra {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.url-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.stat-sub {
  font-size: 12px;
  color: #71717a;
  font-weight: 400;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e4e4e7;
}

.stat {
  display: grid;
  gap: 4px;
  padding: 0 16px;
  min-width: 0;
}

.stat:first-child {
  padding-left: 0;
}

.stat + .stat {
  border-left: 1px solid #e4e4e7;
}

.stat-label {
  font-size: 12px;
  color: #71717a;
}

.stat-value {
  font-size: 14px;
  font-weight: 500;
  color: #18181b;
}

.stat-empty {
  font-size: 14px;
  color: #a1a1aa;
}

.last-request {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.last-request-main {
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail {
  font-size: 12px;
  color: #71717a;
}

.last-request-url {
  font-size: 11px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  margin: 0;
  color: #71717a;
  font-size: 13px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: #71717a;
  overflow: hidden;
}

.meta-item {
  white-space: nowrap;
}

.meta-item.mono {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 720px) {
  .stats {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .stat {
    padding: 0;
  }

  .stat + .stat {
    border-left: none;
  }

  .meta {
    flex-wrap: wrap;
  }
}
</style>
