# Changelog

## [1.0.1](https://github.com/longshihui/vpn-keepalive/compare/v1.0.0...v1.0.1) (2026-10-22)

### Bug Fixes

- **engine:** https 地址跳过证书校验，自签证书不再误报网络错误 ([43b3fd6](https://github.com/longshihui/vpn-keepalive/commit/43b3fd6ceaaec547cec12235fc0c89b7d69c8a7c))

## 1.0.0 (2026-10-22)

### ⚠ BREAKING CHANGES

- 保活地址改为随机选取，Web 界面改版
- 默认启动 Web 界面并自动打开浏览器，新增立即保活
- 默认命令仅运行保活引擎，新增 ui 子命令启动 Web 界面
- 移除存储目录自定义能力与 /api/settings、/api/fs/dirs 接口，已有 settings.json 将被忽略

### Features

- 保活地址改为随机选取，Web 界面改版 ([436da38](https://github.com/longshihui/vpn-keepalive/commit/436da381eea9d91749a96958072e81bbe5dae4ab))
- 命令行未配置地址时交互引导新增保活地址 ([a9462ab](https://github.com/longshihui/vpn-keepalive/commit/a9462ab71d99f96d44cb84f74fb3c159305037c5))
- 固定存储路径为系统约定目录，CLI 改用 commander ([be6a657](https://github.com/longshihui/vpn-keepalive/commit/be6a657c6282f484e20e1c192e54d0c79397938e))
- 存储位置支持目录选择器浏览选取 ([e5c0929](https://github.com/longshihui/vpn-keepalive/commit/e5c0929003083b9a3094d4040e6cd807ee14a460))
- 改造为 npx 可运行的本地 Web 配置保活工具 ([441131f](https://github.com/longshihui/vpn-keepalive/commit/441131fd99898401dc625e3ee4696701ba48914f))
- 迁移 aTrust 保活为独立跨平台工具 ([877ea8d](https://github.com/longshihui/vpn-keepalive/commit/877ea8d05e3fb81f905db8bfd2e5ea42c489746e))
- 默认启动 Web 界面并自动打开浏览器，新增立即保活 ([b8c0eed](https://github.com/longshihui/vpn-keepalive/commit/b8c0eed856c72bd3721fcea4233b550a50f50aea))
- 默认命令仅运行保活引擎，新增 ui 子命令启动 Web 界面 ([3f78308](https://github.com/longshihui/vpn-keepalive/commit/3f78308e037e0fec1400b9b72e8f282945f38041))
