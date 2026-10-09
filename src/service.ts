import { rm } from "node:fs/promises";
import type { Platform } from "./config.js";
import { readOptional, record, writeAtomic } from "./files.js";
import type { DataPaths } from "./paths.js";
import { command, powershell, powershellPath, psQuote } from "./processes.js";

export const xmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export function macDefinition(paths: DataPaths, node: string): string {
  const args = [
    node,
    paths.entry,
    "run",
    "--config",
    paths.config,
    "--data-dir",
    paths.root,
  ]
    .map((value) => `<string>${xmlEscape(value)}</string>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${xmlEscape(paths.serviceName)}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
}

export function windowsDefinition(
  paths: DataPaths,
  node: string,
  sid: string,
): string {
  const script = `$ErrorActionPreference = 'Stop'; & ${psQuote(node)} ${psQuote(paths.entry)} 'run' '--config' ${psQuote(paths.config)} '--data-dir' ${psQuote(paths.root)}; exit $LASTEXITCODE`;
  const args = `-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEscape(sid)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Author"><UserId>${xmlEscape(sid)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
<Actions Context="Author"><Exec><Command>${xmlEscape(powershellPath())}</Command><Arguments>${xmlEscape(args)}</Arguments></Exec></Actions>
</Task>`;
}

export interface Service {
  definition(): Promise<string | null>;
  createDefinition(node: string): Promise<string>;
  deactivate(): Promise<void>;
  remove(): Promise<void>;
  register(definition: string): Promise<void>;
}

function missingMacService(error: unknown): boolean {
  return (
    record(error) &&
    typeof error.stderr === "string" &&
    (/could not find service|service not found/i.test(error.stderr) ||
      (error.code === 3 && /no such process/i.test(error.stderr)))
  );
}

export function createService(platform: Platform, paths: DataPaths): Service {
  if (platform === "darwin") {
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error("无法读取当前用户 UID。");
    const domain = `gui/${uid}`;
    const target = `${domain}/${paths.serviceName}`;
    const deactivate = async () => {
      try {
        await command("/bin/launchctl", ["print", target], 10_000);
      } catch (error) {
        if (missingMacService(error)) return;
        throw error;
      }
      try {
        await command("/bin/launchctl", ["bootout", target], 10_000);
      } catch (error) {
        if (!missingMacService(error)) throw error;
      }
    };
    return {
      definition: () => readOptional(paths.plist),
      createDefinition: async (node) => macDefinition(paths, node),
      deactivate,
      async remove() {
        await deactivate();
        await rm(paths.plist, { force: true });
      },
      async register(definition) {
        await writeAtomic(paths.plist, definition);
        await command(
          "/bin/launchctl",
          ["bootstrap", domain, paths.plist],
          15_000,
        );
      },
    };
  }
  const name = psQuote(paths.serviceName);
  const lookup = `$t = Get-ScheduledTask -TaskPath '\\' | Where-Object { $_.TaskName -eq ${name} };`;
  return {
    async definition() {
      const output = await powershell(
        `${lookup} if ($null -ne $t) { Export-ScheduledTask -TaskName ${name} -TaskPath '\\' }`,
        15_000,
      );
      return output || null;
    },
    async createDefinition(node) {
      const sid = await powershell(
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
      );
      if (!/^S-\d+(?:-\d+)+$/.test(sid))
        throw new Error("无法读取当前 Windows 用户 SID。");
      return windowsDefinition(paths, node, sid);
    },
    async deactivate() {
      await powershell(
        `${lookup} if ($null -ne $t) { Disable-ScheduledTask -TaskName ${name} -TaskPath '\\' | Out-Null }`,
        15_000,
      );
    },
    async remove() {
      await powershell(
        `${lookup} if ($null -ne $t) { Stop-ScheduledTask -TaskName ${name} -TaskPath '\\'; Unregister-ScheduledTask -TaskName ${name} -TaskPath '\\' -Confirm:$false }`,
        15_000,
      );
    },
    async register(definition) {
      await powershell(
        `Register-ScheduledTask -TaskName ${name} -TaskPath '\\' -Xml ${psQuote(definition)} -Force | Out-Null; Start-ScheduledTask -TaskName ${name} -TaskPath '\\'`,
        20_000,
      );
    },
  };
}
