# Zotero Codex Reader：macOS 开发流程

本文件定义将执行的流程。当前仓库仍处于规划阶段；除 Cursor/Codex/Node 等已核查工具外，本文提及的源码、构建脚本和开发 profile 从 S0/S1 起逐步建立。执行顺序以[分阶段计划](superpowers/plans/2026-09-08-zcr-implementation-stages.md)为准。

## 工作台

在项目目录用 `cursor .` 打开仓库，通过 Cursor 中已安装的官方 Codex 扩展工作。扩展入口为 Codex 图标，或命令面板的 **Codex: Open Codex Sidebar**。Cursor 负责显示/编辑代码和 diff，Codex 负责当前明确任务的实施与检查。

Codex 桌面任务可继续用于计划讨论或独立审阅；实际代码修改默认集中在当前 Cursor checkout。新任务读取仓库文档，不靠把全部历史聊天复制进 prompt。

## 每次任务的输入

向 Codex 提供：

```text
先读 AGENTS.md、docs/project-decisions.md 和对应任务。
本次执行 S1 的工具栏入口与基础布局，参考 T2 实施细则。
范围：packages/zotero/src/reader/ 与相关测试。
目标：搜索左侧开关可开关原生风格侧栏；PDF 真实自适应并保持当前阅读段落。
验收：对应 A25、A27、A28；记录实际测试结果，不把源码可行性写成运行成功。
公共接口若需要变化，先更新契约和调用方；与其他任务同时工作时不修改其文件。
```

S0 建立根 AGENTS、Git 基线与最小工程入口后，S1 起使用以上日常模板。T0 是跨阶段验证清单，不代表先完成所有原型再初始化仓库。

## 开发反馈循环

1. 从当前干净状态建立 `codex/sX-描述` 分支；首次规划基线与工程提交在 S0 建立，不在没有提交的仓库直接创建 worktree。
2. 先明确本任务的行为与失败方式，对状态/协议/恢复问题建立有区分力的测试。
3. Codex 实施，跑本任务相关测试、类型检查；用户在 Cursor 查看 diff。
4. 构建插件开发目录，在专用 Zotero profile 中加载/重新加载。原生 API、selection popup 和 PDF 缩放都要在宿主验证。
5. 记录实际结果，修复错误，重复受影响的验证；通过后提交这一项。

从 S0 起按阶段逐步建立的开发命令如下，脚本落地前不能宣称已可执行：

| 命令 | 预期行为 |
| --- | --- |
| `npm ci` | 按已提交 lockfile 安装开发依赖 |
| `npm run dev` | 监听编译 TypeScript/CSS，生成可加载的开发扩展目录；不自动重置 Zotero 状态 |
| `npm run typecheck` | 检查 contracts/core/zotero 的类型边界 |
| `npm run lint` | 检查源码约定 |
| `npm run test:unit` | 核心、协议、UI 纯逻辑测试；无真实模型请求 |
| `npm run test:integration` | 假 Codex 进程/存储与完整业务集成；无真实账户凭据 |
| `npm run test:live` | 显式运行真实 Codex 协议的合成材料测试；Gecko 原生路径另在 Zotero 验收 |
| `npm run build` | 产出可打包扩展 bundle |
| `npm run package:dev` | 生成明确标记的开发 XPI；S1 可只含宿主外壳，S2 加入实验 Codex 资产 |
| `npm run package` | 生成包含固定 Codex runtime 的完整平台发行 XPI |
| `npm run verify:artifacts` | 验证包结构、版本、许可、hash、无个人数据 |

watch 构建不等于 Zotero 已热更新代码。修改 bootstrap、原生注册或进程管理时必须按生命周期重新加载插件，并确认旧监听器和子进程已清理。

## Zotero 开发环境

- 单独创建开发 profile 和 data directory，只导入自制测试 PDF；真实文献库保留日常用途。
- 用 Zotero 开发者工具/Browser Toolbox 查看宿主 DOM、样式、console 和断点。源码加载成功后还必须重新从 XPI 安装验收。
- 专用 Codex 运行/登录状态与开发用 Codex 分开；只通过官方浏览器授权，不读取或复制认证文件。
- 错误定位先判断属于 UI、选择几何、会话状态、stdio 协议、原生进程或文件存储哪一层，再修改对应适配器。

测试截图只使用合成论文。原始论文文字和对话日志属于私有数据，不进入默认调试导出或 GitHub issue。

## 并行与审阅

默认一个任务一个写入负责人。Cursor 人工编辑、Cursor Agent、Codex IDE 和 Codex CLI 不同时改同一 checkout 的同一文件。

UI 与协议核心需要并行时使用独立 worktree；每个工作者先确认分支、工作目录、文件范围和任务依赖。公共 contracts 的变更由一个负责人处理，其他任务更新调用方。

真实 Zotero 调试默认串行使用开发环境。若确需同时运行两个调试实例，为每个实例提供独立 profile、data directory、插件状态和 Codex 子进程；不能只隔离 Git 目录却共用可写测试状态。

每项审阅关注四点：是否达到用户操作结果、是否扩大权限或范围、失败时是否保留内容/避免重复请求、是否有实际测试证据。命名/样式一致性通过项目规范和静态检查处理，避免把审阅耗在格式上。

## 从开发到 GitHub

1. S0 初始化工程，S1 验证真实宿主布局，S2 验证随包 Codex 的原生运行/授权；随后完成主功能与恢复。
2. 完成 30 项验收，区分 PASS/FAIL/NOT RUN。
3. 从干净 checkout 构建完整 macOS arm64 XPI，附准确版本与许可资料。
4. 在没有系统 Node/Codex CLI 的干净环境，从实际下载的 XPI 安装使用。
5. 准备 GitHub draft/prerelease，作者审核具体资产后发布；公开下载后再验证安装与升级。

Intel Mac 只有通过同等验收后才进入支持表；Node 测试能在多个 OS 运行，不代表 Zotero 已支持这些平台。

相关文档：[项目决策](project-decisions.md)、[用户流程](zotero-codex-user-flow.md)、[开发计划](superpowers/plans/2026-09-08-zotero-codex-reader.md)。
