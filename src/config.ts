import { readFile } from "node:fs/promises";
import { record, writeAtomic } from "./files.js";

export interface Config {
  /** 可配置的保活地址列表，默认为空 */
  urls: string[];
  /** 当前选中的活动地址；null 表示未选择，引擎待机 */
  url: string | null;
  intervalMinutes: number;
  timeoutMs: number;
}

export const DEFAULT_CONFIG: Config = {
  urls: [],
  url: null,
  intervalMinutes: 1,
  timeoutMs: 10_000,
};

function parseUrl(value: string, key: string): string {
  if (!value.trim()) throw new Error(`${key} 必须为非空字符串。`);
  const parsed = new URL(value.trim());
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
  const known = new Set(["urls", "url", "intervalMinutes", "timeoutMs"]);
  for (const key of Object.keys(input))
    if (!known.has(key)) throw new Error(`未知配置字段：${key}`);
  const urlsInput = input.urls === undefined ? [] : input.urls;
  if (
    !Array.isArray(urlsInput) ||
    !urlsInput.every((item): item is string => typeof item === "string")
  )
    throw new Error("urls 必须为字符串数组。");
  const urls = urlsInput.map((item) => parseUrl(item, "urls 项"));
  if (new Set(urls).size !== urls.length)
    throw new Error("urls 中存在重复地址。");
  let url: string | null = null;
  if (input.url !== undefined && input.url !== null) {
    if (typeof input.url !== "string")
      throw new Error("url 必须为字符串或 null。");
    url = parseUrl(input.url, "url");
    if (!urls.includes(url))
      throw new Error("url 必须为 urls 中的地址，或为 null。");
  }
  return {
    urls,
    url,
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
