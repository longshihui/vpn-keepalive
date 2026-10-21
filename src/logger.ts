import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hasCode } from "./files.js";

/** 日志最多保留的行数，超出时丢弃最旧的行。 */
const MAX_LINES = 10;

export class Logger {
  readonly path: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "keepalive.log");
  }
  write(level: "info" | "success" | "warn" | "error", message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message.replaceAll(/\r?\n/g, " ").slice(0, 8_000)}`;
    let previous = "";
    try {
      previous = readFileSync(this.path, "utf8");
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    const lines = previous.split("\n").filter((existing) => existing !== "");
    lines.push(line);
    writeFileSync(this.path, `${lines.slice(-MAX_LINES).join("\n")}\n`, {
      mode: 0o600,
    });
  }
}
