<script setup lang="ts">
import { computed } from "vue";
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NTag,
  NText,
  useMessage,
} from "naive-ui";
import type { LogsResponse, RequestOutcome, Status } from "../types";
import { useTrigger } from "../hooks/useTrigger";

const props = defineProps<{
  status: Status | null;
  statusText: string;
  uptime: string;
  countdown: string;
  logs: LogsResponse | null;
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

const levelClass = (line: string): string => {
  if (line.includes("[error]")) return "log-error";
  if (line.includes("[warn]")) return "log-warn";
  return "log-info";
};

const onTrigger = async (): Promise<void> => {
  const response = await trigger.trigger();
  if (!response) {
    message.error(trigger.error.value ?? "触发失败");
    return;
  }
  const last = response.lastRequest;
  if (!last) message.info("已触发保活请求");
  else if (last.outcome === "success")
    message.success(`保活请求成功：${last.detail}`);
  else
    message.error(
      `保活请求失败（${outcomeTag[last.outcome].label}）：${last.detail}`,
    );
  emit("triggered");
};
</script>

<template>
  <n-card title="运行状态" size="small">
    <template #header-extra>
      <div class="header-extra">
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
      </div>
    </template>

    <n-descriptions
      v-if="status"
      :column="2"
      label-placement="left"
      size="small"
      bordered
    >
      <n-descriptions-item label="当前地址" :span="2">
        <n-text v-if="status.url" code class="mono">{{ status.url }}</n-text>
        <n-text v-else depth="3">未选择</n-text>
      </n-descriptions-item>
      <n-descriptions-item label="运行时长">{{ uptime }}</n-descriptions-item>
      <n-descriptions-item label="下次请求">
        <template v-if="status.status === 'active'">{{ countdown }}</template>
        <n-text v-else depth="3">—</n-text>
      </n-descriptions-item>
      <n-descriptions-item label="最近请求" :span="2">
        <template v-if="status.lastRequest">
          <n-tag
            size="small"
            :type="outcomeTag[status.lastRequest.outcome].type"
          >
            {{ outcomeTag[status.lastRequest.outcome].label }}
          </n-tag>
          <span class="detail">
            {{ formatTime(status.lastRequest.at) }}
            {{ status.lastRequest.detail }}
          </span>
        </template>
        <n-text v-else depth="3">—</n-text>
      </n-descriptions-item>
    </n-descriptions>
    <p v-else class="empty">状态加载中…</p>

    <div class="console">
      <div class="console-header">
        <span class="console-title">控制台日志</span>
        <span class="console-path mono" :title="logs?.logPath ?? ''">
          {{ logs?.logPath ?? "—" }}
        </span>
        <span v-if="logs" class="console-count"
          >{{ logs.lines.length }} 行</span
        >
      </div>
      <div class="console-body">
        <p
          v-for="(line, index) in logs?.lines ?? []"
          :key="index"
          :class="levelClass(line)"
        >
          {{ line }}
        </p>
        <p v-if="logs && logs.lines.length === 0" class="log-info">暂无日志</p>
      </div>
    </div>

    <template #footer>
      <div class="meta">
        <div>
          数据目录：<n-text code class="mono">{{
            status?.dataRoot ?? "—"
          }}</n-text>
        </div>
        <div>
          配置：<n-text code class="mono">{{
            status?.configPath ?? "—"
          }}</n-text>
        </div>
        <div>PID {{ status?.pid ?? "—" }} · v{{ status?.version ?? "—" }}</div>
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
  word-break: break-all;
}

.detail {
  font-size: 12px;
  color: #71717a;
  margin-left: 8px;
}

.empty {
  margin: 0;
  color: #71717a;
  font-size: 13px;
}

.meta {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: #71717a;
}

.console {
  margin-top: 16px;
  border-radius: 6px;
  overflow: hidden;
  background: #0f172a;
  box-shadow: inset 0 0 0 1px #1e293b;
}

.console-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: #1e293b;
  font-size: 12px;
  color: #94a3b8;
}

.console-title {
  flex: none;
  color: #e2e8f0;
  font-weight: 500;
}

.console-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}

.console-count {
  flex: none;
}

.console-body {
  height: 280px;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
}

.console-body p {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.log-info {
  color: #94a3b8;
}

.log-warn {
  color: #fbbf24;
}

.log-error {
  color: #f87171;
}
</style>
