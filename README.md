# Zotero Codex Reader

在 Zotero 中使用 Codex 阅读和讨论论文。

当前状态：S0 工程基础、S1 Zotero 原生侧栏开发预览和 S2 自带 Codex 运行/官方登录开发预览已经落地；S2 的真实流式回复与停止检查因测试账户限额暂未运行，通过后进入 S3 选区闭环。当前 npm/workspace 版本为 `0.2.0-alpha.1`，Zotero manifest 版本为 `0.2.0a1`。

## 当前开发预览

开发 XPI 可在 Zotero 9.0.6 的专用测试 profile 中加载。PDF 阅读器搜索按钮左侧已有 Codex 开关；它打开 Zotero 原生右侧区域中的开发预览内容，并让 PDF 按真实剩余宽度适配。当前宿主记录已经验证侧栏内容、附件身份、宽度从 1512 缩到 1155、阅读位置保持，以及固定缩放和用户手动缩放的基础行为。

这仍是开发预览：Codex 后台、ChatGPT 登录、模型请求、选区上的 More details / Ask in sidechat 和聊天历史尚未实现。当前专用宿主流程的 27 项检查已经通过，包括原生侧栏与 Codex 内容切换、三轮停用/启用的监听器数量、同一父条目下两个附件的身份隔离，以及卸载后的实际清理；完整发行验收仍属于后续阶段。

Node.js 24 只用于构建和测试：

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
```

`npm run package:dev` 先构建，再生成 `dist/zotero-codex-reader-0.2.0a1-dev.xpi`；构建前需先执行 `node scripts/runtime-prepare.mjs` 下载并校验固定版本的官方 Codex 运行组件。它不是公开发行版；真实 Zotero 验证必须使用隔离的 `.zcr-dev/` profile，具体步骤见 [macOS 开发流程](docs/development.md)。

## 规划文档

建议先读模块设计和分阶段计划，再按需要查看实施细则：

1. [项目决策](docs/project-decisions.md)：名称、技术路线与 macOS 开发基线。
2. [模块设计](docs/module-design.md)：六个运行模块和构建发布模块的职责、接口与状态归属。
3. [分阶段实施计划](docs/superpowers/plans/2026-09-08-zcr-implementation-stages.md)：S0 仓库初始化到 S7 GitHub 发布，定义实际执行顺序。
4. [用户流程](docs/zotero-codex-user-flow.md)：安装、登录、选区操作、原生侧栏与 PDF 自适应。
5. [设计概览](docs/zotero-codex-design.md)：范围与可行性依据。
6. [macOS 开发流程](docs/development.md)：Cursor + Codex 的日常实施、审阅和宿主调试。
7. [任务实施细则](docs/superpowers/plans/2026-09-08-zotero-codex-reader.md)：T0–T12 工作包参考，按 S 阶段逐项使用。
8. [接口与状态约定](docs/superpowers/plans/2026-09-08-zotero-codex-reader-contracts.md)：类型、错误、进程、存储、恢复与布局规则。
9. [验收与发布矩阵](docs/superpowers/plans/2026-09-08-zotero-codex-reader-acceptance.md)：A01–A30 的完整验收和发布标准。
10. [S0/S1 QA 记录](docs/qa/s0-s1.md)：当前源码、开发 XPI 和专用 Zotero 宿主检查的实际结果与边界。

## 确定的技术路线

Zotero 原生界面 → TypeScript 核心 → Gecko 原生进程管道 → 随包 Codex App Server。

Node.js 仅用于构建和测试。当前开发与验证采用 macOS Apple Silicon、Cursor、官方 Codex 扩展和独立 Zotero profile。普通用户最终只安装完整 XPI；这一发行体验尚未实现。
