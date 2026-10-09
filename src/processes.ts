import { execFile } from "node:child_process";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { Config, Platform } from "./config.js";
import { record } from "./files.js";

const execute = promisify(execFile);
export const psQuote = (value: string): string =>
  `'${value.replaceAll("'", "''")}'`;
export const powershellPath = (): string =>
  join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

export async function command(
  file: string,
  args: string[],
  timeout = 2_000,
  signal?: AbortSignal,
): Promise<string> {
  const result = await execute(file, args, {
    timeout,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
    ...(signal ? { signal } : {}),
  });
  return result.stdout.trim();
}

export function powershell(
  script: string,
  timeout = 2_000,
  signal?: AbortSignal,
): Promise<string> {
  return command(
    powershellPath(),
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(
        `$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    timeout,
    signal,
  );
}

export async function detectProcesses(
  config: Config,
  platform: Platform,
  signal?: AbortSignal,
): Promise<number[]> {
  if (platform === "darwin") {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("无法读取当前用户 UID。");
    const output = await command(
      "/bin/ps",
      ["-U", String(uid), "-o", "pid=,comm="],
      2_000,
      signal,
    );
    return output
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
        if (!match?.[1] || !match[2]) return [];
        const name = match[2].slice(match[2].lastIndexOf("/") + 1);
        return name === config.processName ? [Number(match[1])] : [];
      })
      .sort((a, b) => a - b);
  }
  const output = await powershell(
    `$sid = [System.Diagnostics.Process]::GetCurrentProcess().SessionId; $pids = @(Get-CimInstance Win32_Process -Filter (${psQuote(`Name = '${config.processName}' AND SessionId = `)} + $sid) | ForEach-Object { [int]$_.ProcessId }); ConvertTo-Json -InputObject $pids -Compress`,
    2_000,
    signal,
  );
  const parsed: unknown = JSON.parse(output);
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (pid: unknown) =>
        typeof pid === "number" && Number.isInteger(pid) && pid > 0,
    )
  )
    throw new Error("进程检测返回了无效的 PID 列表。");
  return parsed.sort((a, b) => a - b);
}

export async function processInfo(
  pid: number,
  platform: Platform,
): Promise<{ commandLine: string; startedAt: number } | null> {
  if (platform === "darwin") {
    let output: string;
    try {
      output = await command("/bin/ps", [
        "-p",
        String(pid),
        "-o",
        "lstart=,command=",
      ]);
    } catch (error) {
      if (record(error) && error.code === 1 && error.stdout === "") return null;
      throw error;
    }
    const match =
      /^\s*(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+([\s\S]+)$/.exec(
        output,
      );
    if (!match?.[1] || !match[2] || !Number.isFinite(Date.parse(match[1])))
      throw new Error("无法读取进程启动时间。");
    return { startedAt: Date.parse(match[1]), commandLine: match[2] };
  }
  const text = await powershell(
    `$p = Get-CimInstance Win32_Process -Filter ${psQuote(`ProcessId = ${pid}`)}; if ($null -ne $p) { [pscustomobject]@{ commandLine = $p.CommandLine; startedAt = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
  );
  if (!text) return null;
  const value: unknown = JSON.parse(text);
  if (
    !record(value) ||
    typeof value.commandLine !== "string" ||
    typeof value.startedAt !== "number"
  )
    throw new Error("无法读取进程身份。");
  return { commandLine: value.commandLine, startedAt: value.startedAt };
}

export async function processMatches(
  pid: number,
  entry: string,
  platform: Platform,
  startedAt: number,
): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (record(error) && error.code === "ESRCH") return false;
    throw error;
  }
  try {
    const info = await processInfo(pid, platform);
    return (
      info !== null &&
      info.startedAt === startedAt &&
      (info.commandLine.includes(entry) ||
        info.commandLine.includes(basename(entry)))
    );
  } catch (error) {
    // 查询失败不能当作进程不存在，否则可能启动重复实例。
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (record(probe) && probe.code === "ESRCH") return false;
      throw probe;
    }
    throw error;
  }
}
