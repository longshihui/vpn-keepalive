#!/usr/bin/env node
import { loadOrCreateConfig } from "./config.js";
import { errorMessage, hasCode } from "./files.js";
import { KeepaliveEngine } from "./engine.js";
import { acquireLock } from "./lock.js";
import { getPaths } from "./paths.js";
import { loadSettings } from "./settings.js";
import { createAppServer } from "./server.js";

const VERSION = "0.2.0";

const help = `vpn-keepalive —— 可配置多地址的 HTTP 保活工具
用法：vpn-keepalive [选项]
  --port <端口>       Web 界面端口，默认 3777
  --host <地址>       监听地址，默认 127.0.0.1
  --data-dir <目录>   可选，覆盖配置数据目录
  --help              查看帮助
  --version           查看版本

运行后打开 Web 界面配置保活地址，配置保存在本地。Ctrl+C 停止。`;

const args = process.argv.slice(2);
let dataDirectory: string | undefined;
try {
  if (
    !args.length ||
    (args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
  ) {
    console.log(help);
  } else if (args.length === 1 && args[0] === "--version") {
    console.log(VERSION);
  } else {
    if (Number(process.versions.node.split(".")[0]) < 20)
      throw new Error("需要 Node.js 20 或更新版本。");
    let host = "127.0.0.1";
    let port = 3777;
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 2) {
      const option = args[index];
      const value = args[index + 1];
      if (
        !option ||
        !["--port", "--host", "--data-dir"].includes(option) ||
        !value ||
        value.startsWith("--") ||
        seen.has(option)
      )
        throw new Error(`无效或重复的选项：${option ?? ""}\n${help}`);
      seen.add(option);
      if (option === "--data-dir") dataDirectory = value;
      else if (option === "--port") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
          throw new Error("--port 必须为 0-65535 的整数。");
        port = parsed;
      } else host = value;
    }
    const basePaths = getPaths(dataDirectory);
    const settings = await loadSettings(basePaths.settings);
    const paths = getPaths(dataDirectory, settings);
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
        settings,
        version: VERSION,
      });
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
设置: ${paths.settings}
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
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
