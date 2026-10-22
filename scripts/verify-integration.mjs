import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseConfig, saveConfig } from "../dist/config.js";
import { KeepaliveEngine } from "../dist/engine.js";
import { acquireLock, readOwner } from "../dist/lock.js";
import { Logger } from "../dist/logger.js";
import { getPaths } from "../dist/paths.js";
import { createAppServer } from "../dist/server.js";

const directory = await mkdtemp(join(tmpdir(), "vpn-keepalive-验证-"));
const cli = resolve("dist/cli.js");
const children = new Set();
let requests = 0;
let active = 0;
let maxActive = 0;
let measureOverlap = true;
let behavior = "ok";

const server = createServer((request, response) => {
  requests++;
  active++;
  if (measureOverlap) maxActive = Math.max(maxActive, active);
  response.on("close", () => {
    active--;
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

/** 读取 state.json；文件尚未生成时返回空对象继续轮询。 */
async function readState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function childRun(args) {
  const child = spawn(process.execPath, [cli, ...args], {
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

async function waitForPort(child, timeout = 10_000) {
  let text = "";
  child.stdout.on("data", (chunk) => {
    text += chunk;
  });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const match = /界面: http:\/\/127\.0\.0\.1:(\d+)/.exec(text);
    if (match?.[1]) return Number(match[1]);
    await delay(20);
  }
  throw new Error("等待 CLI 输出界面地址超时");
}

let engine;
let lifecycle;
let appServer;

try {
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  const paths = getPaths(join(directory, "引擎"));

  // 1. 配置与存储设置校验。
  for (const invalid of [
    { urls: ["http://a.com", "http://a.com/"] },
    { urls: ["file:///tmp/example"] },
    { urls: "http://a.com" },
    { intervalMinutes: -1 },
    { intervalMinutes: 0 },
    { intervalMinutes: 0.5 },
    { intervalMinutes: 1.0001 },
    { timeoutMs: 0 },
    { unknown: 1 },
  ]) {
    assert.throws(() => parseConfig(invalid), Error, JSON.stringify(invalid));
  }
  assert.deepEqual(parseConfig({}), {
    urls: [],
    intervalMinutes: 1,
    timeoutMs: 10_000,
  });
  // 旧版“活动地址”字段被静默忽略，兼容既有配置文件。
  assert.deepEqual(
    parseConfig({ url: "http://example.com", urls: ["http://a.com"] }),
    { urls: ["http://a.com/"], intervalMinutes: 1, timeoutMs: 10_000 },
  );
  console.log("通过：配置默认值、旧字段兼容与整分钟间隔校验。");

  // 2. 引擎生命周期（直接构造配置对象以使用亚分钟周期，间隔校验在配置层）。
  const fastConfig = {
    urls: [url],
    intervalMinutes: 0.0015,
    timeoutMs: 260,
  };
  lifecycle = new AbortController();
  engine = new KeepaliveEngine(fastConfig, paths, lifecycle.signal);
  const state = async () => readState(paths.state);
  engine.start();
  await until(async () => {
    const current = await state();
    return (
      current.lastRequest?.outcome === "success" &&
      current.lastRequest?.url === url
    );
  }, "首次成功请求（结果含请求地址）");
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
  // 热更新中止在途请求后必须立即按新配置重发，不等下一周期。
  const beforeReload = requests;
  // 客户端中止已完成时，服务端的 close 事件可能尚未到达。
  measureOverlap = false;
  engine.applyConfig({ ...fastConfig });
  await until(() => requests > beforeReload, "热更新中止在途后立即重发");
  await until(() => active === 1, "重发后的在途请求");
  measureOverlap = true;
  const beforeSlow = requests;
  await delay(150);
  assert.equal(requests, beforeSlow, "在途请求期间不得重叠");
  await until(
    async () => (await state()).lastRequest?.outcome === "timeout",
    "请求超时",
  );
  // 热更新：清空地址列表（待机零请求），再切回恢复。
  const beforePause = requests;
  engine.applyConfig({ ...fastConfig, urls: [] });
  await until(async () => (await state()).status === "waiting", "热更新后待机");
  await delay(200);
  assert.equal(requests, beforePause, "待机期间零请求");
  engine.applyConfig({ ...fastConfig });
  assert.deepEqual(engine.getConfig(), fastConfig, "getConfig 返回当前配置");
  await until(() => active === 1, "恢复后的在途请求");
  const beforeStop = requests;
  lifecycle.abort();
  await until(() => active === 0, "停止取消在途请求");
  await delay(160);
  assert.equal(requests, beforeStop, "停止后不得继续请求");
  await until(
    async () => (await state()).status === "stopped",
    "状态落盘 stopped",
  );
  assert.equal(maxActive, 1, "请求始终不重叠");
  console.log(
    "通过：立即/周期请求、错误分类、超时、不重叠、热更新（在途中止后立即重发、暂停与恢复）、getConfig、停止取消在途请求。",
  );

  // 3. 地址列表为空时待机零请求。
  {
    const idlePaths = getPaths(join(directory, "待机"));
    const idleLifecycle = new AbortController();
    const idleEngine = new KeepaliveEngine(
      {
        urls: [],
        intervalMinutes: 0.002,
        timeoutMs: 10_000,
      },
      idlePaths,
      idleLifecycle.signal,
    );
    const beforeIdle = requests;
    idleEngine.start();
    await until(
      async () => (await readState(idlePaths.state)).status === "waiting",
      "进入待机",
    );
    await delay(200);
    assert.equal(requests, beforeIdle, "未配置地址时零请求");
    await idleEngine.stop();
    idleLifecycle.abort();
    console.log("通过：未配置地址时待机、零请求。");
  }

  // 4. 实例锁：同目录二次启动拒绝；陈旧锁可抢占。
  {
    const lockDir = join(directory, "锁");
    const lock = await acquireLock(lockDir);
    await assert.rejects(acquireLock(lockDir), /已有实例/);
    await lock.release();
    assert.equal(await readOwner(lockDir), null);
    await mkdir(join(lockDir, "nested"), { recursive: true });
    await writeFile(
      join(lockDir, "owner.json"),
      JSON.stringify({
        pid: 999_999_999,
        token: "stale",
        startedAt: "2026-01-01T00:00:00Z",
      }),
    );
    const recovered = await acquireLock(lockDir);
    await recovered.release();
    console.log("通过：实例锁互斥与陈旧锁抢占。");
  }

  // 5. API：配置读写、状态与日志接口。
  {
    behavior = "ok";
    const apiPaths = getPaths(join(directory, "api"));
    const apiConfig = parseConfig({
      urls: [url],
      intervalMinutes: 1,
      timeoutMs: 5000,
    });
    await saveConfig(apiPaths.config, apiConfig);
    const apiLifecycle = new AbortController();
    const apiEngine = new KeepaliveEngine(
      apiConfig,
      apiPaths,
      apiLifecycle.signal,
    );
    apiEngine.start();
    appServer = await createAppServer({
      engine: apiEngine,
      paths: apiPaths,
      version: "test",
      webRoot: join(directory, "no-web"),
    });
    const port = await appServer.listen("127.0.0.1", 0);
    const base = `http://127.0.0.1:${port}`;
    const initial = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(initial.config, apiConfig);
    assert.equal(initial.configPath, apiPaths.config);
    const bad = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intervalMinutes: 0.002 }),
    });
    assert.equal(bad.status, 400, "非整数分钟必须被拒绝");
    const beforePut = requests;
    const good = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        urls: [url],
        intervalMinutes: 1,
        timeoutMs: 1000,
      }),
    });
    assert.equal(good.status, 200);
    const saved = JSON.parse(await readFile(apiPaths.config, "utf8"));
    assert.equal(saved.intervalMinutes, 1);
    await until(() => requests > beforePut, "热更新后立即请求");
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.urlsCount, 1);
    assert.ok(["active", "waiting"].includes(status.status));
    assert.ok(Number.isFinite(status.uptimeMs));
    assert.equal(status.pid, process.pid);
    assert.equal(status.dataRoot, apiPaths.root);
    assert.equal(status.configPath, apiPaths.config);
    assert.equal(status.logPath, join(apiPaths.logs, "keepalive.log"));
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 404, "Web 资源缺失时回退 404");

    // 手动触发接口：地址列表为空时返回 400。
    const idle = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        urls: [],
        intervalMinutes: 1,
        timeoutMs: 1000,
      }),
    });
    assert.equal(idle.status, 200);
    const noUrl = await fetch(`${base}/api/trigger`, { method: "POST" });
    assert.equal(noUrl.status, 400, "未配置地址时触发必须被拒绝");

    // 日志接口：尾部行数、路径、格式。
    const logsResponse = await (await fetch(`${base}/api/logs?lines=3`)).json();
    assert.ok(Array.isArray(logsResponse.lines));
    assert.ok(logsResponse.lines.length > 0 && logsResponse.lines.length <= 3);
    assert.match(logsResponse.lines.at(-1), /\[(info|success|warn|error)\]/);
    assert.equal(logsResponse.logPath, join(apiPaths.logs, "keepalive.log"));
    // 停止后：停止日志落盘；state 仍在数据根目录。
    appServer.server.closeAllConnections();
    await new Promise((resolveClose) => appServer.server.close(resolveClose));
    appServer = undefined;
    await apiEngine.stop();
    apiLifecycle.abort();
    const stoppedLog = await readFile(
      join(apiPaths.logs, "keepalive.log"),
      "utf8",
    );
    assert.match(stoppedLog, /保活已停止/);
    assert.ok(await readFile(apiPaths.state, "utf8"));
    console.log("通过：API 配置读写与整分钟校验、状态与日志接口。");
  }

  // 6. CLI 子进程：默认命令启动保活引擎与 Web 界面。
  {
    const cliDir = join(directory, "cli");
    // 预置配置：CLI 从数据目录加载并立即开始保活。
    const presetConfig = parseConfig({
      urls: [url],
      intervalMinutes: 1,
      timeoutMs: 2000,
    });
    await saveConfig(join(cliDir, "config.json"), presetConfig);

    const first = childRun(["--data-dir", cliDir]);
    const firstPort = await waitForPort(first.child);
    const firstBase = `http://127.0.0.1:${firstPort}`;
    const config = await (await fetch(`${firstBase}/api/config`)).json();
    assert.deepEqual(config.config, presetConfig);
    assert.equal(config.configPath, join(cliDir, "config.json"));
    const index = await fetch(`${firstBase}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type") ?? "", /text\/html/);

    // 手动触发：立即发一次请求并返回结果。
    const beforeTrigger = requests;
    const trigger = await fetch(`${firstBase}/api/trigger`, {
      method: "POST",
    });
    assert.equal(trigger.status, 200);
    const triggered = await trigger.json();
    await until(() => requests > beforeTrigger, "手动触发保活请求", 10_000);
    assert.equal(triggered.lastRequest?.outcome, "success");

    // 整分钟配置保存热生效。
    const beforeCliUi = requests;
    const put = await fetch(`${firstBase}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        urls: [url],
        intervalMinutes: 1,
        timeoutMs: 2000,
      }),
    });
    assert.equal(put.status, 200);
    await until(() => requests > beforeCliUi, "保存后立即请求", 10_000);
    const status2 = await (await fetch(`${firstBase}/api/status`)).json();
    assert.equal(status2.status, "active");
    first.child.kill("SIGTERM");
    const firstExit = await first.exited;
    // Windows 的 child.kill 会强制结束进程，无法触发 CLI 的信号清理。
    if (process.platform === "win32") {
      assert.equal(firstExit.signal, "SIGTERM");
    } else {
      assert.equal(firstExit.code, 0);
      assert.equal(await readOwner(join(cliDir, "run.lock")), null);
    }

    // 指定端口被占用时回退随机端口。
    const blocker = createServer(() => {});
    await new Promise((resolveBlock) =>
      blocker.listen(0, "127.0.0.1", resolveBlock),
    );
    const occupied = blocker.address().port;
    const second = childRun(["--data-dir", cliDir, "--port", String(occupied)]);
    const secondPort = await waitForPort(second.child);
    assert.notEqual(secondPort, occupied, "被占用端口必须回退随机端口");
    second.child.kill("SIGTERM");
    assert.equal((await second.exited).code, 0);
    await new Promise((resolveClose) => blocker.close(resolveClose));
    console.log(
      "通过：默认命令启动引擎与 Web 界面、指定端口被占用回退随机端口、手动触发保活、整分钟保存生效、SIGTERM 干净退出。",
    );
  }

  // 7. 日志行数上限：最多保留 10 行，超出丢弃最旧。
  {
    const logDirectory = join(directory, "日志");
    const capLogger = new Logger(logDirectory);
    for (let index = 0; index < 15; index++)
      capLogger.write("info", `行-${index}`);
    const files = await readdir(logDirectory);
    assert.equal(files.length, 1, "不得产生轮转文件");
    const lines = (await readFile(join(logDirectory, "keepalive.log"), "utf8"))
      .split("\n")
      .filter((line) => line !== "");
    assert.equal(lines.length, 10);
    assert.match(lines.at(-1), /行-14/);
    assert.match(lines[0], /行-5/);
    console.log("通过：日志 10 行上限。");
  }

  console.log("全部集成验证通过。");
} finally {
  lifecycle?.abort();
  if (appServer) {
    appServer.server.closeAllConnections();
    await new Promise((resolveClose) => appServer.server.close(resolveClose));
  }
  for (const child of children) child.kill("SIGTERM");
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(directory, { recursive: true, force: true });
}
