# Zotero Codex Reader

在 Zotero 中使用 Codex 阅读和讨论论文。

当前状态：规划已迁入本项目目录，实现尚未开始。正式开发按 S0–S7 分阶段推进，第一轮从仓库初始化和可加载的 Zotero 外壳开始。

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
9. [验收与发布矩阵](docs/superpowers/plans/2026-09-08-zotero-codex-reader-acceptance.md)：A01–A30，当前均未执行。

## 确定的技术路线

Zotero 原生界面 → TypeScript 核心 → Gecko 原生进程管道 → 随包 Codex App Server。

Node.js 仅用于构建和测试。首轮开发与验证采用 macOS Apple Silicon、Cursor 和官方 Codex 扩展。

文档中的构建命令和源码目录属于后续实施目标；当前没有可安装发行版。
