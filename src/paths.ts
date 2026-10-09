import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Settings } from "./settings.js";

export interface DataPaths {
  root: string;
  settings: string;
  config: string;
  lockDir: string;
  state: string;
  logs: string;
}

function defaultRoot(): string {
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "vpn-keepalive");
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "vpn-keepalive",
    );
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "vpn-keepalive",
  );
}

/** 根据数据根目录与存储设置解析路径；自定义目录为空时落在根目录内。 */
export function getPaths(override?: string, settings?: Settings): DataPaths {
  const root = resolve(override ?? defaultRoot());
  return {
    root,
    settings: join(root, "settings.json"),
    config: join(settings?.configDir ?? root, "config.json"),
    lockDir: join(root, "run.lock"),
    state: join(root, "state.json"),
    logs: settings?.logDir ?? join(root, "logs"),
  };
}
