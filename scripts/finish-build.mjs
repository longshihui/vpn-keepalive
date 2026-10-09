import { chmod, copyFile } from "node:fs/promises";

await copyFile("config.example.json", "dist/config.example.json");
await chmod("dist/cli.js", 0o755);
