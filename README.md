# aTrust Keepalive

随 aTrust 主客户端启停的 HTTP GET 保活工具。支持 macOS、Windows，要求 Node.js 24+。运行时仅使用 Node 原生能力，不需要 Vite、pnpm 或源码仓库。

## 安装与使用

由维护者提供构建后的 `cbn-bass-atrust-keepalive-0.1.0.tgz`，成员执行：

```bash
npm install -g ./cbn-bass-atrust-keepalive-0.1.0.tgz
atrust-keepalive install
atrust-keepalive status
```

安装会复制运行文件到当前用户的数据目录、注册自动启动项并立即启动。以后登录系统自动待机，检测到 aTrust 主客户端后立即保活；退出客户端后取消请求并待机。关闭窗口、最小化、注销或断网不停止监听器，网络失败会记录日志并在下一周期继续尝试。

macOS 使用当前用户的 LaunchAgent，Windows 使用当前用户的登录触发任务、交互登录令牌和普通权限。Windows 后台窗口隐藏，不依赖管理员身份，不存储登录密码；任务不会因运行超过三天或切换电池而停止，异常退出后每分钟重试，最多三次。系统策略拒绝创建任务时，安装报错并回滚，不修改系统策略。

手动前台运行（与已安装监听器共用数据目录时只允许一个实例）：

```bash
atrust-keepalive run
atrust-keepalive run --config ./config.json
```

卸载后台工具：

```bash
atrust-keepalive uninstall
npm uninstall -g @cbn-bass/atrust-keepalive
```

先执行工具的 `uninstall`，再移除 npm 包。卸载停止监听器，移除启动项和运行文件，保留配置、状态与日志；重新安装时沿用配置。

## 配置

复制 `config.example.json` 并按需修改：

```json
{
  "url": "http://10.249.12.234",
  "intervalMinutes": 1,
  "timeoutMs": 10000,
  "processPollIntervalMs": 3000
}
```

```bash
atrust-keepalive install --config ./config.json
```

| 字段                    | 默认值                                     | 约束                                         |
| ----------------------- | ------------------------------------------ | -------------------------------------------- |
| `url`                   | `http://10.249.12.234`                     | 非空 HTTP/HTTPS URL                          |
| `intervalMinutes`       | `1`                                        | 正数，换算后至少 1ms，最大 2147483647ms      |
| `timeoutMs`             | `10000`                                    | 正整数毫秒，最大 2147483647                  |
| `processPollIntervalMs` | `3000`                                     | 正整数毫秒，最大 2147483647                  |
| `processName`           | macOS：`aTrust`；Windows：`aTrustTray.exe` | 可选；主进程名，不能包含路径、引号或特殊字符 |

未提供的字段使用默认值。未知字段、空 URL、非 HTTP/HTTPS URL、无效数值或进程名会在请求和注册启动项前报错。修改安装后的配置文件，重新执行 `atrust-keepalive install` 生效；传入 `--config` 会替换已有配置，不传则保留原配置。

## 状态、日志与数据目录

`status` 输出 JSON，包括启动项是否注册、监听器是否运行、客户端 PID、检测错误、最近请求结果、运行错误、配置路径、日志路径和安装时记录的 Node 路径。监听器运行状态包括 `waiting`、`active`、`detection-error`；停止后显示 `stopped`。

默认数据目录：

- macOS：`~/Library/Application Support/CBN/aTrustKeepalive`
- Windows：`%LOCALAPPDATA%\CBN\aTrustKeepalive`

目录中包含 `config.json`、独立运行文件 `runtime/`、`installation.json`、`state.json`、实例锁和 `logs/`。日志为 `keepalive.log`、`.1`、`.2`，单文件最多 2MB，总计最多三个；请求不保存响应正文。

所有命令支持 `--data-dir <目录>`，用于独立配置或隔离验证。不同目录产生不同启动项名称；自定义安装后，查询、更新和卸载必须传入同一目录。

```bash
atrust-keepalive install --config ./config.json --data-dir "./独立 配置"
atrust-keepalive status --data-dir "./独立 配置"
atrust-keepalive uninstall --data-dir "./独立 配置"
```

同一数据目录使用 PID、启动时间和入口身份校验防止重复运行，异常退出留下的实例锁会自动恢复。安装和卸载也使用互斥锁；安装失败撤销新增启动项并恢复之前的运行文件、配置与启动项。

## 生命周期与限制

- macOS 匹配当前用户的主进程完整名称；Windows 匹配当前登录会话的主进程完整名称。不会匹配 Helper、Agent、Tunnel 或其他用户的会话。
- 每 3 秒检测一次，检测命令超时为 2 秒；正常负载下启停响应目标为 5 秒以内。进程检测失败会暂停请求，恢复后重新判断。
- 最多一个保活请求并行。请求未结束时跳过周期；退出或更换主进程 PID 时取消旧周期及进行中的请求。系统休眠时不工作，恢复后不会补发积压请求。
- 以主进程退出为停止条件，HTTP 成功不代表 aTrust 已认证，也不保证延长服务端规定的绝对会话时限。
- Windows 的默认 `aTrustTray.exe` 来自深信服客户端进程清单；不同客户端版本必须确认“退出客户端”确实退出该主进程，必要时覆盖 `processName`。
- 安装记录 Node 可执行文件的绝对路径。nvm 切换版本后保留旧路径可继续运行；删除、迁移旧 Node 目录后，需要用新 Node 重新执行 `install`。

## 开发与分发

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run verify:integration
npm pack
```

`npm run verify:integration` 使用本地 HTTP 服务、受控生命周期及隔离目录检查调度、取消、错误恢复和实例锁，不修改真实 aTrust。需要验证真实系统启动项时执行 `npm run verify:integration -- --service`，会创建独立名称的临时启动项并在结束时卸载。macOS 验证使用临时 LaunchAgent 文件，仍需另行验证真实用户目录中的下次登录启动。

`npm pack` 自动构建，产物不包含源码和开发依赖。升级时安装新 `.tgz` 后再次执行 `atrust-keepalive install`，无自定义配置参数时保留原配置。

源自经营分析项目的 `vite-dev-keepalive`，原项目已移除旧包和 Dashboard、Admin 接入。现在启动开发服务不会自动创建保活任务，成员需单独安装此工具。

## 平台参考

- [Apple LaunchAgent 文档](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Microsoft 任务计划设置](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset)
- [深信服 aTrust 客户端进程清单](https://bbs.sangfor.com.cn/atrustdeveloper/aTrustClient/docs/9.%E7%AC%AC%E4%B8%89%E6%96%B9%E8%BD%AF%E4%BB%B6%E5%86%B2%E7%AA%81/9.2%E5%B7%B2%E7%9F%A5%E5%86%B2%E7%AA%81%E7%B1%BB%E8%BD%AF%E4%BB%B6.html)
