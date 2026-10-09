import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Platform } from "./config.js";

export interface DataPaths {
  root: string;
  config: string;
  runtime: string;
  entry: string;
  lock: string;
  stop: string;
  state: string;
  logs: string;
  metadata: string;
  installLock: string;
  serviceName: string;
  plist: string;
}

export function getPaths(platform: Platform, override?: string): DataPaths {
  const root = resolve(
    override ??
      (platform === "darwin"
        ? join(
            homedir(),
            "Library",
            "Application Support",
            "CBN",
            "aTrustKeepalive",
          )
        : join(
            process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
            "CBN",
            "aTrustKeepalive",
          )),
  );
  const suffix = createHash("sha256").update(root).digest("hex").slice(0, 12);
  const serviceName =
    platform === "darwin"
      ? `com.cbn.atrust-keepalive.${suffix}`
      : `CBN-aTrustKeepalive-${suffix}`;
  return {
    root,
    config: join(root, "config.json"),
    runtime: join(root, "runtime"),
    entry: join(root, "runtime", "cli.js"),
    lock: join(root, "run.lock"),
    stop: join(root, "stop.json"),
    state: join(root, "state.json"),
    logs: join(root, "logs"),
    metadata: join(root, "installation.json"),
    installLock: join(root, "install.lock"),
    serviceName,
    plist: join(homedir(), "Library", "LaunchAgents", `${serviceName}.plist`),
  };
}
