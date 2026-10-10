import type { Config } from "./config.js";
import { errorMessage, writeJson } from "./files.js";
import { Logger } from "./logger.js";
import type { DataPaths } from "./paths.js";

export interface RequestResult {
  at: string;
  outcome: "success" | "http-error" | "timeout" | "network-error";
  detail: string;
}

export interface EngineStatus {
  status: "waiting" | "active" | "stopped";
  url: string | null;
  startedAt: string;
  updatedAt: string;
  nextRequestAt: string | null;
  lastRequest: RequestResult | null;
  error: string | null;
}

/** 周期保活引擎：选中地址后按间隔请求；未选择地址时待机。 */
export class KeepaliveEngine {
  private config: Config;
  private readonly paths: DataPaths;
  private readonly logger: Logger;
  private readonly signal: AbortSignal;
  private timer: ReturnType<typeof setInterval> | undefined;
  private requestTask: Promise<void> | null = null;
  private requestController: AbortController | null = null;
  private generation = 0;
  private stopping = false;
  private stateQueue: Promise<void> = Promise.resolve();
  private readonly status: EngineStatus;

  constructor(config: Config, paths: DataPaths, signal: AbortSignal) {
    this.config = config;
    this.paths = paths;
    this.signal = signal;
    this.logger = new Logger(paths.logs);
    this.status = {
      status: "stopped",
      url: config.url,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextRequestAt: null,
      lastRequest: null,
      error: null,
    };
    // 外部信号中止（如进程 SIGINT/SIGTERM）时自动停止引擎。
    signal.addEventListener(
      "abort",
      () => {
        void this.stop();
      },
      { once: true },
    );
  }

  start(): void {
    this.stopping = false;
    this.logger.write(
      "info",
      this.config.url
        ? `保活启动，地址 ${this.config.url}，间隔 ${this.config.intervalMinutes} 分钟。`
        : "保活启动，未选择地址，待机。",
    );
    this.schedule(true);
    this.flush();
  }

  /** 热更新配置：中止当前周期与在途请求，按新配置重启循环。 */
  applyConfig(config: Config): void {
    this.config = config;
    this.logger.write(
      "info",
      config.url
        ? `配置已更新，保活地址 ${config.url}，间隔 ${config.intervalMinutes} 分钟。`
        : "配置已更新，未选择地址，待机。",
    );
    this.schedule(true);
    this.flush();
  }

  /** 停止引擎并等待 state.json 落盘；重复调用时仅等待在途写入。 */
  async stop(): Promise<void> {
    if (this.stopping) {
      await this.stateQueue;
      return;
    }
    this.stopping = true;
    this.schedule(false);
    this.status.status = "stopped";
    this.status.nextRequestAt = null;
    this.status.updatedAt = new Date().toISOString();
    this.logger.write("info", "保活已停止。");
    this.flush();
    await this.stateQueue;
  }

  getStatus(): EngineStatus {
    return structuredClone(this.status);
  }

  getConfig(): Config {
    return structuredClone(this.config);
  }

  private flush(): void {
    this.status.updatedAt = new Date().toISOString();
    const snapshot = structuredClone(this.status);
    this.stateQueue = this.stateQueue.then(() =>
      writeJson(this.paths.state, snapshot),
    );
  }

  /** 开启新循环；立即模式下先发一次请求再进入周期。 */
  private schedule(immediate: boolean): void {
    this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.requestController?.abort();
    this.status.nextRequestAt = null;
    const current = this.generation;
    const { url } = this.config;
    if (!url || this.signal.aborted || this.stopping) {
      this.status.status = this.stopping ? "stopped" : "waiting";
      this.status.url = url;
      return;
    }
    this.status.status = "active";
    this.status.url = url;
    const fire = (): void => {
      if (current !== this.generation) return;
      void this.requestOnce().catch((error: unknown) => {
        this.logger.write("error", `保活请求异常：${errorMessage(error)}`);
      });
    };
    if (immediate) {
      const previous = this.requestTask;
      if (previous) {
        // 旧在途请求已被中止：等待其完全退出后立即按新配置重发，不等下一周期。
        void previous.catch(() => {}).then(() => fire());
      } else {
        fire();
      }
    }
    const intervalMs = this.config.intervalMinutes * 60_000;
    this.status.nextRequestAt = new Date(Date.now() + intervalMs).toISOString();
    this.timer = setInterval(() => {
      if (current !== this.generation) return;
      this.status.nextRequestAt = new Date(
        Date.now() + intervalMs,
      ).toISOString();
      fire();
    }, intervalMs);
  }

  /** 发起单次保活请求；在途未结束时直接返回在途任务（不重叠）。 */
  private requestOnce(): Promise<void> {
    if (this.signal.aborted || this.stopping) return Promise.resolve();
    if (this.requestTask) return this.requestTask;
    const { url } = this.config;
    if (!url) return Promise.resolve();
    const generation = this.generation;
    const controller = new AbortController();
    this.requestController = controller;
    // 清理挂在 finally 链上：await requestTask 返回时保证已完全退出。
    this.requestTask = this.executeRequest(generation, controller).finally(
      () => {
        this.requestTask = null;
        this.requestController = null;
      },
    );
    return this.requestTask;
  }

  private async executeRequest(
    generation: number,
    controller: AbortController,
  ): Promise<void> {
    const { url } = this.config;
    if (!url) return;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    let result: RequestResult;
    try {
      const response = await fetch(url, {
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
        outcome: timedOut ? "timeout" : "network-error",
        detail: timedOut
          ? `请求超时（${this.config.timeoutMs}ms）`
          : errorMessage(error),
      };
    } finally {
      clearTimeout(timeout);
    }
    // 配置切换或停止时中止的请求不记入结果。
    if (generation !== this.generation || this.stopping) return;
    this.status.lastRequest = result;
    this.logger.write(
      result.outcome === "success" ? "info" : "warn",
      `保活请求 ${result.outcome}: ${result.detail}`,
    );
    this.flush();
  }
}
