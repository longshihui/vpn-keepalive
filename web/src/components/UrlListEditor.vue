<script setup lang="ts">
import { computed, h } from "vue";
import {
  NButton,
  NDataTable,
  NEmpty,
  NInput,
  NInputGroup,
  NPopconfirm,
  type DataTableColumns,
} from "naive-ui";

const props = defineProps<{
  urls: string[];
  newUrl: string;
}>();

const emit = defineEmits<{
  add: [];
  remove: [url: string];
  "update:newUrl": [value: string];
}>();

interface UrlRow {
  url: string;
}

const rows = computed<UrlRow[]>(() => props.urls.map((url) => ({ url })));

const columns = computed<DataTableColumns<UrlRow>>(() => [
  {
    title: "地址",
    key: "url",
    render: (row) => h("span", { class: "cell-url mono" }, row.url),
  },
  {
    title: "操作",
    key: "actions",
    width: 90,
    render: (row) =>
      h(
        NPopconfirm,
        { onPositiveClick: () => emit("remove", row.url) },
        {
          trigger: () =>
            h(
              NButton,
              {
                size: "tiny",
                quaternary: true,
                type: "error",
              },
              { default: () => "删除" },
            ),
          default: () => "确认删除该地址？",
        },
      ),
  },
]);
</script>

<template>
  <div class="url-editor">
    <n-input-group class="adder">
      <n-input
        :value="newUrl"
        placeholder="https://example.com/keepalive"
        clearable
        @update:value="emit('update:newUrl', $event)"
        @keydown.enter.prevent="emit('add')"
      />
      <n-button @click="emit('add')">添加</n-button>
    </n-input-group>

    <n-data-table
      v-if="urls.length > 0"
      class="url-table"
      :columns="columns"
      :data="rows"
      size="small"
      :single-line="false"
    />
    <n-empty
      v-else
      size="small"
      description="尚未配置地址。添加一个或多个保活地址，引擎将随机选取发起请求。"
      class="empty"
    />
  </div>
</template>

<style scoped>
.adder {
  margin-bottom: 12px;
}

.url-table {
  width: 100%;
}

.empty {
  padding: 12px 0;
}

.cell-url {
  font-size: 13px;
  word-break: break-all;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
