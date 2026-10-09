<script setup lang="ts">
import { computed, h } from "vue";
import {
  NButton,
  NDataTable,
  NEmpty,
  NInput,
  NInputGroup,
  NPopconfirm,
  NTag,
  type DataTableColumns,
} from "naive-ui";

interface UrlRow {
  url: string;
  active: boolean;
}

const props = defineProps<{
  urls: string[];
  activeUrl: string | null;
  newUrl: string;
}>();

const emit = defineEmits<{
  add: [];
  remove: [url: string];
  select: [url: string];
  "update:newUrl": [value: string];
}>();

const rows = computed<UrlRow[]>(() =>
  props.urls.map((url) => ({ url, active: url === props.activeUrl })),
);

const columns = computed<DataTableColumns<UrlRow>>(() => [
  {
    title: "地址",
    key: "url",
    render: (row) => h("span", { class: "cell-url mono" }, row.url),
  },
  {
    title: "状态",
    key: "active",
    width: 90,
    render: (row) =>
      row.active
        ? h(
            NTag,
            { type: "info", size: "small", round: true },
            { default: () => "活动" },
          )
        : h("span", { class: "inactive" }, "—"),
  },
  {
    title: "操作",
    key: "actions",
    width: 190,
    render: (row) =>
      h("div", { class: "row-actions" }, [
        h(
          NButton,
          {
            size: "tiny",
            disabled: row.active,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              emit("select", row.url);
            },
          },
          { default: () => "设为活动" },
        ),
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
                  onClick: (event: MouseEvent) => event.stopPropagation(),
                },
                { default: () => "删除" },
              ),
            default: () => "确认删除该地址？",
          },
        ),
      ]),
  },
]);

const rowProps = (row: UrlRow): { onClick: () => void; style: string } => ({
  onClick: () => emit("select", row.url),
  style: "cursor: pointer",
});

const rowClassName = (row: UrlRow): string =>
  row.active ? "url-active-row" : "";
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
      :row-props="rowProps"
      :row-class-name="rowClassName"
      size="small"
      :single-line="false"
    />
    <n-empty
      v-else
      size="small"
      description="尚未配置地址。添加一个或多个保活地址，并选择一个作为当前活动地址。"
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

.inactive {
  color: #c2c2c8;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.url-table :deep(.url-active-row) td {
  background-color: rgba(32, 128, 240, 0.06) !important;
}
</style>
