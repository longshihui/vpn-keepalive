import type { Config } from "./config.js";
import { errorMessage, writeJson } from "./files.js";
import { Logger } from "./logger.js";
import type { DataPaths } from "./paths.js";

export interface RequestResult {
  at: string;
  url: string;
  outcome: "success" | "http-error" | "timeout" | "network-error";
  detail: string;
}

export interface EngineStatus {
  status: "waiting" | "active" | "stopped";
  urlsCount: number;
  startedAt: string;
  updatedAt: string;
  nextRequestAt: string | null;
  lastRequest: RequestResult | null;
  error: string | null;
}

/** 周期保活引擎：地址列表非空时按间隔随机选取地址请求，否则待机。 */
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
      urlsCount: config.urls.length,
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
      this.config.urls.length > 0
        ? `保活启动，${this.config.urls.length} 个地址，间隔 ${this.config.intervalMinutes} 分钟，随机选取请求。`
        : "保活启动，未配置地址，待机。",
    );
    this.schedule(true);
    this.flush();
  }

  /** 热更新配置：中止当前周期与在途请求，按新配置重启循环。 */
  applyConfig(config: Config): void {
    this.config = config;
    this.logger.write(
      "info",
      config.urls.length > 0
        ? `配置已更新，${config.urls.length} 个地址，间隔 ${config.intervalMinutes} 分钟，随机选取请求。`
        : "配置已更新，未配置地址，待机。",
    );
    this.schedule(true);
    this.flush();
  }

  /**
   * 手动触发一次保活请求（不影响既有周期）；
   * 在途请求未结束时等待其完成，完成后结果记入 lastRequest。
   */
  triggerNow(): Promise<void> {
    if (this.config.urls.length === 0) return Promise.resolve();
    this.logger.write("info", "手动触发保活请求。");
    return this.requestOnce().catch((error: unknown) => {
      this.logger.write("error", `保活请求异常：${errorMessage(error)}`);
    });
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
    this.status.urlsCount = this.config.urls.length;
    const hasUrls = this.config.urls.length > 0;
    if (!hasUrls || this.signal.aborted || this.stopping) {
      this.status.status = this.stopping ? "stopped" : "waiting";
      return;
    }
    this.status.status = "active";
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

  /** 从地址列表中随机选取本次请求的目标地址；列表为空时返回 null。 */
  private pickUrl(): string | null {
    const urls = this.config.urls;
    if (urls.length === 0) return null;
    const index = Math.floor(Math.random() * urls.length);
    return urls[index] ?? null;
  }

  /** 发起单次保活请求；在途未结束时直接返回在途任务（不重叠）。 */
  private requestOnce(): Promise<void> {
    if (this.signal.aborted || this.stopping) return Promise.resolve();
    if (this.requestTask) return this.requestTask;
    const url = this.pickUrl();
    if (!url) return Promise.resolve();
    const generation = this.generation;
    const controller = new AbortController();
    this.requestController = controller;
    // 清理挂在 finally 链上：await requestTask 返回时保证已完全退出。
    this.requestTask = this.executeRequest(generation, controller, url).finally(
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
    url: string,
  ): Promise<void> {
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
        url,
        outcome: response.ok ? "success" : "http-error",
        detail: `${response.status} ${response.statusText}`,
      };
    } catch (error) {
      result = {
        at: new Date().toISOString(),
        url,
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
      result.outcome === "success"
        ? "success"
        : result.outcome === "timeout"
          ? "warn"
          : "error",
      `保活请求 ${result.outcome}: ${result.detail}（${result.url}）`,
    );
    this.flush();
  }
}
