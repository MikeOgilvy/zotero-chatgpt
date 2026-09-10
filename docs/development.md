# Zotero Codex Reader：macOS 开发流程

本文件定义当前实际开发流程。人工产品验收现在就可以做，见下方[产品验收](#产品验收现在就开)。S0–S3 开发预览已经实现；S4/S5 的源码工作见[开发进度](progress.md)。当前版本为 npm/workspaces `0.3.0-alpha.1`、Zotero manifest `0.3.0a1`。S2/S3 的真实流式回复与停止检查因账户限额未运行，限额恢复后补齐即可，不必改实现。执行顺序以[分阶段计划](superpowers/plans/2026-09-08-zcr-implementation-stages.md)为准。

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
| `npm run package:dev` | 先构建，再按 manifest 版本生成明确标记的开发 XPI 和同目录 `SHA256SUMS`；包含已校验的随包 Codex 与许可文件 |
| `npm run verify:artifacts` | 检查已构建目录或 XPI：无 `node:` 导入、无账户/论文记录、含声明的 LICENSE/NOTICE；若 XPI 旁有 `SHA256SUMS` 则核对摘要 |
| `npm run verify:install` | 干净环境安装布局与本地升级/回退 CLI（`prepare` / `seed-records` / `upgrade` / `rollback` / `extract` / `updates-json` / `build-info`）。只接受本地 XPI，拒绝 GitHub Release URL；默认不要指向已登录的 `.zcr-dev/profile` |
| `npm run release:dry-run` | 写出本地发行计划（tag、hash、`githubRelease: null`）；拒绝 `--publish` / `--gh-release` |

<!-- END AUTO-GENERATED -->

当前没有 `test:integration`、`test:live` 或正式 `package` npm script。它们仍是后续阶段目标，不能当作已执行检查。`verify:artifacts` 已能检查构建目录或 XPI 的白名单内容，但不替代干净环境宿主安装。`package:dev` 的文件名从已验证的 Zotero manifest 版本生成；当前输出为 `dist/zotero-codex-reader-0.3.0a1-dev.xpi`（约 101 MB）。`node scripts/runtime-prepare.mjs` 从官方 `rust-v0.144.1` 发行版下载并校验 `codex-aarch64-apple-darwin`，只写入忽略的 `.zcr-dev/runtime-cache/`。

watch 构建不等于 Zotero 已热更新代码。修改 bootstrap、原生注册或进程管理时必须按生命周期重新加载插件，并确认旧监听器和子进程已清理。

## Zotero 开发环境

- 单独创建开发 profile 和 data directory，只导入自制测试 PDF；真实文献库保留日常用途。
- 用 Zotero 开发者工具/Browser Toolbox 查看宿主 DOM、样式、console 和断点。源码加载成功后还必须重新从 XPI 安装验收。
- 专用 Codex 运行/登录状态与开发用 Codex 分开；只通过官方浏览器授权，不读取或复制认证文件。
- 错误定位先判断属于 UI、选择几何、会话状态、stdio 协议、原生进程或文件存储哪一层，再修改对应适配器。

测试截图只使用合成论文。原始论文文字和对话日志属于私有数据，不进入默认调试导出或 GitHub issue。

### 产品验收（现在就开）

验收用的是已登录的专用 profile，**不要**走默认的 `prepare-host-test.mjs`（那会装上自动跑的 host driver，抢走窗口）。日常 Zotero（`mi2zhr2s.default`）可以继续开着。

插件已经重新打包并装进专用 profile：

| 项 | 路径 |
| --- | --- |
| 开发 XPI | `/Users/kuhn/Desktop/ZoteroCodexReader/dist/zotero-codex-reader-0.3.0a1-dev.xpi` |
| SHA-256 | `aba8fe1465ad8a61fd4bef248f4f1eee42a75f2f75a042c0ce07b916c9295567` |
| 已装位置 | `/Users/kuhn/Desktop/ZoteroCodexReader/.zcr-dev/profile/extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi` |
| Profile | `/Users/kuhn/Desktop/ZoteroCodexReader/.zcr-dev/profile` |
| Data | `/Users/kuhn/Desktop/ZoteroCodexReader/.zcr-dev/data` |
| 合成 PDF（可再导入） | `/Users/kuhn/Desktop/ZoteroCodexReader/.zcr-dev/fixtures/reading.pdf` |

若专用 Zotero 还没开，在仓库根目录：

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/profile" \
  -datadir "$PWD/.zcr-dev/data"
```

库里应有先前宿主运行留下的合成条目；也可把上面的 `reading.pdf` 再导入一份（每页底部有 `Bottom-edge selection line`，方便看 A30）。点阅读器搜索按钮左侧的 Codex 开关，按 [用户流程](zotero-codex-user-flow.md) 走一遍，对照 [A01–A30](qa/acceptance-v0.1.md)。

**现在不必试、也判不了的：** 真实流式回答、停止、Ask 之后的发送、A23/A24 改设置再发送、进行中 turn 被杀后的 resume。测试账户 Codex 限额约到 **2026-09-15**。限额拒绝文案不是模型回答。不要对已登录 profile 跑 `--s2`/`--s3`/`--login`（会发请求或打开官方登录）。

想看未登录时的「使用 ChatGPT 登录」按钮，另开（不要关日常 Zotero）：

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/s6-virgin/profile" \
  -datadir "$PWD/.zcr-dev/s6-virgin/data"
```

该树是 `signedOut`，已换上同一份 XPI 且没有 host driver。点登录会走官方浏览器；限额未恢复时不要指望随后能提问。

源码或 UI 改过之后，先关专用 Zotero，再：

```sh
npm run package:dev
node scripts/prepare-host-test.mjs --acceptance
```

`--acceptance` 只刷新开发 XPI 和合成 PDF，并删掉 `zcr-host-test@local`，不会自动点窗口。

### 当前专用宿主测试流程

自动化宿主 QA（会安装并自动运行 driver）与上面的人工验收分开。先确认**专用** Zotero 测试实例已经关闭，然后：

```sh
npm run package:dev
node scripts/prepare-host-test.mjs --s4
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/profile" \
  -datadir "$PWD/.zcr-dev/data"
```

`prepare-host-test.mjs` 也接受一个显式 XPI 路径作为第一个参数。无 `--acceptance` 时它会写入忽略的 `.zcr-dev/`、创建合成 PDF、关闭更新/同步/遥测，并把开发 XPI **与测试驱动**装进专用 profile。测试结果写入 `.zcr-dev/host-report.json`。S1 测试驱动在最后卸载被测插件以核对实际清理，因此再次运行宿主流程前必须重新执行对应的 `prepare-host-test`。不要把这套命令改成普通 Zotero profile，也不要提交 `.zcr-dev/` 内容。人工验收结束后若再跑 `--s2`…`--s5`，验收前必须重新执行 `node scripts/prepare-host-test.mjs --acceptance`。

S2 运行时/登录流程使用 `node scripts/prepare-host-test.mjs --s2`，再用同样的命令启动专用 Zotero。驱动会校验随包 Codex 的提取与启动、`config/read` 策略门、账户状态、侧栏开关不丢进程、停用/重启的收尾与恢复；账户已登录时提交一条明确标为连接测试的合成问题并验证停止。加 `--login` 时驱动会点击“使用 ChatGPT 登录”并等待用户在浏览器完成官方授权。启动 Zotero 的进程必须能脱离启动它的 shell 存活（终端前台或工具托管的后台任务）；运行期间不要操作该测试窗口，关闭其阅读器标签会中止检查。上游拒绝本轮请求（例如账户限额用尽）时，报告状态为 `passed-except-upstream-refusal`，回复/停止检查保持未运行。

S3 选区闭环使用 `node scripts/prepare-host-test.mjs --s3`。驱动会在合成 PDF 上做出文字选区，核对原生标注面板上方的 More details / Ask 操作条、Ask 只写入草稿、More details 提交解释、A/B 附件隔离、关闭/切换/停用后的恢复，以及返回原文。上游拒绝解释请求时报告为 `passed-except-upstream-refusal`，真实回复与追问停止保持未运行。

S4 聊天设置与布局使用 `node scripts/prepare-host-test.mjs --s4`。驱动核对目录作曲家控件、对话历史、可分享诊断按钮、KaTeX 样式表、侧栏宽度限幅、缩放/页锚、1024/1440 窗口停靠、笔记区让出和选区三边避让，**不向 Codex 发送请求**，因此不受账户限额影响。真实发送组合（A23/A24）仍待限额恢复后与 S3 一起补跑。`package:dev` 同时在 `dist/SHA256SUMS` 写入开发 XPI 的 SHA-256。

S5 进程重启使用 `node scripts/prepare-host-test.mjs --s5`。驱动只对专用 profile 下的自有 `app-server` 发 `kill -TERM`、核对握手与同一对话，并在停用插件后写入 uncertain leftover 再启用；**不** `turn/start`。进行中的真实 turn 被杀后的 resume 仍待限额恢复。

S6 干净环境安装：先跑 Node 布局 CLI，再在**全新** `.zcr-dev/s6-virgin/` 上启动 Zotero。不要对已登录的 `.zcr-dev/profile` 跑 `--s6`。

```sh
node scripts/prepare-host-test.mjs --s6
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/s6-virgin/profile" \
  -datadir "$PWD/.zcr-dev/s6-virgin/data"
```

报告在 `.zcr-dev/s6-virgin/host-report.json`。驱动核验 AddonManager 加载本地 XPI、握手、`signedOut`、停用后同版本 XPI 替换且 records 保留，**不发送**。日常 Zotero 可以同时运行；只要用 `-no-remote` 和这套 virgin 目录。

两个已打包版本之间的宿主升级/回退使用独立的 `.zcr-dev/s6-upgrade/` 树（不要对已登录 profile 跑）。仓库产品版本保持 `0.3.0a1`；第二份 XPI 只在临时目录把 manifest 改成 `0.3.0a2` 后打包，再拷进 `.zcr-dev/s6-upgrade/artifacts/`。

```sh
node scripts/prepare-host-test.mjs --s6 \
  --upgrade-xpi "$PWD/.zcr-dev/s6-upgrade/artifacts/zotero-codex-reader-0.3.0a2-dev.xpi" \
  --rollback-xpi "$PWD/.zcr-dev/s6-upgrade/artifacts/zotero-codex-reader-0.3.0a1-dev.xpi"
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zcr-dev/s6-upgrade/profile" \
  -datadir "$PWD/.zcr-dev/s6-upgrade/data"
```

报告在 `.zcr-dev/s6-upgrade/host-report.json`。驱动通过 AddonManager 安装较新 XPI，再回退到较旧 XPI；核对手握、`signedOut` 与 records 保留，**不发送**。`--upgrade-xpi` 只与 `--s6` 一起使用，且两个 XPI 必须是不同版本的本地文件。

`updates.json` 仍是 `https://zcr-dev.invalid/…` 占位。Git 干净 checkout 重建、无系统 Node 的机器、以及从 GitHub Release 下载仍未执行。

当前专用 Zotero 9.0.6 流程：S1 通过 27/27 检查；S2 通过 12/12 已执行检查、3 项因账户限额未运行；S3 通过 23/23 已执行检查、2 项因账户限额未运行；S4 `--s4` 通过 40/40 已执行检查、5 项 NOT RUN（不发送模型请求）；S5 `--s5` 通过 17/17 已执行检查、1 项 NOT RUN（进行中 turn）；S6 `--s6` virgin 通过 15/15 已执行检查、2 项 NOT RUN；S6 两版本宿主通过 19/19 已执行检查、2 项 NOT RUN（不发送）。完整结果见 [S0/S1 QA 记录](qa/s0-s1.md)、[S2 QA 记录](qa/s2.md)、[S3 QA 记录](qa/s3.md)、[S4 QA 记录](qa/s4.md)、[S5 QA 记录](qa/s5.md)、[S6 QA 记录](qa/s6.md) 与 [A01–A30 矩阵](qa/acceptance-v0.1.md)。

### 插件记录、备份与可分享诊断

生产记录写在当前 Zotero profile 下的 `zotero-codex-reader/v1/`，不是系统 Application Support 里的独立应用目录：

| 子目录 | 内容 |
| --- | --- |
| `records/` | 附件索引（`papers/*.json`）、对话快照（`conversations/*.json`）和请求日志（`conversations/*.jsonl`） |
| `account/` | 插件专用 `CODEX_HOME`（官方登录状态）。不要复制、提交或贴到 issue |
| `home/`、`scratch/`、`tmp/` | 随包 Codex 的运行目录 |

对话正文、选区原文和请求日志是私有数据。侧栏「复制诊断」只复制 `shareableDiagnostics` 白名单（插件版本、Codex 版本、错误代码、请求数量、各 `RequestState` 计数，以及无用户名的通用存储位置）；不能靠替换 token 的正则把日志当已脱敏。默认不保存原始 stdio/stderr。

备份或迁移时复制整个 `zotero-codex-reader/v1/` 目录；损坏的会话文件会原样保留并报告 `HISTORY_UNAVAILABLE`，不要用空文件覆盖。从 Zotero 删除该目录等于清除插件本地记录，不等于删除 ChatGPT/Codex 云端历史，也不影响用户自己的 Codex CLI。首版不提供跨设备同步。开发验证只使用 `.zcr-dev/`，不要用日常 profile 做这些操作。

## 并行与审阅

默认一个任务一个写入负责人。Cursor 人工编辑、Cursor Agent、Codex IDE 和 Codex CLI 不同时改同一 checkout 的同一文件。

UI 与协议核心需要并行时使用独立 worktree；每个工作者先确认分支、工作目录、文件范围和任务依赖。公共 contracts 的变更由一个负责人处理，其他任务更新调用方。

真实 Zotero 调试默认串行使用开发环境。若确需同时运行两个调试实例，为每个实例提供独立 profile、data directory、插件状态和 Codex 子进程；不能只隔离 Git 目录却共用可写测试状态。

每项审阅关注四点：是否达到用户操作结果、是否扩大权限或范围、失败时是否保留内容/避免重复请求、是否有实际测试证据。命名/样式一致性通过项目规范和静态检查处理，避免把审阅耗在格式上。

## 从开发到 GitHub

1. 保持已经通过当前开发与宿主检查的 S0–S5 预览可构建；限额恢复后补齐 S2/S3 的真实回复与停止检查，并补跑 A23–A24 与进行中 turn 的 resume。
2. 完成 30 项验收，区分 PASS/FAIL/NOT RUN；当前汇编见 [acceptance-v0.1.md](qa/acceptance-v0.1.md)。
3. 从干净 checkout 构建完整 macOS arm64 XPI，附准确版本与许可资料。
4. 在没有系统 Node/Codex CLI 的干净环境，从实际下载的 XPI 安装使用。
5. 准备 GitHub draft/prerelease，作者审核具体资产后发布；公开下载后再验证安装与升级。

Intel Mac 只有通过同等验收后才进入支持表；Node 测试能在多个 OS 运行，不代表 Zotero 已支持这些平台。

相关文档：[项目决策](project-decisions.md)、[用户流程](zotero-codex-user-flow.md)、[分阶段实施计划](superpowers/plans/2026-09-08-zcr-implementation-stages.md)、[历史文档归档](archive/README.md)。
