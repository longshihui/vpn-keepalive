import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { parseUrl } from "./config.js";
import { errorMessage } from "./files.js";

/** 确认是否现在新增地址；空输入或 y/yes 视为确认，n/no 视为拒绝。 */
async function askConfirm(
  rl: Interface,
  signal: AbortSignal,
): Promise<boolean> {
  for (;;) {
    const answer = (
      await rl.question("未配置保活地址，是否现在添加？(Y/n) ", { signal })
    )
      .trim()
      .toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    console.log("请输入 y 或 n。");
  }
}

/** 逐个输入保活地址并即时校验；空行结束，返回新增地址（可能为空）。 */
async function askUrls(rl: Interface, signal: AbortSignal): Promise<string[]> {
  const urls: string[] = [];
  for (;;) {
    const query =
      urls.length === 0
        ? "请输入保活地址（HTTP/HTTPS，直接回车结束）："
        : "继续输入其他地址，直接回车结束：";
    const input = (await rl.question(query, { signal })).trim();
    if (input === "") return urls;
    try {
      const url = parseUrl(input, "保活地址");
      if (urls.includes(url)) {
        console.log("该地址已添加，请输入其他地址。");
        continue;
      }
      urls.push(url);
      console.log(`已添加：${url}`);
    } catch (error) {
      console.log(errorMessage(error));
    }
  }
}

/**
 * 命令行交互引导新增保活地址。
 * 返回新增地址列表（可能为空）；用户拒绝或中止（Ctrl+C/SIGTERM）时返回 null。
 */
export async function promptAddUrls(
  signal: AbortSignal,
): Promise<string[] | null> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!(await askConfirm(rl, signal))) return null;
    return await askUrls(rl, signal);
  } catch (error) {
    // 引导期间外部信号中止视为放弃新增，交由调用方走停止流程。
    if (signal.aborted) return null;
    throw error;
  } finally {
    rl.close();
  }
}
