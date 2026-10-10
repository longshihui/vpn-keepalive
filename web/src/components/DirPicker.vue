<script setup lang="ts">
import {
  NAlert,
  NButton,
  NEmpty,
  NInput,
  NInputGroup,
  NModal,
  NSpin,
} from "naive-ui";
import { ref, watch } from "vue";
import type { DirEntry } from "../types";

const props = defineProps<{
  show: boolean;
  loading: boolean;
  error: string | null;
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}>();

const emit = defineEmits<{
  navigate: [path: string];
  confirm: [];
  close: [];
}>();

// 手动输入的路径；浏览到新目录时同步为当前目录。
const pathInput = ref("");

watch(
  () => [props.show, props.current] as const,
  ([visible, current]) => {
    if (visible) pathInput.value = current;
  },
  { immediate: true },
);

const goInput = (): void => {
  emit("navigate", pathInput.value);
};

const goHome = (): void => {
  emit("navigate", "~");
};

const goParent = (): void => {
  if (props.parent) emit("navigate", props.parent);
};

const onUpdateShow = (visible: boolean): void => {
  if (!visible) emit("close");
};
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="选择目录"
    size="small"
    :bordered="false"
    :style="{ width: '560px', maxWidth: 'calc(100vw - 32px)' }"
    @update:show="onUpdateShow"
  >
    <div class="picker">
      <n-input-group>
        <n-input
          v-model:value="pathInput"
          class="path-input mono"
          placeholder="输入目录路径（支持 ~ 开头）"
          @keyup.enter="goInput"
        />
        <n-button @click="goHome">主目录</n-button>
        <n-button type="primary" @click="goInput">前往</n-button>
      </n-input-group>

      <n-spin :show="loading">
        <div class="picker-body">
          <n-alert v-if="error" type="error" :bordered="false">
            {{ error }}
          </n-alert>
          <template v-else>
            <p class="current mono" :title="current">
              当前目录：{{ current || "—" }}
            </p>
            <n-empty
              v-if="dirs.length === 0"
              description="无子目录"
              size="small"
              class="picker-empty"
            />
            <div v-else class="dir-list">
              <button
                v-for="dir in dirs"
                :key="dir.path"
                type="button"
                class="dir-item"
                :title="dir.path"
                @click="emit('navigate', dir.path)"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"
                  />
                </svg>
                <span class="mono">{{ dir.name }}</span>
              </button>
            </div>
          </template>
        </div>
      </n-spin>

      <div class="picker-actions">
        <n-button size="small" :disabled="!parent" @click="goParent">
          上级目录
        </n-button>
        <div class="spacer"></div>
        <n-button size="small" quaternary @click="emit('close')">
          取消
        </n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="!current"
          @click="emit('confirm')"
        >
          使用当前目录
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.path-input {
  flex: 1;
}

.picker-body {
  min-height: 220px;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border: 1px solid #e4e4e7;
  border-radius: 6px;
  box-sizing: border-box;
}

.current {
  margin: 0 0 8px;
  font-size: 12px;
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-empty {
  padding: 48px 0;
}

.dir-list {
  display: flex;
  flex-direction: column;
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  background: none;
  border-radius: 4px;
  color: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.dir-item:hover {
  background: #f4f4f5;
}

.dir-item + .dir-item {
  margin-top: 2px;
}

.dir-item svg {
  flex: none;
  color: #eab308;
}

.dir-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spacer {
  flex: 1;
}
</style>
