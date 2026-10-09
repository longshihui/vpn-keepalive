import { mkdir, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Config, Platform } from "./config.js";
import { errorMessage, readOptional, record, writeJson } from "./files.js";
import { acquireLock } from "./lock.js";
import { Logger } from "./logger.js";
import type { DataPaths } from "./paths.js";
import { detectProcesses } from "./processes.js";

interface RequestResult {
  at: string;
  outcome: "success" | "http-error" | "timeout" | "network-error" | "cancelled";
  detail: string;
}

interface RuntimeState {
  pid: number;
  token: string;
  startedAt: string;
  updatedAt: string;
  status: "waiting" | "active" | "detection-error" | "stopped" | "error";
  processName: string;
  pids: number[];
  lastRequest: RequestResult | null;
  error: string | null;
}

interface RunOptions {
  entry: string;
  signal?: AbortSignal;
  detect?: (signal: AbortSignal) => Promise<number[]>;
}

export async function runMonitor(
  config: Config,
  paths: DataPaths,
  platform: Platform,
  options: RunOptions,
): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const lock = await acquireLock(paths.lock, platform, options.entry);
  const lifecycle = new AbortController();
  const stop = () => lifecycle.abort();
  let requestTimer: ReturnType<typeof setInterval> | undefined;
  let stopTimer: ReturnType<typeof setInterval> | undefined;
  let requestTask: Promise<void> | null = null;
  let requestController: AbortController | null = null;
  const abortRequest = () => requestController?.abort();
  let session = 0;
  let checkingStop = false;
  let fatalError: unknown;
  let stateQueue = Promise.resolve();
  const state: RuntimeState = {
    ...lock.owner,
    updatedAt: new Date().toISOString(),
    status: "waiting",
    processName: config.processName,
    pids: [],
    lastRequest: null,
    error: null,
  };
  const saveState = () => {
    state.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(state);
    stateQueue = stateQueue.then(() => writeJson(paths.state, snapshot));
    return stateQueue;
  };
  const fail = (error: unknown) => {
    fatalError = error;
    stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  try {
    const logger = new Logger(paths.logs);
    await rm(paths.stop, { force: true });
    logger.write(
      "info",
      `监听器启动，主进程 ${config.processName}，检测周期 ${config.processPollIntervalMs}ms。`,
    );
    await saveState();

    const deactivate = async () => {
      session++;
      if (requestTimer) clearInterval(requestTimer);
      requestTimer = undefined;
      abortRequest();
      await requestTask;
    };

    const requestOnce = async () => {
      if (requestTask || lifecycle.signal.aborted || state.status !== "active")
        return;
      const currentSession = session;
      const controller = new AbortController();
      requestController = controller;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);
      requestTask = (async () => {
        let result: RequestResult;
        try {
          const response = await fetch(config.url, {
            method: "GET",
            signal: controller.signal,
          });
          await response.body?.cancel();
          result = {
            at: new Date().toISOString(),
            outcome: response.ok ? "success" : "http-error",
            detail: `${response.status} ${response.statusText}`,
          };
        } catch (error) {
          result = {
            at: new Date().toISOString(),
            outcome: timedOut
              ? "timeout"
              : controller.signal.aborted
                ? "cancelled"
                : "network-error",
            detail: timedOut
              ? `请求超时（${config.timeoutMs}ms）`
              : errorMessage(error),
          };
        } finally {
          clearTimeout(timeout);
        }
        if (currentSession !== session || lifecycle.signal.aborted) return;
        state.lastRequest = result;
        logger.write(
          result.outcome === "success" ? "info" : "warn",
          `保活请求 ${result.outcome}: ${result.detail}`,
        );
        await saveState();
      })();
      try {
        await requestTask;
      } finally {
        requestTask = null;
        requestController = null;
      }
    };

    stopTimer = setInterval(() => {
      if (checkingStop) return;
      checkingStop = true;
      void (async () => {
        const text = await readOptional(paths.stop);
        if (text !== null) {
          const value: unknown = JSON.parse(text);
          if (record(value) && value.token === lock.owner.token) stop();
        }
      })()
        .catch(fail)
        .finally(() => {
          checkingStop = false;
        });
    }, 250);

    try {
      while (!lifecycle.signal.aborted) {
        const deadline = Date.now() + config.processPollIntervalMs;
        let pids: number[];
        try {
          pids = await (
            options.detect ??
            ((signal) => detectProcesses(config, platform, signal))
          )(lifecycle.signal);
        } catch (error) {
          if (lifecycle.signal.aborted) break;
          await deactivate();
          const message = errorMessage(error);
          if (state.status !== "detection-error" || state.error !== message)
            logger.write("warn", `进程检测失败，暂停保活：${message}`);
          state.status = "detection-error";
          state.pids = [];
          state.error = message;
          await saveState();
          await delay(Math.max(1, deadline - Date.now()), undefined, {
            signal: lifecycle.signal,
          });
          continue;
        }
        if (lifecycle.signal.aborted) break;
        if (
          pids.join(",") !== state.pids.join(",") ||
          state.status === "detection-error"
        ) {
          await deactivate();
          state.pids = pids;
          state.error = null;
          state.status = pids.length ? "active" : "waiting";
          logger.write(
            "info",
            pids.length
              ? `客户端运行，开始保活（PID ${pids.join(",")}）。`
              : "客户端已退出，停止保活并待机。",
          );
          await saveState();
          if (pids.length) {
            void requestOnce().catch(fail);
            requestTimer = setInterval(() => {
              void requestOnce().catch(fail);
            }, config.intervalMinutes * 60_000);
          }
        }
        await delay(Math.max(1, deadline - Date.now()), undefined, {
          signal: lifecycle.signal,
        });
      }
    } catch (error) {
      if (!lifecycle.signal.aborted) fatalError = error;
    } finally {
      await deactivate();
      state.pids = [];
      state.status = fatalError === undefined ? "stopped" : "error";
      state.error = fatalError === undefined ? null : errorMessage(fatalError);
      logger.write(
        fatalError === undefined ? "info" : "error",
        fatalError === undefined
          ? "监听器已停止。"
          : `监听器异常停止：${state.error}`,
      );
      await saveState();
    }
    if (fatalError !== undefined) throw fatalError;
  } finally {
    stop();
    if (requestTimer) clearInterval(requestTimer);
    if (stopTimer) clearInterval(stopTimer);
    abortRequest();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    options.signal?.removeEventListener("abort", stop);
    await lock.release();
  }
}
