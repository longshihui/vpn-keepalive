#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { loadOrCreateConfig } from "./config.js";
import { errorMessage, hasCode } from "./files.js";
import { KeepaliveEngine } from "./engine.js";
import { acquireLock } from "./lock.js";
import { getPaths } from "./paths.js";
import { createAppServer } from "./server.js";

const VERSION = "0.2.0";

/** --port 取值校验：0-65535 的整数。 */
const parsePort = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new InvalidArgumentError("必须为 0-65535 的整数。");
  return parsed;
};

type CliOptions = {
  port: number;
  host: string;
  dataDir?: string;
};

/** 启动保活引擎与 Web 界面，收到 SIGINT/SIGTERM 后干净退出。 */
const run = async (options: CliOptions): Promise<void> => {
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
    const app = await createAppServer({
      engine,
      paths,
      version: VERSION,
    });
    const { host } = options;
    let port = options.port;
    const listen = (attempt: number): Promise<number> =>
      app.listen(host, port).catch((error: unknown) => {
        // 默认端口被占用时自动改用随机端口，便于多实例共存。
        if (hasCode(error, "EADDRINUSE") && attempt < 1 && port !== 0) {
          console.log(`端口 ${port} 已被占用，改用随机端口。`);
          port = 0;
          return listen(attempt + 1);
        }
        throw error;
      });
    const actualPort = await listen(0);
    console.log(`vpn-keepalive 已启动
界面: http://${host}:${actualPort}
配置: ${paths.config}
日志: ${paths.logs}
按 Ctrl+C 停止`);
    await new Promise<void>((resolveStop) => {
      lifecycle.signal.addEventListener("abort", () => resolveStop(), {
        once: true,
      });
    });
    app.server.closeAllConnections();
    await new Promise<void>((resolveClosed) =>
      app.server.close(() => resolveClosed()),
    );
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
    "可配置多地址的 HTTP 保活工具，运行后打开 Web 界面配置，Ctrl+C 停止。",
  )
  .usage("[选项]")
  .version(VERSION, "-V, --version", "查看版本")
  .helpOption("-h, --help", "查看帮助")
  .option(
    "--port <端口>",
    "Web 界面端口，被占用时自动改用随机端口",
    parsePort,
    3777,
  )
  .option("--host <地址>", "监听地址，仅本机访问，无需鉴权", "127.0.0.1")
  .option("--data-dir <目录>", "覆盖数据根目录，用于隔离运行")
  .showHelpAfterError("(使用 --help 查看帮助)")
  .action((options: CliOptions) => run(options));

program.parseAsync().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
