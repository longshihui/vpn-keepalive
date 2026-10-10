import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface DataPaths {
  root: string;
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

/**
 * 解析数据路径。默认使用操作系统为用户应用约定的数据目录
 * （macOS Application Support / Windows LocalAppData / Linux XDG），
 * 避免系统位置导致读写权限问题；`--data-dir` 显式覆盖仅用于隔离运行。
 */
export function getPaths(override?: string): DataPaths {
  const root = resolve(override ?? defaultRoot());
  return {
    root,
    config: join(root, "config.json"),
    lockDir: join(root, "run.lock"),
    state: join(root, "state.json"),
    logs: join(root, "logs"),
  };
}
