# 贡献指南

感谢关注 vpn-keepalive！本文档说明本地开发、调试与发布的完整流程。

## 开发环境

- Node.js 22.14+（CI 使用最新的 Node.js 22；运行已发布的包仍支持 Node.js 20+）
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
pnpm typecheck           # 类型检查：tsc + vue-tsc
pnpm lint                # ESLint
pnpm format:check        # Prettier 格式检查
pnpm format              # Prettier 自动修复格式
pnpm build               # 后端 tsc + 前端 vite build + 产物修正
pnpm verify:integration  # 集成测试（先执行 build）
pnpm verify:release      # 临时仓库中验证提交钩子、版本递增与 changelog
pnpm verify              # 完整校验：类型、lint、格式、集成测试、发布工具
pnpm commit              # 交互式创建提交信息并提交已暂存的改动
pnpm changelog           # 预览下一版本的 changelog
pnpm release:dry-run     # 预演发布，显示版本与待执行步骤
pnpm release             # 更新版本与 changelog，提交、打 tag 并推送
```

提交前请确保 `typecheck`、`lint`、`format:check` 全部通过。

## 提交规范

本仓库使用 Conventional Commits。执行 `pnpm install` 后，Husky 自动安装 `commit-msg` 钩子，每次 `git commit` 都会用 commitlint 校验提交信息。CI 也会校验本次推送或 PR 中的提交信息。

推荐先暂存改动，再使用中文交互式提交工具：

```bash
git add <修改的文件>
pnpm commit
```

提交格式为 `type(scope): subject`，范围可省略，描述可以使用中文或英文，标题最多 100 个字符。例如：

```text
feat(web): 支持切换活动地址
fix(engine): 修复超时后调度异常
docs: 更新开发说明
chore(release): 0.2.1
```

支持 `feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`。不兼容变更使用 `!`（如 `feat(cli)!: 调整命令参数`）或在正文末尾添加 `BREAKING CHANGE: ...`。

直接运行 `git commit -m "fix: 修复问题"` 也会触发校验。需要单独检查最近一次提交时运行 `pnpm commitlint --last --verbose`。

## 本地运行

```bash
pnpm build
node dist/cli.js
```

与 `npx vpn-keepalive` 行为一致。建议加 `--data-dir` 指向临时目录，与真实数据隔离：

```bash
node dist/cli.js --port 3888 --data-dir /tmp/vk-dev
```

### 增量构建

改动后无需整包重跑，可分别重建：

- 后端：`pnpm exec tsc --watch`（监听 `src/`，增量输出到 `dist/`），改完重启进程生效（项目未配置进程自动重启工具）。
- 前端：`pnpm exec vite build web`，构建完成后刷新浏览器即可。项目未配置 Vite dev 代理，直接跑 `vite dev` 无法请求 `/api/*`，调试 UI 请走构建产物。

## 调试

后端以 Node 原生能力为主（仅 CLI 解析依赖 commander），直接用 inspector：

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

该命令会先执行完整构建，再运行 `scripts/verify-integration.mjs`。发布工具测试运行 `pnpm verify:release`，会在临时 Git 仓库中验证提交校验、失败检查、dry-run、patch/minor/major 版本递增与 changelog，不会推送或发布。

## 发布

包为公共 npm 包（无 scope），通过 GitHub Actions 的 OIDC Trusted Publishing 自动发布，无需配置 `NPM_TOKEN`：推送 `v<version>` 格式的 tag 后，工作流（`.github/workflows/publish.yml`）会自动执行校验并发布到 npm。

### 首次发布与 OIDC 配置

Trusted Publisher 在 npm 包的 Settings 中配置。若 `vpn-keepalive` 尚未发布，需要先在本地登录 npm，完成首次发布以创建包；确认包名可用，npm 账号已验证邮箱并启用 2FA，然后运行：

```bash
npm login --registry https://registry.npmjs.org/
pnpm verify
npm publish --access public --registry https://registry.npmjs.org/
```

首次发布会使用当前 `package.json` 的版本；交互式登录和发布按提示完成 2FA。已有包可跳过这一步。

随后打开 [npm 包设置](https://www.npmjs.com/package/vpn-keepalive/access)，在 Settings → Trusted publishing 中添加 GitHub Actions，填写：

| 字段                 | 值              |
| -------------------- | --------------- |
| Organization or user | `longshihui`    |
| Repository           | `vpn-keepalive` |
| Workflow filename    | `publish.yml`   |
| Environment name     | 留空            |

在 Allowed actions 中启用 `npm publish`，以允许工作流直接发布。工作流没有配置 GitHub Environment，因此这里也应留空；workflow 只填文件名，不填 `.github/workflows/` 路径。

OIDC 要求 Node.js >= 22.14.0 和 npm >= 11.5.1；发布工作流使用最新的 Node.js 22，并显式安装 npm 11，再调用 `npm publish`。pnpm 继续负责依赖安装、校验和构建，`prepack` 钩子仍会自动运行 `pnpm run build`。`package.json` 中的 `repository.url` 必须与 GitHub 仓库一致；公开仓库的公开包使用 OIDC 时会自动附带 provenance。

新建的 Trusted Publisher 必须在 2 天内成功发布一次以验证配置；过期后需删除并重新创建。首次手动发布后，通过下方流程发布一个新版本（例如 `pnpm release patch`），不要再推送已发布版本的 tag，以免重复发布同一版本。

OIDC 成功发布后，可以在 npm 包的 Publishing access 中选择 **Require two-factor authentication and disallow tokens**，并移除 GitHub 仓库中不再使用的 `NPM_TOKEN` Secret、撤销对应的 npm 发布 token。

官方说明见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

### 后续版本发布

发布由 release-it 和 Conventional Changelog 驱动。发布时根据上次版本 tag 以来的提交推荐版本，更新 `package.json` 与 `CHANGELOG.md`，生成 `chore(release): <version>` 提交和 `v<version>` tag，并将提交和 tag 一起推送到远端。

`fix` 推荐 patch，`feat` 推荐 minor，不兼容变更推荐 major；其他类型默认不进入 changelog，包含不兼容变更时仍会记录。仓库尚无版本 tag 时，第一次生成会包含全部提交历史。

发布步骤：

1. 在 `main` 分支完成所有改动并提交，确保工作区干净，且已配置跟踪远端分支；运行 `git pull --ff-only` 同步最新代码和 tag。
2. 运行预览命令，核对版本建议与变更记录：

   ```bash
   pnpm changelog
   pnpm release:dry-run
   ```

   两个命令都使用本地 Git 历史，不会联网 fetch、修改版本文件、创建提交/tag 或推送。dry-run 显示检查步骤，完整检查由正式发布时的 `pnpm verify` 执行；也可以提前手动运行。

3. 执行 `pnpm release`，按提示确认版本、提交、tag 与推送；也可以指定版本增量：

   ```bash
   pnpm release patch
   pnpm release minor
   pnpm release major
   ```

4. 在仓库 Actions 页面查看 Publish 工作流，全部通过后即发布成功。实际 npm 发布由 CI 使用 OIDC 执行，本地无需 npm 发布凭据。

正式发布前自动运行 `pnpm verify`，并要求在 `main` 上、有新提交、工作区干净。生成的 changelog 会自动格式化后包含在发布提交中。版本尚未确定时，可随时运行 `pnpm changelog` 预览下一版本的变更记录。

工作流内置检查：提交信息或 tag 与 `package.json` 的 `version` 不一致会直接失败；`typecheck` / `lint` / `format:check` / `verify:integration` 全部通过才会执行 `npm publish --access public`（经 `prepack` 钩子自动构建）。

发布前建议先本地检查打包产物：

```bash
pnpm pack
```

发布前检查清单：

- [ ] 预览中的版本与 changelog 符合预期
- [ ] `README.md` 中如涉及版本描述已同步更新
- [ ] npm 包已创建，Trusted Publisher 与仓库、workflow 文件名一致，且允许 `npm publish`
- [ ] 待发布版本尚未存在于 npm
