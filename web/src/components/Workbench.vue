<script setup lang="ts">
import { NButton, NSpin, NTag, useMessage } from "naive-ui";
import { onMounted, ref } from "vue";
import logoUrl from "../assets/logo.jpg";
import ConfigForm from "./ConfigForm.vue";
import LogConsole from "./LogConsole.vue";
import StatusPanel from "./StatusPanel.vue";
import { useConfigForm } from "../hooks/useConfigForm";
import { useLogs } from "../hooks/useLogs";
import { useStatus } from "../hooks/useStatus";

const REPO_URL = "https://github.com/longshihui/vpn-keepalive";

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
          <img class="brand-logo" :src="logoUrl" alt="vpn-keepalive" />
          <div class="brand-text">
            <h1>vpn-keepalive</h1>
            <p>HTTP 保活 · 本地配置</p>
          </div>
        </div>
        <div class="topbar-actions">
          <n-tag v-if="status.error.value" type="error" size="small" round>
            状态获取失败
          </n-tag>
          <a
            class="git-link"
            :href="REPO_URL"
            target="_blank"
            rel="noreferrer"
            title="GitHub 仓库"
            aria-label="GitHub 仓库"
          >
            <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
              <path
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
              />
            </svg>
          </a>
        </div>
      </div>
    </header>

    <main class="layout">
      <section class="hero">
        <div class="hero-body">
          <h2 class="hero-title">VPN 链路持续保活</h2>
          <p class="hero-desc">
            为保活地址持续注入 HTTP
            心跳：引擎按设定间隔随机选取列表中的地址发起请求，保持 VPN
            链路活跃。
          </p>
          <div class="hero-tags">
            <span class="hero-tag">随机多地址</span>
            <span class="hero-tag">间隔可配</span>
            <span class="hero-tag">本地运行</span>
          </div>
        </div>
        <svg
          class="hero-pulse"
          viewBox="0 0 300 96"
          fill="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="hero-pulse-gradient"
              x1="0"
              y1="0"
              x2="1"
              y2="0"
            >
              <stop offset="0" stop-color="#38bdf8" stop-opacity="0" />
              <stop offset="0.45" stop-color="#38bdf8" />
              <stop offset="1" stop-color="#22d3ee" />
            </linearGradient>
          </defs>
          <path
            class="hero-pulse-line"
            d="M0 48 H56 L64 40 L72 48 H104 L112 52 L124 14 L136 78 L144 48 H188 L196 40 L204 48 H300"
            stroke="url(#hero-pulse-gradient)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="300" cy="48" r="3" fill="#22d3ee" />
        </svg>
      </section>

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
            @triggered="onTriggered"
          />
          <div class="columns">
            <ConfigForm
              :config="form.config.value"
              :new-url="form.newUrl.value"
              :add-error="addError"
              :saving="form.saving.value"
              @add="onAdd"
              @remove="form.removeUrl"
              @update:new-url="form.newUrl.value = $event"
              @save="onSave"
            />
            <LogConsole :logs="logs.logs.value" />
          </div>
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
  max-width: 1080px;
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

.brand-logo {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  object-fit: cover;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
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

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.git-link {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: #94a3b8;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.git-link:hover {
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
}

.git-link svg path {
  fill: currentColor;
}

.layout {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px;
}

.hero {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 28px;
  border-radius: 10px;
  overflow: hidden;
  background:
    linear-gradient(
      120deg,
      rgba(56, 189, 248, 0.14),
      rgba(34, 211, 238, 0.04) 45%,
      transparent 75%
    ),
    linear-gradient(135deg, #0f172a, #1e293b);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.14);
}

.hero::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.07) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.07) 1px, transparent 1px);
  background-size: 28px 28px;
  pointer-events: none;
}

.hero-body {
  position: relative;
  min-width: 0;
}

.hero-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #f1f5f9;
}

.hero-desc {
  margin: 8px 0 0;
  max-width: 560px;
  font-size: 13px;
  line-height: 1.6;
  color: #94a3b8;
}

.hero-tags {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.hero-tag {
  font-size: 12px;
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.12);
  padding: 2px 10px;
  border-radius: 999px;
}

.hero-pulse {
  position: relative;
  flex: none;
  width: 300px;
  height: 96px;
}

.stack {
  display: grid;
  gap: 20px;
  margin-top: 20px;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  gap: 20px;
  align-items: stretch;
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

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }

  .hero-pulse {
    display: none;
  }
}
</style>
