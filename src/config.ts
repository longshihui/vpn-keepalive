import { readFile } from "node:fs/promises";
import { record, writeAtomic } from "./files.js";

export interface Config {
  /** 可配置的保活地址列表，每次请求随机选取其一 */
  urls: string[];
  intervalMinutes: number;
  timeoutMs: number;
}

export const DEFAULT_CONFIG: Config = {
  urls: [],
  intervalMinutes: 1,
  timeoutMs: 10_000,
};

/** 校验并规范化单个保活地址；仅接受 HTTP/HTTPS，供命令行引导复用。 */
export function parseUrl(value: string, key: string): string {
  if (!value.trim()) throw new Error(`${key} 必须为非空字符串。`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${key} 格式无效。`);
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error(`${key} 仅支持 HTTP/HTTPS。`);
  return parsed.href;
}

function positiveTimer(value: unknown, key: string, factor = 1): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value * factor < 1 ||
    value * factor > 2_147_483_647 ||
    (factor === 1 && !Number.isInteger(value))
  )
    throw new Error(`${key} 必须为有效的正数计时值（毫秒上限 2147483647）。`);
  return value;
}

/** 请求间隔只允许整分钟。 */
function positiveMinutes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value * 60_000 > 2_147_483_647
  )
    throw new Error("intervalMinutes 必须为不小于 1 的整数分钟。");
  return value;
}

export function parseConfig(input: unknown): Config {
  if (!record(input)) throw new Error("配置必须为 JSON 对象。");
  const rest = { ...input };
  // 旧版"活动地址"字段已废弃：每次请求随机选取，读取时静默忽略以兼容既有配置文件。
  delete rest.url;
  const known = new Set(["urls", "intervalMinutes", "timeoutMs"]);
  for (const key of Object.keys(rest))
    if (!known.has(key)) throw new Error(`未知配置字段：${key}`);
  const urlsInput = rest.urls === undefined ? [] : rest.urls;
  if (
    !Array.isArray(urlsInput) ||
    !urlsInput.every((item): item is string => typeof item === "string")
  )
    throw new Error("urls 必须为字符串数组。");
  const urls = urlsInput.map((item) => parseUrl(item, "urls 项"));
  if (new Set(urls).size !== urls.length)
    throw new Error("urls 中存在重复地址。");
  return {
    urls,
    intervalMinutes: positiveMinutes(
      input.intervalMinutes === undefined
        ? DEFAULT_CONFIG.intervalMinutes
        : input.intervalMinutes,
    ),
    timeoutMs: positiveTimer(
      input.timeoutMs === undefined
        ? DEFAULT_CONFIG.timeoutMs
        : input.timeoutMs,
      "timeoutMs",
    ),
  };
}

/** 读取配置文件；不存在时以默认值创建并返回。 */
export async function loadOrCreateConfig(path: string): Promise<Config> {
  try {
    return parseConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ))
      throw error;
  }
  await writeAtomic(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return DEFAULT_CONFIG;
}

export async function saveConfig(path: string, config: Config): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}
