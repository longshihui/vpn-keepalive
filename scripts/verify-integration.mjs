import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { parseConfig, supportedPlatform } from "../dist/config.js";
import { readOwner } from "../dist/lock.js";
import { install } from "../dist/installer.js";
import { Logger } from "../dist/logger.js";
import { getPaths } from "../dist/paths.js";
import { runMonitor } from "../dist/runtime.js";
import { macDefinition, windowsDefinition } from "../dist/service.js";

const execute = promisify(execFile);
const platform = supportedPlatform();
const directory = await mkdtemp(join(tmpdir(), "atrust-集成 验证-"));
const entry = resolve(process.argv[1]);
const cli = resolve("dist/cli.js");
const children = new Set();
let requests = 0;
let closed = 0;
let behavior = "ok";
let active = 0;
let maxActive = 0;
let lifecycle;
let running;

const server = createServer((request, response) => {
  requests++;
  active++;
  maxActive = Math.max(maxActive, active);
  response.on("close", () => {
    active--;
    closed++;
  });
  if (behavior === "hang") return;
  if (behavior === "disconnect") {
    request.socket.destroy();
    return;
  }
  response.writeHead(behavior === "503" ? 503 : 200);
  response.end("ok");
});

async function until(predicate, description, timeout = 4_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`等待超时：${description}`);
}

function childRun(args, env = process.env) {
  const child = spawn(process.execPath, [cli, ...args], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      children.delete(child);
      resolveExit({ code, signal, stderr });
    });
  });
  return { child, exited };
}

try {
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  const paths = getPaths(platform, join(directory, "调度 状态"));
  const config = parseConfig(
    { url, intervalMinutes: 0.0015, timeoutMs: 260, processPollIntervalMs: 30 },
    platform,
  );
  let pids = [];
  let detectionFailure = false;
  lifecycle = new AbortController();
  running = runMonitor(config, paths, platform, {
    entry,
    signal: lifecycle.signal,
    detect: async () => {
      if (detectionFailure) throw new Error("模拟检测失败");
      return pids;
    },
  });
  const state = async () => JSON.parse(await readFile(paths.state, "utf8"));
  await until(async () => (await readOwner(paths.lock)) !== null, "实例启动");
  await delay(150);
  assert.equal(requests, 0, "客户端未运行时必须零请求");
  pids = [12345];
  await until(
    async () => (await state()).lastRequest?.outcome === "success",
    "首次成功请求",
  );
  await until(() => requests >= 2, "周期请求");
  behavior = "503";
  await until(
    async () => (await state()).lastRequest?.outcome === "http-error",
    "HTTP 错误",
  );
  behavior = "disconnect";
  await until(
    async () => (await state()).lastRequest?.outcome === "network-error",
    "网络错误",
  );
  behavior = "hang";
  await until(() => active === 1, "阻塞请求");
  const beforeSlow = requests;
  await delay(150);
  assert.equal(requests, beforeSlow, "在途请求期间不得重叠");
  await until(
    async () => (await state()).lastRequest?.outcome === "timeout",
    "请求超时",
  );
  await until(() => active === 1, "第二次阻塞请求");
  const beforeClose = closed;
  pids = [];
  await until(async () => (await state()).status === "waiting", "客户端退出");
  await until(() => closed > beforeClose, "退出取消在途请求");
  const stoppedCount = requests;
  await delay(160);
  assert.equal(requests, stoppedCount, "退出后不得继续请求");
  behavior = "ok";
  pids = [23456];
  await until(() => requests > stoppedCount, "重新打开恢复");
  const beforeRestart = requests;
  pids = [34567];
  await until(
    async () => (await state()).pids[0] === 34567 && requests > beforeRestart,
    "PID 更换立即恢复",
  );
  detectionFailure = true;
  await until(
    async () => (await state()).status === "detection-error",
    "检测失败暂停",
  );
  const paused = requests;
  await delay(160);
  assert.equal(requests, paused);
  detectionFailure = false;
  await until(() => requests > paused, "检测恢复");
  await assert.rejects(
    runMonitor(config, paths, platform, { entry, detect: async () => [] }),
    /已有实例/,
  );
  behavior = "hang";
  await until(() => active === 1, "停止前的在途请求");
  lifecycle.abort();
  await running;
  await until(() => active === 0, "监听器停止取消请求");
  assert.equal(await readOwner(paths.lock), null);
  assert.equal((await state()).status, "stopped");
  assert.equal(maxActive, 1);
  console.log(
    "通过：等待、立即/周期请求、HTTP/网络错误、超时、不重叠、退出取消、重新打开、PID 更换、检测恢复、单实例。",
  );

  for (const invalid of [
    { url: "file:///tmp/example" },
    { intervalMinutes: -1 },
    { timeoutMs: null },
    { processName: "evil'command" },
    { typo: 1 },
  ]) {
    const file = join(directory, "invalid.json");
    await writeFile(file, JSON.stringify(invalid));
    const result = await childRun([
      "run",
      "--config",
      file,
      "--data-dir",
      join(directory, "invalid"),
    ]).exited;
    assert.equal(result.code, 1);
  }
  console.log("通过：真实 CLI 拒绝无效配置。");

  const childPaths = getPaths(platform, join(directory, "异常 恢复"));
  const childConfig = join(directory, "child.json");
  await writeFile(
    childConfig,
    JSON.stringify({
      url,
      processName: "NoSuchKeepaliveProcess",
      processPollIntervalMs: 50,
    }),
  );
  const first = childRun([
    "run",
    "--config",
    childConfig,
    "--data-dir",
    childPaths.root,
  ]);
  await until(
    async () => (await readOwner(childPaths.lock))?.pid === first.child.pid,
    "子进程实例启动",
  );
  first.child.kill("SIGKILL");
  await first.exited;
  await mkdir(join(childPaths.lock, "recovering"));
  await writeFile(
    join(childPaths.lock, "recovering", "owner.json"),
    JSON.stringify(await readOwner(childPaths.lock)),
  );
  const second = childRun([
    "run",
    "--config",
    childConfig,
    "--data-dir",
    childPaths.root,
  ]);
  await until(
    async () => (await readOwner(childPaths.lock))?.pid === second.child.pid,
    "异常退出后恢复失效锁",
  );
  second.child.kill("SIGTERM");
  assert.equal((await second.exited).code, 0);
  console.log(
    "通过：真实进程 SIGKILL 后恢复、恢复过程残留锁恢复、SIGTERM 清理。",
  );

  if (platform === "darwin") {
    const processName = `KeepProbe${process.pid}`;
    const mainFile = join(directory, processName);
    const helperFile = join(directory, `${processName}H`);
    await copyFile("/bin/sleep", mainFile);
    await copyFile("/bin/sleep", helperFile);
    const probe = (file) => {
      const child = spawn(file, ["60"], { stdio: "ignore" });
      children.add(child);
      const exited = new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", () => {
          children.delete(child);
          resolveExit();
        });
      });
      return { child, exited };
    };
    const nativePaths = getPaths(platform, join(directory, "检测 生命周期"));
    const file = join(directory, "native.json");
    await writeFile(
      file,
      JSON.stringify({
        url,
        processName,
        intervalMinutes: 0.002,
        processPollIntervalMs: 50,
      }),
    );
    const helper = probe(helperFile);
    const monitor = childRun([
      "run",
      "--config",
      file,
      "--data-dir",
      nativePaths.root,
    ]);
    await until(async () => {
      try {
        return (
          JSON.parse(await readFile(nativePaths.state, "utf8")).status ===
          "waiting"
        );
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }, "真实检测器待机");
    const before = requests;
    await delay(150);
    assert.equal(requests, before, "名称相似的 Helper 不得触发保活");
    behavior = "ok";
    const main = probe(mainFile);
    await until(() => requests > before, "真实主进程启动触发请求");
    main.child.kill("SIGTERM");
    await main.exited;
    await until(
      async () =>
        JSON.parse(await readFile(nativePaths.state, "utf8")).status ===
        "waiting",
      "真实主进程退出停止请求",
    );
    const after = requests;
    await delay(160);
    assert.equal(requests, after);
    monitor.child.kill("SIGTERM");
    assert.equal((await monitor.exited).code, 0);
    helper.child.kill("SIGTERM");
    await helper.exited;
    console.log(
      "通过：macOS 真实主进程启动/退出触发保活，名称相似的 Helper 不触发。",
    );
  }

  const logDirectory = join(directory, "日志");
  const logger = new Logger(logDirectory);
  for (let index = 0; index < 700; index++)
    logger.write("info", "a".repeat(8_000));
  const files = await readdir(logDirectory);
  assert.equal(files.length, 3);
  for (const file of files)
    assert.ok((await stat(join(logDirectory, file))).size <= 2 * 1024 * 1024);
  const unusual = getPaths(platform, join(directory, "路径 '中文 & 空格"));
  const plist = macDefinition(unusual, "/path with space/node");
  assert.ok(plist.includes("&apos;") && plist.includes("&amp;"));
  const plistFile = join(directory, "service.plist");
  await writeFile(plistFile, plist);
  if (platform === "darwin")
    await execute("/usr/bin/plutil", ["-lint", plistFile]);
  const xml = windowsDefinition(
    unusual,
    "C:\\Program Files\\Node's\\node.exe",
    "S-1-5-21-123",
  );
  assert.ok(
    xml.includes("IgnoreNew") &&
      xml.includes("PT0S") &&
      xml.includes("InteractiveToken"),
  );
  const encoded = /-EncodedCommand ([A-Za-z\d+/=]+)/.exec(xml)?.[1];
  assert.ok(encoded);
  assert.ok(
    Buffer.from(encoded, "base64").toString("utf16le").includes("Node''s"),
  );
  console.log(
    "通过：日志轮转、中文/空格/引号路径、macOS plist 解析、Windows 启动定义与参数编码。",
  );

  if (process.argv.includes("--service")) {
    const servicePaths = getPaths(platform, join(directory, "独立 安装"));
    const env = process.env;
    const call = (args) =>
      execute(
        process.execPath,
        [cli, ...args, "--data-dir", servicePaths.root],
        { env, timeout: 60_000, windowsHide: true },
      );
    try {
      await call(["install", "--config", childConfig]);
      const firstStatus = JSON.parse((await call(["status"])).stdout);
      assert.ok(firstStatus.installed && firstStatus.running);
      assert.equal(firstStatus.client.pids.length, 0);
      await call(["install"]);
      assert.equal(
        JSON.parse(await readFile(servicePaths.config, "utf8")).processName,
        "NoSuchKeepaliveProcess",
      );
      const duplicate = await childRun(
        ["run", "--data-dir", servicePaths.root],
        env,
      ).exited;
      assert.equal(duplicate.code, 1);
      const invalidFile = join(directory, "invalid-install.json");
      await writeFile(invalidFile, '{"timeoutMs": -1}');
      await assert.rejects(call(["install", "--config", invalidFile]));
      assert.ok(JSON.parse((await call(["status"])).stdout).running);
    } catch (error) {
      console.error("启动项回归失败：", error.stderr ?? error);
      throw error;
    } finally {
      await call(["uninstall"]);
    }
    const final = JSON.parse((await call(["status"])).stdout);
    assert.equal(final.installed, false);
    assert.equal(final.running, false);
    assert.ok(await readFile(servicePaths.config, "utf8"));
    console.log(
      `通过：${platform} 真实隔离安装、立即启动、重复安装保留配置、单实例、配置失败不破坏现有安装、卸载并保留数据。`,
    );
    if (platform === "darwin") {
      const failedPaths = getPaths(platform, join(directory, "注册失败 回滚"));
      const agents = join(directory, "只读 启动项");
      const failedDefinitionPaths = {
        ...failedPaths,
        plist: join(agents, `${failedPaths.serviceName}.plist`),
      };
      await mkdir(agents, { recursive: true });
      await chmod(agents, 0o555);
      try {
        await assert.rejects(
          install(failedDefinitionPaths, platform, entry, childConfig),
          /安装失败并执行回滚/,
        );
        for (const file of [
          failedPaths.entry,
          failedPaths.config,
          failedPaths.metadata,
        ])
          await assert.rejects(readFile(file), { code: "ENOENT" });
        assert.equal(await readOwner(failedPaths.lock), null);
        assert.equal((await readdir(agents)).length, 0);
        console.log(
          "通过：真实注册写入失败后撤销新运行文件、配置、元数据和启动项。",
        );
      } finally {
        await chmod(agents, 0o700);
      }
    }
  }
} finally {
  lifecycle?.abort();
  await running?.catch(() => {});
  for (const child of children) child.kill("SIGTERM");
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(directory, { recursive: true, force: true });
}
