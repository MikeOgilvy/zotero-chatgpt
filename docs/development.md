# Zotero Codex Reader：macOS 开发流程

本文件定义当前实际开发流程。S0 工程基础、S1 原生侧栏开发预览和 S2 自带 Codex 运行/登录开发预览已经实现；当前版本为 npm/workspaces `0.2.0-alpha.1`、Zotero manifest `0.2.0a1`。S2 仍有三项真实回复/停止检查因账户限额未运行，通过后进入 S3。执行顺序以[分阶段计划](superpowers/plans/2026-09-08-zcr-implementation-stages.md)为准。

## 工作台

在项目目录用 `cursor .` 打开仓库，通过 Cursor 中已安装的官方 Codex 扩展工作。扩展入口为 Codex 图标，或命令面板的 **Codex: Open Codex Sidebar**。Cursor 负责显示/编辑代码和 diff，Codex 负责当前明确任务的实施与检查。

Codex 桌面任务可继续用于计划讨论或独立审阅；实际代码修改默认集中在当前 Cursor checkout。新任务读取仓库文档，不靠把全部历史聊天复制进 prompt。

## 每次任务的输入

向 Codex 提供：

```text
先读 AGENTS.md、docs/project-decisions.md 和对应任务。
本次执行 S2 的原生运行与官方登录最小闭环，参考阶段计划中的 S2。
范围：Codex 协议核心、Zotero 原生进程适配、账户状态和相关测试。
目标：从开发 XPI 启动受控的随包 Codex，通过官方浏览器登录，并提交明确标为合成测试的一条真实请求。
验收：分别记录假进程测试、真实 Zotero 原生进程证据和真实登录结果；不能用 fixture 文本代替模型回复。
公共接口若需要变化，先更新契约和调用方；与其他任务同时工作时不修改其文件。
```

S0/S1 已建立根规则、工程入口和原生布局。后续仍按一个小任务写明范围、预期结果和证据层级；T0 是跨阶段验证清单，不代表某个单元测试能替代宿主验收。

## 开发反馈循环

1. 从当前干净状态建立 `codex/sX-描述` 分支；首次规划基线与工程提交在 S0 建立，不在没有提交的仓库直接创建 worktree。
2. 先明确本任务的行为与失败方式，对状态/协议/恢复问题建立有区分力的测试。
3. Codex 实施，跑本任务相关测试、类型检查；用户在 Cursor 查看 diff。
4. 构建插件开发目录，在专用 Zotero profile 中加载/重新加载。原生 API、selection popup 和 PDF 缩放都要在宿主验证。
5. 记录实际结果，修复错误，重复受影响的验证；通过后提交这一项。

先用 `npm ci` 按 lockfile 安装开发依赖。当前 `package.json` 实际提供以下脚本：

<!-- AUTO-GENERATED: package scripts -->

| 命令 | 预期行为 |
| --- | --- |
| `npm run dev` | 监听编译 TypeScript/CSS，生成可加载的开发扩展目录；不自动重置 Zotero 状态 |
| `npm run typecheck` | 检查 contracts/core/zotero 的类型边界 |
| `npm run lint` | 检查源码约定 |
| `npm run test:unit` | 运行当前源码、构建、打包和 UI 纯逻辑测试；无真实模型请求 |
| `npm run build` | 产出可打包扩展 bundle；要求 `node scripts/runtime-prepare.mjs` 已把固定版本 Codex 放入忽略的缓存，否则明确失败 |
| `npm run package:dev` | 先构建，再按 manifest 版本生成明确标记的开发 XPI；包含已校验的随包 Codex 与许可文件 |

<!-- END AUTO-GENERATED -->

当前没有 `test:integration`、`test:live`、正式 `package` 或 `verify:artifacts` npm script。它们仍是后续阶段目标，不能当作已执行检查。`package:dev` 的文件名从已验证的 Zotero manifest 版本生成；当前输出为 `dist/zotero-codex-reader-0.2.0a1-dev.xpi`（约 101 MB）。`node scripts/runtime-prepare.mjs` 从官方 `rust-v0.144.1` 发行版下载并校验 `codex-aarch64-apple-darwin`，只写入忽略的 `.zcr-dev/runtime-cache/`。

watch 构建不等于 Zotero 已热更新代码。修改 bootstrap、原生注册或进程管理时必须按生命周期重新加载插件，并确认旧监听器和子进程已清理。

## Zotero 开发环境

- 单独创建开发 profile 和 data directory，只导入自制测试 PDF；真实文献库保留日常用途。
- 用 Zotero 开发者工具/Browser Toolbox 查看宿主 DOM、样式、console 和断点。源码加载成功后还必须重新从 XPI 安装验收。
- 专用 Codex 运行/登录状态与开发用 Codex 分开；只通过官方浏览器授权，不读取或复制认证文件。
- 错误定位先判断属于 UI、选择几何、会话状态、stdio 协议、原生进程或文件存储哪一层，再修改对应适配器。

测试截图只使用合成论文。原始论文文字和对话日志属于私有数据，不进入默认调试导出或 GitHub issue。

### 当前专用宿主测试流程

先确认专用 Zotero 测试实例已经关闭，然后在仓库根目录运行：

```sh
npm run package:dev
node scripts/prepare-host-test.mjs
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/profile" \
  -datadir "$PWD/.zcr-dev/data"
```

`prepare-host-test.mjs` 也接受一个显式 XPI 路径作为第一个参数。它只写入忽略的 `.zcr-dev/`，创建合成 PDF，关闭更新、同步和遥测，并将开发 XPI 与测试驱动安装进专用 profile。测试结果写入 `.zcr-dev/host-report.json`。S1 测试驱动在最后卸载被测插件以核对实际清理，因此再次运行宿主流程前必须重新执行 `node scripts/prepare-host-test.mjs`。不要把这套命令改成普通 Zotero profile，也不要提交 `.zcr-dev/` 内容。

S2 运行时/登录流程使用 `node scripts/prepare-host-test.mjs --s2`，再用同样的命令启动专用 Zotero。驱动会校验随包 Codex 的提取与启动、`config/read` 策略门、账户状态、侧栏开关不丢进程、停用/重启的收尾与恢复；账户已登录时提交一条明确标为连接测试的合成问题并验证停止。加 `--login` 时驱动会点击“使用 ChatGPT 登录”并等待用户在浏览器完成官方授权。启动 Zotero 的进程必须能脱离启动它的 shell 存活（终端前台或工具托管的后台任务）；运行期间不要操作该测试窗口，关闭其阅读器标签会中止检查。上游拒绝本轮请求（例如账户限额用尽）时，报告状态为 `passed-except-upstream-refusal`，回复/停止检查保持未运行。

当前专用 Zotero 9.0.6 流程：S1 通过 27/27 检查，S2 通过 12/12 已执行检查、3 项因账户限额未运行。完整结果和证据边界见 [S0/S1 QA 记录](qa/s0-s1.md) 与 [S2 QA 记录](qa/s2.md)。

## 并行与审阅

默认一个任务一个写入负责人。Cursor 人工编辑、Cursor Agent、Codex IDE 和 Codex CLI 不同时改同一 checkout 的同一文件。

UI 与协议核心需要并行时使用独立 worktree；每个工作者先确认分支、工作目录、文件范围和任务依赖。公共 contracts 的变更由一个负责人处理，其他任务更新调用方。

真实 Zotero 调试默认串行使用开发环境。若确需同时运行两个调试实例，为每个实例提供独立 profile、data directory、插件状态和 Codex 子进程；不能只隔离 Git 目录却共用可写测试状态。

每项审阅关注四点：是否达到用户操作结果、是否扩大权限或范围、失败时是否保留内容/避免重复请求、是否有实际测试证据。命名/样式一致性通过项目规范和静态检查处理，避免把审阅耗在格式上。

## 从开发到 GitHub

1. 保持已经通过当前开发与宿主检查的 S0/S1/S2 预览可构建；限额恢复后补齐 S2 的真实回复与停止检查，再进入 S3 选区闭环。
2. 完成 30 项验收，区分 PASS/FAIL/NOT RUN。
3. 从干净 checkout 构建完整 macOS arm64 XPI，附准确版本与许可资料。
4. 在没有系统 Node/Codex CLI 的干净环境，从实际下载的 XPI 安装使用。
5. 准备 GitHub draft/prerelease，作者审核具体资产后发布；公开下载后再验证安装与升级。

Intel Mac 只有通过同等验收后才进入支持表；Node 测试能在多个 OS 运行，不代表 Zotero 已支持这些平台。

相关文档：[项目决策](project-decisions.md)、[用户流程](zotero-codex-user-flow.md)、[开发计划](superpowers/plans/2026-09-08-zotero-codex-reader.md)。
