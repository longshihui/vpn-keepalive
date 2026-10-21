<script setup lang="ts">
import { NCard } from "naive-ui";
import type { LogsResponse } from "../types";

defineProps<{
  logs: LogsResponse | null;
}>();

const levelClass = (line: string): string => {
  if (line.includes("[error]")) return "log-error";
  if (line.includes("[warn]")) return "log-warn";
  if (line.includes("[success]")) return "log-success";
  return "log-info";
};
</script>

<template>
  <n-card title="运行日志" size="small" class="console-card">
    <template #header-extra>
      <span class="console-count">{{ logs?.lines.length ?? 0 }} 行</span>
    </template>

    <div class="console-body">
      <p
        v-for="(line, index) in logs?.lines ?? []"
        :key="index"
        :class="levelClass(line)"
      >
        {{ line }}
      </p>
      <p v-if="logs && logs.lines.length === 0" class="log-info">暂无日志</p>
      <p v-if="!logs" class="log-info">日志加载中…</p>
    </div>

    <template #footer>
      <span class="console-path mono" :title="logs?.logPath ?? ''">
        {{ logs?.logPath ?? "—" }}
      </span>
    </template>
  </n-card>
</template>

<style scoped>
.console-card {
  height: 100%;
}

.console-card :deep(.n-card-content) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.console-count {
  font-size: 12px;
  color: #71717a;
}

.console-body {
  flex: 1;
  min-height: 200px;
  overflow-y: auto;
  border-radius: 6px;
  padding: 10px 12px;
  background: #0f172a;
  box-shadow: inset 0 0 0 1px #1e293b;
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

.log-success {
  color: #4ade80;
}

.log-warn {
  color: #fbbf24;
}

.log-error {
  color: #f87171;
}

.console-path {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #a1a1aa;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
