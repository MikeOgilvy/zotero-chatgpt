# zotero-chatgpt：进度、历史证据与待修事项

> 文档类型：证据和缺口，不是产品规格。整理日期：2026-09-19。
> 本版只根据本次上传的原 progress.md、其它文档和截图整理，未读取仓库源码、未打开原始验收报告、未运行构建/宿主/真实服务。以下历史 PASS 均表示“原文档如此记录”，不是本轮重新验证。

产品要求见 [zotero-chatgpt-user-flow.md](zotero-chatgpt-user-flow.md)，架构见 [module-design.md](module-design.md)，命令与状态定义见 [development.md](development.md)。整合进仓库时必须保留期间新产生的实际进度，不能用这份基线覆盖更近的记录。

## 1. 本次文档整理的状态

本轮交付是四份主文档的改写稿及旧文件迁移说明，没有修改产品代码或生成新的 XPI。新增 UI 要求尚未接受真实宿主验收，不能因为文档重写就标为 PASS。

用户再次明确：Chat 使用官方网页，不使用 Codex 的只读聊天路径；Agent 才使用 Codex，承担问答、高亮、文献获取和文献库整理。截图指出的模式开关位置变化、顶部内容过多和设置范围不清，需要进入后续修复。

截图无法确定具体安装版本。这里将可见现象记为“截图观察”，不把它们直接归因于 a33 或任何 commit，也不依据截图判断源码根因。

## 2. 最近一份上传文档记录的候选

以下是原文档的 a33 基线，不代表当前工作树、用户现在安装的插件或本轮新产物：

| 字段 | 原记录 |
| --- | --- |
| 版本 | Zotero ChatGPT 0.4.0a33 |
| XPI | `dist/zotero-chatgpt-0.4.0a33-dev.xpi` |
| SHA-256 | `5447f33870bc56677796437764b9600c0892ef492db0c339fc083c86dcd69631` |
| 文件数 | 87 |
| 版本 commit | `9374ac8` |
| 本轮 Chat 修复 | `f942eeb`、`08d53ba`、`482e35a`；审查外观修复 `9374ac8` |
| 原实测平台 | macOS Apple Silicon / Zotero 9.0.6 |
| 发行性质 | 本地开发 XPI；不是已签名公开发行包 |

原记录：typecheck、lint、100 test files / 1336 tests / 0 skipped（`--maxWorkers=4`）、package 与 artifact verification 通过。独立 detached worktree 在版本 commit 上 `npm ci` 后逐字节重建相同 SHA。最终 XPI 在 PATH 不含 Node 的干净专用 profile 中取得 46/46、提取 2 页、0 模型请求。

a33 比 a32 增加了将 Chat 重新加载按钮从时钟图标改为 reload 图标的修复。原文档已经说明产物 hash 改变，因此 a32 真实服务证据不自动变成 a33 的证据；这一原则继续保留。

## 3. 原文档记录的 Chat 修复

| 修复 | commit | 原记录与边界 |
| --- | --- | --- |
| 登录页没有 composer 时被整页禁用 | `f942eeb` | composer-missing 页面保持可点击；恢复未完成时仍拒绝上下文和发送命令 |
| 官方编辑器空白重排被误判为用户改稿 | `482e35a` | 允许已验证的空白重排，仍检查非空白内容和请求 marker；a31 运行报告曾被覆盖，只引用保留的回归测试与 a33 证据 |
| 官方页面没有接住第一次提交 | `08d53ba` | 仅在明确未接受的保护条件下，最多再尝试同一冻结提交一次；接受后不再重发 |

原文档明确：a32/a33 四次真实 Chat 运行的 attempts 都是 1。因而重试分支虽有单元回归，但没有真实服务触发证据。不能把“Chat 一次提交成功”写成“重试分支真实验证成功”。

“原文档记录的 a33 网页 Chat 通过”与“更早的 Codex 只读 Chat 方案不是本产品最终路径”是不同事实。文档不能再把两者混称为一个 Chat 后端。

## 4. 核心流程：历史结果与本轮缺口分开

| 场景 | 对应产物的执行状态 | 当前验收推进 | 原证据及未覆盖范围 |
| --- | --- | --- | --- |
| 网页 Chat 真实提问，当前 PDF 为上下文 | PASS（原记录 a33） | 本轮 NOT RUN | `a33-web-live-PASS.json`，14/14，随机 PDF token 命中，attempts=1，Codex 0→0 |
| 网页 Chat 重启恢复与停止 | PASS（原记录 a33） | 本轮 NOT RUN | `a33-web-resume-stop-PASS.json`，5/5，恢复官方会话并停止随后一轮，Codex 0→0 |
| Agent 高亮 | a30 PASS；a32 FAIL；a33 NOT RUN | BLOCKED（沿用额度阻塞记录，待重试） | a30 完整真实链路；a32 在模型轮次后失败；a33 未重跑，不能继承 a30 PASS |
| Agent 整理选中文献 | a30 PASS；a33 NOT RUN | BLOCKED（沿用额度阻塞记录，待重试） | a30 冻结选择、加法写入和冲突撤销；a32 在较早高亮阶段失败，不能称整理阶段也已单独验证 |
| 文献获取：DOI 元数据预览 | a33 有实际尝试，结果 UNAVAILABLE | 可用元数据目标未通过；原因待核查 | 不等于 PDF 下载或整条 acquire 流程 |
| 文献获取：PDF 下载、验证、保存与读回 | NOT RUN（上传材料无该轮完整证据） | NOT RUN | 必须独立于 translator 预览补证据 |
| UI-01 至 UI-07 | NOT RUN（新验收要求） | 待修复并验收 | 用户截图提供了可见问题；未绑定当前 XPI |

### Agent 阻塞的准确解释

原文档记录 a32 两次尝试在登录、打开 Reader、可见发送并记录 1 个模型轮次后，于 `annotation-review-terminal-preparation` 超时。会话状态为 accepted → dispatching → running → failed，从 running 到 failed 约 115 秒；用户随后确认 Codex 周额度已耗尽。

这些材料支持“当时存在额度阻塞，需要额度可用后复跑”。上传材料没有给出明确的配额错误码，因此不能仅凭超时彻底排除产品回归。a32 的失败报告保留 FAIL；a33 没有执行，记为 NOT RUN，发布验收的推进状态可以是 BLOCKED。

原文档还记录 a30→a33 的产品 diff 仅涉及 `OfficialChatChild.mjs`、`chat/embed.ts` 和 `chat/view.ts` 的 Chat 面改动，并给出 `git diff --name-only 9311836..HEAD -- packages/` 作为核对路径。本轮未复核该 diff，因此只保留为历史说明，不用它替代最终 XPI 的 Agent 复验。

## 5. 分场景证据矩阵

以下均整理自上传原文档。未有精确到该场景的证据，不扩大为 PASS；完整定义和后续记录格式见开发文档。

| 场景 | 自动 / 本地证据 | 真实服务与最终产物证据 | 未覆盖部分 |
| --- | --- | --- | --- |
| 干净安装、无系统 Node | 原记录 PASS | a33 install 46/46 PASS；0 请求 | 其它平台、公开发行安装 |
| Chat 冷启动不触发 Codex | 原记录 PASS | a33 两组 web 记录 Codex 0→0 | 已有 Agent 在途时的混合场景仍需专项验证 |
| Agent 故障不阻断 Chat | 原表写 PASS | 当前摘录主要证明正常 Chat 的 Codex 0→0 | 缺少分别覆盖未登录、缺资产、额度不足的明确故障注入证据 |
| PDF A/B、同名附件和切换草稿 | 原记录宿主 PASS | 真实服务多窗口 NOT RUN | 最终包的多窗口服务绑定 |
| 模式切换状态 | 原记录 clean host PASS | 原表写真实服务 PASS，证据主要为 Chat 不触发 Codex | 固定开关位置、真实草稿/focus/IME/在途任务需独立验证 |
| Agent 高亮与整理 | 原记录自动/原生宿主 PASS | a30 真模型 PASS；a33 未跑 | 当前最终包真实模型 |
| 原生标注和整理撤销 | a33 native 子集 PASS | 合成候选，无模型调用 | 不能把 native 证据列为完整真实模型流程 |
| 停止生成 | 原记录 PASS | a33 web resume-stop PASS | 其它恢复场景不能自动继承 |
| 有界第二次提交 | 单元回归 PASS | 真实 attempts 均为 1 | 第二次尝试分支未触发 |
| 超时、Agent 重试、进程中断 | 原表记录相关单元/宿主覆盖 | 当前摘录无逐场景最终真实服务报告 | 补独立场景、命令与报告 |
| 登录、网络与额度错误 | 原记录部分路径 | Apple 邮箱/密码手工 PASS；passkey BLOCKED；额度耗尽由用户确认 | 真实过期、断网、明确错误归因 |
| 重启官方会话恢复 | 原记录 PASS | a33 web resume-stop PASS | 不代表 Agent 不确定写入恢复也通过 |

## 6. 历史报告索引

同一个报告包含多个结果时拆分说明，新验收列不使用 PARTIAL 或 FAIL/BLOCKED 混合状态。原始业务结果（例如 UNAVAILABLE）与测试断言状态分别保留；未读取原报告时不推断未知断言，不反向改写历史结果。

| 证据 | 原执行结果或本轮整理口径 | 覆盖范围 |
| --- | --- | --- |
| `a33-{typecheck,lint,unit,package,artifacts}.log` | PASS（原记录） | 100 files / 1336 tests / 0 skipped；87-file XPI 校验 |
| `9374ac8b4ca0aff703c3d5ebf0d76b2fce27061b/final-status.txt` | PASS（原记录） | detached worktree 重建相同 SHA |
| `final-a33-install-PASS.json` | PASS（原记录） | 最终 a33 XPI，46/46，无 Node PATH，0 请求 |
| `a33-native-16-PASS-DOI-UNAVAILABLE.json`：native 子集 | PASS（原记录 16/16） | 标注、整理、读回和撤销等本地原生行为 |
| 同一报告：DOI 预览 | UNAVAILABLE（原业务结果）；本轮复核 NOT RUN | 预览确已尝试，未取得可用元数据；未核实原断言状态和外部根因，不把报告整体改为 PASS |
| `a33-web-live-PASS.json` | PASS（原记录） | 真实网页 14/14，随机 token 命中，Codex 0→0 |
| `a33-web-resume-stop-PASS.json` | PASS（原记录） | 恢复与停止 5/5，Codex 0→0 |
| `a32-native-PASS-17.json` | PASS（原记录） | a32 17/17，包含该轮 DOI 预览；不替代 a33 |
| `a30-web-live-fresh-conversation-not-accepted.json` | FAIL（原记录） | 首次提交未确认，0 条消息、0 次接受；失败记录保留 |
| `482e35a` 的回归测试 | PASS（原记录） | 编辑器重排回归；不引用已覆盖丢失的 a31 报告 |
| `a32-web-resume-stale-manifest-FAIL.json` | FAIL（原记录） | harness 使用旧 resume manifest；原文称更正后重跑通过 |
| `a32-live-core-annotate-turn-failed-FAIL.json` | FAIL（原记录） | 高亮准备阶段未完成；用户确认当时周额度用尽 |
| `a32-live-core-r2-annotate-turn-failed-FAIL.json` | FAIL（原记录） | 同类再次尝试，失败报告不被阻塞说明覆盖 |
| `a30-live-core-PASS.json` | PASS（原记录） | 真模型 2 轮，annotate + organize 12/12 |

原文档记录的机器可读摘要路径为 `.zotero-chatgpt-dev/verification/delivery-20260919/acceptance-current.json`。本轮未读取该文件。失败报告应保留；新报告不能覆盖旧失败再宣称无失败历史。

## 7. 本轮待修与待核查清单

优先级表示本轮建议顺序，不表示源码根因已经确认。“待核查”项须先确认是否仍存在，不能凭旧计划机械重构。

| 优先级 / ID | 来源 | 需要完成的结果 | 本轮实现/验收 |
| --- | --- | --- | --- |
| P0 / ROUTING | 用户再次确认＋既有产品要求 | Chat 全路径不调用 Codex；Agent 才走 Codex；不回到“只读 Codex Chat”方案 | NOT RUN |
| P0 / UI-01 | 截图中 Chat/Agent 开关位置不同 | 共同顶部外壳、固定位置、无第二套开关 | 已实现；离线回归 PASS；真实宿主 NOT RUN，见 §9 |
| P0 / UI-02 | 截图顶部操作与多条反馈常驻 | 正常态紧凑；次要操作折叠；失败可处理 | 已实现；预览几何 PASS；真实宿主 NOT RUN，见 §9 |
| P0 / UI-03 | 截图“本地 24 页”和“3/24 已缩短”未清晰分层 | 提取、待发送、已接受、回答分开表达 | 已实现；离线回归 PASS；真实宿主 NOT RUN，见 §9 |
| P1 / UI-04 | 截图 Attach 操作实际提示剪贴板粘贴 | 文件准备不冒充上传；附件和文本覆盖各自明确 | 已实现（`Copy PDF file…`）；真实页面附件流程 NOT RUN，见 §9 |
| P1 / UI-05 | 截图 Agent 的 New chat、Model 和不明圆点；输入细节待验 | 模式身份、禁用原因、独立草稿、IME、焦点和在途状态一致 | 已实现；离线回归 PASS；真实模型 NOT RUN，见 §9 |
| P1 / UI-06 | 截图“适用于所有 chat”的模型/instructions | Agent 设置独立标注；不承诺控制官网；字号范围准确 | 已实现；离线回归 PASS；真实宿主 NOT RUN，见 §9 |
| P1 / UI-07 | 主界面历史入口与设置里的完整聊天列表并存 | 导航和数据管理分工；搜索/删除范围准确 | 已实现；离线回归 PASS；真实宿主 NOT RUN，见 §9 |
| P1 / ACQUIRE | 用户再次强调下文章 | DOI/URL 到条目及合法 PDF 附件的真实链路独立验收 | NOT RUN |
| P1 / LEGACY | 旧计划中的 Chat 曾使用 Codex | 旧 mode 与服务来源不混淆；hash、任务和来源兼容 | 待核查，NOT RUN |
| P1 / STORE | 旧计划记录 conversation 双写者 | 核查当前所有者；有问题才收敛，不机械新增存储层 | 待核查，NOT RUN |
| P2 / CLEANUP | 旧计划残留 test-only 方法、类型/偏好归属问题 | 只在当前任务相关且有行为覆盖时清理 | 待核查，NOT RUN |
| P2 / DOC-REFS | 本次没有仓库 AGENTS.md / README / 全部测试 | 检查旧文档引用与过期阶段限制，迁移后删除旧文件 | 仓库操作 NOT RUN |

本轮不要求重写后端、扩大权限或新增通用 provider 平台。原生任务、冻结快照、账本和安全验证不因为 UI 简化而删除。

## 8. 原基线的产品范围和剩余发行限制

原 a33 记录的 Chat 默认 brief 来自本地纯文本，最多 12,000 字符；不会自动发送页面图像。这个数值是该版记录，不是本轮已核验的新代码配置，也不代表全文全部传给模型。

原 Agent strict config、quote 唯一验证、同库最多 50 条目的加法整理、已有可编辑集合、intent/readback/delta 与冲突撤销约束继续作为保留要求。扩展获取任务不授予任意文件或网络工具。

仍需完成当前候选上的 Agent 两条真实流程、文献获取完整链路、多窗口真实服务绑定、真实过期/断网、IME/焦点/窄窗及本轮 UI 项。额度恢复后重新记录当时实际可用的产物，不机械要求继续测试已经被替换的 a33。

原记录未覆盖：签名、公开发布、更新频道、其它 CPU/系统、Gatekeeper 下载来源、升级/回退和公开安装验证。Apple passkey 仍是该基线的 BLOCKED 记录，不推定之后的宿主版本仍有同一结果。

原文档称既有测试仅使用专用 profile/data 与合成资料，没有读取认证、操作日常文献库、push 或公开发布。本轮只处理用户提供的文档副本，同样没有执行这些仓库、宿主或账户操作。

## 9. 2026-09-19 UI / UX 改造轮次记录

本轮按 [zotero-chatgpt-ui-redesign-instruction.md](zotero-chatgpt-ui-redesign-instruction.md) 完成 UI-01 至 UI-07 的源码改造、离线回归、浏览器渲染复查与开发 XPI 打包。真实 Agent 功能验收按用户要求整轮排除。

### 9.1 可见变化与主要修改

| 目标 | 实现 |
| --- | --- |
| UI-01 | 新增共同外壳 `.zchatgpt-shell`：模式开关只创建一次并固定在 `.zchatgpt-chrome`（`data-zchatgpt-shell-bar`）最左侧；Chat 与 Agent 切换不再移动、也不再出现第二套开关。Agent composer 只保留附件 `+`。 |
| UI-02 | 顶部正常态固定为一行 44 px 工具栏 + 一行 30 px 上下文摘要（实测外壳总高 75 px）。新建/历史留在右侧；`Copy paper context`、`Copy PDF file…`、`Copy selection`、`Reload` 在 Chat 面保留为次要操作。 |
| UI-03 | 摘要行改为回答“下一次发送什么”：选区、自动 PDF 关闭、准备中、本地读取页数、文本不可用、无 PDF。点击摘要打开锚定详情面板（来源全名、下次发送、本地读取、自动 PDF 状态、复制/重新读取、上次覆盖报告）。 |
| UI-04 | `Attach current PDF` 改名为 `Copy PDF file…`，状态文案明确“已复制到剪贴板，需粘贴”；复制成功不表示附件已上传。 |
| UI-05 | Agent 新增紧凑空状态（标题 + 一句用途 + 高亮/获取文章/整理选中条目三个入口，仅准备草稿，不发送不连接）；空会话改称 `New agent`；发送与模型设置禁用时给出原因；输入框说明 Enter / Shift+Enter。 |
| UI-06 | Preferences 重组为 General / Chat / Agent 四组加历史的数据管理组；`Chat text scale` 改名 `Agent text size`；`Codex instructions` 改名 `Agent instructions` 并注明“仅用于 Agent 请求”；模型与 skill 的原始 id/版本收进 `Details`；instructions 增加未保存指示。 |
| UI-07 | 侧栏历史行改为标题 + 文献/最近活动/可证明来源的第二行；Preferences 的 `Chat history` 改名 `Local data` 并说明删除范围。 |

主要文件：`packages/zotero/src/chat/view.ts`、`packages/zotero/src/chat/ui-locale.ts`、`packages/zotero/assets/sidebar.css`、`packages/zotero/src/preferences/pane.ts`、`packages/zotero/src/preferences/history-section.ts`、`packages/zotero/src/preferences/registration.ts`（Preferences 面板加载插件样式表）、`tests/host/context-driver.js`、`tests/host/embed-driver.js`，以及对应离线测试。

### 9.2 本机执行的门禁（2026-09-19）

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | PASS，100 files / 1344 tests / 0 skipped（新增 8 条 UI/设置回归） |
| `npm run package:dev` | PASS，构建 `dist/zotero-chatgpt-0.4.0a34-dev.xpi`（92,732,302 bytes） |
| `npm run verify:artifacts` | PASS，87 个文件；SHA-256 `c56659757bf21a9949ffa93e5a037be053ceb58f7960a05d7370edd955c5c2ef` |

产品 Codex 模型请求：本轮未运行任何会连接产品 Agent 的入口（未执行 `--live*`、`--native`、`--embed --web-live`、`--context` 等宿主阶段），因此可证明范围是“未发起”，不是“已实测为零”。

### 9.3 渲染复查（浏览器预览，非 Zotero/Gecko 宿主）

用真实 `view.ts` / `pane.ts` 与随包 `sidebar.css`，配合合成状态在浏览器中渲染窄/常规宽度与深浅主题：
`.zotero-chatgpt-dev/ui-preview/`，截图 `.zotero-chatgpt-dev/ui-preview/screenshots/ui-preview-{context,history}.png`（各 1248 × 1462，工具视口上限所限，只覆盖页面顶部若干卡片；其余卡片以 DOM 几何与可访问性树核对）。

实测要点：

| 项目 | 观测 |
| --- | --- |
| 模式开关 | 每张卡片仅 1 个；始终位于 `[data-zchatgpt-shell-bar]` 内、左偏移 9 px；Chat 与 Agent 一致 |
| 顶部高度 | 工具栏 44 px；摘要行 30 px；外壳总高 75 px（≤80） |
| 模式命中区 | 每个选项 47 × 26 px |
| 摘要对比度 | 浅色 5.98:1、深色 9.11:1（≥4.5:1） |
| 详情面板 | 360 px 侧栏下宽 344 px、左右各留 9 px、无横纵溢出 |
| Agent 空状态 | 无 h1/h2；三个入口只写入草稿 |
| Chat 宿主面 | 原生 Chat 隐藏，composer 宽高为 0（不可达）；新建/历史隐藏 |
| 历史行 | 工作区路径渲染标题 + `文献 · 日期`，列表无溢出 |

该复查是浏览器渲染，不是 Zotero/Gecko 宿主证据；真实宿主中的 dock 尺寸、IME、焦点环与 `--material-*` 主题变量仍需宿主复验。

### 9.4 明确 NOT RUN

```text
UI-01 至 UI-07 真实宿主（Zotero 9.0.6 + 0.4.0a34）：NOT RUN
原因：用户本轮明确要求不运行产品 Agent 功能验收（Codex weekly limit 已用尽），且不运行会连接产品 Agent 的宿主阶段。
边界：离线回归与浏览器渲染证据不等于真实 Gecko 宿主、真实模型、高亮、整理或下载链路通过。
```

后续待办：在额度可用时于专用 `.zotero-chatgpt-dev/` profile 用 0.4.0a34 复验 UI-01 至 UI-07 的真实宿主布局、IME、焦点返回与多窗口；历史来源标记目前只在记录能证明 message mode 时显示，工作区列表条目未暴露来源字段，不猜测填充。
