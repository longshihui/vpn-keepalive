import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Platform } from "./config.js";
import { hasCode, readOptional, record, writeJson } from "./files.js";
import { processInfo, processMatches } from "./processes.js";

export interface LockOwner {
  pid: number;
  token: string;
  entry: string;
  startedAt: string;
  processStartedAt: number;
}

export async function readOwner(directory: string): Promise<LockOwner | null> {
  const text = await readOptional(join(directory, "owner.json"));
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    !record(value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.token !== "string" ||
    typeof value.entry !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.processStartedAt !== "number"
  )
    return null;
  return {
    pid: value.pid,
    token: value.token,
    entry: value.entry,
    startedAt: value.startedAt,
    processStartedAt: value.processStartedAt,
  };
}

export async function acquireLock(
  directory: string,
  platform: Platform,
  entry: string,
): Promise<{ owner: LockOwner; release(): Promise<void> }> {
  const info = await processInfo(process.pid, platform);
  if (!info) throw new Error("无法读取当前进程身份。");
  const owner: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    entry,
    startedAt: new Date().toISOString(),
    processStartedAt: info.startedAt,
  };
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await mkdir(directory, { mode: 0o700 });
      try {
        await writeJson(join(directory, "owner.json"), owner);
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      return {
        owner,
        async release() {
          if ((await readOwner(directory))?.token === owner.token)
            await rm(directory, { recursive: true, force: true });
        },
      };
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const existing = await readOwner(directory);
    if (
      existing &&
      (await processMatches(
        existing.pid,
        existing.entry,
        platform,
        existing.processStartedAt,
      ))
    )
      throw new Error(`已有实例运行（PID ${existing.pid}）。`);
    if (!existing) {
      try {
        if (Date.now() - (await stat(directory)).mtimeMs < 5_000) {
          await delay(150);
          continue;
        }
      } catch (error) {
        if (hasCode(error, "ENOENT")) continue;
        throw error;
      }
    }
    // 在原锁目录内独占恢复权；恢复者必须再次确认目录身份与所有者。
    const stale = `${directory}.stale.${randomUUID()}`;
    const recovery = join(directory, "recovering");
    let recoveryLock: Awaited<ReturnType<typeof acquireLock>> | undefined;
    try {
      const before = await stat(directory);
      // 恢复锁也记录进程身份，恢复过程中崩溃后仍可再次恢复。
      recoveryLock = await acquireLock(recovery, platform, entry);
      const current = await readOwner(directory);
      const after = await stat(directory);
      if (
        before.ino !== after.ino ||
        before.birthtimeMs !== after.birthtimeMs ||
        current?.token !== existing?.token
      ) {
        continue;
      }
      await rename(directory, stale);
      await rm(stale, { recursive: true, force: true });
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    } finally {
      await recoveryLock?.release();
    }
  }
  throw new Error("等待实例锁超时，请检查数据目录中的锁记录。");
}
