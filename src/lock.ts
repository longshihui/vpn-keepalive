import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hasCode, readOptional, record, writeJson } from "./files.js";

export interface LockOwner {
  pid: number;
  token: string;
  startedAt: string;
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
    typeof value.startedAt !== "string"
  )
    return null;
  return {
    pid: value.pid,
    token: value.token,
    startedAt: value.startedAt,
  };
}

/** 纯 Node PID 存活检查；不校验进程身份（PID 复用的极端场景不处理）。 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasCode(error, "ESRCH");
  }
}

export async function acquireLock(
  directory: string,
): Promise<{ owner: LockOwner; release(): Promise<void> }> {
  const owner: LockOwner = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
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
    if (existing && pidAlive(existing.pid))
      throw new Error(`已有实例运行（PID ${existing.pid}）。`);
    if (!existing) {
      // 目录存在但无 owner：并发启动的短暂窗口，等待后重试。
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
    // PID 已不存活或 owner 长期缺失：视为陈旧锁并抢占。
    await rm(directory, { recursive: true, force: true });
  }
  throw new Error("等待实例锁超时，请检查数据目录中的锁记录。");
}
