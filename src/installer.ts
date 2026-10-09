import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, parseConfig, type Platform } from "./config.js";
import {
  errorMessage,
  hasCode,
  readOptional,
  record,
  writeAtomic,
  writeJson,
} from "./files.js";
import { acquireLock, readOwner } from "./lock.js";
import type { DataPaths } from "./paths.js";
import { detectProcesses, processMatches } from "./processes.js";
import { createService } from "./service.js";

async function stopRuntime(
  paths: DataPaths,
  platform: Platform,
): Promise<void> {
  const owner = await readOwner(paths.lock);
  if (
    !owner ||
    !(await processMatches(
      owner.pid,
      owner.entry,
      platform,
      owner.processStartedAt,
    ))
  )
    return;
  await writeJson(paths.stop, { token: owner.token });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (
      (await readOwner(paths.lock))?.token !== owner.token ||
      !(await processMatches(
        owner.pid,
        owner.entry,
        platform,
        owner.processStartedAt,
      ))
    )
      return;
    await delay(250);
  }
  if (
    await processMatches(
      owner.pid,
      owner.entry,
      platform,
      owner.processStartedAt,
    )
  )
    process.kill(owner.pid, "SIGTERM");
  await delay(250);
  if (
    await processMatches(
      owner.pid,
      owner.entry,
      platform,
      owner.processStartedAt,
    )
  )
    throw new Error("监听器未能停止，未删除运行文件。");
}

export async function install(
  paths: DataPaths,
  platform: Platform,
  entry: string,
  configPath?: string,
): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const mutex = await acquireLock(paths.installLock, platform, entry);
  const stage = join(paths.root, `.runtime-stage-${randomUUID()}`);
  const backup = join(paths.root, `.runtime-backup-${randomUUID()}`);
  let movedPrevious = false;
  let installedRuntime = false;
  let changedService = false;
  const service = createService(platform, paths);
  try {
    const previousConfig = await readOptional(paths.config);
    const previousMetadata = await readOptional(paths.metadata);
    const previousDefinition = await service.definition();
    const bundled = fileURLToPath(
      new URL("./config.example.json", import.meta.url),
    );
    const configText = configPath
      ? await readOptional(configPath)
      : (previousConfig ?? (await readOptional(bundled)));
    if (configText === null)
      throw new Error(`配置文件不存在：${configPath ?? bundled}`);
    const value: unknown = JSON.parse(configText);
    parseConfig(value, platform);
    const definition = await service.createDefinition(process.execPath);
    await cp(fileURLToPath(new URL(".", import.meta.url)), stage, {
      recursive: true,
    });
    await writeJson(join(stage, "package.json"), {
      type: "module",
      private: true,
    });
    try {
      changedService = true;
      await service.deactivate();
      await stopRuntime(paths, platform);
      try {
        await rename(paths.runtime, backup);
        movedPrevious = true;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      await rename(stage, paths.runtime);
      installedRuntime = true;
      await writeAtomic(paths.config, configText);
      await service.register(definition);
      // 启动成功必须有当前入口的实例锁，不能只依赖注册命令的退出码。
      const deadline = Date.now() + 12_000;
      let started = false;
      while (Date.now() < deadline) {
        const owner = await readOwner(paths.lock);
        if (
          owner?.entry === paths.entry &&
          (await processMatches(
            owner.pid,
            owner.entry,
            platform,
            owner.processStartedAt,
          ))
        ) {
          started = true;
          break;
        }
        await delay(250);
      }
      if (!started)
        throw new Error(
          "自动启动未产生监听器实例，请检查日志及系统后台项设置。",
        );
      await writeJson(paths.metadata, {
        version: "0.1.0",
        platform,
        node: process.execPath,
        entry: paths.entry,
        serviceName: paths.serviceName,
        installedAt: new Date().toISOString(),
      });
    } catch (error) {
      const failures: unknown[] = [error];
      const rollback = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch (failure) {
          failures.push(failure);
        }
      };
      if (changedService) {
        await rollback(() => service.deactivate());
        await rollback(() => stopRuntime(paths, platform));
        await rollback(() => service.remove());
      }
      if (installedRuntime)
        await rollback(() =>
          rm(paths.runtime, { recursive: true, force: true }),
        );
      if (movedPrevious) await rollback(() => rename(backup, paths.runtime));
      await rollback(() =>
        previousConfig === null
          ? rm(paths.config, { force: true })
          : writeAtomic(paths.config, previousConfig),
      );
      await rollback(() =>
        previousMetadata === null
          ? rm(paths.metadata, { force: true })
          : writeAtomic(paths.metadata, previousMetadata),
      );
      if (previousDefinition !== null)
        await rollback(() => service.register(previousDefinition));
      throw new AggregateError(
        failures,
        `安装失败并执行回滚：${failures.map(errorMessage).join("；")}`,
        { cause: error },
      );
    }
    await rm(backup, { recursive: true, force: true });
    console.log(`已安装并启动。配置：${paths.config}\n日志：${paths.logs}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await mutex.release();
  }
}

export async function uninstall(
  paths: DataPaths,
  platform: Platform,
  entry: string,
): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const mutex = await acquireLock(paths.installLock, platform, entry);
  try {
    const service = createService(platform, paths);
    await service.deactivate();
    await stopRuntime(paths, platform);
    await service.remove();
    await rm(paths.runtime, { recursive: true, force: true });
    await rm(paths.metadata, { force: true });
    await rm(paths.stop, { force: true });
    const owner = await readOwner(paths.lock);
    if (
      !owner ||
      !(await processMatches(
        owner.pid,
        owner.entry,
        platform,
        owner.processStartedAt,
      ))
    )
      await rm(paths.lock, { recursive: true, force: true });
    console.log(
      `已停止并移除自动启动项及运行文件。配置和日志保留于：${paths.root}`,
    );
  } finally {
    await mutex.release();
  }
}

export async function showStatus(
  paths: DataPaths,
  platform: Platform,
): Promise<void> {
  const owner = await readOwner(paths.lock);
  const running =
    owner !== null &&
    (await processMatches(
      owner.pid,
      owner.entry,
      platform,
      owner.processStartedAt,
    ));
  const installed =
    (await createService(platform, paths).definition()) !== null;
  const text = await readOptional(paths.state);
  const parsed: unknown = text === null ? null : JSON.parse(text);
  const state = record(parsed) ? parsed : null;
  const metadataText = await readOptional(paths.metadata);
  const configured = await readOptional(paths.config);
  const config =
    configured === null
      ? await loadConfig(
          fileURLToPath(new URL("./config.example.json", import.meta.url)),
          platform,
        )
      : parseConfig(JSON.parse(configured), platform);
  let pids: number[] = [];
  let detectionError: string | null = null;
  try {
    pids = await detectProcesses(config, platform);
  } catch (error) {
    detectionError = errorMessage(error);
  }
  console.log(
    JSON.stringify(
      {
        installed,
        running,
        pid: running ? owner?.pid : null,
        status:
          running && state?.token === owner?.token ? state.status : "stopped",
        client: { processName: config.processName, pids, detectionError },
        lastRequest: state?.lastRequest ?? null,
        runtimeError: state?.error ?? null,
        config: paths.config,
        logs: paths.logs,
        installation: metadataText === null ? null : JSON.parse(metadataText),
      },
      null,
      2,
    ),
  );
}
