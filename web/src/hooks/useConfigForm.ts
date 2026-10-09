import { ref } from "vue";
import { fetchConfig, updateConfig } from "../api";
import type { Config } from "../types";

/** 配置表单：加载、URL 列表编辑、数值校验、整体保存。 */
export function useConfigForm() {
  const config = ref<Config | null>(null);
  const configPath = ref("");
  const loading = ref(true);
  const loadError = ref<string | null>(null);
  const saving = ref(false);
  const saveError = ref<string | null>(null);
  const newUrl = ref("");

  const load = async (): Promise<void> => {
    loading.value = true;
    loadError.value = null;
    try {
      const result = await fetchConfig();
      config.value = result.config;
      configPath.value = result.configPath;
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  };

  const addUrl = (): string | null => {
    const value = newUrl.value.trim();
    if (!value) return "地址不能为空。";
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "地址格式无效。";
    }
    if (!["http:", "https:"].includes(parsed.protocol))
      return "仅支持 HTTP/HTTPS 地址。";
    const href = parsed.href;
    const current = config.value;
    if (!current) return null;
    if (current.urls.includes(href)) return "地址已存在于列表中。";
    current.urls.push(href);
    // 列表从空变为非空时自动选中，减少一次手动操作。
    if (current.url === null) current.url = href;
    newUrl.value = "";
    return null;
  };

  const removeUrl = (url: string): void => {
    const current = config.value;
    if (!current) return;
    current.urls = current.urls.filter((item) => item !== url);
    if (current.url === url) current.url = current.urls[0] ?? null;
  };

  const selectUrl = (url: string): void => {
    const current = config.value;
    if (current?.urls.includes(url)) current.url = url;
  };

  const save = async (): Promise<boolean> => {
    const current = config.value;
    if (!current || saving.value) return false;
    if (current.urls.length === 0 && current.url !== null) {
      saveError.value = "地址列表为空时不能选中活动地址。";
      return false;
    }
    saving.value = true;
    saveError.value = null;
    try {
      const result = await updateConfig({ ...current });
      config.value = result.config;
      return true;
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      saving.value = false;
    }
  };

  return {
    config,
    configPath,
    loading,
    loadError,
    saving,
    saveError,
    newUrl,
    load,
    addUrl,
    removeUrl,
    selectUrl,
    save,
  };
}
