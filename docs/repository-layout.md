# 仓库目录约定

本仓库采用“一项目一目录”。每个浏览器扩展、Userscript 或其他轻量级浏览器工具都保留自己的源码、README 和独立配置。

## 目录

- `extensions/<project-name>/`：Chrome / Edge / Chromium 浏览器扩展。
- `userscripts/<project-name>/`：Tampermonkey、Violentmonkey 等 Userscript 项目。
- `shared/`：多个项目确实需要共享代码时再创建并放入公共模块。
- `docs/`：仓库级说明、迁移记录和跨项目文档。

## 新增项目

浏览器扩展直接创建 `extensions/<清晰项目名>/`。项目自己的 `manifest.json`、`README.md`、源码和资源都放在该目录内。

油猴脚本直接创建 `userscripts/<清晰项目名>/`。主 `.user.js`、README、测试或辅助文件都放在该目录内。

当前没有统一 Node 构建链，因此不配置 npm / pnpm / yarn workspace。某个子项目以后需要 Node 时，在自己的目录里维护 `package.json`；等多个项目出现真实共享依赖需求后，再评估 workspace。
