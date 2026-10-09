import { ref } from "vue";
import { fetchSettings, updateSettings } from "../api";
import type { ResolvedDirs, Settings } from "../types";

export interface SettingsFormState {
  configDir: string;
  logDir: string;
}

/** 存储位置设置：加载、编辑、保存（保存后配置与日志迁移到新目录）。 */
export function useSettings() {
  const form = ref<SettingsFormState>({ configDir: "", logDir: "" });
  const resolved = ref<ResolvedDirs | null>(null);
  const settingsPath = ref("");
  const loading = ref(true);
  const loadError = ref<string | null>(null);
  const saving = ref(false);
  const saveError = ref<string | null>(null);

  const apply = (settings: Settings): void => {
    form.value = {
      configDir: settings.configDir ?? "",
      logDir: settings.logDir ?? "",
    };
  };

  const load = async (): Promise<void> => {
    loading.value = true;
    loadError.value = null;
    try {
      const result = await fetchSettings();
      apply(result.settings);
      resolved.value = result.resolved;
      settingsPath.value = result.settingsPath;
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
    } finally {
      loading.value = false;
    }
  };

  const save = async (): Promise<boolean> => {
    if (saving.value) return false;
    saving.value = true;
    saveError.value = null;
    try {
      const result = await updateSettings({
        configDir: form.value.configDir.trim() || null,
        logDir: form.value.logDir.trim() || null,
      });
      apply(result.settings);
      resolved.value = result.resolved;
      return true;
    } catch (error) {
      saveError.value = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      saving.value = false;
    }
  };

  return {
    form,
    resolved,
    settingsPath,
    loading,
    loadError,
    saving,
    saveError,
    load,
    save,
  };
}
