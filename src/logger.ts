import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { hasCode } from "./files.js";

const LIMIT = 2 * 1024 * 1024;

export class Logger {
  readonly path: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.path = join(directory, "keepalive.log");
  }
  write(level: "info" | "warn" | "error", message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message.replaceAll(/\r?\n/g, " ").slice(0, 8_000)}\n`;
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (size + Buffer.byteLength(line) > LIMIT) {
      rmSync(`${this.path}.2`, { force: true });
      try {
        renameSync(`${this.path}.1`, `${this.path}.2`);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      try {
        renameSync(this.path, `${this.path}.1`);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
    }
    appendFileSync(this.path, line, { mode: 0o600 });
  }
}
