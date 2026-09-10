# Zotero Codex Reader

在 Zotero 中使用 Codex 阅读和讨论论文。

当前状态：开发预览已装进专用 `.zcr-dev` profile，可按 [产品验收](docs/development.md#产品验收现在就开) 直接试用。S0–S6 先前宿主记录仍在；S7 只有 `release:dry-run`，没有 GitHub Release。S2/S3 真实流式回复与停止、A23/A24 发送因测试账户限额暂未运行（约 2026-09-15）。当前 npm/workspace 版本为 `0.3.0-alpha.1`，Zotero manifest 版本为 `0.3.0a1`，开发 XPI SHA-256 `aba8fe14…`。

## 当前开发预览

开发 XPI 可在 Zotero 9.0.6 的专用测试 profile 中加载。PDF 阅读器搜索按钮左侧已有 Codex 开关；它打开 Zotero 原生右侧区域中的开发预览内容，并让 PDF 按真实剩余宽度适配。当前宿主记录已经验证侧栏内容、附件身份、宽度从 1512 缩到 1155、阅读位置保持，以及固定缩放和用户手动缩放的基础行为。

这仍是开发预览。源码已有目录模型控件、Markdown/KaTeX 回答、多对话历史和进程重启对账；专用宿主已验证选区操作条、Ask/More details、附件隔离和启停恢复。真实模型回复待账户限额恢复后补齐。完整发行验收仍属于后续阶段。

Node.js 24 只用于构建和测试：

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
npm run verify:install -- prepare --root /tmp/zcr-clean/profile --data /tmp/zcr-clean/data --xpi dist/zotero-codex-reader-0.3.0a1-dev.xpi
npm run release:dry-run
```

`npm run package:dev` 先构建，再生成 `dist/zotero-codex-reader-0.3.0a1-dev.xpi`；构建前需先执行 `node scripts/runtime-prepare.mjs` 下载并校验固定版本的官方 Codex 运行组件。它不是公开发行版；真实 Zotero 验证必须使用隔离的 `.zcr-dev/` profile，具体步骤见 [macOS 开发流程](docs/development.md)。

## 规划文档

1. [项目决策](docs/project-decisions.md)：名称、技术路线与 macOS 开发基线。
2. [模块设计](docs/module-design.md)：六个运行模块和构建发布模块的职责、接口与状态归属。
3. [分阶段实施计划](docs/superpowers/plans/2026-09-08-zcr-implementation-stages.md)：S0–S7 执行顺序；T0–T12 只是该计划内的工作包参考。
4. [用户流程](docs/zotero-codex-user-flow.md)：安装、登录、选区操作、原生侧栏与 PDF 自适应。
5. [macOS 开发流程](docs/development.md)：Cursor + Codex 的日常实施、审阅和宿主调试。
6. [接口与状态约定](docs/superpowers/plans/2026-09-08-zotero-codex-reader-contracts.md)：恢复、布局与 Codex 适配语义；公共类型以 `packages/contracts` 为准。
7. [A01–A30 验收记录](docs/qa/acceptance-v0.1.md)：实际执行结果，不是规划清单。
8. [S0/S1 QA](docs/qa/s0-s1.md)、[S2](docs/qa/s2.md)、[S3](docs/qa/s3.md)、[S4](docs/qa/s4.md)、[S5](docs/qa/s5.md)、[S6](docs/qa/s6.md)：源码、开发 XPI 和专用 Zotero 宿主检查的结果与边界。
9. [贡献说明](CONTRIBUTING.md)、[发行过程](docs/release.md)（仅 dry-run；没有 GitHub Release）。
10. [历史文档归档](docs/archive/README.md)：被取代的 T0–T12 清单、验收规划稿和首版设计笔记。

## 隐私

插件记录写在当前 Zotero profile 下的 `zotero-codex-reader/v1/`（`records/`、`account/`、`home/`、`scratch/`、`tmp/`），不会上传整篇 PDF。对话正文、选区和请求日志是私有数据。默认侧栏不提供「复制诊断」；若开发构建仍导出诊断 JSON，其中只有白名单字段（版本、错误代码、请求计数和状态、无用户名的通用存储位置），不含论文原文、账户标识、令牌或真实路径。本仓库、测试和诊断输出不复制官方登录文件。Codex 云端历史由官方账户管理；删除插件本地目录不等于删除云端会话。没有遥测。

## 确定的技术路线

Zotero 原生界面 → TypeScript 核心 → Gecko 原生进程管道 → 随包 Codex App Server。

Node.js 仅用于构建和测试。当前开发与验证采用 macOS Apple Silicon、Cursor、官方 Codex 扩展和独立 Zotero profile。普通用户最终只安装完整 XPI；这一发行体验尚未实现。
