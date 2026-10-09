#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, supportedPlatform } from "./config.js";
import { errorMessage, readOptional } from "./files.js";
import { install, showStatus, uninstall } from "./installer.js";
import { readOwner } from "./lock.js";
import { Logger } from "./logger.js";
import { getPaths } from "./paths.js";
import { runMonitor } from "./runtime.js";

const help = `aTrust 保活工具（Node.js 24+，macOS / Windows）
用法：atrust-keepalive <run|install|status|uninstall> [选项]
  run                  前台运行，随主客户端启停请求
  install              复制运行文件并注册当前用户自动启动项
  status               查看监听器、客户端、请求结果及日志路径
  uninstall            停止并移除自动启动和运行文件，保留配置日志
  --config <文件>       run / install 使用的 JSON 配置
  --data-dir <目录>     可选，覆盖数据目录，用于独立安装或隔离验证
  --help               查看帮助
  --version            查看版本`;

const args = process.argv.slice(2);
let activeCommand: string | undefined;
let dataDirectory: string | undefined;
try {
  if (
    !args.length ||
    (args.length === 1 && ["--help", "-h"].includes(args[0] ?? ""))
  ) {
    console.log(help);
  } else if (args.length === 1 && args[0] === "--version") {
    console.log("0.1.0");
  } else {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("需要 Node.js 24 或更新版本。");
    activeCommand = args.shift();
    if (
      !["run", "install", "status", "uninstall"].includes(activeCommand ?? "")
    )
      throw new Error(`未知命令：${activeCommand}\n${help}`);
    let configPath: string | undefined;
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 2) {
      const option = args[index];
      const value = args[index + 1];
      if (
        !option ||
        !["--config", "--data-dir"].includes(option) ||
        !value ||
        value.startsWith("--") ||
        seen.has(option)
      )
        throw new Error(`无效或重复的选项：${option ?? ""}`);
      seen.add(option);
      if (option === "--config") configPath = resolve(value);
      else dataDirectory = resolve(value);
    }
    if (configPath && !["run", "install"].includes(activeCommand ?? ""))
      throw new Error("--config 仅用于 run / install。");
    const platform = supportedPlatform();
    const paths = getPaths(platform, dataDirectory);
    const entry = resolve(process.argv[1] ?? fileURLToPath(import.meta.url));
    if (activeCommand === "run") {
      const actualConfig =
        configPath ??
        ((await readOptional(paths.config)) !== null
          ? paths.config
          : fileURLToPath(new URL("./config.example.json", import.meta.url)));
      await runMonitor(
        await loadConfig(actualConfig, platform),
        paths,
        platform,
        { entry },
      );
    } else if (activeCommand === "install") {
      await install(paths, platform, entry, configPath);
    } else if (activeCommand === "status") {
      await showStatus(paths, platform);
    } else {
      await uninstall(paths, platform, entry);
    }
  }
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
  if (activeCommand === "run") {
    try {
      const paths = getPaths(supportedPlatform(), dataDirectory);
      if (!(await readOwner(paths.lock)))
        new Logger(paths.logs).write("error", errorMessage(error));
    } catch (loggingError) {
      console.error(`无法记录启动错误：${errorMessage(loggingError)}`);
    }
  }
}
