import { ref } from "vue";
import { fetchDirs } from "../api";
import type { DirEntry } from "../types";

/** 目录选择器：打开弹窗、逐级浏览目录、确认当前目录。 */
export function useDirPicker() {
  const show = ref(false);
  const current = ref("");
  const parent = ref<string | null>(null);
  const dirs = ref<DirEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // 快速连续导航时仅保留最后一次请求的结果。
  let generation = 0;

  const load = async (path: string): Promise<void> => {
    const id = ++generation;
    loading.value = true;
    error.value = null;
    try {
      const result = await fetchDirs(path.trim() || undefined);
      if (id !== generation) return;
      current.value = result.path;
      parent.value = result.parent;
      dirs.value = result.dirs;
    } catch (e) {
      if (id === generation)
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (id === generation) loading.value = false;
    }
  };

  const open = (initialPath: string): void => {
    show.value = true;
    void load(initialPath);
  };

  const close = (): void => {
    show.value = false;
  };

  return {
    show,
    current,
    parent,
    dirs,
    loading,
    error,
    open,
    close,
    load,
  };
}
