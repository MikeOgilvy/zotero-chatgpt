# 仓库重构计划（Repository Refactor Plan）

本文件是 **勘察与迁移计划**，不是重构本身。它把仓库当前真实状态（code / unit test / 真实宿主 / 真实模型 / 发行物五级证据分开标注）与目标架构对照，给出可逐步执行、每步都能验证的迁移路线。

- 目标架构以 [模块设计](module-design.md) 与 [产品规格](zotero-chatgpt-user-flow.md) 为准；当前进度与证据边界见 [进度](progress.md)。
- 本计划遵守 [AGENTS.md](../AGENTS.md)：不改代码、不 push、不安装、不启动 Zotero、不接触真实 profile / library / 认证文件、不读认证文件。以上描述的是 Stage 0 的只读勘察；Stage 1 的代码改动由 owner 于 2026-09-18 单独授权，范围与约束见 §I 与 §L。
- 本文件最初作为 Stage 0 唯一新增的文档；Stage 1 起按 §I / §L 落地实现。

---

## 0. 文档定位、方法与证据基线

### 0.1 方法与证据级别

本计划中的每一条判断都附证据，并按下列级别标注：

| 级别 | 含义 |
| --- | --- |
| `code` | 直接读到的源码（附 `path:line`） |
| `unit test` | 单测/构建测试断言 |
| `real host` | 真实 Zotero 开发 profile + `.zotero-chatgpt-dev/` 合成 PDF 的宿主驱动结果 |
| `real model` | 真实 Codex 运行时输出 |
| `release artifact` | `dist/` 中的 XPI / SHA256SUMS |

无法定级的内容一律标注为 `[uncertain]` 或列入「需要人工判断」，不以猜测充当结论。mock 行为不当作模型输出。

### 0.2 Stage 0 基线（本次实际观测）

观测时间 2026-09-18，commit `2d3d75751d82ceaa9213c75fe5961108d5ee7e99`，工作树干净。

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npm run typecheck`（`tsc --noEmit`） | **PASS**（无输出） |
| lint | `npm run lint` | **PASS**（无输出） |
| 单测 | `npm run test:unit`（`vitest run`） | **PASS：79 文件 / 1073 用例全通过，0 跳过**，耗时 8.21s |
| 工具链 | `node -v` / `npm -v` | `v24.11.0` / `11.6.1` |
| 构建产物 | `ls dist` | `zotero-chatgpt-0.4.0a11-dev.xpi`、`SHA256SUMS`（存在） |

说明：`progress.md` 记录的旧基线是 1071 passed / 2 skipped，那是尚未打出 XPI 时的数字；本次 `dist` 已有发布物，因此没有 skip。这个数字以后可能随 `dist/` 是否存在而变，Stage 0 应把它记录成「当前值 + 条件」，不要当常量。

**未运行**（按任务约束）：`package:dev`、`install:dev`、`verify:install`、`release:dry-run`、`verify:artifacts`、任何宿主驱动（`tests/host/**`）。因此本文件的 `package` / `install` / 宿主 / 模型 / 发行物结论全部来自既有文档、静态阅读或子代理报告，不来自本次执行。

### 0.3 本次未读清单（诚实边界）

- 未逐行读：`packages/zotero/src/chat/view.ts`（1659 行，只读结构与跨模块调用，细节依赖子代理报告）、`packages/zotero/src/preferences/pane.ts` 与 `history-section.ts` 全量、`packages/zotero/src/reader/layout.ts` / `toolbar.ts` / `selection-actions.ts` / `packages/zotero/src/runtime/generated-image.ts`。
- 未读源码：`scripts/*.mjs` 的逐行实现（由子代理报告）、`tests/**/*.test.ts` 的用例体（只读了 `tests/build/dependency-boundaries.test.ts`）、`assets/sidebar.css` 全文、`locale/`、`package-lock.json`。
- 未验证：任何 `real host` / `real model` / `release artifact` 级别的断言（本任务禁止执行）。
- 全部 `path:line` 引用基于 commit `2d3d757`；后续任何改动都可能移位。

---

## A. 实际代码勘察（Inspection）

### A.1 顶层结构

```
zotero-chatgpt/
├─ packages/
│  ├─ contracts/     纯领域契约与校验；无 DOM / Node / Zotero
│  ├─ core/          会话、上下文、Codex 传输、任务、workspace；无 Zotero / DOM
│  └─ zotero/        适配层：Zotero API、Reader、UI、偏好设置、运行时接线
├─ runtime/          随包 Codex App Server 发行身份（manifest.ts、model-capabilities.ts）
├─ scripts/          构建 / 打包 / 发行校验 / 运行时资产 / 宿主测试准备
├─ tests/            build / contracts / core / zotero / runtime / host / fixtures
├─ build/            生成的构建中间件（非源码）
├─ dist/             生成的 XPI 与 SHA256SUMS（非源码）
└─ assets/ sidebar.css、locale、第三方运行资产
```

三个 workspace 由根 `package.json` 的 `workspaces` 声明。**注意**：`packages/core` 的 `package.json` 没有声明对 `@zotero-chatgpt/contracts` 的依赖，所有跨包 import 都是相对路径 `'../../contracts/src/...'`（`code`：见任意 core 文件首行）。依赖方向由测试而非包管理器约束。

### A.2 `packages/contracts`（契约，无依赖）

| 文件 | 内容（`code`） |
| --- | --- |
| `src/index.ts` | `PaperScope`、`PaperIdentity`、`Citation`、`DocumentRevision`、`GenerationSettings`、`Message`、`Conversation`、`SendInput`、`RequestState`/`MessageStatus`、`RequestTiming`、`UsageReport`/`ContextReport`、`ReaderEvent`、`ReaderError`/`ErrorCode`、`Draft`、`ShareableDiagnostics`，以及 `paperId`、`advanceRequestTiming` 等纯函数 |
| `src/document.ts` | `DOCUMENT_BYTES` 上限、`DocumentRevision`/`DocumentPage`/`DocumentContext`/`DocumentSummary`、`validateDocument`/`validateRevision`/`documentSummary` |
| `src/native.ts` | `NativeReaderPort`（只读）与 `NativeActionPort extends NativeReaderPort`（写入）；读写端口在类型层面已分离 |
| `src/runtime.ts` | `ProcessPort`/`ManagedProcess`、`StoragePort`、`ReaderClient`、`RuntimeSnapshot`、`AccountStatus`/`LoginFlow`、`ModelOption`、`RuntimeFailure` |
| `src/tasks.ts` | `ActionTaskRecord`、`ActionTaskItemStatus`、`ActionTaskChoices`、`ActionTasks`（含 `approve`/`cancel`/`reconcile`/`undo`/`list`） |
| `src/workspace.ts` | `WorkflowKind`、`Personalization`、`ReaderSkill`、`WorkspaceSettings`、`ReaderReference`、`HistoryEntry`/`HistorySource`、`ReaderWorkspace`、`LibraryReferencePort`、`PickedFile` |
| `src/validation.ts` / `workspace-validation.ts` | 全部 `validate*` 入参校验与上限 |
| `src/clone.ts` | Gecko 下 `structuredClone` 不可用时的 JSON 深拷贝 |

### A.3 `packages/core`（领域编排，无 Zotero / DOM / Node）

- `codex/transport.ts` `RpcTransport`：stdin/stdout 上的 JSON-RPC，请求/通知/超时/中止。
- `codex/reader-policy.ts`：`PAPER_THREAD_POLICY`（base/developer instructions）、`readingInput`、`EXPLAIN_QUESTION`，以及运行时是否只读的校验。
- `codex/models.ts`、`codex/model-capabilities.ts`：运行时 `model/list` 解析、`parseThreadUsage`、`buildContextBudget`（预算估算，非 tokenizer）。
- `codex/history.ts`：`thread/read` 只用于重启对账，从不暴露给侧栏。
- `codex/errors.ts`：把 `codexErrorInfo` 映射为稳定 `ErrorCode` + 固定文案（不回传上游自由文本）。
- `sessions/service.ts`（872 行）`ReaderService`：会话编排、请求生命周期（`accepted/dispatching/running/completed/cancelled/failed/uncertain`）、通知分发、重启对账（`code: sessions/service.ts:45` 附近的 `hashInput`/`reconstructInput`）。
- `sessions/store.ts` `ConversationStore`：`conversations/<id>.json` 快照 + `.jsonl` 请求日志 + `papers/<scope>.json` 索引；`schemaVersion: 1 | 2 | 3`；单写者串行队列（`code: sessions/store.ts:146-151`）。
- `sessions/log.ts` / `sessions/diagnostics.ts`：只追加请求日志、白名单可分享诊断。
- `context/coordinator.ts` `ReadingCoordinator`：多轮阅读作业（`reserved/submitting/running/cancelling/completed/cancelled/failed`）的调度、取消、持久化。
- `context/planner.ts` `planContext`：按预算选择页/片段，产出 `coverage.reason`（gap 说明的唯一权威来源）。
- `context/bibliography.ts`：纯格式化。
- `tasks/controller.ts`（409 行）`ActionTaskController`：审批、意图、账本、对账、撤销的唯一属主；`parseAnnotationCandidates` 也在这里。
- `workspace/store.ts` / `skills.ts` / `history.ts` / `allowed-models.ts`：workspace 持久化、内置与用户 skill、历史管理、模型 allowlist。
- `index.ts`：`createReaderClient`（把 `RuntimeSession` + store + 进程端口接成 `ReaderClient`）、`shareableDiagnostics`。

### A.4 `packages/zotero`（适配 + UI）

- 入口：`bootstrap.js`（XPI 入口，`Services.scriptloader.loadSubScript('content/zchatgpt.js')`）→ `src/index.ts`（**唯一组合根**，插件生命周期）。
- `src/reader/`：`dock.ts`（DOM 挂载/宽度/缩放 workaround）、`document.ts`（`ReaderDocumentCache`，PDF 文本抽取 + 有界缓存）、`reader-pane.ts`（`NativeReaderPane` + `ReaderLayoutController`）、`selection.ts`（`captureSelection`/`freezeCitationVersion`/`openCitation`）、`source-highlight.ts`（`locateQuoteOnPage` + 导航）、`locate.ts`（纯文本定位）、`layout.ts`、`toolbar.ts`、`selection-actions.ts`、`host-types.ts`（Zotero 内部 API 的类型声明，唯一的类型级宿主耦合点之一）。
- `src/library/`：`native-read.ts`（`NativeReaderPort` 实现）、`native-support.ts`（共享 host 访问/校验/`waitRead`）、`reference.ts`（`LibraryReferencePort`：文章搜索、PDF 阅读、打开条目、**选文件**、页面截图、导出图片）。
- `src/actions/native.ts`：`NativeActionPort` 实现（创建/删除注释、创建条目、加入 collection、撤销、获取 OA PDF）。
- `src/host/native.ts`：Zotero 内部对象与文件系统的深层类型。
- `src/runtime/`：`supervisor.ts`（Codex 进程生命周期 + `ReaderClient`）、`local-services.ts`（先于运行时的本地服务）、`gecko.ts`、`prepare.ts`、`storage.ts`、`bundled.ts`、`process.ts`。
- `src/chat/`：`view.ts`（1659）、`presenter.ts`（1352）为核心，其余为 `workspace-view`、`task-view`、`context-view`、`source-links`、`render-answer`、`command-menu`、`draft`、`generation-settings`、`message-time`、`pick-images`、`text-scale`、`ui-locale`。
- `src/preferences/`：`pane.ts`（585）、`history-section.ts`（568）、`service.ts`（JSON-text 桥）、`entry.ts`（面板沙箱入口）、`registration.ts`（面板注册）、`preferences/preferences.xhtml`。

### A.5 关键运行时入口与生命周期（`code`）

`src/index.ts` 的顺序（`code: packages/zotero/src/index.ts:222-271`）：

1. `runtime = createRuntimeSupervisor(rootURI, version)`；
2. `documentCache = new ReaderDocumentCache(...)`；
3. `localServices = createLocalServices(geckoHost().host, Zotero, clientId(), documentCache)`；
4. `Zotero.ItemPaneManager.registerSection({ paneID: 'codex-reader', ... })`（原生面板本身故意隐藏）；
5. `preferencesBridge().ZoteroChatGPTPreferencesHost = createPreferencesService(...)`；
6. `createPreferencePaneRegistrar(...).ensure()`；
7. `Zotero.Reader.registerEventListener('renderToolbar', attach)` / `('renderTextSelectionPopup', onSelectionPopup)`；
8. `Zotero.Notifier.registerObserver({ notify: reconcile }, ['tab'])`。

生命周期分级（`code`）：插件级 `runtime` / `localServices` / `documentCache` / `presenters`（**每个 attachment 一个 presenter，活得比 view 长**）/ `citationVersions`；窗口级 `windows`；reader 级 `readers`；dock 挂载级 view（每次 `render` 都重建 DOM 与本地 view 状态）；请求级 `submissions` / `sendFlights` / `documentJob`。draft 与 scroll 由 presenter 持有，所以 view 重建不丢草稿。

---

## B. 当前架构重建

### B.1 依赖方向（实际）

```
                ┌──────────────────────────────────────────────┐
                │ packages/zotero  (host + UI + composition)   │
                │  index.ts ─┬─ reader/*   library/*  actions/* │
                │            ├─ chat/*     preferences/*        │
                │            └─ runtime/*  host/*               │
                └───────┬───────────────────────┬──────────────┘
                        │ (相对路径 import)      │ 只经由 contracts 端口
                        ▼                       ▼
                ┌──────────────────┐   ┌────────────────────────┐
                │ packages/core    │──▶│ packages/contracts     │
                │ sessions/context │   │ 纯类型 + validate      │
                │ codex/tasks/ws   │   │ 无任何上层 import      │
                └──────────────────┘   └────────────────────────┘
```

静态约束由 `tests/build/dependency-boundaries.test.ts` 强制（`unit test`），今日断言**恰好 7 条**：

1. 解析出 100+ 条依赖边，其中必须包含 `zotero/src/actions/native.ts → library/native-read.ts` 与 `library/reference.ts → reader/document.ts`；
2. `contracts` 不得 import 非 contracts 包；
3. `core` 不得 import `zotero` 包；
4. `contracts`、`core` 不得出现 `node:` / `zotero` / `chrome://` import；
5. `reader`、`library` 读侧不得依赖 `zotero/src/actions/`；
6. `chat` 不得 import `zotero/src/actions/`；
7. `zotero/src` 下不得存在 `agent` 目录。

### B.2 真实运行流程

**聊天主链路（Chat，当前唯一链路）**

```
view.ts (input/send)
  → presenter.send → sendDraft                       [zotero/src/chat/presenter.ts:981]
    → loadLocal / captureWorkspace                   [core/workspace/store.ts]
    → connect → runtime.supervisor.ensureStarted()    [zotero/src/runtime/supervisor.ts]
        → prepareRuntime → bundled 校验 → ProcessPort[gecko.ts]
        → createReaderClient → RpcTransport ⇄ Codex App Server (stdio)
    → ensureConversation                              [core/sessions/store.ts]
    → requestDocument(range, signal)                  [zotero/src/reader/document.ts]
        → TextPdf.getPageData（本地抽取，非模型）
    → previewReference → library.read                [zotero/src/library/reference.ts]
    → planInput → estimateBudget/buildContextBudget + planContext
    → 分叉：ReadingCoordinator.start/enqueue           [core/context/coordinator.ts]
             或 client.send(input)                     [core/sessions/service.ts]
    → 通知回流：ReaderEvent → presenter.sync → snapshot → view.render
```

**动作链路（Agent 能力，附加在聊天链路上）**

```
skill workflow='annotate' 的答案完成                     [core/workspace/skills.ts:40-44]
  → presenter.planReturnedAnnotations                     [presenter.ts:520]
    → parseAnnotationCandidates（直接 import core/tasks）  [presenter.ts:13]
    → ActionTaskController.planAnnotations                [core/tasks/controller.ts]
        → native.resolveQuote（NativeReaderPort）           [library/native-read.ts]
  → status='review' → 用户 approve
  → ActionTaskController.execute → NativeActionPort        [actions/native.ts]
  → ledger 记录 + reconcile + undo
```

`workflow: 'acquire' | 'diagram'` 走同一 `submit` 内的分支处理（`code: presenter.ts:1098-1104`），这是当前「模式」的**唯一实际载体**。

### B.3 隐藏耦合与混合职责（证据）

| 位置 | 问题 | 证据 |
| --- | --- | --- |
| `chat/presenter.ts`（1352 行） | 事实上的 application service：会话、草稿持久化、上下文预算/规划、模型目录对齐、任务规划、原生导航、**大量 UI 文案**都在一个类里 | `planInput` `1047`、`estimateBudget` `1032`、`submit` `1086`、`STALE_PROFILE_MESSAGE` `:17`、`openTaskSource` 里手搓 `Citation` `:551` |
| `chat/view.ts`（1659 行） | 纯 DOM 文件却持有模型目录策略、context report 语义、reader 缩放、剪贴板路由 | 子代理证据：`renderPicker` `1355-1461`、`contextDetailNodes` `286-311`、`pick-images` 路由 `787-812` |
| `src/index.ts` | 组合根同时做 host I/O、领域身份构造（`paperOf`/`paperIdentityFor`）、presenter 工厂 | `code: index.ts:52-113` |
| `preferences/pane.ts` | 设置表单内联模型 allowlist 逻辑（carry-through / 空列表拒绝） | 子代理证据：`syncModels` `323-343`、`saveAllowedModels` `487-500` |
| `library/reference.ts` | 读侧文件里混入**写/IO 动作**：`pickFile`、页面截图、导出图片 | `contracts/src/workspace.ts` 的 `LibraryReferencePort` 定义在 workspace 契约里 |
| 全局可变状态 | `src/index.ts` 模块级 `readers` / `windows` / `presenters` / `citationVersions` 可变 Map | `code: index.ts:43-44` |
| 双写者风险 | `ConversationStore` 与 `WorkspaceStore` 各自读同一批 conversation 文件；`WorkspaceStore.removeConversation` 删除，`ConversationStore.remove` 也删除 | `code: sessions/store.ts:280-296`；`core/workspace/store.ts` |
| 每 attachment 一个 presenter | presenter 按 `paperId` 缓存且长于 view，跨 tab 共享状态，无显式「一个文件一个 owner」检查 | `code: index.ts:43, 111` |
| 预算逻辑重复 | presenter 的 `estimateBudget` 与 core 的 `buildContextBudget` 语义重叠；生产环境 `contextBudget` seam 不注入，走 presenter 兜底 | `code: presenter.ts:1032-1046` |
| 会话 id 跨系统复用 | `task.conversationId`、`readingJob.conversationId` 与 conversation id 直接耦合 | `code: core/tasks/controller.ts`、`core/context/coordinator.ts` |

---

## C. 与目标架构的差异

目标分层：`contracts` → `core` → `zotero` → application/UI entrypoints。

### C.1 已经符合的部分

- 分层方向真实存在且有测试强制，`contracts`→`core`→`zotero` 没有被反转（`unit test`：dependency-boundaries）。
- 读写分离已落地：`NativeReaderPort` / `NativeActionPort` 类型分离，`library/` 与 `actions/` 目录分离，读侧禁止依赖写侧（`code` + `unit test`）。
- `core` 不依赖 DOM / Zotero / Node（`unit test`：断言 4）。
- 文档、上下文、校验、任务、workspace 的概念在 `contracts` 中都已存在，不是空壳。
- 偏好设置在 `preferences/service.ts` 的 JSON-text 桥后已隔离。

### C.2 违反分层或概念混淆的部分

| 违反 | 证据 | 说明 |
| --- | --- | --- |
| `chat` 直接 import `core/tasks`（Agent 专属基础设施） | `code: presenter.ts:13` `parseAnnotationCandidates` | Chat 路径因此隐式依赖 Agent 基础设施，违反「Chat 不依赖 Agent」 |
| UI 文件承担模型/预算/Reader 语义 | `view.ts`、`generation-settings.ts` | 目标里这些应属于 core 策略 + 注入端口 |
| 组合根承担领域身份 | `index.ts:52-61` | `paperIdentityOf` 已存在 core，应由 `zotero` 纯适配调用，不做二次领域逻辑 |
| 「模式」没有显式契约 | 只有 `WorkflowKind`（`read/annotate/acquire/diagram`） | Chat/Agent 是隐含的 skill 选择结果，不可冻结、不可观测、不可单测 |
| `CurrentDocument` / `ReaderContext` 没有单一属主 | 见 F 节 | `PaperScope`（身份）+ `DocumentContext`（抽取文本）+ `Citation`（选区）+ reader 状态分散在 4 个模块 |
| 文件 IO 动作在读端口里 | `library/reference.ts` `pickFile`/`exportImage` | 目标里文件动作属于 action 边界 |
| 预算估算两处实现 | `presenter.ts:1032` 与 `core/codex/model-capabilities.ts:104` | 未注入 seam 时生产走 presenter 副本 |

### C.3 缺少的组件

1. **显式的请求模式契约**：`mode: 'chat' | 'agent'`，随请求冻结、随记录持久化、参与 hash。
2. **共享文档上下文层（`ReaderContext`）**：把「当前 PDF 身份 + 冻结版本 + 选区 + 页范围 + 布局/缩放 + 页码映射」收敛为一个由 core/zotero 共享读取的对象，而不是 presenter 里的一堆 `document.*` 字段。
3. **Agent 能力端口**：把 `parseAnnotationCandidates` / task 规划从 presenter 的静态 import 提升为注入端口（`PresenterServices.getTasks` 已有雏形）。
4. **模式门禁测试**：现有 dependency-boundaries 没有断言「Chat 路径不触达 tasks/actions」。

---

## D. Chat Mode 与 Agent Mode 设计

### D.1 产品语义

- **Chat Mode**：对话式、只读的论文阅读器。用户 → 共享文档上下文 → chat/model runtime → 回答。**不需要写工具，不需要动作编排。**
- **Agent Mode**：可执行的阅读器。用户 → 共享文档上下文 → agent runtime → tools/actions → 必要时审批 → 执行 → 账本/对账 → 回答。
- 两者**共享**：session、当前 PDF 上下文、文档检索、bibliography/quote/page 引用、reader 状态、会话历史。
- 两者**不共享**：动作基础设施。Agent 可以依赖 action 层，Chat **不得**依赖。

### D.2 在本仓库中的结构落点

当前代码已经提供了几乎全部需要的接缝，不需要新框架：

| 概念 | 现有承载 | 结论 |
| --- | --- | --- |
| 模式值 | `WorkflowKind = 'read' \| 'annotate' \| 'acquire' \| 'diagram'`（`contracts/src/workspace.ts`） | 复用其语义：`read` → Chat；其余 → Agent。再引入 `RequestMode = 'chat' \| 'agent'` 作为请求级冻结字段，避免让 UI 用 skill 名反推模式 |
| 请求冻结点 | `presenter.sendDraft` → `submit`（`presenter.ts:981-1125`），已有 `frozenWorkflow`（`:1013`）先例 | 在同一处冻结 `mode`，与 skill / profile / 权限 / 模型设置并列 |
| 共享层 | `contracts`、`core/sessions`、`core/context`、`core/codex`、`core/workspace`、`zotero/reader`、`zotero/library`（只读）、`zotero/runtime` | 不改 |
| Agent 专属层 | `core/tasks`、`zotero/actions`、`NativeActionPort` 及其注入 | 只能在 Agent 模式被构造/调用 |
| 分界线 | `PresenterServices.getTasks` / `getReading`（`presenter.ts:28-41`）注入端口 | 强化为**唯一**入口；移除 presenter 对 `core/tasks` 的静态 import |

### D.3 请求路径

```
Chat Mode:
  user → ReaderContext（共享） → core/sessions（只读 policy） → Codex turn → response
  （不构造 ActionTasks，不注册任务订阅，不出现 approve/undo）

Agent Mode:
  user → ReaderContext（共享） → core/sessions → Codex turn
       →（可选）ActionTaskController.plan* → review → approve
       → NativeActionPort 执行 → ledger → reconcile / undo → response
```

`core/codex/reader-policy.ts` 的 `PAPER_THREAD_POLICY` 已经是只读指令集，Chat 模式可直接复用；Agent 模式不改它，而是在其上叠加 task 编排。

### D.4 冻结与持久化

- `mode` 进入 `SendInput`，由 `validateSendInput` 校验（`contracts/src/validation.ts`）。
- 进入 `Message`（用户消息）与请求记录，使重启对账能还原同一模式；`hashInput` 需要 **`hashVersion: 3`**，同时保留对 v2 记录的 `reconstructInput`（`core: sessions/service.ts`）。这一点是硬约束：任何 hash 变更必须同时能重建旧记录，否则已写入的记录会变成 `uncertain`。
- 模式**每轮冻结**，不随 UI 切换追溯已有请求；切模式只影响下一轮。
- Chat 记录永不携带 task 引用；Agent 记录才允许 `task id`。

### D.5 必须避免的事

- 不复制 `ConversationPresenter`、`ReaderService`、`DocumentCache` 来做第二套模式（违反不变量 8）。
- 不新建 `agent` 目录或恢复 `agent` 术语（违反 dependency-boundaries 断言 7）。
- 不让模式成为「权限授予」：`skills.ts:44-48` 已明确 skill 不授予权限，模式同样只是路由，最终写入仍必须经 approve。

---

## E. 历史架构搜寻（Legacy Hunt）

已用 ripgrep 扫过 `packages/`、`runtime/`、`scripts/`、`tests/`、`docs/`（排除 `node_modules`、`dist`、`.zotero-chatgpt-dev`）。**源码中不存在 `TODO` / `FIXME` / `HACK` / `XXX` / `obsolete` / `shim`**（仅在 `package-lock.json` 有误命中）。

| 发现 | 位置 | 它实际做什么 | 建议 |
| --- | --- | --- | --- |
| `paneID: 'codex-reader'`、`data-pane="codex-reader"` | `zotero/src/index.ts:231`、`assets/sidebar.css` | 改名后的遗留字符串，仅作 DOM/注册 id | 保留（改它需同步 CSS 与测试）；如改名，独立提交 |
| host driver 里的 `native-agent` 字符串 | `tests/host/native-action-driver.ts` | 旧术语残留 | 可删（阶段 7） |
| `archivedAt` | `contracts/src/workspace.ts`、`core/workspace/history.ts:6-12`、`sessions/store.ts:131-133` | 旧版归档字段，现在**只读**；没有任何写入路径 | 保留为兼容读取，标注「temporary compatibility」；不要新增 archive UI |
| conversation `schemaVersion: 1 \| 2 \| 3` 读取分支 | `sessions/store.ts:55-138` | 旧记录兼容与 v2/v3 文档拆分 | 保留；删除是不可逆数据风险 |
| v2 `requests` 的 `permissionMode: 'read' \| 'diagram'` | `sessions/store.ts:126` | 早期「权限模式」概念，现已不写 | 保留读取；这是 Chat/Agent 的**前身**，新 `mode` 不要复用它 |
| `contracts/native.ts` 的 `capturePage` | `library/reference.ts` 附近 | 无生产调用者，仅测试与宿主驱动使用 | 阶段 7 评估；先保留 |
| `ui-locale.ts` 里的 `.zchatgpt-workspace-settings*` / `select[name=detail|mathematics|workflow]` / `.zchatgpt-workspace-editor` | `chat/ui-locale.ts:141-144, 299` | 已删除的 workspace 编辑器选择器，只在 CSS 与测试 fixture 中存在 | 阶段 7 删除（连同 `assets/sidebar.css` 对应块） |
| `renameForm.append(renameInput, saveName)` 重复调用 | `chat/view.ts:497-498` | 第二次是 no-op | 阶段 7 删除一行 |
| `renderReaderShell` 的 `close` 参数 | `view.ts:327`（`void close`）、`index.ts:145` 仍传参 | 死参数 | 阶段 7 删除参数与调用点实参 |
| `ChatViewHooks.writeTextScale`、`pasteTargets` | `view.ts:26, 28, 855` | 无生产调用者 | 阶段 7 删除 |
| presenter 的 `savePreferences` / `saveAppearance` / `saveProfile` / `deleteProfile` / `saveSkill`、`copyDiagnostics`、`setDocumentEnabled`、`setDocumentRange`、`selectProfile` | `presenter.ts:418-455, 613-623, 1336` | **仅测试调用**，对应 UI 已移除 | 阶段 7 与测试一起评估；不要先删（会先破坏单测） |
| `TaskViewActions.availability` | `chat/task-view.ts:17` | 生产不注入，`available?` 守卫永远为真 | 阶段 7 删除，或补上生产注入 |
| `docs/progress.md` 里 `data-zchatgpt-output` 的说法 | `docs/progress.md:131` | 与当前代码不符的陈旧表述 | 阶段 7 做一次小型文档订正（需报告） |
| 运行时注释里的 `0.144.1` | `core/codex/errors.ts:2` | pin 版本注释未随 0.154.0 更新 | 注释订正；不是兼容层 |
| 「Codex App Server」「codex-*」命名 | `runtime/manifest.ts` 等 | **真实外部产品名**，不是遗留 | 保留 |
| `packages/core` / `@zotero-chatgpt/core` | 全局 | 真实包名 | 保留 |

未发现：旧的 session 实现、实验性 pipeline、废弃 tool API、未知 feature flag、第二套 workspace 概念、blanket 兼容层。

---

## F. 模块归属表（Module Ownership）

「目标 owner」是本计划建议的**唯一**属主；「当前 owner」若与目标不同，说明存在分散或歧义。

| 概念 | 当前 owner（证据） | 目标 owner | 是否歧义 |
| --- | --- | --- | --- |
| `CurrentDocument`（当前打开的 PDF） | 无单一类型：`PaperScope`（身份，`index.ts:52`）+ `DocumentContext`（文本，`contracts/document.ts`）+ `readers` map（`index.ts:43`） | `packages/zotero/src/reader/context.ts`（新增，聚合层） | **是**（分散 3 处） |
| `ReaderContext`（身份+冻结版本+选区+页范围+reader 状态） | 不存在；字段散在 `PresenterState.document`（`presenter.ts:88`）、`reader/reader-pane.ts`、`reader/selection.ts` | `packages/zotero/src/reader/context.ts` + `contracts` 中的只读快照类型 | **是**（缺失） |
| 文档检索（PDF 文本抽取/缓存） | `packages/zotero/src/reader/document.ts`（`ReaderDocumentCache`） | 同左（KEEP） | 否 |
| 文章/条目检索 | `packages/zotero/src/library/reference.ts` | 同左，但 `pickFile`/`exportImage` 迁出 | **是**（读端口混写入） |
| chat session | `packages/core/src/sessions/service.ts` + `store.ts` | 同左 | 否 |
| agent session | 不存在独立实现；复用 chat session | 复用 `core/sessions`，不新建 | 否（需在文档中固定这一决定） |
| conversation history（列表/过滤/删除） | `core/workspace/history.ts` `HistoryManager`（偏好设置侧）+ `core/sessions/store.ts`（侧栏侧）+ `core/workspace/store.ts` | 统一以 `core/sessions/store.ts` 为唯一存储属主，`HistoryManager` 只做查询/校验视图 | **是**（两个 store 都能删文件） |
| model / runtime 抽象 | `contracts/src/runtime.ts` + `zotero/src/runtime/*` | 同左 | 否 |
| agent runtime | 不存在独立运行时 | 不新建；Agent = 同一 runtime + `core/tasks` | 否 |
| Zotero library 读 | `packages/zotero/src/library/{native-read,native-support}.ts` | 同左 | 否 |
| Zotero 写入 / actions | `packages/zotero/src/actions/native.ts` | 同左 | 否 |
| 文件动作（选文件/截图/导出） | `packages/zotero/src/library/reference.ts` | `packages/zotero/src/actions/files.ts`（新增） | **是** |
| approvals | `packages/core/src/tasks/controller.ts` | 同左 | 否 |
| action ledger | `packages/core/src/tasks/controller.ts` | 同左 | 否 |
| reconciliation | `core/tasks/controller.ts`（task）+ `core/sessions/service.ts`（request）+ `core/context/coordinator.ts`（reading） | 同左；三者边界写进不变量 | 否（但需明确三者不互相接管） |
| undo | `packages/core/src/tasks/controller.ts` | 同左 | 否 |
| workspace 持久化 | `packages/core/src/workspace/store.ts` | 同左 | 否 |
| preferences | 三个 owner：`contracts/src/workspace.ts`（`Personalization`）、`core/workspace/store.ts`（持久化）、`zotero/src/index.ts`（`clientId`/`automaticPdfText`/`sidebarWidth` 等 Zotero pref）+ `zotero/src/preferences/*`（UI） | 持久化归 `core/workspace/store.ts`；Zotero 原生 pref 键归 `packages/zotero/src/preferences/service.ts`；UI 归 `pane.ts` | **是** |
| skills | `packages/core/src/workspace/skills.ts` + `store.ts` | 同左 | 否 |
| source / quote references | `contracts` 的 `Citation` + `zotero/src/reader/source-highlight.ts`（定位）+ `chat/source-links.ts`（渲染绑定）+ `reader/locate.ts`（纯定位） | 定位纯逻辑归 `core` 或 `reader/locate.ts`；渲染归 chat；`Citation` 契约归 contracts | **是**（3 处共同决定「源」） |
| 模型目录展示策略 | `core/workspace/allowed-models.ts` + `chat/generation-settings.ts` + `preferences/pane.ts` | 策略归 core；UI 只渲染 | **是**（策略被抄进两个 UI） |
| 请求级上下文预算 | `core/codex/model-capabilities.ts` + `chat/presenter.ts:1032`（生产兜底副本） | core 唯一；presenter 只调用注入端口 | **是** |
| 请求模式 | 无 | `contracts`（类型）+ `presenter.submit`（冻结点） | **是**（缺失） |

---

## G. 当前 → 目标迁移映射

动作定义：KEEP（保留）/ KEEP BUT MOVE（保留但迁移位置）/ REFACTOR（保留职责、改接口）/ MERGE（合并重复）/ SPLIT（拆分）/ REPLACE（替换）/ DELETE（删除）。

| Current path/module | Current responsibility | Target location | Action | Notes |
| --- | --- | --- | --- | --- |
| `contracts/src/index.ts` | 全部核心类型 + 错误 + 纯函数 | `contracts/src/{request,conversation,citation,errors}.ts` | SPLIT | 大文件；拆分是纯移动，可先做 |
| `contracts/src/document.ts` | 文档校验 | 不变 | KEEP | 已是干净契约 |
| `contracts/src/native.ts` | 读写端口分离 | 不变 | KEEP | 读/写分离是核心资产 |
| `contracts/src/runtime.ts` | 进程/存储/client 端口 | 不变 | KEEP | — |
| `contracts/src/tasks.ts` | 动作任务契约 | 不变 | KEEP | — |
| `contracts/src/workspace.ts` | workspace 契约 **+ `LibraryReferencePort`** | 拆出 `contracts/src/library.ts` | SPLIT | 读端口混在 workspace 契约里，属归属混乱 |
| `contracts/src/validation.ts` | 请求校验 | 增加 `mode` 校验 | REFACTOR | Stage 1 |
| `contracts/src/workspace-validation.ts`、`clone.ts` | 校验 / 深拷贝 | 不变 | KEEP | — |
| `core/src/index.ts` | `createReaderClient` + 诊断 | 不变 | KEEP | — |
| `core/src/codex/*` | 协议、模型、预算、错误映射 | 不变 | KEEP | `model-capabilities.ts` 是预算唯一权威 |
| `core/src/sessions/service.ts`（872） | 请求生命周期 + 事件 + 恢复 | 拆出 `recovery.ts` / `dispatch.ts` / `events.ts` | SPLIT | 需先补单测覆盖再拆 |
| `core/src/sessions/store.ts` | 会话/日志/索引持久化 | 不变，成为 conversation 唯一存储属主 | KEEP | 见 F 的双写者风险 |
| `core/src/workspace/store.ts` | workspace/draft/skill/历史持久化 | 去掉 `removeConversation` 的写入职责 | REFACTOR | 删除必须委托 `sessions/store.ts` |
| `core/src/workspace/history.ts` | 历史列/过滤/删除编排 | 只保留查询与校验 | REFACTOR | 「删除」应走 session store |
| `core/src/context/{coordinator,planner,bibliography}.ts` | 多轮阅读、预算、书目 | 不变 | KEEP | 共享层核心 |
| `core/src/tasks/controller.ts` | 审批/账本/对账/撤销 | 不变（可后续再拆 ledger） | KEEP | Agent 专属；此阶段不动 |
| `zotero/src/index.ts` | 组合根 + host I/O + 领域身份 | 拆出 `composition/presenters.ts`、`composition/reader.ts` | SPLIT | 只搬接线，不改行为 |
| `zotero/bootstrap.js` | XPI 入口 shim | 不变 | KEEP | 外部宿主要求 |
| `zotero/src/reader/document.ts` | PDF 抽取 + 缓存 | 不变 | KEEP | 不要提前抽象 |
| `zotero/src/reader/{dock,layout,reader-pane,selection,selection-actions,source-highlight,toolbar,locate,host-types}.ts` | Reader 集成 | 归入显式的 reader context 层，`locate.ts` 保持纯函数 | KEEP BUT MOVE | 只做归属声明，不合并文件 |
| `zotero/src/reader/context.ts` | — | **新增**：`ReaderContext` 聚合（身份+版本+选区+范围+布局） | REPLACE（替代分散字段） | Stage 2 的核心产出 |
| `zotero/src/library/native-read.ts`、`native-support.ts` | Zotero 只读访问 | 不变 | KEEP | 已是读侧边界 |
| `zotero/src/library/reference.ts` | 搜索/读 PDF/打开条目 **+ 选文件/截图/导出** | 保留读逻辑；IO 动作移到 `zotero/src/actions/files.ts` | SPLIT | 需先抽接口（`LibraryReferencePort` 已存在） |
| `zotero/src/actions/native.ts` | Zotero 写入 | 不变，成为动作边界 | KEEP | **后期前不要动** |
| `zotero/src/host/native.ts` | Zotero 内部类型 | 不变 | KEEP | — |
| `zotero/src/runtime/*` | 进程/存储/准备/监督 | 不变 | KEEP | 高风险区，后置 |
| `zotero/src/chat/presenter.ts`（1352） | 会话+草稿+预算+规划+任务+导航 | 拆 `draft-store.ts`、`request-pipeline.ts`、`capabilities.ts` | SPLIT | **必须先抽接口**；移除 `core/tasks` 静态 import |
| `zotero/src/chat/view.ts`（1659） | 侧栏 DOM | 拆 `model-picker`、`context-report-view`、`composer` | SPLIT | 只搬，不改渲染细节 |
| `zotero/src/chat/{draft,task-view,workspace-view,context-view,source-links,render-answer,command-menu,generation-settings,message-time,pick-images,text-scale,ui-locale}.ts` | 侧栏子模块 | 不变（`generation-settings` 的策略下沉 core） | KEEP | 策略下沉属 Stage 3 |
| `zotero/src/preferences/*` + `preferences.xhtml` | 偏好设置 UI/桥 | 不变；`pane.ts` 的 allowlist 逻辑改为调用 core | KEEP | 已隔离 |
| `runtime/*` | 发行身份 | 不变 | KEEP | 禁止改 |
| `tests/build/dependency-boundaries.test.ts` | 分层门禁 | 增加 Chat/Agent 边界断言 | REFACTOR | Stage 1 起持续扩展 |
| `tests/{contracts,core,zotero,runtime}/**` | 回归网 | 不变 | KEEP | 拆分前先补覆盖 |
| `tests/host/**` | 真实宿主驱动 | 不变 | KEEP | 本任务禁止运行 |
| `scripts/*.mjs` | 构建/发行 | 不变 | KEEP | — |
| `build/`、`dist/` | 生成物 | 不变 | KEEP | 不手改 |

**分类汇总**：

- 基本可原地迁移：`contracts/*`、`core/codex/*`、`core/context/*`、`core/workspace/*`、`zotero/reader/*`、`zotero/library/native-read.ts`、`zotero/actions/native.ts`、`zotero/runtime/*`。
- **必须先抽接口**：`chat/presenter.ts`、`chat/view.ts`、`core/sessions/service.ts`、`zotero/src/index.ts`、`library/reference.ts`。
- 混合职责：`presenter.ts`、`view.ts`、`index.ts`、`preferences/pane.ts`、`library/reference.ts`、`workspace/store.ts`。
- 暂时保留的兼容胶水：conversation `schemaVersion` 读取分支、`archivedAt` 只读、`permissionMode` 读取、`paneID: 'codex-reader'`。
- 可安全删除（阶段 7）：`writeTextScale`、`pasteTargets`、`renderReaderShell` 的 `close`、重复的 `renameForm.append`、过期 `ui-locale` 选择器、测试专用的 presenter CRUD（与测试同步删）。
- **后期前不得触碰**：`zotero/src/actions/*`、`core/src/tasks/*`、`zotero/src/reader/document.ts` 的 revision/hash 逻辑、`runtime/*`、`scripts/*`、宿主驱动、真实 profile。

---

## H. 高风险依赖

| 风险 | 证据 | 失败模式 | 安全拆除顺序 |
| --- | --- | --- | --- |
| R1 `chat` → `core/tasks` 静态 import | `code: presenter.ts:13` | 拆分 presenter 时 Agent 依赖被带进 Chat；Chat 模式无法脱离 action 基础设施 | ① 先把 `parseAnnotationCandidates` 从 `core/src/tasks/controller.ts` 纯搬迁到 `packages/contracts`（D1，Stage 1 完成）；② 加 boundary 断言「chat 不得 import core/tasks」，搬迁后即为绿，不引入故意失败的测试；③ 后续再让 `getTasks` 成为唯一入口（Stage 4） |
| R2 组合根模块级可变 Map | `code: index.ts:43-44` | 并行 view/presenter 竞争；测试间串味；局部重构就可能引发跨 tab 状态泄漏 | ① 把 `presenters`/`readers`/`windows`/`citationVersions` 收进一个显式 `PluginRuntime` 对象；② 只在 `startup/shutdown` 创建/销毁；③ 加生命周期单测 |
| R3 conversation 双写者 | `code: sessions/store.ts:280-296`；`core/workspace/store.ts` | 偏好设置删除与侧栏保存并发 → 索引与文件不一致（历史上出现过 "Unknown conversation"） | ① 把删除收敛到 `sessions/store.ts`；② `HistoryManager` 退化为只读查询；③ 用现有 `unit test` 回归 |
| R4 presenter 直接做域逻辑（`openTaskSource` 手搓 `Citation`） | `code: presenter.ts:551-557` | UI 层复制领域构造规则，`Citation` 校验/页映射会漂移 | ① 在 core 提供 `citationFromAnnotation`；② presenter 只调用 |
| R5 `estimateBudget` 与 `buildContextBudget` 双实现 | `code: presenter.ts:1032-1046`；`core/codex/model-capabilities.ts:104` | 预算口径分叉，覆盖率说明与真实发送不一致 | ① 让组合根注入 `contextBudget`；② 删 presenter 副本；③ 用 planner 单测锁定 |
| R6 请求 hash 与持久化记录耦合 | `code: core/sessions/service.ts` 的 `hashInput`/`reconstructInput` | 加 `mode` 后若不同时支持 v2 重建，旧记录会被判 `uncertain` 或错认 | ① 先只读地枚举 hashVersion 分支；② 加 v2→v3 重建测试；③ 再落 `mode` |
| R7 会话 id 跨系统复用 | `code: core/tasks/controller.ts`、`core/context/coordinator.ts` 的 `conversationId` | 删除/归档会话时 task/reading job 变孤儿 | ① 在删除路径显式检查未完成任务（已有 `unfinishedWork` 语义，`core/workspace/history.ts:136-139`）；② 加断言测试 |
| R8 测试与实现细节绑定 | 测试专用 presenter 方法 `presenter.ts:418-455`；`ChatViewHooks.readTextScale` 仅测试注入 | 想删死代码时先破坏测试，导致不敢删 | ① 先补行为级测试；② 再删测试专用包装；③ 最后删死代码 |
| R9 宿主假设藏在工具函数 | `view.ts:855` 的 paste targets、`pick-images` 的 Gecko 特权剪贴板 | 非宿主环境（vitest）与真实宿主行为分叉，mock 通过 ≠ 宿主通过 | ① 把宿主访问收敛到 `index.ts` 注入的 hooks；② 需要宿主证据的改动必须跑宿主驱动（本任务不跑） |
| R10 包依赖未声明 | `packages/core/package.json` 无 `@zotero-chatgpt/contracts` 依赖，全部相对路径跨包 import | 构建顺序/工具链假设隐藏；package 边界不可靠 | ① 补 `package.json` 依赖并改用包名，或明确记录「相对路径是约定」；② 由 boundary 测试继续兜底 |

---

## I. 分阶段迁移计划

总原则：每阶段结束仓库必须可构建、可 typecheck、可 lint、可单测；每阶段只删除复杂度，不新增永久抽象层。

### Stage 0 — 安全基线（本次已完成，无代码改动）

- 目标：固定基线，冻结参考点。
- 动作：记录 `typecheck` / `lint` / `test:unit` 的实际结果（见 §0.2）；确认工作树只有本计划文件。
- 退出门禁：上表结果可复现。
- 回滚/风险：无。
- 宿主证据：不需要。

### Stage 1 — 契约与模式冻结（contracts）

- 目标：为 Chat/Agent 建立显式、可冻结、可单测的请求模式契约；不产生任何行为变化。
- owner 决策（2026-09-18，覆盖本文件旧表述）：
  - D1：把 `parseAnnotationCandidates` 先从 `core/src/tasks/controller.ts` 迁到 `packages/contracts`（零新增模块的纯搬迁），再让 boundary 断言在 Stage 1 即为绿；**不**交付故意失败的测试。
  - D2：模式用独立字段 `RequestMode = 'chat' | 'agent'` 承载，不扩展/复用 `WorkflowKind`。
  - D3：已持久化、没有 `mode` 字段的请求按 `'chat'` 解释。
  - D4：Stage 1 本次授权实施。
- 具体动作：
  1. `contracts/src/index.ts`：新增 `export type RequestMode = 'chat' | 'agent'`，并在 `SendInput` 加 `readonly mode?: RequestMode`；`Message` 加可选 `mode`（用于还原本轮模式）。
  2. `contracts/src/validation.ts`：`validateSendInput` 接受/校验 `mode`，只接受恰好 `'chat'`/`'agent'`；缺省语义固定为 `'chat'`（D3）并写进注释。
  3. `core/src/sessions/service.ts`：`hashVersion: 3` 纳入 `mode`，**同时**保留 v2 的 `reconstructInput`。
  4. `core/src/sessions/store.ts`：读写 `mode`（旧记录缺 `mode` 仍可读，按 D3 解释为 `'chat'`），不改变 `schemaVersion`，不迁移/重写旧记录。
  5. `chat/presenter.ts`：在 `frozenWorkflow` 同一处冻结 `mode`（缺省 `'chat'`，无 UI 变化，不门禁任何现有动作）。
  6. 先按 D1 迁移校验器，再在 `tests/build/dependency-boundaries.test.ts` 新增断言——`chat` 不得 import `core/src/tasks`；迁移后 Stage 1 即为绿。
- 接口变化：`SendInput.mode?`、`hashVersion: 3`。
- 退出门禁：`npm run typecheck`、`npm run lint`、`npm run test:unit`；新增 hash v2→v3 重建测试与 `mode` 校验测试通过。
- 回滚/风险：hash 变更不可逆地影响记录判读 → 必须先有 v2 重建测试（R6）。
- 宿主证据：不需要。

### Stage 2 — 共享文档上下文（ReaderContext）

- 目标：为「当前 PDF」建立单一属主，Chat/Agent 都从它读。
- 具体动作：新增 `zotero/src/reader/context.ts` 聚合身份/冻结版本/选区/页范围/布局；presenter 的 `document.*` 字段改为读该对象；给 `ReaderContext` 加只读契约。
- 退出门禁：typecheck/lint/test:unit；`tests/zotero/reader/*` 全绿；dependency-boundaries 全绿。
- 回滚/风险：presenter 是最大改动点 → 先加 `presenter.test.ts` 覆盖再改。
- 宿主证据：建议（非必须）用 `.zotero-chatgpt-dev/` + 合成 PDF 验证选区/页范围；本任务不执行。

### Stage 3 — Chat runtime 显式化

- 目标：Chat 路径不再触达 Agent 基础设施。
- 具体动作：把 presenter 的 chat-only 流程抽成 `request-pipeline.ts`；`generation-settings` 的策略下沉 core；启用 Stage 1 的新边界断言。
- 退出门禁：Stage 1 的失败断言转为通过；typecheck/lint/test:unit。
- 回滚/风险：若断言无法通过，保留临时 adapter 并在文档标记 temporary compatibility，不得让树不可构建。
- 宿主证据：需要（Chat 只读行为）；本任务不执行。

### Stage 4 — Agent capability 端口化

- 目标：Agent 专属能力只经注入端口进入。
- 具体动作：`parseAnnotationCandidates` 移出 presenter；`getTasks`/`getReading` 成为唯一 Agent 入口；组合根里显式装配 Agent 能力。
- 退出门禁：typecheck/lint/test:unit；新增「Chat 模式不构造 ActionTasks」单测。
- 回滚/风险：动作路径是最高风险区 → 不改 `actions/native.ts` 与 `tasks/controller.ts` 语义。
- 宿主证据：**需要**（需真实宿主审批/撤销），本任务不执行；没有宿主证据前不得宣称动作行为正确。

### Stage 5 — Zotero 适配层收口

- 目标：读写边界与文件动作归属清晰。
- 具体动作：`library/reference.ts` 的 `pickFile`/截图/导出移到 `actions/files.ts`；`contracts/workspace.ts` 拆出 `library.ts`；`core/workspace/store.ts` 交出删除写入。
- 退出门禁：typecheck/lint/test:unit；dependency-boundaries（读侧不依赖写侧）。
- 回滚/风险：`LibraryReferencePort` 被偏好设置与侧栏共用 → 先抽接口再搬。
- 宿主证据：需要（真实文件选择/导出）；本任务不执行。

### Stage 6 — UI 集成 Chat/Agent 开关

- 目标：用户可见的模式切换，且不改共享层。
- 具体动作：`view.ts` 增加模式控件；presenter 暴露 `setMode`（只影响下一轮）；`mode` 随请求冻结与持久化。
- 退出门禁：typecheck/lint/test:unit；模式切换单测；需要真实宿主的 UI 证据（缩放/IME/焦点/滚动锚点保持）。
- 回滚/风险：UI 改动可能破坏阅读锚点 → 宿主回归不可省。
- 宿主证据：**必须**。

### Stage 7 — 遗留清理

- 目标：删除已确认死代码与过期文档表述（E 节清单）。
- 具体动作：删死 hooks/参数/重复行；删过期 `ui-locale` 选择器与 CSS；与测试同步删测试专用 presenter 方法；订正 `progress.md:131`、`errors.ts:2` 注释。
- 退出门禁：typecheck/lint/test:unit；`npm run package:dev` + `npm run verify:artifacts`（由有权限者执行）。
- 回滚/风险：逐条独立提交，便于回滚。
- 宿主证据：建议。

**关于「哪一阶段无法保持可构建」**：按本计划分步实施时，任何阶段都**不允许**留下不可构建的树；唯一无法保持构建的是「跨阶段大爆炸移动」（例如同时移动 `contracts` 拆包 + presenter 拆分 + actions 搬迁）。Stage 4 若无法在保持构建的前提下完成端口化，必须保留临时 adapter 并显式标注，而不是让树变红。

---

## J. 架构不变量（Architecture Invariants）

未来任何 agent 不得违反：

1. 当前打开的 PDF 是隐式上下文；用户不需要上传/附加。
2. Chat Mode 与 Agent Mode 共享同一份文档上下文（同一 `ReaderContext`，不得各建一份）。
3. Chat Mode 只读：不得产生任何 Zotero 写入。
4. Chat Mode 不要求 Agent/action 基础设施（不得 import `core/tasks` 或 `zotero/actions`）。
5. `core` 不直接依赖 Zotero 私有 API。
6. 所有 Zotero 写入必须经过显式 action 边界（`NativeActionPort`）。
7. 领域契约有明确唯一属主（见 F 节）。
8. 同一子系统不得有并行实现（不得复制 session / context / document cache）。
9. 旧兼容代码是临时的、显式标注的，不得成为永久架构。
10. 每个迁移阶段应减少复杂度，而不是新增一个永久抽象层。

由本仓库实际代码额外证明必须补充的：

11. 已持久化请求的 `settings` 与 hash 必须可重建：任何 hash 变更必须保留对旧 `hashVersion` 的还原（证据：`core/sessions/service.ts` 的 `hashInput`/`reconstructInput`）。
12. 同一份 conversation 文件只能有一个写入负责人（证据：R3 双写者）。
13. Zotero 宿主 API 只能在 `zotero` 包内出现，且类型级集中声明（证据：`reader/host-types.ts`、`host/native.ts`；boundary 断言 4）。
14. 不得新建 `agent` 目录或恢复 `agent` 术语（证据：boundary 断言 7）。
15. 模式（`mode`）只是路由，不授予权限；写入仍需显式批准（证据：`core/workspace/skills.ts:44-48`「skill 不授予权限」）。
16. 文档抽取是本地能力，不经模型（证据：`reader/document.ts` 直接调用 `TextPdf.getPageData`）；任何把 PDF 上传模型的行为都是方向性错误。

---

## K. 反过度设计护栏（Anti-Overengineering Guardrails）

本仓库历史上多次调整产品方向（Codex-first → 通用聊天 → 读写分离 → Chat/Agent），因此必须明确**不要发明**：

| 不要发明 | 原因 |
| --- | --- |
| 通用插件框架 / 事件总线 / 中间件管线 | 当前只有 3 个包、单一插件；没有第二个消费者 |
| 没有当前消费者的泛化抽象（如通用 `Tool`/`Capability` 注册表） | 唯一动作路径是 task 审批；引入注册表只会掩盖归属 |
| 长期并存的新旧两套架构 | `archivedAt`、`permissionMode` 这类兼容读取必须显式标注临时，不得再增加 |
| 不必要的向后兼容 | 旧字段只在**读取**时兼容，不允许继续写入新数据 |
| 巨型 service 对象 | `presenter.ts`、`sessions/service.ts` 已是教训；拆分目标是减少职责，不是换个更大的类 |
| 依赖注入容器 / 装饰器 / 反射 | 现有 `PresenterServices` 函数式注入已足够 |
| 新的持久化层 / ORM | `StoragePort` + JSON 快照 + 追加日志已验证；不要替换 |
| 把 PDF 上传给模型 | 与产品规格和 `reader/document.ts` 的本地抽取直接冲突 |
| 新的 `agent` 目录/术语 | boundary 断言禁止 |

本仓库的偏好（应写进 review checklist）：概念更少、层数更少、属主显式、依赖方向明确、接口小而稳定、优先删除死代码。

---

## L. 建议的第一个实施阶段（Recommendation）

**执行 Stage 1 — 契约与模式冻结（contracts + frozen mode）。** 它是唯一在零行为变化下就能消除「模式不可观测」这一核心架构缺口的阶段，并为后续所有阶段提供门禁。

**owner 已决（2026-09-18）**：D1 先搬迁 `parseAnnotationCandidates` 再让 boundary 断言为绿（不交付故意失败的测试）；D2 用独立 `RequestMode` 字段，不复用 `WorkflowKind`；D3 旧记录缺省为 `'chat'`；D4 本阶段现在实施。

文件级、按序任务：

1. `packages/contracts/src/index.ts`
   - 新增 `export type RequestMode = 'chat' | 'agent';`
   - `SendInput` 增加 `readonly mode?: RequestMode`；`Message` 增加可选 `mode`。
2. `packages/contracts/src/validation.ts`
   - `validateSendInput` 接受并校验 `mode`（只接受 `'chat'`/`'agent'`）；文档化「缺省 = `'chat'`」。
3. `tests/contracts/validation.test.ts`（或既有同名文件）
   - 新增 `mode` 缺省/合法/非法值用例。
4. `packages/core/src/sessions/service.ts`
   - `hashInput` 升到 `hashVersion: 3` 并纳入 `mode`；
   - 保留并测试 v2 → v3 的 `reconstructInput`，旧记录不得因 hash 变化被判 `uncertain`。
5. `packages/core/src/sessions/store.ts`
   - 允许读取/写入 `mode`；旧记录缺 `mode` 仍可读、按 D3 解释为 `'chat'`，不改变 schemaVersion、不迁移旧记录。
6. `packages/zotero/src/chat/presenter.ts`
   - 在 `frozenWorkflow` 同一处冻结 `mode`，默认 `'chat'`；不新增 UI，不门禁现有动作。
7. 先按 D1 把 `parseAnnotationCandidates` 从 `core/src/tasks/controller.ts` 纯搬迁到 `packages/contracts`，再在 `tests/build/dependency-boundaries.test.ts`
   - 新增断言：`packages/zotero/src/chat/**` 不得 import `core/src/tasks/**`。搬迁完成后该断言在 Stage 1 即为绿，不引入故意失败的测试。

**完成门禁（必须全部实际运行）**：`npm run typecheck`、`npm run lint`、`npm run test:unit`，并记录用例数变化；新增的 hash 重建测试与模式校验测试必须通过。

**本阶段不得做**：

- 不得改 `core/tasks/*`、`zotero/actions/*` 的任何行为；
- 不得新增模式 UI、不得改 `view.ts` 交互；
- 不得删除任何旧字段（`archivedAt`、`permissionMode`）；
- 不得迁移/重写任何已持久化记录；
- 不得为了让新 boundary 断言变绿而删除 presenter 的功能；D1 之后它本就应为绿；
- 不得运行 `package:dev` / `install:dev` / 宿主驱动。

---

## 附录 1：需要人工判断（Needs Human Judgment）

1. **「当前 PDF」是否需要一个新契约类型**（例如 `CurrentDocument` / `ReaderContext` 是否进 `contracts`，还是只存在于 `zotero` 适配层）。代码里 `PaperScope`（身份）与 `DocumentContext`（抽取文本）已存在，新增类型有重复风险，需 owner 决定。
2. **模式的最小载体** — **已决（owner 2026-09-18）**：使用新的独立字段 `RequestMode = 'chat' | 'agent'`，**不**扩展或复用 `WorkflowKind`。值是每轮请求冻结的显式契约，可观测、可单测；`WorkflowKind` 语义不变。
3. **`mode` 缺省语义** — **已决（owner 2026-09-18）**：已持久化且没有 `mode` 字段的请求一律解释为 `'chat'`；只影响解释，不据此迁移或重写旧记录，hash 仍按各自 `hashVersion` 重建。
4. **conversation 存储唯一属主**：是否允许 `WorkspaceStore` 继续持有 `removeConversation`（当前偏好设置删除依赖它），还是全部委托 `ConversationStore`。
5. **`capturePage` 的去留**：无生产调用者，但被宿主驱动与测试使用；不确定是否计划保留截图能力。
6. **测试专用 presenter 方法**（`saveSkill`/`saveProfile`/`setDocumentRange` 等）是删除，还是补回真实 UI 入口。
7. **`packages/core` 是否改用包名 import**（现为相对路径）——是补齐 `package.json` 依赖，还是把「相对路径跨包」正式定为约定。
8. **`paneID: 'codex-reader'` / CSS 类名是否改名**：属对外可见标识，改名需宿主回归与用户设置迁移判断。
9. **Preference 键归属**：`clientId` / `automaticPdfText` / `sidebarWidth` 等 Zotero 原生 pref 是否并入 `WorkspaceSettings`。
10. **`reader/host-types.ts` 与 `host/native.ts` 的边界**：两个类型声明的分工是否明确，还是需要合并/重命名。

## 附录 2：本计划未验证的断言

- 所有 `real host` 级别的行为（缩放、IME、焦点、滚动锚点、审批/撤销、真实文件 IO）**未在本次验证**；Stage 3-6 必须由 owner 在有权限的环境执行。
- 所有 `real model` 行为（真实 Codex 输出、模态支持）**未验证**；本文件没有把任何 mock 当作模型输出。
- `release artifact` 级别只确认了 `dist/` 文件名存在，未运行 `verify:artifacts`。
- 行号与文件行数基于 commit `2d3d757`；任何代码改动都会使行号漂移，执行时以符号名与注释为准。
