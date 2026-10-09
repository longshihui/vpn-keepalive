<script setup lang="ts">
import { dateZhCN, NConfigProvider, NMessageProvider, zhCN } from "naive-ui";
import Workbench from "./components/Workbench.vue";
</script>

<template>
  <n-config-provider :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider placement="top">
      <Workbench />
    </n-message-provider>
  </n-config-provider>
</template>

<style>
body {
  margin: 0;
  background: #f4f5f7;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
</style>
