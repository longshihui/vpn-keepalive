<script setup lang="ts">
import { NButton, NSpin, NTag, useMessage } from "naive-ui";
import { onMounted, ref } from "vue";
import ConfigForm from "./ConfigForm.vue";
import StatusPanel from "./StatusPanel.vue";
import { useConfigForm } from "../hooks/useConfigForm";
import { useLogs } from "../hooks/useLogs";
import { useStatus } from "../hooks/useStatus";

const form = useConfigForm();
const status = useStatus();
const logs = useLogs();
const message = useMessage();
const addError = ref<string | null>(null);

onMounted(() => {
  void form.load();
});

const onAdd = (): void => {
  addError.value = form.addUrl();
};

const onSave = async (): Promise<void> => {
  const ok = await form.save();
  if (ok) {
    message.success("配置已保存并生效");
    void status.refresh();
  } else {
    message.error(form.saveError.value ?? "保存失败");
  }
};

/** 手动保活完成后立即刷新状态与日志，不等轮询。 */
const onTriggered = (): void => {
  void status.refresh();
  void logs.refresh();
};
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <span class="brand-mark">VK</span>
          <div class="brand-text">
            <h1>vpn-keepalive</h1>
            <p>HTTP 保活 · 本地配置</p>
          </div>
        </div>
        <n-tag v-if="status.error.value" type="error" size="small" round>
          状态获取失败
        </n-tag>
      </div>
    </header>

    <main class="layout">
      <n-spin :show="form.loading.value">
        <div v-if="form.loadError.value" class="panel-error">
          <p>配置加载失败：{{ form.loadError.value }}</p>
          <n-button @click="form.load()">重试</n-button>
        </div>
        <div v-else-if="form.config.value" class="stack">
          <StatusPanel
            :status="status.status.value"
            :status-text="status.statusText.value"
            :uptime="status.uptime.value"
            :countdown="status.countdown.value"
            :logs="logs.logs.value"
            @triggered="onTriggered"
          />
          <ConfigForm
            :config="form.config.value"
            :new-url="form.newUrl.value"
            :add-error="addError"
            :saving="form.saving.value"
            @add="onAdd"
            @remove="form.removeUrl"
            @select="form.selectUrl"
            @update:new-url="form.newUrl.value = $event"
            @save="onSave"
          />
        </div>
      </n-spin>
    </main>
  </div>
</template>

<style scoped>
.topbar {
  background: #1e293b;
  box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.08);
}

.topbar-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: #0f172a;
  color: #60a5fa;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  box-shadow: inset 0 0 0 1px #334155;
}

.brand-text h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f1f5f9;
}

.brand-text p {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
}

.layout {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
}

.stack {
  display: grid;
  gap: 20px;
}

.panel-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 48px 0;
  color: #b91c1c;
}

.panel-error p {
  margin: 0;
}
</style>
