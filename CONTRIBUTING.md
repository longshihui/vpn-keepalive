# 贡献指南

感谢关注 vpn-keepalive！本文档说明本地开发、调试与发布的完整流程。

## 开发环境

- Node.js 20+
- pnpm（包管理器，本仓库所有命令均基于 pnpm）
- 支持平台：macOS / Windows / Linux（CI 与本地验证均覆盖）

```bash
git clone <仓库地址>
cd vpn-keepalive
pnpm install
```

## 项目结构

```text
├── src/                 # 后端：Node 原生 TypeScript（运行时依赖仅 commander）
│   ├── cli.ts           # CLI 入口（bin，基于 commander）
│   ├── server.ts        # HTTP 服务：静态资源托管 + /api 路由
│   ├── engine.ts        # 保活引擎：调度、请求、状态
│   ├── config.ts        # config.json 读写与校验
│   ├── paths.ts         # 数据目录与文件路径解析（各 OS 约定目录）
│   ├── logger.ts        # 日志写入与轮转
│   ├── lock.ts          # 实例锁
│   └── files.ts         # 文件读写工具
├── web/                 # 前端：Vue3 + Vite + TypeScript + Naive UI
│   └── src/
│       ├── components/  # 页面区块组件
│       └── hooks/      # 组合式逻辑（跨组件 Hook）
├── scripts/             # 构建辅助与集成测试
└── dist/                # 构建产物（后端 dist/*.js，前端 dist/web/）
```

## 常用命令

```bash
pnpm dev                 # 本地调试：tsx watch 源码启动，数据隔离到 .dev-data，端口 3888
pnpm dev:web             # 前端 Vite 开发服务器（HMR，/api 代理到 3888）
pnpm typecheck           # 类型检查：tsc + vue-tsc
pnpm lint                # ESLint
pnpm format:check        # Prettier 格式检查
pnpm format              # Prettier 自动修复格式
pnpm build               # 后端 tsc + 前端 vite build + 产物修正
pnpm verify:integration  # 集成测试（先执行 build）
```

提交前请确保 `typecheck`、`lint`、`format:check` 全部通过。

## 本地运行

```bash
pnpm dev
```

开发脚本封装了本地调试所需的全部配置：

- 从源码启动（tsx），无需先构建；`tsx watch` 监听 `src/` 变更自动重启
- 数据隔离到 `./.dev-data`（已 gitignore），不与真实数据目录的实例锁冲突
- 固定端口 `3888`，交互式终端下自动打开浏览器

前端改动需要界面热更新时，另开终端运行：

```bash
pnpm dev:web
```

Vite 开发服务器已配置 `/api` 代理到 `3888`，与 `pnpm dev` 同时运行即可获得前端 HMR。

也可以走构建产物验证（与 `npx vpn-keepalive` 行为一致）：

```bash
pnpm build
node dist/cli.js --data-dir /tmp/vk-dev
```

## 调试

后端以 Node 原生能力为主（CLI 解析依赖 commander，端口查找依赖 get-port），直接用 inspector：

```bash
node --inspect-brk dist/cli.js --data-dir /tmp/vk-dev
```

打开 Chrome 访问 `chrome://inspect`（或 VS Code「Run and Debug → Attach to Node Process」）附加断点。VS Code 也可用 launch.json 一键启动：

```json
{
  "type": "node",
  "request": "launch",
  "name": "vpn-keepalive dev",
  "program": "${workspaceFolder}/dist/cli.js",
  "args": ["--data-dir", "/tmp/vk-dev"],
  "skipFiles": ["<node_internals>/**"]
}
```

排查运行问题时的信息入口：

- Web 界面「运行状态」区块：最近请求结果与控制台日志视图（最近 200 行）。
- 数据目录（或 `--data-dir` 目录）下 `logs/keepalive.log`（含轮转 `.1`、`.2`）与 `state.json`（最近状态快照）。
- `curl http://127.0.0.1:3888/api/status`、`/api/logs` 直接查看状态与日志（端口以启动输出为准）。

## 测试

集成测试覆盖引擎调度、错误分类、热更新、实例锁、配置校验、日志接口、API、CLI 子进程（含重启后配置加载）与日志轮转：

```bash
pnpm verify:integration
```

该命令会先执行完整构建，再运行 `scripts/verify-integration.mjs`。

## 发布

包为公共 npm 包（无 scope），通过 GitHub Actions 自动发布：推送 `v<version>` 格式的 tag 后，工作流（`.github/workflows/publish.yml`）会自动执行校验并发布到 npm。

发布步骤：

1. 将 `package.json` 中的 `version` 按语义化版本递增并提交。
2. 打 tag（必须与 `version` 一致，如 `v0.2.1`）并推送：

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

3. 在仓库 Actions 页面查看工作流进度，全部通过后即发布成功。

工作流内置检查：tag 与 `package.json` 的 `version` 不一致会直接失败；`typecheck` / `lint` / `format:check` / `verify:integration` 全部通过才会执行 `pnpm publish`（经 `prepack` 钩子自动构建）。

发布前建议先本地检查打包产物：

```bash
pnpm pack
```

发布前检查清单：

- [ ] `package.json` 中 `version` 已按语义化版本递增
- [ ] `README.md` 中如涉及版本描述已同步更新

> 仓库需在 GitHub 仓库 Settings → Secrets → Actions 中配置 `NPM_TOKEN`（npmjs.com 生成的 Access Token，具备该包写入权限），工作流才能完成发布。
