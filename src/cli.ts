#!/usr/bin/env node
import { spawn } from "node:child_process";
import { stdout } from "node:process";
import { Command, InvalidArgumentError } from "commander";
import getPort from "get-port";
import { loadOrCreateConfig } from "./config.js";
import { errorMessage, hasCode } from "./files.js";
import { KeepaliveEngine } from "./engine.js";
import { acquireLock } from "./lock.js";
import { getPaths, type DataPaths } from "./paths.js";
import { createAppServer, type AppServer } from "./server.js";

const VERSION = "0.2.0";

/** --port 取值校验：0-65535 的整数。 */
const parsePort = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new InvalidArgumentError("必须为 0-65535 的整数。");
  return parsed;
};

interface RunOptions {
  dataDir?: string;
  port: number;
  host: string;
}

/** 用系统默认浏览器打开界面地址；无法打开时提示手动访问。 */
const openBrowser = (address: string): void => {
  const isWindows = process.platform === "win32";
  const command =
    process.platform === "darwin" ? "open" : isWindows ? "cmd" : "xdg-open";
  const args = isWindows ? ["/c", "start", "", address] : [address];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {
    console.log(`未能自动打开浏览器，请手动访问：${address}`);
  });
  child.unref();
};

/** 启动 Web 界面并输出访问地址；端口由 get-port 在监听前查找。 */
const startUi = async (
  engine: KeepaliveEngine,
  paths: DataPaths,
  options: RunOptions,
): Promise<AppServer> => {
  const app = await createAppServer({
    engine,
    paths,
    version: VERSION,
  });
  // 启动前查找空闲端口：未指定端口（0）时随机分配；指定端口被占用时回退随机。
  const preferred = options.port === 0 ? undefined : options.port;
  let port = await getPort(
    preferred === undefined
      ? { host: options.host }
      : { host: options.host, port: preferred },
  );
  const listen = (attempt: number): Promise<number> =>
    app.listen(options.host, port).catch(async (error: unknown) => {
      // 查找与监听之间存在竞态窗口：仍冲突时重新查找再试一次。
      if (hasCode(error, "EADDRINUSE") && attempt < 1) {
        port = await getPort({ host: options.host });
        return listen(attempt + 1);
      }
      throw error;
    });
  const actualPort = await listen(0);
  if (preferred !== undefined && actualPort !== preferred)
    console.log(`端口 ${preferred} 已被占用，改用 ${actualPort}。`);
  console.log(`vpn-keepalive 已启动
界面: http://${options.host}:${actualPort}
配置: ${paths.config}
日志: ${paths.logs}
按 Ctrl+C 停止`);
  // 交互式终端自动用默认浏览器打开；管道/CI 等非交互环境仅输出地址。
  if (stdout.isTTY) {
    const browserHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
    openBrowser(`http://${browserHost}:${actualPort}`);
  }
  return app;
};

/** 关闭 Web 服务并等待连接排空。 */
const stopUi = async (app: AppServer): Promise<void> => {
  app.server.closeAllConnections();
  await new Promise<void>((resolveClosed) =>
    app.server.close(() => resolveClosed()),
  );
};

/** 启动保活引擎与 Web 界面，收到 SIGINT/SIGTERM 后干净退出。 */
const run = async (options: RunOptions): Promise<void> => {
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw new Error("需要 Node.js 20 或更新版本。");
  const paths = getPaths(options.dataDir);
  const config = await loadOrCreateConfig(paths.config);
  const lock = await acquireLock(paths.lockDir);
  const lifecycle = new AbortController();
  const onSigint = () => {
    console.log("\n收到 SIGINT，正在停止…");
    lifecycle.abort();
  };
  const onSigterm = () => lifecycle.abort();
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const engine = new KeepaliveEngine(config, paths, lifecycle.signal);
    engine.start();
    const app = await startUi(engine, paths, options);
    await new Promise<void>((resolveStop) => {
      // 等待前信号可能已中止（如启动期间 Ctrl+C），直接放行避免挂起。
      if (lifecycle.signal.aborted) resolveStop();
      else
        lifecycle.signal.addEventListener("abort", () => resolveStop(), {
          once: true,
        });
    });
    await stopUi(app);
    await engine.stop();
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    await lock.release().catch(() => {});
  }
};

const program = new Command();

program
  .name("vpn-keepalive")
  .description(
    "可配置多地址的 HTTP 保活工具，默认启动 Web 界面并自动打开浏览器，Ctrl+C 停止。",
  )
  .usage("[选项]")
  .version(VERSION, "-V, --version", "查看版本")
  .helpOption("-h, --help", "查看帮助")
  .option(
    "--port <端口>",
    "Web 界面端口；未指定时由 get-port 查找空闲端口，指定后被占用则回退随机端口",
    parsePort,
    0,
  )
  .option("--host <地址>", "监听地址，仅本机访问，无需鉴权", "127.0.0.1")
  .option("--data-dir <目录>", "覆盖数据根目录，用于隔离运行")
  .showHelpAfterError("(使用 --help 查看帮助)")
  .action((options: RunOptions) => {
    void run(options);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
