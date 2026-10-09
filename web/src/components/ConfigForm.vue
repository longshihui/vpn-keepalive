<script setup lang="ts">
import { ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInputNumber,
} from "naive-ui";
import type { Config } from "../types";
import UrlListEditor from "./UrlListEditor.vue";

const props = defineProps<{
  config: Config;
  newUrl: string;
  addError: string | null;
  saving: boolean;
}>();

const emit = defineEmits<{
  add: [];
  remove: [url: string];
  select: [url: string];
  "update:newUrl": [value: string];
  save: [];
}>();

const onInterval = (value: number | null): void => {
  if (value !== null && Number.isInteger(value) && value >= 1)
    props.config.intervalMinutes = value;
};

const onTimeout = (value: number | null): void => {
  if (value !== null && Number.isFinite(value) && value >= 1)
    props.config.timeoutMs = Math.floor(value);
};

// 非法输入（如 0.5）被拒绝后，输入框可能保留中间态；失焦时重建以回显实际生效值。
const intervalKey = ref(0);
const onIntervalBlur = (): void => {
  intervalKey.value++;
};
</script>

<template>
  <n-card title="保活配置" size="small">
    <n-form label-placement="top" size="small" :show-feedback="false">
      <n-form-item label="保活地址列表">
        <UrlListEditor
          :urls="config.urls"
          :active-url="config.url"
          :new-url="newUrl"
          @add="emit('add')"
          @remove="emit('remove', $event)"
          @select="emit('select', $event)"
          @update:newUrl="emit('update:newUrl', $event)"
        />
      </n-form-item>
      <n-alert v-if="addError" type="error" :bordered="false" class="add-error">
        {{ addError }}
      </n-alert>

      <div class="field-row">
        <n-form-item label="请求间隔（分钟）">
          <n-input-number
            :key="intervalKey"
            :value="config.intervalMinutes"
            :min="1"
            :step="1"
            :precision="0"
            style="width: 100%"
            @update:value="onInterval"
            @blur="onIntervalBlur"
          />
        </n-form-item>
        <n-form-item label="请求超时（毫秒）">
          <n-input-number
            :value="config.timeoutMs"
            :min="1"
            :step="500"
            :precision="0"
            style="width: 100%"
            @update:value="onTimeout"
          />
        </n-form-item>
      </div>
    </n-form>

    <template #footer>
      <div class="form-footer">
        <n-button type="primary" :loading="saving" @click="emit('save')">
          保存并生效
        </n-button>
      </div>
    </template>
  </n-card>
</template>

<style scoped>
.add-error {
  margin-bottom: 12px;
}

.field-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.form-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
