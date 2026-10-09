import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { readOptional, record, writeAtomic } from "./files.js";

export interface Settings {
  /** 配置文件目录；null 表示使用默认（数据根目录） */
  configDir: string | null;
  /** 日志目录；null 表示使用默认（数据根目录/logs） */
  logDir: string | null;
}

export const DEFAULT_SETTINGS: Settings = { configDir: null, logDir: null };

/** 展开 ~ 前缀并解析为绝对路径（兼容 macOS / Windows / Linux）。 */
export function expandPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function normalizeDir(value: unknown, key: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} 必须为字符串。`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    !isAbsolute(trimmed) &&
    trimmed !== "~" &&
    !trimmed.startsWith("~/") &&
    !trimmed.startsWith("~\\")
  )
    throw new Error(
      `${key} 必须为绝对路径，或以 ~ 开头指向用户目录（兼容 macOS / Windows / Linux）。`,
    );
  return expandPath(trimmed);
}

export function parseSettings(input: unknown): Settings {
  if (!record(input)) throw new Error("设置必须为 JSON 对象。");
  const known = new Set(["configDir", "logDir"]);
  for (const key of Object.keys(input))
    if (!known.has(key)) throw new Error(`未知设置字段：${key}`);
  return {
    configDir: normalizeDir(input.configDir, "configDir"),
    logDir: normalizeDir(input.logDir, "logDir"),
  };
}

export async function loadSettings(path: string): Promise<Settings> {
  const text = await readOptional(path);
  if (text === null) return DEFAULT_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("settings.json 不是有效的 JSON。");
  }
  return parseSettings(value);
}

export async function saveSettings(
  path: string,
  settings: Settings,
): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}
