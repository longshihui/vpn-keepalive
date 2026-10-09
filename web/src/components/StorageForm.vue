<script setup lang="ts">
import { NAlert, NButton, NCard, NForm, NFormItem, NInput } from "naive-ui";
import type { SettingsFormState } from "../hooks/useSettings";
import type { ResolvedDirs } from "../types";

defineProps<{
  form: SettingsFormState;
  resolved: ResolvedDirs | null;
  settingsPath: string;
  loadError: string | null;
  saving: boolean;
}>();

const emit = defineEmits<{ save: [] }>();
</script>

<template>
  <n-card title="存储位置" size="small">
    <n-alert v-if="loadError" type="error" :bordered="false">
      设置加载失败：{{ loadError }}
    </n-alert>
    <n-form
      v-else
      label-placement="top"
      size="small"
      :show-feedback="false"
      class="storage-form"
    >
      <div class="field-row">
        <n-form-item label="配置文件目录">
          <n-input
            v-if="resolved"
            :value="form.configDir"
            :placeholder="resolved.configDir"
            clearable
            @update:value="form.configDir = $event"
          />
          <n-input v-else :value="form.configDir" clearable />
        </n-form-item>
        <n-form-item label="日志目录">
          <n-input
            v-if="resolved"
            :value="form.logDir"
            :placeholder="resolved.logDir"
            clearable
            @update:value="form.logDir = $event"
          />
          <n-input v-else :value="form.logDir" clearable />
        </n-form-item>
      </div>
      <p class="hint">
        留空使用默认目录；支持以 ~
        开头的路径（展开为用户主目录），其余须为绝对路径（macOS / Windows /
        Linux 均可）。保存后现有配置与日志将复制到新目录，原文件保留。
      </p>
    </n-form>

    <template #footer>
      <div class="form-footer">
        <span class="settings-path mono" :title="settingsPath">
          设置文件：{{ settingsPath || "—" }}
        </span>
        <n-button type="primary" :loading="saving" @click="emit('save')">
          保存目录设置
        </n-button>
      </div>
    </template>
  </n-card>
</template>

<style scoped>
.storage-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 720px) {
  .field-row {
    grid-template-columns: 1fr;
  }
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #71717a;
  line-height: 1.6;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-path {
  font-size: 12px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
