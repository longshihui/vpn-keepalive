import { existsSync } from "node:fs";

if (
  process.env.HUSKY !== "0" &&
  !process.env.CI &&
  process.env.NODE_ENV !== "production" &&
  existsSync(".git")
) {
  try {
    const { default: husky } = await import("husky");
    const message = husky();
    if (message) console.log(message);
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
}
