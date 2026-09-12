> 历史记录：因任务开始时已有未提交内容而保留。当前产品权威为 [产品规格](../zotero-codex-user-flow.md)，有效证据/未决项见 [progress](../progress.md)。以下旧版文字不代表当前实现或新版验收。

# 产品 / UX 反馈：MVP 清理后的侧栏与 composer

日期：2026-09-10。来源：用户在专用 `.zcr-dev` profile 上手动试用开发预览后给出的 13 条产品反馈。

**实施状态（2026-09-10，第六次 UI 修正）：** 聊天仍停在阅读器 iframe `#split-view` 右栏、原生 toolbar 下面。Composer 为无描边悬浮卡片、黑色圆形发送、选中时无蓝色焦点环。空对话中间是插件自绘的单色 Codex 云/`>_` 标记，没有教学段落。粘贴截图走阅读器 chrome document + composer，DOM `clipboardData.items` 为空时回退 `nsIClipboard`（含 macOS `public.png`）。第 11 条仍未做。`@` 其它对话/论文、`/` skills、PDF 高亮给 agent 只记为后续，本轮不实现、不做假自动完成。第 3 节仍是实施前快照。

本文不是 [A01–A30](../progress.md) 的替代件。用户流程已按已落地条目改过对应草图与文案。

视觉与交互参考：**Cursor Agent** 与 **Cursor 内官方 Codex 插件**（composer、模型/推理选择、icon-only 操作、New chat、chat 管理）。宿主仍是 Zotero 9 原生阅读器，不是把 Cursor 整页搬进侧栏。

人工宿主试用偏好：用目录里的 **GPT-5.3 Spark**（用户原文「5.3 Spark」）做发送类检查。这是测试选择，不是现在改代码。仓库没有模型 allowlist；目录来自 Codex `model/list`。

---

## 1. 本文怎么用

| 层 | 含义 |
| --- | --- |
| **用户原话** | 下面每条开头的引用，不合并、不改意 |
| **源码证据** | 当前工作树里能指到文件/字符串/接口的行为 |
| **逻辑推论** | 由源码直接推出的后果（例如硬上限会导致拖宽弹回） |
| **假设** | 未在宿主上复现、或用户意图可能有多种读法时单独标出 |
| **未知** | 尤其是 Codex 官方 More details 怎么做——**不编造** |

实现时先写会失败的回归测试，再改行为。配置与文案用直接检查，不要只靠源码字符串测试。真实发送仍受账户限额约束；不要把 fixture 输出写成模型回答。凭据只走官方登录，不把 auth 文件读进仓库或诊断。

---

## 2. 架构约束（实施时不得突破）

来自 [AGENTS.md](../../AGENTS.md)、[项目决策](../project-decisions.md)、[模块设计](../module-design.md)、[用户流程](../zotero-codex-user-flow.md)：

- 生产形态是 **Zotero 原生扩展** + TypeScript 核心 + 随包 Codex App Server，经 Gecko stdio 连接。Node 只用于构建/测试。
- 宿主 DOM、阅读器内部、进程和文件 API 留在 Zotero 适配器。核心只依赖 contracts 与注入能力。
- 选区文字、附件身份、PDF 位置在 UI 失焦后仍不可变。对话绑定 **PDF 附件**（含 `clientId` / library / profile 命名空间），不是父条目下所有附件共用一个会话。
- **会话/进程寿命 ≠ 视图寿命**。关 sidebar 必须保留属于插件服务的工作；不要因改 chrome 而把 presenter 绑死在 DOM 上。
- 视觉对齐 **Zotero 原生语言**：真实停靠与原生 PDF 缩放，禁止覆盖层或 CSS scale 冒充适配。
- 未完成的后台/登录控件标为 development preview；**不得把 fixture 输出呈现为真实模型回复**。
- 正文只从明确选区动作发送；当前政策是 **不上传整篇 PDF**。第 11 条（整篇总结）是后续能力，不能偷偷变成默认每次都喂全文。
- 公共产物不含私有记录。诊断只有白名单字段。

模块落点提醒：M1 `packages/zotero/src/reader/`（停靠、宽度、工具栏、选区）；M2 `packages/zotero/src/chat/`（composer、文案、历史 UI）；M3 `packages/core/src/sessions/`（会话归属、发送、持久化）；M4 `packages/core/src/codex/`（thread/turn 与阅读 framing）；M6 存储适配没有删除 API。

---

## 3. 当前实现速览（代码事实，不是猜测）

侧栏挂在 Zotero **原生右侧 context pane** 的自定义 section（`ItemPaneManager.registerSection`，pane `codex-reader`），不是盖在 PDF 上的浮层。阅读器工具栏在 PDF iframe 里另有一颗 Codex 开关。

| 区域 | 当前行为 | 主要文件 |
| --- | --- | --- |
| 宽度 | 默认 360px；硬夹紧 **最小约 320、最大 `min(560, 45% 可用宽度)`**；偏好 `extensions.zcr.sidebarWidth` | `packages/zotero/src/reader/layout.ts`、`reader-pane.ts` |
| 顶栏 | 阅读器 iframe toolbar 只加 Codex 开关；插件 `.zcr-chrome` 在 context pane 内、toolbar 下面；原生 section `.head` 隐藏 | `toolbar.ts`、`view.ts`、`assets/sidebar.css` |
| Composer | 多行 textarea；其下一行三个 `<select>`（Model / Speed / Reasoning）+ 文字按钮 **Send** / **Stop** | `src/chat/view.ts`、`generation-settings.ts` |
| Speed | 选项是目录 `serviceTiers` + 空值标签 **Default**；界面不写 fast | `generation-settings.ts` |
| 底注 | 固定文案 `Preview · selected text only`；离线壳 `Preview · no model connected`；`aria-label` 为 `Codex development preview` | `view.ts` `COPY` |
| 历史 | `<select>`，**至少 2 条会话才显示**；选项名取首条用户/助手正文前 24 字，否则 `Untitled` | `view.ts` `conversationLabel` |
| New chat | 文字按钮 `New chat`；调用 `newConversation(paper, attachmentTitle)` | `view.ts`、`presenter.ts` |
| 默认会话 | `ReaderClient.current()` 复用该附件的 current 指针；每个附件一条，直到用户再 New chat | `packages/core/src/sessions/service.ts` |
| 会话 title 字段 | 写入时用 **附件** `getField('title')`，缺省 `'PDF attachment'`；父文献题名在 `paperMetadata()`，创建会话时未用 | `src/index.ts`、`reader-pane.ts`、`selection.ts` |
| 提问上下文 | `readingInput()`：固定中文说明 + JSON（`contextScope: "selection"`、选区、问题）。**有 citation 才带 paper 书目**；无选区追问时 `paper` 为 `null` | `packages/core/src/codex/reader-policy.ts` |
| 线程指令 | `PAPER_THREAD_POLICY` 写明只提供选区、不要声称读过全文；回答语言跟用户问题，默认中文 | 同上 |
| More details | `action: 'explain'`，`question` = `EXPLAIN_QUESTION`（长中文预设）。该字符串写入 **user message**，出现在 transcript | `draft.ts`、`reader-policy.ts`、`service.ts` |
| Copy 等 | 助手消息旁文字 **Copy**；另有文字 **Return to source** / **Remove** / **New content** | `view.ts` |
| 整篇总结 | **没有**。`SendInput.action` 只有 `'explain' \| 'ask'`；`contextScope` 只有 `'selection'`；校验拒绝 `'summarize'` | `packages/contracts/src/index.ts`、`validation.ts` |
| 删除历史 | **没有**。`ReaderClient` / `ConversationStore` / `StoragePort` 均无 delete | `runtime.ts`、`store.ts` |
| 模型目录 | `model/list` 翻页，无硬编码允许名单。S2 记录默认曾为 `gpt-5.6-sol` | `packages/core/src/index.ts`、`docs/qa/s2.md` |

用户流程文档里的侧栏草图仍写着「Model · Speed · Reasoning ➤」和「Preview · selected text only」，与当前实现一致，也是本次要改的对象。

---

## 4. 优先级总表

| # | 主题 | 时机 |
| --- | --- | --- |
| 1 | Sidebar 放大弹回 / 不能稳定适配宽度 | **现在**（布局回归） |
| 2 | Sidebar 顶与 Zotero toolbar 一体 | **现在**（原生视觉） |
| 3 | 用 GPT-5.3 Spark 做宿主测试 | **现在**（测试习惯，默认不改代码） |
| 4 | Composer：箭头 Send；模型/推理/fast·default 收进下部选择器 | **现在** |
| 5 | 去掉底部 Preview 一类字 | **现在** |
| 6 | Composer 整体对齐 Cursor Agent | **现在**（与 4、10 同一视觉任务） |
| 7 | 新 chat 默认用 paper 名；每篇 paper 默认一个对话框 | **现在** |
| 8 | 提问时自动喂给 Codex 这篇文章的信息 | **现在**（书目/身份上下文；不是全文 PDF） |
| 9 | More details：预设 prompt 不进对话框；prompt 改英文本 | **现在** |
| 10 | Copy 等小操作改为 icon-only | **现在** |
| 11 | 一键总结整篇 paper | **后续**（用户原话「后续还要做」） |
| 12 | New chat 改为非纯文字 UI | **现在**（可与 10 同做） |
| 13 | 能删除不要的 chat history | **现在**（S5 已有多对话，缺删除） |

「现在」仍须遵守第 2 节约束，并按小提交拆开；不是要求一个 PR 做完 12 条 UI。

---

## 5. 分条说明

### 1. Sidebar 放大时弹回，不能自动适配大小

> Sidebar 放大的时候会自动弹回去，不能自动适配大小。

**当前（证据）**

- `clampSidebarWidth`（`layout.ts`）：目标宽度夹在 `min(320, max)` 与 `min(560, floor(available * 0.45))` 之间。可用宽度 = PDF iframe + context pane + splitter。
- `NativeReaderPane.onLayoutSettled`（`reader-pane.ts`）：`resize` / `ResizeObserver` / splitter `mouseup`·`pointerup` 后 80ms 结算。可用宽度变了走 `viewportChanged()`（按记忆宽度再夹紧，**不**把夹紧值写回 preference）；只是 pane 宽度变了则 `setWidth(width)`，把夹紧后的值 **写回** `extensions.zcr.sidebarWidth`。
- S4 宿主明确验收过：preference 存 900 时，打开后宽度被夹到 560px（[s4.md](s4.md)）。这是当时的目标，不是疏漏。

**逻辑推论：** 用户把分隔条拖过 560px 或超过约 45% 阅读条带时，结算后会弹回。窗口变窄再变宽时，若上次结算把 preference 写成了夹紧值，也不一定回到用户刚才拖到的位置。

**假设（未在本次对照宿主上重放）：** 「不能自动适配」也可能包含 PDF 在拖宽时没有跟着 `page-width` 重算。打开时若原先是固定缩放，会暂改为 `page-width`；拖分隔条时 `relayout` 会 `keepAnchor` 或再 `setZoom('page-width')`。若弹回主要是 560/45% 夹紧，应先改夹紧策略再看缩放。

**期望**

- 用户拖宽 sidebar 后，宽度停在拖到的位置，不在松手或短延时后弹回一个更窄的硬上限（现行 560 / 45%）。
- 窗口变窄时仍可暂时收窄，以免挡住论文；窗口变宽后应回到用户选择的宽度（在安全范围内），而不是永远锁在夹紧值。
- PDF 继续用原生缩放适配剩余宽度，禁止 CSS transform 冒充。

**验收建议**

- 在足够宽的窗口（例如 1440 CSS px）把分隔条拖到明显大于 560px；松手后宽度保持，80ms 后不再跳回 560。
- 把窗口缩到必须让出论文空间，sidebar 可暂时变窄；再拉回宽窗口后，宽度回到用户上次选择（或文档化的新上限），而不是永远 360/560。
- 拖宽/缩窄过程中当前页与阅读锚点保持；选择/标注坐标不因假缩放错位。
- 更新或改写 S4「900 → 560」那条：旧夹紧不再是通过条件。

**实施笔记：** `clampSidebarWidth`、`ReaderLayoutController.setWidth` / `viewportChanged`、`NativeReaderPane.applyWidth` / `onLayoutSettled`、`tests/zotero/layout.test.ts`、S4 host 宽度断言。新上限仍要保证论文可见，不能做成盖住 PDF 的浮层。改 preference 语义时区分「用户选择」与「窗口临时夹紧」。

---

### 2. Sidebar 顶部与 Zotero 自带 toolbar 融为一体（已改口：不要并进阅读器 toolbar）

> Sidebar 的上面希望和 Zotero 自带的 toolbar 融为一体。

**2026-09-10 产品改口：** 视觉「一体」不得理解成把 title / New chat / history / 页码并进 PDF iframe 的原生顶栏。用户已拒绝那种融合条（原生搜索与插件 chrome 挤在同一行）。原生 toolbar 保持 Zotero 自己画的搜索、缩放、页码、标注工具；唯一允许的 toolbar 改动是原来的 Codex **开关图标**。侧栏从 toolbar **下面**打开、PDF 旁。Context pane 是整高兄弟，会切开工具栏，因此不能再把聊天画在 ItemPane 里，也不能用顶 padding 假装对齐。

**当前（证据，2026-09-10 第四次）**

- PDF **阅读器 toolbar**（搜索左侧）只有原生风格 Codex 开关，tooltip「Show / Hide Codex sidebar」（`toolbar.ts`）。不再测量 `--zcr-reader-toolbar-height`，也不把插件控件塞进 iframe toolbar。
- 聊天画在阅读器 iframe `#split-view` 的右栏（`dock.ts`）。打开时收起 `ZoteroContextPane`，并隐藏 ItemPane Codex section / sidenav 按钮。插件 `.zcr-chrome`（题名、+ New chat、时钟历史）在 dock 内部、原生 toolbar **下面**。
- Dock 打开时，阅读器 iframe document（及 dock 根）上的 ⌘+ / ⌘- / ⌘0 改 `--zcr-chat-text-scale`，写入 `extensions.zcr.chatTextScale`（0.85–1.5）。嵌套 PDF.js iframe 不绑，以免抢走 PDF 缩放。

**期望**

- 不要移动、替换或拆开 Zotero 原生顶栏。搜索、缩放、页码、标注工具保持宿主原样。
- 插件 chrome 只在侧栏里。不要为了「一体」做成盖住 PDF 的浮动面板，也不要再把 title / + / 时钟拉上 iframe toolbar。

**假设：** 用户原先说的「融为一体」已被这次截图否决；现以「侧栏在 toolbar 下面」为准。

**验收建议**

- 打开侧栏后，阅读器顶栏仍是完整的一条（Codex 开关 + 搜索 + 宿主其余控件），没有题名 / p. / + / 时钟挤进去。
- 侧栏自己的 header 在 pane 里，在 toolbar 下方。
- 关侧栏仍只通过阅读器 toolbar 开关。

**实施笔记：** 已去掉 `measureReaderToolbarHeight` / `applyReaderToolbarHeight`。`.zcr-chrome` 不再按阅读器 toolbar 高度伪装。`tests/zotero/toolbar.test.ts` 断言 toolbar 模块不托管 New chat / history / title。

---

### 3. 测试时用 GPT-5.3 Spark

> 做测试的时候可以用 5.3 Spark 做测试。

**当前（证据）**

- 无模型 allowlist。`composerControls` 列出 `model/list` 的 `displayName`。S2 记录真实目录约 7 个模型，当时默认 `gpt-5.6-sol`。A23/A24 因限额未跑发送。

**期望**

- 限额恢复后的人工 / 宿主发送检查，优先在目录中选择 **GPT-5.3 Spark**（以当时 `model/list` 的 id / displayName 为准）。
- **默认不改产品代码**，除非目录根本没有该模型、或控件无法选中它。

**验收建议**

- 目录若包含该模型：能选中，下一条 `turn/start` 带上对应 `model`；正在生成的请求快照不变。
- 目录若无此名：记在 QA，改用当时目录中的可用项，不硬编码过期 id。
- 不把「测试用了 Spark」写成「产品默认模型改成 Spark」。

**实施笔记：** 无需改 `generation-settings.ts`，除非发现过滤/对齐丢掉了该条目。记录写进后续 S3/S4 宿主笔记即可。

---

### 4. Composer：箭头 Send；模型选择在下部；推理强度与 fast/default 在模型菜单里

> 对话框（composer）参考 Cursor-Codex 插件设计，或参考 Cursor Agent 设计：Send 就是一个箭头；模型选择在对话框下部；点开模型后可以选择推理强度；fast/default 也可以在里面选择。

**当前（证据）**

- Send 是带边框的文字按钮，文案 `Send`，class `zcr-send`（`view.ts`）。
- 三个并列 `<select>`：`aria-label` 为 Model / Speed / Reasoning。Speed 的空值是 **Default**，其余为目录 `serviceTiers`（如 Priority），**没有名为 fast 的产品档位**。Reasoning 选项为 effort id（low/medium/…）+ Default。
- 设置写在待发送 draft 上；发送时冻结到该条 user message（`presenter.setSettings` / `service.send`）。

**期望**

- Send 是箭头控件（icon-only），不是单词 Send。生成中仍要能 Stop（Stop 也可改为图标，但必须可发现、有 `aria-label`）。
- 模型选择在 composer **下部**，做成一个可点开的选择器（Cursor Agent / Cursor-Codex 那种），而不是三个永远展开的原生 `<select>`。
- 点开后可改：**模型**、**推理强度**、**fast / default**（及目录里其它仍支持的 speed/tier）。三者仍独立，不能用降低 reasoning 冒充加速。
- 同一对话可改设置，下一条生效；进行中的 turn 不被改写。

**验收建议**

- `[data-zcr-action="send"]` 对用户可见的是箭头，不是 `Send` 四字；`aria-label` 仍说明发送。
- 未展开时，composer 下部能看出当前模型（及是否 fast/default），不占三列下拉。
- 展开后能改模型、effort、fast/default；不支持的组合按现有 `alignSettings` 回落到目录默认并显示清楚。
- 单元：`applyComposerChoice` / `composerControls` 仍覆盖 catalog 组合。宿主：选 GPT-5.3 Spark + 某一 effort + fast 或 default，再发送（限额允许时）。

**实施笔记：** `view.ts` 的 `settingsRow` / `zcr-send`；`generation-settings.ts`（可把 Speed 的空档在 UI 映射为 default，把目录里的快速档标成 fast，**不要**发明目录没有的 tier）；`sidebar.css` `.zcr-composer` / `.zcr-settings`。Gecko 里自定义菜单要注意焦点与键盘。`chat-view.test.ts` 目前断言三个 SELECT 和文案 `Send`，实现时一并改测试。

---

### 5. 去掉最下面的 Preview 一类字

> 最下面的 preview 之类的字去掉。

**当前（证据）**

- Composer 下有 `<p class="zcr-footnote">`，文案 `Preview · selected text only`。
- 无运行时的 `renderPreview` 壳显示 `Preview · no model connected`。
- 根节点 `aria-label` 为 `Codex development preview`。
- `progress.md` 仍写「Keep the visible sidebar labeled as a development preview」。manifest description 也含 Development preview。

**期望**

- 用户在侧栏底部 **看不到** Preview / development preview / selected text only 这类脚注。
- 选区-only 的安全含义改到内部政策与文档，不必印在每条对话底下。

**假设：** 用户针对的是 **可见脚注**，不是要求立刻改 XPI 版本号或摘掉所有「开发预览」文档。辅助技术用的简短 `aria-label`（例如「Codex」）可以保留，但不要再写 development preview。

**与现有进度文案的冲突：** `progress.md` 的「保持 development preview 标签」是开发阶段决策。按本反馈，**可见 UI 不再使用该标签**。改 UI 的那次提交应同时改掉 progress 里过时的那一句，避免文档与产品打架。

**验收建议**

- 已登录就绪的侧栏 `textContent` 不含 `Preview` / `preview` / `development preview`（脚注与可见 chrome）。
- 空状态只保留短提示（现为 `Select text in the PDF or ask a question.`），不跟 Preview 混排。
- 更新 `chat-view.test.ts` 里「defaults visible sidebar copy」对 `/Preview|preview/` 的断言。

**实施笔记：** 删 `view.ts` 的 `note` / `COPY.previewNote`；评估 `COPY.paneLabel` 与 `renderPreview`。不要为此关闭选区-only 发送政策。

---

### 6. 对话框整体设计参考 Cursor Agent

> 对话框的整体设计也参考 Cursor Agent。

**当前（证据）**

- 结构：状态行 → chrome → 错误 → transcript → draft（citation 卡 + textarea + 设置行 + 脚注）。输入框是带方框边框的原生 textarea，圆角 3px，与 Zotero 字段接近，但不是 Cursor Agent 那种「输入区包含发送与模型芯片」的一体 composer。

**期望**

- Composer 作为一块整体：输入、箭头发送、下部模型/fast/effort 入口，层次接近 Cursor Agent，同时颜色、字体、边框仍用 Zotero token（`--material-*`、`--fill-*`、`--color-panedivider`），不要品牌大色块或网页卡片。
- 与第 4、5、10 条同一视觉任务，不要做出第三套控件语言。

**验收建议**

- 对照 Cursor Agent：发送在输入区角落；模型入口在 composer 下沿；没有三条永久下拉 + Preview 脚注。
- 中文 IME：composition 期间 Enter 不发送（现有 `compositionstart` / `isComposing` 必须保留）。
- 系统字体、灰阶、焦点环仍在；A26 主题未跑完的缺口不要用 Cursor 深色主题硬盖 Zotero。

**实施笔记：** `view.ts` `mountChatView` 的 draft/composer DOM；`sidebar.css` `.zcr-draft` / `.zcr-input` / `.zcr-composer`。参考是交互，不是依赖 Cursor 的 CSS。

---

### 7. Chat 管理：新 chat 默认用 paper 名；每篇 paper 默认一个对话框

> 包括不同 chat 之间的管理：默认每一个新 chat 的名字就是目前所看 paper 的名字；每一个 paper 默认在一个对话框里面。

**当前（证据）**

- 归属键是附件 `PaperScope`（`clientId + libraryId + attachmentKey`）。`current()` 复用该附件的 current 会话；`newConversation()` 另建一条并把 current 指过去。打开 PDF 默认已是「一个附件一个对话框」，直到用户点 New chat。
- 持久化 `Conversation.title` 来自 **附件** title（`attachmentIdentity`），不是 `paperMetadata()` 的父文献题名。附件常叫 `PDF` / 文件名；`compactPaperTitle()` 会把这类 generic 标题藏掉。
- 历史下拉的 **显示名** 不是 `conversation.title`，而是首条消息截断，否则 `Untitled`（`conversationLabel`）。因此即使用户后来有了文献题名，列表里仍像一句提问。
- 历史 `<select>` 在只有 1 条会话时隐藏。

**期望**

- 打开一篇 paper（一个 PDF 附件）时，默认落在 **该附件唯一的当前对话框**，不必先 New chat。
- 任何 **新** chat（含第一条自动创建的）默认名称 = **当前所看 paper 的名字**（父文献题名；无父条目则用附件上仍有意义的题名）。
- 历史列表显示该名称，而不是 `Untitled` 或首条 prompt 残句。
- 同一父条目下的另一份 PDF 仍必须隔离（A03/A04），不能理解成「一个父条目一个对话框」。

**假设：** 「paper 的名字」指书目题名（`paperMetadata`），不是磁盘文件名。若题名极长，UI 可截断，但完整名称应留在 `title` 字段与 `aria-label`。

**验收建议**

- 新打开、尚无历史的附件：创建的会话 `title` 等于父文献题名（有父条目时）；历史/chrome 显示该名，而不是 `Untitled`。
- 用户 New chat 后，新会话默认同名（若需区分第二条，可用「题名」+ 短序号或日期，但默认仍是 paper 名，不是第一条用户问题）。
- 只存在一条会话时，不必强迫露出历史选择器（可与第 13 条的管理入口一起设计）。
- 附件 B 仍是空会话，不出现附件 A 的消息。

**实施笔记：** `presenterFor` 传入 `identity.title` 处改为（或同时传入）`paperMetadata().title`；`conversationLabel` 优先 `c.title`；评估 `compactPaperTitle` 是否把合法短题名藏掉。核心 `store.create` 已存 title，不必改主键。不要把两条附件合成一个 thread。

---

### 8. 提问时自动把文章信息喂给 Codex

> 提问的时候自动把这篇文章的信息喂给 Codex，这样就知道提问的上下文。

**当前（证据）**

- 每轮用户可见 payload 是 `readingInput()`：中文 READING_INSTRUCTION + JSON。`paper` 只从 **第一条 citation** 取 title/authors/year/doi；`Ask` 且 draft 无 citation 时 `paper` 为 `null`。
- 线程级 `baseInstructions` / `developerInstructions` 是通用阅读助手说明，**不含** 当前论文题名；并写明只给了选区、没有全文。
- `Conversation.title` 不进入 `turn/start` 文本。
- `progress.md`：论文正文只从明确选区发送，不上传整篇 PDF。`project_doc_max_bytes: 0`。

**期望**

- 用户提问（有无选区均可）时，Codex 能知道 **正在读哪一篇**：至少题名，以及已有的 authors / year / doi（与 `paperMetadata` 一致）。
- 这样「这段公式什么意思」之类的追问带有论文身份，而不只靠侧栏上用户看见的题名。

**不是本条、且不得偷换：** 上传全文 PDF 或默认整篇索引。那是第 11 条后续工作。在第 11 条落地前，指令仍须禁止模型声称已经读完全文。

**验收建议**

- 无 citation 的 `ask`：`readingInput` JSON 仍含非空 `paper`（title 至少有）。
- 有 citation 的 `ask` / `explain`：书目与选区一致，且与父文献元数据一致。
- 单元：无 citation 时也能解析出 title；有 citation 时行为与 `tests/core/policy.test.ts` 现有 framing 兼容。
- 不把 PDF 字节或全文提取塞进默认 `turn/start`。
- 限额允许时：对合成 PDF 只问「这篇在讲什么方向」且不选字，回答应提到该 fixture 题名或明确说只看到元数据/选区，而不是编造章节。

**实施笔记：** `readingInput()`；`makeAsk` / `presenter.send` 需能在无 citation 时带上 paper 书目（可从 presenter 持有的 metadata 或 conversation.title + 一次 `paperMetadata` 注入）。注意 `PAPER_THREAD_POLICY.developerInstructions` 与 JSON `paper` 不要互相矛盾。Payload 仍受 `LIMITS.payloadBytes`。

---

### 9. More details：prompt 不出现在对话框；默认英文短句

> More details：用户不知道 Codex 官方是怎么做的。我们现在是把预设 prompt 放进对话框再提问，不优雅。希望点 More details 后 prompt 信息不出现在对话框里，让 Codex 直接回答。这里的 prompt 也要重新设计，默认都是英文，或许就是 "tell me more about this" 之类。

**当前（证据）**

- 选区条按钮文案 `More details`（`selection-actions.ts`）。点击 → 展开侧栏 → `presenter.explain` → `makeExplain` → `action: 'explain'`，`question: EXPLAIN_QUESTION`。
- `EXPLAIN_QUESTION` 全文（`reader-policy.ts`）：

  `请用中文解释这些选区。先说明这段话的含义，再解释关键术语、符号或推理步骤。保留原文记号；区分作者陈述与补充解释。如果缺少定义或前后文，请指出具体缺少什么，不补造论文内容。`

- `ConversationService.send` 把 `input.question` 写成 **user message 的 `text`**，因此 transcript 里会出现整段中文预设。S3 宿主：「More details records one user message with the citation and submits the explain turn」。
- 该字符串同时进入 `readingInput` 的 `question` 字段，上游实际看到的是「长指令 + 选区 JSON」。
- 用户流程第 2 节仍写：More details 默认相当于替用户填入「请详细解释这段内容」。

**未知（必须保持未知）**

- **Codex 官方产品（ChatGPT / Codex IDE / 其它客户端）的「More details」如何实现：未核实。** 不要在文档或代码注释里写成「官方是隐藏 system prompt」或「官方是某条固定英文」。实现本条只满足 **本插件用户** 的可见性与文案要求。

**期望**

- 点击 More details 后：**对话框里不出现** 预设 prompt（composer 不填入，transcript 也不把长指令渲染成用户气泡）。
- Codex **直接开始回答**（仍走现有 explain 提交、去重、登录恢复）。
- 用户仍应能看出这次解释针对哪段选区（citation 卡、页码、Return to source），只是看不到内部指令。
- 发给模型的说明改成 **默认英文**、更短；用户举例为 `tell me more about this`。最终短句可在实现时定稿，但不得再默认用当前这段中文长文案。
- `PAPER_THREAD_POLICY` 里「Answer in the language of the user's question, Chinese by default」与「可见问题改成英文短句」会一起把默认回答语言推向英文。若产品仍希望中文论文默认中文回答，应改线程政策或按 **论文/界面语言** 决定，而不是继续把中文长 prompt 显示给用户。此点见第 8 节开放问题。

**验收建议**

- More details 之后：`[data-zcr-messages]` 与 composer 的可见文本不含 `EXPLAIN_QUESTION` 旧文，也不含新内部短句（若短句仍作为 `SendInput.question` 发给上游，UI 必须按 `action === 'explain'` 隐藏或改写成选区摘要）。
- 仍恰好一次 `send` / `explain`；未登录时仍 pending 一次，登录后不重复提交。
- Ask in sidechat 仍只加入 citation、聚焦输入、不发送。
- 双击 More details 仍去重（现有 `explainFlights`）。
- 更新用户流程第 2 节「填入详细解释」的表述，使其与「不可见 prompt」一致。

**实施笔记：** `EXPLAIN_QUESTION`、`makeExplain`、`service.ts` 写 user message 处、`view.ts` `messageNode`（可按 action 或约定空 `text` + citations 渲染）。恢复路径 `reconstructInput` 依赖 `user.text` 与 hash——隐藏 UI 可以，但不要随便清空已持久化的 question 而不改 hash/action。`tests/core/`、`tests/zotero/presenter.test.ts`、S3「records one user message」的期望要改成「记录 explain + citation，可见文本不是 prompt」。

---

### 10. Copy 等小 UI 不用文字，参考 Cursor Agent

> Copy 这种小的 UI 设计都可以不用文字，参考 Cursor Agent。

**当前（证据）**

- 助手消息头：文字按钮 `Copy`（`COPY.copy`）。
- 同属文字小按钮：`Return to source`、`Remove`、滚动提示 `New content`。登录/重试等大动作仍是句子，本条不要求改成图标。

**期望**

- Copy 以及同类 **消息/引用级** 动作改为 icon-only，风格参考 Cursor Agent（复制、定位等用图标 + tooltip / `aria-label`）。
- 键盘与屏幕阅读器仍能操作。

**验收建议**

- 可见标签不再是单词 `Copy`；`aria-label` / `title` 为 `Copy`。
- 点击仍复制净化后的回答纯文本（`copyableAnswerText`），默认 UI 仍不出现 Copy diagnostics。
- Return to source / Remove 若一并改图标，各有明确 `aria-label`。

**实施笔记：** `view.ts` `button()` 目前把 `textContent` 当可见标签；改为 SVG + `aria-label`。图标用单色 stroke，对齐 Zotero toolbar，不要彩色品牌图标。`chat-view.test.ts` 对 `Return to source` / `Remove` 的 `textContent` 断言要改。

---

### 11. 后续：一键自动总结整篇文章

> 后续还要做一个功能：一键自动总结整篇文章。现在的功能都是问局部问题；需要一个问整篇 paper 在干什么的功能。

**时机：后续。本轮 MVP UI 不实现。**

**当前（证据）**

- 只有选区 More details / Ask，以及 composer 自由提问。`contextScope` 只有 `'selection'`。政策与 progress 写明不上传全文。`developerInstructions`：不要声称读过全文。
- 无 toolbar「Summarize paper」。校验把 `action: 'summarize'` 标为 `INVALID_REQUEST`。

**期望（留给后续 brief）**

- 明确入口：针对 **当前 PDF 附件** 问「整篇在干什么」，而不是再选一段。
- 仍绑定该附件会话（或该附件上一条专门的总结对话——后续再定）。
- 不得在未设计全文供给方式时，让模型假装已经读完全文。

**后续必须先回答的问题（现在不要拍板）**

- 全文怎么进入 Codex：提取文本、分页、附件文件、还是只加强书目 + 用户粘贴？现有 payload 上限与 `project_doc_max_bytes: 0` 都要重审。
- 与第 8 条「喂文章信息」的边界：第 8 条是身份/书目；第 11 条才是整篇内容。
- 长 PDF、扫描件、双栏、补充材料附件如何失败提示。

**验收（实现第 11 条时才适用）**

- 有一键入口；不选字也能启动整篇总结。
- 回答针对当前附件；兄弟附件不串。
- 无全文供给时，UI 不得呈现「已读完全文」的假成功；不得用 fixture 冒充总结。

**实施笔记（后续）：** 新 `action` / `contextScope`、M1 文本提取、M3 更大 payload 政策、用户流程新节。不要在做第 4–10 条时顺手加一个会撒谎的「Summarize」按钮。

---

### 12. New chat 也可以做成非纯文字 UI

> New chat 这样的也可以做 UI 设计，不用放纯文字。

**当前（证据）**

- `.zcr-chrome` 里文字按钮 `New chat`（`data-zcr-action="new-conversation"`），另有 `aria-label="New chat"`。生成中隐藏。

**期望**

- New chat 为图标按钮（Cursor Agent 常见为 compose / plus），tooltip 与 `aria-label` 仍为 `New chat`。
- 与第 2、7、13 条的顶栏管理区同一套图标语言。

**验收建议**

- 可见节点不是单词 `New chat`；`aria-label` 仍匹配 `/New chat/`。
- 点击仍 `newConversation`；进行中 turn 时不可用或不可误触。
- 更新 `chat-view.test.ts` 里用 `textContent` 匹配 New chat 的用例。

**实施笔记：** `view.ts` 的 `fresh` 按钮；`sidebar.css` `.zcr-chrome`。不要用第二个文字「新对话」重复入口（现有测试已防止 history 与 New chat 重复）。

---

### 13. 管理 chat history：能删掉不要的 history

> 需要管理 chat history 的功能，能删掉不要的 history。

**当前（证据）**

- S5 已有每附件多对话、`list` / `select`、侧栏历史 `<select>`（≥2 条才显示）。
- **没有删除：** `ReaderClient` 无 delete；`ConversationStore` 无 remove；`StoragePort` 只有 `read` / `writeAtomic` / `append`。不确定会话的出路是「再开一个新对话」，不是删旧的。
- 本地记录在 profile 下 `zotero-codex-reader/v1/records/`。删插件目录 ≠ 删 ChatGPT/Codex 云端 thread（[development.md](../development.md)、README 隐私节）。Codex 侧 `history.persistence` 为 `none`，插件自己存快照。

**期望**

- 用户能看到该 PDF 附件下的 chat 列表，并 **删除不要的** 本地历史。
- 删当前对话后，落到该附件另一条仍存在的会话，或按第 7 条新建默认以 paper 命名的会话。
- 删除不可误触（确认或 Cursor Agent 式的列表内删除）。

**假设：** 用户要的是插件侧栏里的历史，不是官方账号网站。本条 **不要求** 调用未核实的 Codex 云端删除 API。若以后要同时忘掉 upstream `threadId`，另开协议调查，不要猜 RPC。

**验收建议**

- 每条历史有删除；确认后该 id 从 `list` 消失，对应 `conversations/{id}.json` 与 `.jsonl` 不再被 `current` / `select` 读到。
- 删除当前正在看的会话：sidebar 不卡在已删 id；activeRequest 必须先结束或明确取消，不能留下指向已删会话的 in-flight turn。
- 删除不碰其它附件的会话；不自动 `turn/start`。
- 关侧栏再开：已删项不回来（除非测试故意写回文件）。
- 失败时（`HISTORY_UNAVAILABLE`）不覆盖成空文件冒充删除成功。

**实施笔记：** contracts 增 `deleteConversation`（名称以实现为准）；`ConversationStore` + `StoragePort` 需要安全删除或「写墓碑 + 去掉索引」（Gecko 适配须实测）；`presenter` 暴露给 UI；历史 UI 不要只用无法做行内删除的光 `<select>`。诊断白名单仍禁止导出论文正文。测试：`tests/core/store.test.ts`、`presenter.test.ts`、S5 类宿主（不发送）。

---

## 6. 建议实现顺序（仍不实施）

便于拆分提交，不是新的阶段门禁：

1. **布局：** 第 1 条宽度弹回；第 2 条顶栏与 toolbar 对齐（M1 + CSS）。
2. **Composer 视觉：** 第 4、5、6、10、12 条（M2）。
3. **会话产品：** 第 7 条命名/默认一对话框；第 13 条删除（M3/M6 + M2）。
4. **上下文与 More details：** 第 8、9 条（M4 framing + M2 可见性）。第 9 条不要猜官方行为。
5. **第 11 条** 单独后续 brief。
6. **第 3 条** 贯穿限额恢复后的宿主发送，不单独占功能分支。

---

## 7. 开放问题

1. **Codex 官方 More details：** 未调查。实现只按本插件「不可见 prompt + 直接回答 + 英文短内部说明」。
2. **第 9 条之后的默认回答语言：** 可见问题若变成英文短句，现有「跟随用户问题、默认中文」会偏向英文。是改线程政策、按 Zotero 界面语言，还是按论文语言？
3. **fast / default：** 映射到目录的 `serviceTier`（null = default；若存在名为 fast 的 tier 再用它），还是产品层只保留两档、其余 tier 进高级区？须对照当时 `model/list`，不要硬编码。
4. **第 1 条新宽度上限：** 取消 560 之后，上限是「只受论文最小宽度约束」、固定更大像素，还是可接近对半？需在 1024/1440 上试，并保留「论文仍可见」。
5. **第 2 条（已改口）：** 不要像素齐平或把 chrome 并进 iframe toolbar。侧栏在原生 toolbar 下面即可。
6. **第 8 条「文章信息」范围：** 本反馈按书目 + 附件身份实施。用户若其实想要摘要或全文，归第 11 条，不要在第 8 条上传 PDF。
7. **第 7 条第二条 chat 的重名：** 默认都叫 paper 名时，列表如何区分？短序号 / 相对时间 / 仍显示 paper 名由用户点进再看内容？
8. **第 13 条与 uncertain 会话：** 删除是否允许干掉无法对账的旧会话（从而不必「只能 New chat」）？倾向允许删，但进行中的请求须先停。
9. **GPT-5.3 Spark 的稳定 id：** 以限额恢复后的 `model/list` 为准；displayName 可能变化。
10. **可见 Preview 去掉后，开发预览声明放哪：** README / 安装说明可以保留「开发预览」；不要印在 composer 底下。

---

## 8. 与现有文档的关系

| 文档 | 关系 |
| --- | --- |
| [zotero-codex-user-flow.md](../zotero-codex-user-flow.md) | 已按落地的第 1–10、12、13 条改过草图与 More details 文案。第 11 条仍未写入流程。 |
| [acceptance-v0.1.md](../progress.md) | 不覆盖。日后为宽度、composer、More details 可见性、删除历史增加用例。 |
| [progress.md](../progress.md) | 已去掉「保持可见 development preview 标签」；脚注不再出现。不要把第 11 条标成已交付。 |
| [module-design.md](../module-design.md) | More details 仍是 M1 复制选区 → M2 → M3 → M4；M2 不再把 explain prompt 当作用户可见问题。 |

---

## 9. 证据与假设（总表）

**当作事实的源码/文档证据**

- 宽度夹紧 560 / 45% 及 S4「900 → 560」。
- 原生 section `.head` 在聊天激活时隐藏；插件 `.zcr-chrome` 留在 pane 内，不再按阅读器 toolbar 高度伪装。
- Composer 三 `<select>` + 文字 Send + Preview 脚注。
- 历史名用消息截断；会话 title 用附件 title。
- `readingInput` 在无 citation 时 `paper: null`。
- More details 把中文 `EXPLAIN_QUESTION` 写入 user message。
- 无 summarize、无 delete conversation、无模型 allowlist。

**明确标为假设或未知的**

- 第 1 条是否还包含 PDF 缩放「不跟手」（除夹紧弹回之外）。
- 第 2 条是否要求与 reader toolbar 像素级齐平。
- Codex 官方 More details 行为（未知）。
- 第 8 条是否被理解成全文（本文按否，全文归第 11 条）。
- 删除是否包含云端 thread（本文按否）。
- GPT-5.3 Spark 在下次 `model/list` 中的准确 id。

---

## 10. 后续能力（2026-09-10 宿主再试用；本轮只记录）

用户再次对照 ChatGPT / Codex 截图后要求的产品能力。**本轮不实现、不做假入口**：空状态中间只有自绘单色标记，不出现 `@` 自动完成、`/` skills 列表或 PDF 高亮控件。

| 主题 | 用户原意 | 本轮 |
| --- | --- | --- |
| PDF 高亮给 agent | 阅读器里与 PDF 交互，让 agent 标出重要段落 | **后续**。仍只用现有选区 More details / Ask；不要假装模型已经在 PDF 上画了高亮 |
| `@` 其它对话 / 其它论文 | 在 composer 里 @ 引用其它 chats 或其它 papers | **后续**。不要加假的 @ 自动完成 |
| `/` skills | Codex 式 slash skills | **后续**。不要加假的 `/` 菜单 |
| 第 11 条整篇总结 | 一键问整篇 paper 在干什么 | 已是后续；仍禁止把 fixture 或局部选区冒充全文 |

截图对照已落地的视觉：黑色圆形发送、空状态 Codex 标记、去掉 composer 电蓝焦点环。粘贴截图必须在阅读器 iframe / Gecko 上可用（DOM `items` 为空时走 `nsIClipboard`，含 macOS `public.png`）。
