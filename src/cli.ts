#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
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
}

interface UiOptions extends RunOptions {
  port: number;
  host: string;
}

/** 启动 Web 界面并输出访问地址；端口被占用时自动改用随机端口。 */
const startUi = async (
  engine: KeepaliveEngine,
  paths: DataPaths,
  ui: UiOptions,
): Promise<AppServer> => {
  const app = await createAppServer({
    engine,
    paths,
    version: VERSION,
  });
  let port = ui.port;
  const listen = (attempt: number): Promise<number> =>
    app.listen(ui.host, port).catch((error: unknown) => {
      // 默认端口被占用时自动改用随机端口，便于多实例共存。
      if (hasCode(error, "EADDRINUSE") && attempt < 1 && port !== 0) {
        console.log(`端口 ${port} 已被占用，改用随机端口。`);
        port = 0;
        return listen(attempt + 1);
      }
      throw error;
    });
  const actualPort = await listen(0);
  console.log(`vpn-keepalive ui 已启动
界面: http://${ui.host}:${actualPort}
配置: ${paths.config}
日志: ${paths.logs}
按 Ctrl+C 停止`);
  return app;
};

/** 关闭 Web 服务并等待连接排空。 */
const stopUi = async (app: AppServer): Promise<void> => {
  app.server.closeAllConnections();
  await new Promise<void>((resolveClosed) =>
    app.server.close(() => resolveClosed()),
  );
};

/** 启动保活引擎与可选的 Web 界面，收到 SIGINT/SIGTERM 后干净退出。 */
const run = async (options: RunOptions, ui?: UiOptions): Promise<void> => {
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
    const app = ui ? await startUi(engine, paths, ui) : undefined;
    if (!ui)
      console.log(`vpn-keepalive 已启动
配置: ${paths.config}
日志: ${paths.logs}
提示: 运行 vpn-keepalive ui 可启动 Web 界面
按 Ctrl+C 停止`);
    await new Promise<void>((resolveStop) => {
      lifecycle.signal.addEventListener("abort", () => resolveStop(), {
        once: true,
      });
    });
    if (app) await stopUi(app);
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
    "可配置多地址的 HTTP 保活工具，默认仅运行保活引擎，Ctrl+C 停止。",
  )
  .usage("[命令] [选项]")
  .version(VERSION, "-V, --version", "查看版本")
  .helpOption("-h, --help", "查看帮助")
  .option("--data-dir <目录>", "覆盖数据根目录，用于隔离运行")
  .showHelpAfterError("(使用 --help 查看帮助)")
  .action((options: RunOptions) => run(options));

program
  .command("ui")
  .description("启动保活引擎与 Web 界面，在界面中配置保活地址。")
  .option(
    "--port <端口>",
    "Web 界面端口，被占用时自动改用随机端口",
    parsePort,
    3777,
  )
  .option("--host <地址>", "监听地址，仅本机访问，无需鉴权", "127.0.0.1")
  .option("--data-dir <目录>", "覆盖数据根目录，用于隔离运行")
  .showHelpAfterError("(使用 --help 查看帮助)")
  // commander 15 中程序级选项（--data-dir）即使写在子命令后也归入程序层，
  // 因此这里用 optsWithGlobals 合并程序级与子命令级选项。
  .action((_: unknown, command: Command) => {
    const options = command.optsWithGlobals() as UiOptions;
    void run(options, options);
  });

program.parseAsync().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
