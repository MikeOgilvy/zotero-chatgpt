# 架构与契约

本文描述 **0.4.0a16 工作树实现**。产品行为由[产品规格](zotero-chatgpt-user-flow.md)定义，命令见[开发与测试](development.md)，已验证范围和剩余问题统一见[进度与验收](progress.md)。代码、单元测试、真实宿主、真实模型和最终 XPI 是不同层次的证据。

运行路径为 Zotero 9 原生扩展 → TypeScript core → Gecko Subprocess 私有 stdio → 随包 Codex App Server。Node 24 只用于构建和测试。模型没有通用脚本、库写入或文件系统工具；本地阅读、标注、文献导入通过有明确输入和权限边界的原生端口完成。

产品默认路径是 **Chat Mode**：在当前 PDF/附件上阅读、推理与问答。**Agent Mode** 是 Codex 执行：`core/tasks` 里的原生任务编排（候选 → 确定性校验 → 审批 → 原生动作 → 结果账本 → 撤销）只在显式工具调用与任务授权时运行。两种模式共用一个会话、一份文档上下文和一套模型展示，但**不共用执行生命周期**：Chat 不创建线程/轮次/任务/审批，也不消耗 Agent 执行额度。默认阅读路径不因 Agent Mode 的存在而改变。

**Chat Mode / Agent Mode 共用同一个文档上下文层。** Reader 产生 Current Document Context（Zotero 书目与附件身份、PDF 文本、当前页、选区、邻近文本、标注、引用与页定位信息），两种模式都从它取数；区别只是该轮是否暴露 `core/tasks` + `zotero/actions` 的写入能力。不存在第二套 reader 管道，模式也不是两个层：

```text
                               ┌ Chat Mode  → ChatExecutor  → ChatTransport（普通补全）
Reader → Current Document Context → ExecutionRouter ┤
                               └ Agent Mode → AgentExecutor → Codex 线程/轮次 → 工具/动作 → 结果
```

上下文分层取用（轻量元数据 / 即时 reader 上下文 / 按需全文检索），不要求每轮整篇发送；模式随每轮请求冻结并写入请求快照，切换模式不新建会话、不丢草稿、不重放写入。完整产品行为见[产品规格](zotero-chatgpt-user-flow.md)。

### Chat / Agent 执行路径与能力边界

Stage 8 起，两种模式不再是同一个 `submit()` 里的分支，而是两条具名执行路径，模式调度只看当轮冻结的 `mode`：

```text
submit()  ──mode=chat──▶ chat/chat-execution.ts   只读上下文 + 推理 + 回答
          └─mode=agent─▶ chat/agent-execution.ts  任务编排 / 多轮阅读 / 工具动作
```

- `chat/chat-execution.ts` 是 Chat 路径。它拿到只读端口与一次请求，只能拒绝并发出一条请求。它**不**接受任何 Agent 能力参数，也**不** import 阅读协调器（`core/context/coordinator`）、`core/tasks` 或 `zotero/actions`，因此结构上无法创建任务或启动阅读作业。Agent-only 的 skill、明确的库/PDF 变更指令、以及需要多轮阅读的超大上下文，都在这里被拒绝并提示切换到 Agent Mode。
- `chat/agent-execution.ts` 是 Agent 路径，是唯一会 `planAcquisition` 或 `reading.start`/`reading.enqueue` 的地方。它通过 presenter 注入的 `ports`（`tasks()`/`reading(client)`）触达能力，端口的所有权、缓存与订阅仍在 presenter。
- `submit()` 只按冻结的 `mode` 调用上述二者之一；共享的文档准备、引用校验、上下文预算与计划仍留在 presenter，两种模式共用。
- 边界不只由前端保证：会话服务在接受任何请求前调用 `core/chat/mode-boundary.ts` 的 `assertModeBoundary()`，任何 `mode !== 'agent'`（含缺省）却携带 Agent 工作（`batch` 多轮阅读，或非 `read` skill）的请求都以 `UNSUPPORTED_INTERACTION` 拒绝，既不落记录也不起 turn；阅读协调器 `create()` 同样拒绝 Chat 请求，其每一步 `makeRequest()` 又显式把 step 冻结为 `mode: 'agent'`（含恢复旧作业）。因此绕过 presenter 的直接调用也无法以 Chat 创建阅读作业或原生任务；带 PDF 文档、引用与图片的普通只读请求不受影响。
- `refreshTaskState()` 只在 `state.mode === 'agent'` 时运行；`setMode('agent')` 才按需 hydrate。Chat Mode **不初始化 Agent 能力**（`ActionTasks` 或 `ReadingCoordinator`）覆盖其三条可能触达能力的路径：**发送**（`chat-execution.ts`，结构上无能力）、**刷新**（`refreshTaskState` 按模式门禁）、以及**删除**（见下）。
- 删除会话时的「未完成原生任务 / 未完成阅读作业」忙碌检查会获取任务端口与阅读端口，因此它受一个显式条件约束：`this.state.mode === 'agent'` **或** `conversationHasAgentWork(conversation)`。后者是 `core/chat/agent-work.ts` 的纯函数，只看该会话自身记录——某个 `message.mode === 'agent'`，或（旧记录）非 `read` 的 `workflow.skill.workflow`，或 `message.batch`（只由阅读协调器写入，因此也覆盖 Stage 6–7 从 Chat 轮次升级出阅读作业那段遗留数据）。文案与拒绝行为不变：仍抛 `BUSY` 且从不调用 `cancel`/`undo`。真实数据里未完成任务/阅读作业必然伴随上述某一种消息，所以纯 Chat 会话的删除不会初始化能力，而任何真实保护都不失效。
- `chat/capability.ts` 定义唯一的 Agent 能力接口 `AgentCapability`（组合根仍以 `PresenterAgent` 名注入）。边界由 `tests/build/dependency-boundaries.test.ts` 静态强制：Chat 执行模块不得 import 协调器/任务/写入实现，且 `ChatSendContext` 不得含 `agent` 成员——加回该成员会让 `HasAgentMember` 类型断言编译失败。
- 判定「这是不是一条动作指令」由 `core/chat/action-intent.ts` 的纯函数完成，无模型调用；规则保守，疑问句与主题介词一律判为普通问答。

### Core 执行边界：一个 Router，两个平级 executor

presenter 决定「这一轮是不是动作」；`core/sessions/service.ts`（共享会话控制器）决定「这一轮用哪个执行运行时」。二者之间只有一个选择点：

```text
send()/enqueue() → ReaderService.dispatch(run)
                     └ ExecutionRouter.select(run.input.mode)
                        ├ chat  → ChatExecutor → ChatTransport（抽象端口）
                        └ agent → AgentExecutor → Codex App Server（线程 / 轮次 / 工具 / 任务）
```

- 契约在 `contracts/src/execution.ts`：`ExecutionMode`、`ChatRequest`、`ChatContext`、`ChatStreamEvent`（`chat.started` / `chat.delta` / `chat.completed` / `chat.failed` / `chat.cancelled`）、`ChatTransport`、`ChatExecutorPort`、`AgentExecutorPort`。两个 executor 是**平级**类型，没有继承也没有互相包装。
- `core/conversation/execution-router.ts` 是唯一按 `mode` 选择运行时的地方；缺省或未知 mode 一律是 chat（D3）。别处再出现「按 mode 选运行时」的 `if` 就是把两条路径重新耦合。
- Chat 路径（`core/chat/executor.ts`）只做一次会话式补全：没有线程、轮次、任务、审批、工具、配额与恢复。它不 import `core/codex`、`core/sessions`、`core/tasks`、`core/context/coordinator`，由 `tests/build/dependency-boundaries.test.ts` 静态强制。
- **ChatTransport 是尚未落地的平台集成边界。** 本 build 只装 `core/chat/chat-transport.ts` 的诚实占位实现：`available=false`，请求以 `UNSUPPORTED_INTERACTION` 明确失败并提示切到 Agent Mode。它不会退回 Codex，也不是「无工具的 Codex 轮次」；等有受支持的 ChatGPT Chat 传输再实现同一端口，Router、共享控制器与 Agent 运行时都不需要改动。
- **没有自动升级。** 长提示、整篇 PDF、复杂推导、`contextReport: multi-pass` 都不会把 Chat 变成 Agent。Chat 里出现动作指令时，`chat-action` 与 `assertModeBoundary` 在发送前拒绝并提示切换；模式只由用户显式切换。
- **事件与取消也分开。** Chat 的响应生命周期走共享的 `ReaderEvent`（`accepted` / `delta` / `messageCompleted` / `completed` / `failed` / `cancelled`）与请求记录（`requestTiming` 的 accepted/firstText/settled、`lastEventAt`），因此「Responding… / Waiting Ns」读的是共享请求状态，不依赖 Agent 的 turn/task 事件；`usage`、`turn/*` 只属于 Agent。Stop 在 Chat 上 abort 本地流并调用 `ChatTransport.cancel`，绝不发 `turn/interrupt`。
- **恢复策略不同。** 只有被中断的 Agent 请求是 `uncertain`（可能需要 `thread/read` 对账）；被中断的 Chat 请求没有副作用也没有可对账的线程，直接记为 `failed`，不阻塞会话。
- 临时诊断：`ReaderOptions.trace` 注入 sink 后，每条线都从真实对象取值（冻结 mode、被选中的 executor、`run.turnId !== null`），例如 `[conversation] mode=chat`、`[execution-router] executor=chat`、`[chat] request_started request=…`、`[agent] runtime_started=false`。默认关闭。
- 验收测试 `tests/core/execution-boundary.test.ts` 在进程边界上把 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 当作 Codex Agent 运行时的入口断点：chat 请求（含带 PDF、超长提示、动作指令）从不命中，agent 请求必然命中。

### 惰性 Codex 启动与运行时分界（0.4.0a16）

打开侧栏、列会话、在 Chat 档发送都**不启动、不连接、不握手**随包 Codex：组合根只用本地 `StoragePort` 构造唯一的共享 `ReaderClient`，构造本身不发任何 RPC。`createReaderClient` 因此不再是「构造即握手」，它接受两种 `ManagedProcess | ConnectCodex`：测试注入已生成进程，生产注入惰性连接器。

- 随包 Codex 的进程与协议通道由 `zotero/src/runtime/agent-runtime.ts` 的 `AgentRuntime` 独占，并且**按需**创建。只有 Agent 档需要的路径（切到 Agent 档、`refreshAccount`、官方登录、Agent 发送、retry）才取 `connection()`；`prepareRuntime`（建私有目录、校验并解包随包可执行文件）与 spawn 也只在那一刻发生。`connection()` 复用仍然可用的通道，失败或 `restart()` 后才释放旧句柄再取新通道；`stop()` 是唯一终止入口。
- Chat 路径没有隐藏回退。`ChatTransport` 不可用时，`ReaderService.send` 在任何 Codex 检查（账户、模型目录、线程）之前就以 `UNSUPPORTED_INTERACTION` 明确拒绝；`hasAgentWork` 让对账与补发路径对纯 Chat 会话不触达上游。缺 runtime 时本地历史、草稿、改名与删除仍然可用。
- 运行时分界由真实宿主验证，而不是只由单元测试断言：`tests/host/context-driver.js` 在专用 profile 上先只走 Chat（断言没有任何 Codex 进程、私有运行目录不存在），再显式切到 Agent 档（断言目录与进程才出现），并在 Chat 档确认「Responding… / Waiting Ns」不被伪造点亮。证据等级与结果见[进度与验收](progress.md)。


## 分层与依赖方向

目录边界就是模块边界，由 `tests/build/dependency-boundaries.test.ts` 静态强制：

```text
packages/contracts       领域契约：文献身份、消息、工作区、runtime、原生端口与动作任务
        ↑
packages/core            与宿主无关的领域逻辑
  codex                  Codex App Server 协议：JSONL、握手、模型/能力/用量、策略、恢复历史
  sessions               会话、请求哈希、持久化队列、上游线程、取消与对账
  context                全文/聚焦/分批计划、预算、来源缓存、书目格式化
  workspace              离线历史、草稿、图片资产、偏好、研究主题、SKILL.md
  tasks                  动作任务编排：审批、写入意图、结果账本、对账、撤销
        ↑
packages/zotero          Zotero 适配与 UI
  host                   Zotero 9 私有宿主表面（items/collections/translators/HTTP/file I/O）
  reader                 当前附件、dock/缩放/选区、文本与版本校验、原文定位、页面图像
  library                读取侧：引用搜索、条目/附件读取、引文定位、文件名/图钉读取、页面栅格化
  actions                写入侧：标注、条目、集合成员关系、OA 附件与精确快照撤销
  chat                   Presenter 与视图投影、统一输入、历史/任务/上下文、Markdown 与 KaTeX
  preferences            Zotero 原生偏好设置面板（pane、注册、服务、历史管理节）
  runtime                本地服务、GeckoStorage、发行资产校验、生成图像加载、按需启动的 Agent 运行时（Codex 进程与协议通道）
```

依赖只能向上：contracts 不依赖 core/zotero；core 不依赖 zotero、DOM 或 Node；`reader`/`library` 不依赖 `actions`，`chat` 不依赖 `actions` 实现。`actions` 实现 `NativeActionPort`，其读取方法由 `library` 的 `NativeReaderPort` 提供，所以**只读构建可以完全跳过写入侧**。`agent` 不是层名：工具/动作执行就是 `core/tasks` 加 UI/skill 通过端口驱动的调用。同理，Chat Mode / Agent Mode 不是两个层，而是同一层之上的两种请求策略：Chat Mode 只用只读端口（`reader`/`library`/`codex`/`context`），Agent Mode 额外接入 `core/tasks` 与 `zotero/actions`。这两条策略现在落在 `chat/chat-execution.ts` 与 `chat/agent-execution.ts`：前者不得 import `core/context/coordinator`、`core/tasks`、`zotero/actions` 或能力类型，后者才经 presenter 注入的端口触达 Agent 侧。

`core/tasks/controller.ts` 是审批与原生写入意图的唯一所有者；`zotero/actions/native.ts` 只是无状态执行器，本身不保存审批或账本状态。

core 只依赖 contracts。bootstrap/index 负责组装；视图借用服务端口，不持有原始管道或账户目录。关闭 sidebar 或卸载某个视图不结束任务。原生任务、阅读批次和模型请求各自保存状态；它们不以一个仍然打开的阅读器窗口作为存续条件。

本地工作区和原生任务记录可在运行组件未启动、离线或未登录时读取。发送模型请求仍需可用 runtime 和官方登录。**Agent 运行时只管理自己启动的进程**，确认退出后才替换；打开侧栏或停留在 Chat 档不会创建该进程。插件关闭分别停止本地工作和 runtime，一方清理失败不能跳过另一方，也不能提前丢掉仍待终止的进程句柄。阅读协调器停止新派发并等待自己的写入结束后才能交给替代实例。

## 身份、发送与队列

`PaperScope` 是持久随机 profile `clientId`、`libraryId`、`attachmentKey` 的组合；数值 itemID 只用于当前宿主查找。标题、文件名或父条目不是附件身份，标签文字也不承担身份。正文与补充材料分别拥有会话和来源。

发送前复制问题、附件/库/profile、PDF 版本、选区、图像、引用、skill 版本、偏好和模型设置。文献内容与第三方 skill 只能提供数据，不能选择原生写入 key、集合、任意路径或新增权限。同名附件、切标签、编辑草稿和下一轮设置不改变已捕获的请求。

`requestId` 和输入 SHA-256 共同去重。新请求使用 `hashVersion: 2`，包括明确提供的书目信息；重建时保留字段缺省状态，不能补入另一个标题后改变哈希。旧 V1 哈希按旧规则核对。不同内容复用同一 ID 会被拒绝。

用户消息与 `accepted` 先保存，`dispatching` 在上游提交前保存，取得 turnId 后进入 `running`。仅持久化且从未派发的 accepted 请求可继续派发一次。dispatching/running 在连接中断后进入 uncertain，通过 `thread/resume` 和 `thread/read` 按请求 ID 对账；超时、重开视图和重启均不自动重发不确定写入。恢复后的上游 item ID 与本地消息绑定，避免把一段部分输出和完整输出存成两条回答。恢复历史与实时事件使用相同的工具活动边界。

同一会话只有一个 activeRequestId。`enqueue` 保存下一问题的完整快照，取消等待项不影响正在执行的请求；取消活动项先检查会话归属，并等待上游终态。`activeBatchId` 使普通问题排在整个多轮阅读批次后面，而非穿插进两次阅读之间。确认取消或结束批次后释放占用；存在活动/不确定轮次时不能强行释放。

视图先订阅再取快照，只应用 seq 大于 lastSeq 的事件。文本增量约 80ms 合并，消息结束与整个 turn 结束分别处理。改名、分支和重新生成保留来源；新分支不重放原生写入。模型、effort、serviceTier 按轮固定，实际目录不支持的组合会被拒绝。

## 当前 PDF、引用与预算

默认只准备当前附件；打开 PDF 可在本地逐页读取，外发发生在发送或已授权任务边界。上下文按“轻量元数据 / 即时 reader 上下文 / 按需全文检索”分层取用，不要求每轮整篇发送；只有预算可容纳且策略允许时才纳入全部授权文本。`@article` 搜索先返回元数据，选定后才读取对应 PDF。`@chat` 是明确消息的有界快照，不递归展开嵌套引用，也不被当作文献原始证据。

本地文本缓存最多保留 3 份结果，每份 **16 MiB UTF-8 文本**，超过上限要求缩小页范围，不静默裁剪。来源 ID 由文献身份、版本、解析器、页范围和文本摘要确定，LRU 驱逐不会把同一来源变成随机新身份。片段保留来源关联、物理页号、印刷页标签、空白/失败状态及实际覆盖；页内分块或不完整文本使用 partial。

本地上限不等于模型窗口。每轮先采用本模型/线程的有效 runtime 窗口报告，否则按固定 runtime/hash 对应的精确 model ID 目录值估算；无可靠值时明确未知。预算为指令、历史、工作流、问题、图像、输出和安全余量预留空间。UTF-8 字节近似 token、图像额度与安全余量均是保守策略，不是 tokenizer 实测、账户容量承诺或图像成本精确值。累计 total usage 不是当前上下文占用。

可容纳时发送全部授权文本；否则生成聚焦范围或多轮阅读计划。分批阅读固定原始问题、全部来源、设置及 request IDs，每个 map 和 reduce 使用新的上游线程；中间结果只来自已完成并保存的真实回答。reduce 只接收已完成的来源摘要，不再次堆入全部原文/图片。摘要或共享上下文超预算时暂停并说明，不能截短后冒充完成。最终 diagram 可用已验证图像作为成果；map 仍需文字证据摘要。批次状态与结果哈希另行持久化。

普通连续问答可在同一上游线程复用当前来源；压缩、恢复或失败后重新提供所需来源。缓存不代表服务端永久保留上下文，也不代表免计费。

## 本地记录与兼容性

基础目录是 Zotero profile 下的 `zotero-chatgpt/v1/`。目录中的 v1 是命名空间，不是所有文件的 schema 版本。

| 路径（相对基础目录） | 内容 |
| --- | --- |
| `records/papers/<client>-<library>-<attachment>.json` | 附件的会话索引 |
| `records/conversations/<conversation>.json`、同名 `.jsonl` | 会话快照与顺序请求状态日志 |
| `records/conversations/<conversation>.<document>.source.json` | 同一会话内不可变来源正文；消息保存来源摘要和引用关联 |
| `records/workspace/settings.json` | 偏好、研究主题、外观及 skill 注册元数据 |
| `records/workspace/skills/<skill-id>/SKILL.md` | 用户/导入 skill 的唯一正文 |
| `records/workspace/drafts/<client>-<library>-<attachment>-<conversation-or-unbound>.json` | 草稿、引用、设置、滚动位置和页范围 |
| `records/workspace/assets/<sha256>.json` | 按内容去重的草稿图片资产 |
| `records/tasks/<task>.json` | 原生任务候选、审批、写入意图与精确结果快照 |
| `records/reading/<job>.json`、`<job>.input.json`、`<job>.cancel.json` | 阅读批次状态、独立冻结输入/计划和取消标记 |
| `account/` | 插件专用 Codex home 和官方授权数据；生成输出只允许显式子目录 |
| `home/`、`scratch/`、`tmp/` | 运行环境、受限工作目录与临时文件，彼此为同级目录 |

新会话和新发送写 schema 3；读取兼容 schema 1、2、3。schema 1 的旧消息不要求文献正文；schema 2 的独立 source 文件结构继续使用；schema 3 增加工作流、引用来源、批次、用量、生成图像和上游消息关联。原生任务、阅读任务和工作区使用各自 schema，不跟随会话版本编号变化。`+` / New chat 标签在第一次发送之前不调用 `store.create`：未发送的 composer 只占屏幕上的 unbound 草稿，store 按调用方给出的标题原样写入，不再从兄弟记录派生 “讨论 N”。

加载时校验来源身份、引用关联、哈希和数据形状。缺失/损坏文件、未知 schema 与不支持的旧二进制会明确拒绝，保留原文件，不重置为空；这叫安全拒绝，不是“旧版本可继续写新记录”。降级/回滚的实际行为必须在隔离副本上验证。GeckoStorage 使用受限相对路径、符号链接检查、原子快照和 flush；请求日志支持坏尾恢复，但不宣称断电时目录级 fsync 或跨文件事务保证。

SKILL.md 正文与注册表不再维护两份副本。读取时从文件重新解析有限 frontmatter 和正文；UI 编辑与外部编辑通过 revision 冲突检查。旧内嵌正文迁移到 SKILL.md 后从注册表移除。内置 skill 来自随包定义，可启停，修改需复制。导入默认不启用；脚本、MCP、依赖等未支持能力不会执行，不能因导入或声明 permissions 获得权限。

## 原生任务与撤销

标注先将严格的模型候选 JSON 解析为原文引用，再按冻结 PDF 版本校验唯一文字位置和真实矩形。无法定位、歧义或几何不可靠时只保留建议。`planAnnotations` 按 modelRequestId 持久化去重；再次打开视图或恢复同一模型请求不会复制候选任务。准备阶段的取消会忽略迟到的只读结果。

只有任务批准后才执行被选中的写入。每次原生操作先保存 writing 意图；创建条目/标注先保留 key，修改已有条目保存其原快照。PDF 附件的 key 由宿主生成，账本先保存父条目和获取意图，成功后记录实际附件 key；结果不明时不能假定未写入而重试。`Annotations.saveFromJSON` 是按 key 更新的接口，适配器拒绝陌生已有 key；它自行调用 saveTx，不能外套另一个 DB transaction。原生写入有单独账本，不伪造为 assistant 消息。

获取流程使用显式 DOI/链接和目标 collection：原生翻译器返回未保存元数据 → DOI 查重 → 用户选择 → 创建或添加已有条目的集合成员关系 → 尝试 OA 附件。批准的元数据只接受固定字段，不携带 notes、tags、relations、路径或执行权限。下载只使用原生 OA 结果和经过逐跳校验的匿名 HTTP；PDF 类型、首页标题/DOI、补充材料标志及哈希不能确认时，保留正确元数据并报告未获取/不确定。OA 解析器提供的版本标签不冒充独立版本鉴定。

撤销只处理账本中仍与精确快照一致的输出：标注保护后续文字/颜色/标签等编辑；集合撤销只移除本任务添加的成员关系；新条目和附件在字段、文件哈希及子标注检查后移入原生垃圾箱，保留文件。未知写入先检查保留 key/结果，不盲目重试。丢失完整写后快照、无法判断后续人工修改的结果保持 uncertain，不把当前人工内容重新认作可撤销的任务成果。

## 运行时、图像与宿主适配

固定运行时由 `runtime/manifest.ts` 锁定 **Codex 0.154.0 / darwin arm64**、归档/二进制 SHA-256 和许可证。`app-server --strict-config`、配置值与来源校验、空执行环境目录、`CODEX_EXEC_SERVER_URL=none` 禁用 shell、外部工具、MCP、插件、记忆和任意环境继承。普通阅读不启用图像生成；明确选择 diagram 后才开启对应线程能力，并用运行时特性报告核实。下一次普通阅读恢复禁止生成，实时和恢复历史中的未授权工具活动都关闭连接。

输入图像每张 **2 MiB**，生成输出每张 **16 MiB**，不为适配上限自动缩图。输出只接受已完成 imageGeneration 的可验证 PNG/JPEG/WebP 内联数据或显式白名单目录中的文件，校验编码、magic、大小、路径和符号链接；未识别的编码不算成功。生成图与原文截图有不同 origin。已保存且验证过的生成图优先用于恢复，不能因运行时临时文件过期抹去已确认成果。侧栏附图走 `pickFile`（原生多选：文本文件成为 reference 正文，PNG/JPEG/GIF/WebP 成为图像附件）和剪贴板/拖放；`captureRegion` 已删除。剪贴板读按路由继续：reader 窗口的 `nsIClipboard` 抛错不得吞掉后续的插件 realm 读取；macOS 截图 TIFF 仅在 `imgITools` 能解码并编码为 PNG 时附加，否则诚实拒绝。`capturePage` 端口仍保留给 native-action 驱动。

Zotero 9.0.6 的关键适配集中在 reader：

- `getPageData({pageIndex})` / `getPageLabels2()` 提供原生字符和标签，跨 realm 参数通过 Cu.cloneInto 传递。getPageData 的 native `partial: true` 恒指基础页面数据尚未增加引用/overlay 信息；它不表示字符提取被截断。适配器只映射已知字符/边界，不转发这个不同语义的标志。
- 通过 `await getData()` 取得已加载 PDF 字节，在插件 realm 计算一次 SHA；每次捕获/校验比较磁盘 SHA，防止 size/mtime 不变的替换。选区和页面图像保留 documentRevision；旧坐标不能落到新文件上。
- Reader.open 的 tabID 指向已有容器。后台引用先通过原生 Tabs.add 保留容器，再打开 reader；只关闭仍由自己拥有、未被用户接管的标签。已有用户标签保持原状。
- await 得到的 PDFPageProxy 可能被 Xray 隐去 getViewport/render/view；只对已确认的宿主页对象用 Cu.waiveXrays，再以原生坐标渲染，不改变 PDF 缩放或焦点。
- 原生 Preferences 面板注册 `defaultXUL: true`；pane 脚本 `mount` 包在 try/catch 里，onload 抛错不能中断 Zotero 的 `_loadPane` 切走其它面板（否则侧栏高亮本插件、内容仍是上一面板）。

已有 **12 项 native 驱动通过**的证据来自工作树生产模块被打包进独立测试 driver（`tests/host/native-action-driver.ts`）。它证明对应原生 API 流程，不等于最终 0.4 XPI 的 UI 接线、真实图像生成、升级或完整平台验收；详情仅在[进度与验收](progress.md)维护。

账户、缓存、历史、原生标注、删除聊天和卸载相互独立。诊断只输出白名单版本/状态/错误码，不含正文、图像、认证或原始管道内容。认证目录不进入普通备份/报告；没有跨设备同步承诺。
