import { readFile } from "node:fs/promises";
import { record } from "./files.js";

export interface Config {
  url: string;
  intervalMinutes: number;
  timeoutMs: number;
  processPollIntervalMs: number;
  processName: string;
}

export type Platform = "darwin" | "win32";

export function supportedPlatform(): Platform {
  if (process.platform === "darwin" || process.platform === "win32")
    return process.platform;
  throw new Error(
    `不支持的系统：${process.platform}；仅支持 macOS 和 Windows。`,
  );
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

export function parseConfig(input: unknown, platform: Platform): Config {
  if (!record(input)) throw new Error("配置必须为 JSON 对象。");
  const known = new Set([
    "url",
    "intervalMinutes",
    "timeoutMs",
    "processPollIntervalMs",
    "processName",
  ]);
  for (const key of Object.keys(input))
    if (!known.has(key)) throw new Error(`未知配置字段：${key}`);
  const url = input.url === undefined ? "http://10.249.12.234" : input.url;
  if (typeof url !== "string" || !url.trim())
    throw new Error("url 必须为非空字符串。");
  const parsed = new URL(url.trim());
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("url 仅支持 HTTP/HTTPS。");
  const processName =
    input.processName === undefined
      ? platform === "darwin"
        ? "aTrust"
        : "aTrustTray.exe"
      : input.processName;
  if (
    typeof processName !== "string" ||
    !/^[\w .-]{1,128}$/.test(processName) ||
    processName.trim() !== processName
  )
    throw new Error("processName 必须为不含路径及特殊字符的进程名。");
  return {
    url: parsed.href,
    intervalMinutes: positiveTimer(
      input.intervalMinutes === undefined ? 1 : input.intervalMinutes,
      "intervalMinutes",
      60_000,
    ),
    timeoutMs: positiveTimer(
      input.timeoutMs === undefined ? 10_000 : input.timeoutMs,
      "timeoutMs",
    ),
    processPollIntervalMs: positiveTimer(
      input.processPollIntervalMs === undefined
        ? 3_000
        : input.processPollIntervalMs,
      "processPollIntervalMs",
    ),
    processName:
      platform === "win32" && !processName.toLowerCase().endsWith(".exe")
        ? `${processName}.exe`
        : processName,
  };
}

export async function loadConfig(
  path: string,
  platform: Platform,
): Promise<Config> {
  const content: unknown = JSON.parse(await readFile(path, "utf8"));
  return parseConfig(content, platform);
}
