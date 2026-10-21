import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import { parseConfig, saveConfig } from "./config.js";
import { errorMessage, hasCode, readOptional } from "./files.js";
import type { KeepaliveEngine } from "./engine.js";
import type { DataPaths } from "./paths.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface AppServer {
  server: Server;
  /** 开始监听；port 传 0 时由系统分配，返回实际端口。 */
  listen(host: string, port: number): Promise<number>;
}

interface AppServerOptions {
  engine: KeepaliveEngine;
  paths: DataPaths;
  version: string;
  webRoot?: string;
}

const JSON_HEADER = { "content-type": "application/json; charset=utf-8" };

function sendJson(response: ServerResponse, code: number, body: unknown): void {
  response.writeHead(code, JSON_HEADER);
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(
  webRoot: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const target = normalize(join(webRoot, relative));
  if (!target.startsWith(webRoot + sep) && target !== webRoot) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? join(webRoot, "index.html") : target;
    const content = await readFile(file);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      // 前端为单页应用，未知路径回退到入口页。
      try {
        const content = await readFile(join(webRoot, "index.html"));
        response.writeHead(200, {
          "content-type": MIME_TYPES[".html"] ?? "text/html",
        });
        response.end(content);
        return;
      } catch {
        // Web 资源缺失（如开发模式），继续返回 404。
      }
    }
    response.writeHead(404);
    response.end("Not Found");
  }
}

export async function createAppServer(
  options: AppServerOptions,
): Promise<AppServer> {
  const { engine, paths, version } = options;
  // 默认使用产物旁的 web 目录；从源码运行（tsx dev）时回退到 dist/web。
  const sourceRoot = fileURLToPath(new URL("./web", import.meta.url));
  const buildRoot = fileURLToPath(new URL("../dist/web", import.meta.url));
  let defaultRoot = sourceRoot;
  try {
    await stat(sourceRoot);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
    defaultRoot = buildRoot;
  }
  const webRoot = options.webRoot ?? defaultRoot;

  const readConfig = async (): Promise<Config> => {
    const text = await readOptional(paths.config);
    if (text === null) throw new Error("配置文件不存在。");
    return parseConfig(JSON.parse(text));
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/api/config" && request.method === "GET") {
        sendJson(response, 200, {
          config: await readConfig(),
          configPath: paths.config,
        });
        return;
      }
      if (url.pathname === "/api/config" && request.method === "PUT") {
        try {
          const config = parseConfig(JSON.parse(await readBody(request)));
          await saveConfig(paths.config, config);
          engine.applyConfig(config);
          sendJson(response, 200, { config, configPath: paths.config });
        } catch (error) {
          sendJson(response, 400, { error: errorMessage(error) });
        }
        return;
      }
      if (url.pathname === "/api/logs" && request.method === "GET") {
        const requested = Number(url.searchParams.get("lines") ?? "200");
        const count =
          Number.isInteger(requested) && requested >= 1 && requested <= 1_000
            ? requested
            : 200;
        const logPath = join(paths.logs, "keepalive.log");
        const text = await readOptional(logPath);
        const all =
          text === null ? [] : text.split("\n").filter((line) => line !== "");
        sendJson(response, 200, {
          lines: all.slice(-count),
          total: all.length,
          logPath,
        });
        return;
      }
      if (url.pathname === "/api/trigger" && request.method === "POST") {
        if (!engine.getConfig().url) {
          sendJson(response, 400, {
            error: "未选择保活地址，请先在配置中选择活动地址。",
          });
          return;
        }
        await engine.triggerNow();
        sendJson(response, 200, {
          lastRequest: engine.getStatus().lastRequest,
        });
        return;
      }
      if (url.pathname === "/api/status" && request.method === "GET") {
        const status = engine.getStatus();
        sendJson(response, 200, {
          ...status,
          uptimeMs: Date.now() - Date.parse(status.startedAt),
          dataRoot: paths.root,
          configPath: paths.config,
          logPath: join(paths.logs, "keepalive.log"),
          pid: process.pid,
          version,
        });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "接口不存在。" });
        return;
      }
      await serveStatic(webRoot, url.pathname, response);
    })().catch((error: unknown) => {
      sendJson(response, 500, { error: errorMessage(error) });
    });
  });

  return {
    server,
    listen(host, port) {
      return new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, host, () => {
          const address = server.address();
          resolveListen(
            typeof address === "object" && address ? address.port : port,
          );
        });
      });
    },
  };
}
