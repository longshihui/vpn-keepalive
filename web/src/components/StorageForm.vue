<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NInputGroup,
} from "naive-ui";
import { ref } from "vue";
import DirPicker from "./DirPicker.vue";
import { useDirPicker } from "../hooks/useDirPicker";
import type { SettingsFormState } from "../hooks/useSettings";
import type { ResolvedDirs } from "../types";

type DirField = "configDir" | "logDir";

const props = defineProps<{
  form: SettingsFormState;
  resolved: ResolvedDirs | null;
  settingsPath: string;
  loadError: string | null;
  saving: boolean;
}>();

const emit = defineEmits<{ save: [] }>();

const picker = useDirPicker();
const pickingField = ref<DirField | null>(null);

const openPicker = (field: DirField): void => {
  pickingField.value = field;
  const fallback = props.resolved ? props.resolved[field] : "~";
  picker.open(props.form[field].trim() || fallback);
};

const onPickConfirm = (): void => {
  if (pickingField.value && picker.current.value)
    props.form[pickingField.value] = picker.current.value;
  picker.close();
};
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
          <n-input-group>
            <n-input
              :value="form.configDir"
              :placeholder="resolved?.configDir ?? ''"
              clearable
              @update:value="form.configDir = $event"
            />
            <n-button @click="openPicker('configDir')">选择</n-button>
          </n-input-group>
        </n-form-item>
        <n-form-item label="日志目录">
          <n-input-group>
            <n-input
              :value="form.logDir"
              :placeholder="resolved?.logDir ?? ''"
              clearable
              @update:value="form.logDir = $event"
            />
            <n-button @click="openPicker('logDir')">选择</n-button>
          </n-input-group>
        </n-form-item>
      </div>
      <p class="hint">
        留空使用默认目录；可点击“选择”浏览目录，或直接输入以 ~
        开头的路径（展开为用户主目录）、绝对路径（macOS / Windows / Linux
        均可）。保存后现有配置与日志将复制到新目录，原文件保留。
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

  <DirPicker
    :show="picker.show.value"
    :loading="picker.loading.value"
    :error="picker.error.value"
    :current="picker.current.value"
    :parent="picker.parent.value"
    :dirs="picker.dirs.value"
    @navigate="picker.load"
    @confirm="onPickConfirm"
    @close="picker.close"
  />
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
