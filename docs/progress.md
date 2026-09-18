# 当前进度与验收

本页只保留**当前状态、产物与证据边界、剩余差距与下一任务**。逐轮迭代流水、原样失败报告与被取代的数字不在本页维护，只保留在 Git 历史（见文末 [历史](#历史)）。代码、单元测试、真实宿主、真实模型与发行物是不同层次的证据，不得互相冒充；未运行项一律为 NOT RUN，不补写原因。

## 当前状态

- **产品分层**：**Chat Mode**（当前 PDF 上下文阅读与问答）已实质实现，证据见下“已交付路径”与宿主 `--context` 报告；叠加其上的 **Agent Mode** 动作能力（真实模型行为、标注与获取整理的真实库写入及 UI、skill 作者 UI 等）仍有独立差距，见“剩余差距与下一任务”。2026-09-18 的 Chat Mode / Agent Mode 文档决策见下节；它不改变本页任何证据层级。
- **架构分层（2026-09-18 重构 + Stage 1，见下）**：原生读取与原生写入已分开——`zotero/library`（读取）+ `zotero/library/native-support.ts`（共享宿主访问）+ `zotero/actions`（写入）。`reader`/`library`/`chat` 不再依赖写入侧，旧的 `zotero/agent/` 目录已删除，`agent` 术语从代码中移除。边界由 `tests/build/dependency-boundaries.test.ts` 静态强制。Stage 1 起，Chat/Agent 模式是**每请求显式冻结、随请求记录持久化、并由边界断言强制**的路由字段（`RequestMode = 'chat' | 'agent'`，请求输入 hash `hashVersion: 3`）；但**面向用户的模式开关与任何按 `mode` 门禁的行为仍 NOT IMPLEMENTED**（见下“Stage 1”）。Stage 2/3 起，「当前 PDF + reader 状态」有唯一属主 `zotero/src/reader/context.ts`（Chat 与 Agent 读同一对象），请求级上下文预算与模型目录策略的唯一属主都在 `core`（见下“Stage 2”“Stage 3”）。Stage 4 起，Agent 能力（`ActionTasks` 编排 + 多轮阅读）是组合根**显式装配并注入**的单一 `PresenterAgent`，Chat-only/reader-only 主机不提供它即无法触达审批、写账本、对账或撤销（见下“Stage 4”）。Stage 5 起，Zotero 读端口（`zotero/src/library/reference.ts`）不再混入文件 IO，`pickFile`/`exportImage` 归 `zotero/src/actions/files.ts`，共享的字节→图像构造归 `contracts/src/image.ts`，读侧不再依赖 `chat/` 或 `actions/`（见下“Stage 5”）。

- **Git**：`main` 基线 `59c21f3`；重构提交 `b6df0e5`、`013df5b`、`11cf37d`。2026-09-15 的仓库整理已在 `main`（`f48f337` 快进到 `6a39c1a` 再记入 `59c21f3`）。2026-09-18 的 `602c640` 引入 Chat Mode / Agent Mode 文档决策；同日按 owner 授权完成项目重命名（提交 `c2840ac`，见下“项目重命名”）；同日 Stage 1 留下四个本地提交 `aa7446a`、`27ec1ef`、`7a58d12`、`25a7e76`（见下“Stage 1”），Stage 2 留下 `2d83c26`，Stage 3 留下 `3be663d`、`0913d49`、`cad7eea`（见下“Stage 2”“Stage 3”），Stage 4 留下 `679e2d7`、`40f47ac`、Stage 5 留下 `406dcc6`（见下“Stage 4”“Stage 5”），本页记录提交 `cf26a99`（纯文档），**均未 push**，前一条已记录基线为 `2d3d757`。`dist/`、`build/`、`.zotero-chatgpt-dev/` 不在版本控制内。
- **版本**：npm `0.4.0-alpha.1` / Zotero `0.4.0a11`。重命名改变了 addon id、bundle 文件名与 manifest 字节，按“侧载新字节先升版本”的规则升到 **a11**，不覆盖 a10 的标签；npm 工作区版本不是侧载身份，未随动。a7 的 `fcdcbc51…` 与 a8 的 `896063bf…` 从未装进 owner 正常 profile。工具链 Node 24.11.0 / npm 11.6.1；固定运行时 `codex-cli 0.154.0`（`runtime/manifest.ts`）。
- **本轮门禁（Stage 2 + Stage 3，代码树 `cad7eea`，2026-09-18，同一树、按序；文档提交 `cf26a99` 后复跑同样 PASS）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1085 passed / 0 skipped**（5.46s）。**本次未运行** `npm run package:dev` / `npm run verify:artifacts` / `install:dev` / `verify:install` / `release:dry-run` 与任何宿主驱动，故 **`dist/` 与 0.4.0a11 字节不变、没有新 XPI**。最近一次完整发行回合仍是 0.4.0a11 重命名：`npm run package:dev` → `dist/zotero-chatgpt-0.4.0a11-dev.xpi`（92,676,309 bytes，SHA-256 `2c9494b5521394cdf99e2f4b6150868fd3ed41d4b7df07130a17eb711d130863`），`npm run verify:artifacts` **84 files PASS**，该树打包前 **1071 passed / 2 skipped**、打包后 **1073 passed / 79 files / 0 skipped**。**真实宿主与真实模型 NOT RUN**：a11 的 addon id 与字节从未装进任何 `.zotero-chatgpt-dev/` 树，故无 `--context` 结论可沿用（a10 的 32/32 属于重命名前的另一身份，见下）。

### 产品方向：Chat Mode / Agent Mode（2026-09-18 文档决策）

本轮**只改文档**，不产生代码、单元、宿主或模型证据；测试计数、产物 hash 与门禁数字均不变。

- 产品定位是“ChatGPT 式的论文阅读侧栏”；Chat Mode 是完整的一等产品，Agent Mode 是可选的动作能力。两者共用同一个文档上下文层与同一会话。
- 当前打开的 PDF 是**隐式上下文**，不是手动附加的文件；上下文按“轻量元数据 / 即时 reader 上下文 / 按需全文检索”分层取用，不要求每轮整篇发送。
- 第 1 阶段的产品价值由 Chat Mode 承载：自动当前 PDF 上下文、高质量全文检索、页/引用定位与良好阅读体验；Agent Mode 的标注、笔记、元数据编辑、文献库整理、下载、文件动作与多步工作流按顺序补上。
- **尚未在代码中实现独立的模式开关/模式路由**：今天只有单一对话路径，加上叠加的 `core/tasks` + `zotero/actions` 动作能力。模式切换 UI、跨模式续用同一会话属于待实现差距（见下 Epic F）；其中“把模式作为每轮冻结设置”的**契约与持久化**已由同日 Stage 1 落定（见下“Stage 1”），但 UI 与按 `mode` 门禁的行为仍未实现。
- 契约见[产品规格](zotero-chatgpt-user-flow.md)的“定位与范围”“当前 PDF 默认上下文”“会话、历史与请求”，以及[架构与契约](module-design.md)的模式请求策略段落。

### 项目重命名：Zotero ChatGPT（2026-09-18，owner 授权）

目标：把项目名统一为 **Zotero ChatGPT**（slug `zotero-chatgpt`），GitHub 仓库同步改名。owner 明确选择**全量重 identity**，并知悉会使现有 dev 记录、已装实例与旧标注溯源失效。

| 项 | 旧 | 新 |
| --- | --- | --- |
| 展示名 | Zotero GPT Reader / Zotero Codex Reader | **Zotero ChatGPT** |
| 仓库 / npm / 工作区 | `zotero-gpt-reader` / `zotero-codex-reader` / `@zotero-codex-reader/*` | `zotero-chatgpt` / `zotero-chatgpt` / `@zotero-chatgpt/*` |
| 发行物 | `zotero-codex-reader-<ver>-dev.xpi` | `zotero-chatgpt-<ver>-dev.xpi` |
| addon id | `{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}` | `{90909501-7b5b-4985-9f55-566e9890746c}` |
| 存储目录 | `zotero-codex-reader/v1/` | `zotero-chatgpt/v1/` |
| pref / CSS / bundle / locale / 资源 | `extensions.zcr.*`、`.zcr-*`、`data-zcr-*`、`content/zcr.js`、`zcr.ftl`、`resource://zcr/` | `extensions.zchatgpt.*`、`.zchatgpt-*`、`data-zchatgpt-*`、`content/zchatgpt.js`、`zchatgpt.ftl`、`resource://zchatgpt/` |
| 标注 provenance | `[AI · Zotero Codex Reader]` | `[AI · Zotero ChatGPT]` |
| 保留 URL / 占位域 | `zcr.invalid/source/...`、`zcr-dev.invalid` | `zchatgpt.invalid/source/...`、`zotero-chatgpt-dev.invalid` |
| 内部全局 / 桥 / 协议名 | `ZoteroCodexReader`、`ZoteroCodexReaderPreferences{Pane,Host}`、`clientInfo.name = zotero_codex_reader` | `ZoteroChatGPT`、`ZoteroChatGPTPreferences{Pane,Host}`、`zotero_chatgpt` |
| 本地开发树 | `.zcr-dev/` | `.zotero-chatgpt-dev/`（目录已就地 `mv`，4.1 GB 原有 profile/报告随之迁移） |
| 产品规格文件 | `docs/zotero-codex-user-flow.md` | `docs/zotero-chatgpt-user-flow.md` |
| 版本 | Zotero `0.4.0a10` | Zotero `0.4.0a11`（npm 仍 `0.4.0-alpha.1`） |

**刻意未改**（改了就变成错误或伪造证据）：`.zotero-chatgpt-dev/` 内既有文件的内容与既有产物文件名（`*.host-verified-*.xpi` 等历史字节）、owner 真实 profile 里已存在的备份文件 `.zcr-bak-20260914-090331-0.4.0a4`（磁盘上就叫这个名字）、docs 里 a9/a10 时期的 `{8a5f5bde-…}` 历史记录、以及指向后端 runtime 的 “Codex” 文案（`Codex App Server`、`codex-cli 0.154.0`、`account/` 的 CODEX_HOME 语义）。本仓库的工作目录仍叫 `ZoteroCodexReader`：它是当前 Cursor 会话的根目录，重命名会使会话与 `.cursor` 配置失配，需在会话外单独处理。

**代价（owner 已确认）**：新 addon id 使 `.zotero-chatgpt-dev/{context,live,s6}*/profile/extensions/` 里已装的旧插件不再是同一个插件，需重新安装后才能再跑宿主检查；`zotero-chatgpt/v1/` 不读取旧 `zotero-codex-reader/v1/` 记录，**未实现迁移**（旧记录仍原样保留在磁盘，未删除）；provenance 字符串变化使重命名前由插件写入的 AI 标注不再被新 provenance 命中。`extensions.zchatgpt.*` 是新的 pref 分支，旧 `extensions.zcr.*` 值不被读取。

**本轮发现的真实回归（已修）**：`scripts/install-dev-xpi.ts` 的 `parsePsProfilePids` 用整行子串 `/zotero/iu` 判断“这是不是一个 Zotero 进程”。把开发树改名为含 `zotero` 的 `.zotero-chatgpt-dev` 后，`tests/build/install-dev-xpi.test.ts` 里那条“非 Zotero 应用（`Other.app`）持有同一 profile”的用例开始误命中——因为 profile 路径本身含 `zotero`。生产路径上该启发式本来就靠仓库路径里的 `ZoteroCodexReader` 命中，行为未变；测试改用不含该子串的合成路径 `/tmp/zchatgpt-dev/profile` 以保住用例原意，并加注释说明。这是本轮**唯一**需要改测试语义的地方。

证据层级：本重命名是**代码 + 单元 + 产物**证据（typecheck / lint / 1071→1073 passed / `zotero-chatgpt-0.4.0a11-dev.xpi` / `verify:artifacts` 84 files）。**真实宿主与真实模型 NOT RUN**。

### 产物边界

| 字节（SHA-256） | 版本 | 位置 | 证据层次 |
| --- | --- | --- | --- |
| `2c9494b5521394cdf99e2f4b6150868fd3ed41d4b7df07130a17eb711d130863`（92,676,309 B） | 0.4.0a11 | `dist/`（`SHA256SUMS` 唯一条目） | 代码 + 单元 + 产物：重命名后首次构建（addon id `{90909501-…}`、`content/zchatgpt.js`）。**无宿主证据**：该 XPI 从未装进任何 `.zotero-chatgpt-dev/` 树 |
| `8770ffd0ac32439a2f196c1e84a922b8fc2822e3d82ca3f0e5999b4327613f80`（92,675,982 B） | 0.4.0a10 | 重命名前的 `dist/` 副本已删除；字节仍在 `.zotero-chatgpt-dev/context/profile/extensions/{8a5f5bde-…}.xpi`（旧 addon id） | 代码 + 单元 + 产物；**真实宿主 `--context` 32/32 PASS**（2026-09-18，专用 `.zotero-chatgpt-dev/context` 树；重构树：读取/写入分离 + 未发送标签改为 New chat + 产品名改 Zotero GPT Reader，后者于同日重命名时再改为 Zotero ChatGPT）。**从未装进 owner 正常 profile** |
| `3207d7e71c50a0ced0f58f9cf93b88ee318372e87fccad9bfe67698d55c60038`（92,675,854 B） | 0.4.0a9 | `.zotero-chatgpt-dev/context/profile/extensions/{8a5f5bde-…}.xpi`（`dist/` 副本已被 a10 覆盖） | 代码 + 单元 + 产物；**真实宿主 `--context` 32/32 PASS**（2026-09-15，专用 `.zotero-chatgpt-dev/context` 树）。**从未装进 owner 正常 profile** |
| `896063bf1078e46b06577cb027668033aca7fd4bc4d92923a86744bf727a6529`（92,675,778 B） | 0.4.0a8 | 上一 chrome 回合产物，已被 a9 覆盖 | 代码 + 单元 + 产物；专用宿主 `--context` **FAILED** `title-before-or-with-connection`（3/4）。从未装进 owner 正常 profile |
| `fcdcbc519977af2df05e6bbfb77131315a0675f7c08d583a99f2334c23993f68`（92,679,071 B） | 0.4.0a7 | 上一 chrome 回合 `dist/` 产物，已被 a8 覆盖 | 代码 + 单元 + 产物；**无宿主证据，从未安装** |
| `64568ebf91afea2c5695b92051302d27ee6d5776d6f70790ac28ce84cae7911a`（92,680,039 B） | 0.4.0a6 | 上一整理轮 `dist/` 产物，已被 a7 覆盖 | 代码 + 单元 + 产物；**无宿主证据，从未安装** |
| `68529c36cfd422268a7f24fc05eaf350b057c1457923d1f8320a6bdc7129261b`（92,665,647 B） | 0.4.0a5 | `.zotero-chatgpt-dev/artifact-backup/…host-verified-68529c36.xpi`；owner 正常 profile 当前安装 | **真实宿主 `--context` 32/32 PASS**（2026-09-14，专用 `.zotero-chatgpt-dev/context` 树；该树现已换成 a9） |
| `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`（92,661,563 B） | 0.4.0a4 | `.zotero-chatgpt-dev/artifact-backup/…host-verified-5a6bb161.xpi`；owner profile 侧 `.zcr-bak-20260914-090331-0.4.0a4` | 真实宿主 `--context` 32/32（2026-09-13，已被 a5 取代） |

- owner 正常 profile 装的是宿主已验证的 a5 字节；那是 profile 变更，**不是**宿主验证证据，也没有任何版本在 owner 真实文献库被目视/使用的证据。
- **同版本脚枪**：a5 曾出现"版本串相同、字节不同"（`dist/` 的 `426542c2…` 与已验证的 `68529c36…`），`about:addons` 无法区分，且 development 记录的"换包后报告版本停在旧值"同样适用。规则：**侧载新字节前先提升版本号**；a6/a7/a8 为此提升，a9 为首次打开标题提升，2026-09-18 的架构重构改动了当时的 `content/zcr.js`（现 `content/zchatgpt.js`）字节，故升到 **a10** 而不是覆盖 a9 的标签；同日重命名又改了 addon id、bundle 文件名与 manifest 字节，故再升到 **a11**。`426542c2…` 从未宿主验证，已于 2026-09-15 从 `dist/` 删除（忽略目录，不产生提交）。
- 更早的两份 a6 字节均未宿主验证、已被重建覆盖：整理前的 `bc9d1370…`（92,682,832 B，两列只读转录回合打出）只残留在 `.zotero-chatgpt-dev/profile/extensions/`（见 [仓库整理](#仓库整理2026-09-15) 的误操作记录）；整理中途的 `61225f4e…`（92,682,070 B）已不在磁盘上。`0.3.0a1` XPI 字节已不在磁盘上，只能从 tag `v0.3.0a1`（`2b5b310`）重打包；历史上用它跑过的 s6 升级/回退因此无法逐字重跑。

### 测试计数（唯一权威）

本页**只有这一处**声明当前测试计数；其它出现过的数字都是历史值，只在 Git 历史中。

- 本机（macOS，`dist/` 仍是 0.4.0a11 XPI，Stage 4/5 未打包）：**1088 passed / 79 files / 0 skipped**（2026-09-18 Stage 4/5 代码树 `406dcc6`；未打包）。相对 Stage 3 的 1085 为 **+3**，全部是新增单测、无删除：Stage 4 的 `tests/zotero/chat/presenter-workspace.test.ts` +2（「未装配 Agent 能力时普通 chat 仍可用」与「阅读任务未完成时拒绝删除会话」，后者补 R7 的阅读侧断言），Stage 5 的 `tests/build/dependency-boundaries.test.ts` +1（新增「`library/**` 不得 import `chat/**`」断言）；Stage 5 把 `pickFile`/`exportImage` 搬到 `actions/files.ts` 未新增用例，既有 `tests/zotero/library/reference.test.ts` 改在组合后的端口（读端口 + 文件动作）上调用。相对 Stage 1 的 1079 为 **+6**，全部是新增单测、无删除：`tests/core/model-capabilities.test.ts` 的 `estimateRequestBudget` +2、`tests/zotero/chat/presenter.test.ts` 的“报告必须等于 core 估算” +1、`tests/core/allowed-models.test.ts` 的 `offeredModelIds` +2 与 `unofferableAllowedModelIds` +1。Stage 2 不改变测试计数（`presenter.test.ts`/`view.test.ts` 等只按新构造签名改写调用）。Stage 1 相对其前基线 `2d3d757` 的 1073 为 +6（`27ec1ef` 分层断言 +1、`7a58d12` `mode` 校验 +1、`25a7e76` 的 `recovery.test.ts` +3 与 `store.test.ts` +1；`aa7446a` 纯文档 +0）。a11 重命名树打包前为 1071 passed / 2 skipped、打包后 1073 passed / 79 files / 0 skipped，差额即 `install-lifecycle.test.ts` 的两条 `it.skipIf`（本机 `dist/` 有当前 manifest 版本 XPI 时两条都执行）；重命名不改变测试条数（a10 → a11 仍为同一组 1073 / 1071+2）。相对 a9 的 1068：删除 `tests/zotero/reader/metadata.test.ts` 的 2 条再导出用例（该兼容层已删除），新增 `tests/build/dependency-boundaries.test.ts` 的 7 条分层守卫，净 +5（Stage 1 又在该文件加 1 条、Stage 2/3 再加 1 条，见下）。
- 差额来自 `tests/build/install-lifecycle.test.ts` 的两条 `it.skipIf`：(1) `copies the existing packaged XPI into a virgin isolated tree` 要求 `dist/` 有当前版本 XPI；(2) `verifies the Apple signature of the Codex binary inside the existing XPI` 还要求 `darwin` 与 `/usr/bin/codesign`。
- CI：`ci.yml` 的 `package` 作业在 `package:dev` **之后**再跑一次 `test:unit`，故 (1) 执行、(2) 在 linux runner 上始终 skip，预期为"本机计数 − 1 passed / 1 skipped"。CI 打出的 XPI 是 darwin/arm64 产物、在 linux 上构建、从不宿主执行。

## 已交付路径（代码 + 单元；宿主/模型证据另见下节）

- 在当前 PDF 打开助手：首次打开即出现可写的未发送会话，标签文案是 **New chat**（界面语言为中文时为“新建对话”），**不显示文章标题**，也不建记录；文章身份由附件/上下文系统提供。无需登录即可创建/恢复本地会话；打开本身不产生模型请求。
- 自动本地读取当前附件全部可提取文本（Zotero 原生 `getPageData`/`getPageLabels2` 字符接口，保留段落/换行/页标签）；上下文可展开预览并返回原页，可指定物理页范围，明确未覆盖/空白/失败/partial 页；文档就绪等待 12 秒且可取消。侧栏显示 reader 实际读到的书目卡片与"实际发生的本地读取"，字段清单与请求里的紧凑书目块共用 `core/src/context/bibliography.ts`。
- 首次外发范围说明；真实设置可关闭自动全文；发送边界复核全局关闭设置；问题、选区、图片、模型设置与请求附件冻结。解析失败/取消不发送书目替代回答，准备期间新输入不被旧请求清掉。
- 本地文本缓存最多 3 份、每份 16 MiB；来源 ID 由文献身份/版本/解析器/页范围/文本摘要确定性生成；加载字节与磁盘 SHA-256 比较可发现 size/mtime 不变的替换。预算取 runtime 窗口、否则固定 catalog；聚焦/多轮计划。全文存为独立不可变 source 文件，逐轮消息只存摘要。
- 会话：同附件并发打开不重复建会话；同名正文与补充附件隔离；新建对话独立草稿；离线历史、改名/分支/排队；schema 3 读写与旧 schema 1/2 安全拒绝；删除活动/不确定聊天被拒绝。**`+` 只打开未持久化的 New chat 标签，第一次发送才建记录**；store 按给定标题写入，不加 “讨论 N”。**未发送草稿会持久化并在插件重启后恢复**（`presenter.ts` `stageDraft`/`flushDraft` → `workspace.saveDraft`；`index.ts` `shutdown` 屏障强制 flush；恢复在 `loadLocal`；只有 `pageRange` 故意不恢复）——代码/单元结论，重启后端到端宿主观察未做。
- 多会话：dock 可同时打开多个会话面板（Cursor 式标签条始终可见，方向键只移焦点）；**只有当前会话一列转录**，其它打开的会话只在标签条上，不随宽度并排第二列。同名会话只在标签条上显示 `标题 · 2`，已有存储标题永不重写。
- 侧栏：无三点菜单（重命名在选中标签、账户用量在模型选择器）；已打开会话在左；未发送标签固定为 New chat（Agent Mode 下可称 New agent），不显示文章标题，`+` 在已有命名会话旁仍是 New chat 文案，切走后仍留在条上，选中标签才有关闭 X，`+`/历史靠右；附件弹层只有 Attach file（多选文本或图片）；reference 与 skill 分入口；面向用户一律称 "skill"，存储 schema/id/名称逐字不变；历史行直删。
- 全局设置在 Zotero 原生偏好设置面板（`startup()` 注册 `defaultXUL: true`、`shutdown()` 清理，JSON 文本函数桥，一次一个校验快照/skill 修订，拒绝写入即重读；pane `mount` 抛错不能中断切面板）；面板文案随 store 的 `uiLanguage`。侧栏只保留每对话内容。
- 论断溯源：点击 `zchatgpt.invalid/source/<id>/<page>` 引文先校验冻结 revision，再按链接 title 的逐字引用在该页字符盒定位，命中临时高亮、未命中诚实提示；点击路径无库写入。
- 标注/获取整理（Chat Mode 之上的 Agent Mode 动作能力，`zotero/actions` + `core/tasks`）：候选 JSON 解析、按 PDF 版本原文定位、任务审批、账本写意图/撤销/冲突检测、DOI/链接查重与 OA 附件校验；第三方 skill 不能授予权限。
- 模型/多模态：固定 catalog 模态/窗口、provider 能力与 rate-limit 解析、每轮预算、粘贴/拖放/选文件多图（2 MiB 输入；reader clipboard 抛错继续走插件 realm；macOS TIFF 可转 PNG）、16 MiB 生成图校验、diagram 线程能力；诚实耗时指示（首个文本到达即冻结）。区域截图入口已删除；`capturePage` 端口仍在。
- 安装/发行：`install:dev`（`plan`/`install`/`check`/`revert`/`rollback`）自校验；MIT `LICENSE` 与 5 个打包依赖许可（`linkify-it`/`mdurl`/`uc.micro`/`punycode.js` MIT，`entities@4.5.0` BSD-2-Clause）随包，`verify:artifacts` 列为必需；CI 用 `.nvmrc`，无 upload/publish/tag。

## 已取得的宿主证据（合成 PDF、专用 `.zotero-chatgpt-dev/` 树、未调用模型）

- **0.4.0a10 `8770ffd0…` `--context`（2026-09-18）**：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 与产物一致。Zotero 9.0.6，1512×949，DPR 2。`new-chat-tab-before-or-with-connection` PASS（`tabId: new-chat`、`label: New chat`、文章标题仍在报告里但不进标签）；`same-title-attachments-separated` PASS（改名后同一断言的读取侧证明：shell 绑定到 sibling `8RRJNTC3`，主附件 `SJI3KJPB` 的草稿未跨过来）；`local-conversation-independent-of-login` 为 `signedIn` 且 `conversation: null`；`pref-pane-registered-once-after-startup` 含 `defaultXUL: true` 且 `label: Zotero GPT Reader`（重命名前的标签）。性能样本（同机，两页合成 PDF，`performance.now` DOM 可交互）：warm-open p95 **4.61ms**，local-feedback p95 **1.07ms**。**8 项 `notRun` 不得当作通过**：`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`acknowledge-context-resumes-the-pending-explain`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister`。报告 `.zotero-chatgpt-dev/verification/scope-2026-09-18-a10/host-context-0.4.0a10-PASS-32of32.json`（SHA-256 `3f3bf15205be063636693881eb3b16f36cffeaa063e77fb8c0aadddf040c0a09`）。该运行**只**证明这份 a10 字节在合成 PDF 上的本地路径、原生 UI/会话/附件切换、偏好面板注册与中英文切换、合成性能样本；`--native` 未跑，真实模型未跑。运行结束后已按 development 的流程退出专用实例并重新准备 `--context --acceptance`（当前 `.zotero-chatgpt-dev/context` 无自动 driver）。
- **0.4.0a9 `3207d7e7…` `--context`（2026-09-15）**：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 与产物一致。Zotero 9.0.6，1512×949，DPR 2。`title-before-or-with-connection` PASS；`local-conversation-independent-of-login` 为 `signedIn` 且 `conversation: null`（首次打开未建记录）；`pref-pane-registered-once-after-startup` 含 `defaultXUL: true`。性能样本（同机，两页合成 PDF，`performance.now` DOM 可交互）：warm-open p95 **5.00ms**，local-feedback p95 **0.86ms**（打开/关闭历史面板，不是已删除的三点设置菜单）。**8 项 `notRun` 不得当作通过**（名单与 a10 相同）。报告 `.zotero-chatgpt-dev/verification/scope-2026-09-15-a9/host-context-0.4.0a9-PASS-32of32.json`（SHA-256 `3452b328f3b661b92a89a3bf4185a0b40282f7e5f646bf26853f4e44d20aa37c`）。该运行**只**证明那份 a9 字节在当时树上的同类本地路径；`title-before-or-with-connection` 已在 a10 改名为 `new-chat-tab-before-or-with-connection` 并反转断言，a9 记录按历史事实保留。
- **0.4.0a8 `896063bf…` `--context`（2026-09-15）**：**FAILED** `title-before-or-with-connection`（3/4：isolated-context-profile / full-xpi-active / read-observation-armed 通过）。去掉标题条后首次打开只显示 New chat，文章标题不在面板 `textContent` 里。报告 `.zotero-chatgpt-dev/verification/scope-2026-09-15-a8/host-report-0.4.0a8-FAILED-title-before-or-with-connection.json`。a9 首次打开改在未发送标签上立刻显示文章标题后，该检查通过。
- **0.4.0a5 `68529c36…` `--context`（2026-09-14）**：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 与产物一致。含 `automatic-whole-pdf-background-preparation-without-panel`（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）与三个 `pref-pane-copy-*`（`Appearance`/`外观` 图例，zh 时段 skill id/名字逐字不变）。**8 项 `notRun` 不得当作通过**（名单与 a9 相同）。报告 `.zotero-chatgpt-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json`（SHA-256 `03c7a614f9bd388f6e05c4d2f8e19bbf96734a49aac4178c99bff5b5da18d187`）。该运行**只**证明那份字节在合成 PDF 上的本地路径、原生 UI/会话/附件切换、偏好面板注册与中英文切换、合成性能样本。
- **2026-09-13 宿主预检（0.4.0a3/a4 期间）**：偏好面板注册身份正确、真实 Preferences 窗口能挂载片段、禁用/启用不叠加、文案双向 zh/en 切换；生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑回到引用页 `highlighted`、缺失 quote `unlocated`、无库写入；`close-preserves-current-page` 的间歇失败定位为 pdf.js "跳页已提交、`_location` 未刷新"的竞态并修复（`capturePosition` 以已提交页为准），最终包连续 5 次 `--context` 23/23，另有 `reopen-keeps-current-page`。a3 曾在 `automatic-background-preparation` 60s 超时 FAILED（报告 `.zotero-chatgpt-dev/verification/scope-2026-09-13-a3/`，未改驱动、未重试到通过），由 a4/a5 的 32/32 取代。
- **0.4.0a1（2026-09-12/13）**：`--context` 16/16、`--context --native` 12/12（`driverIssuedModelRequests = 0`，4 类 NOT RUN）、s6 `0.3.0a1 → 0.4.0a1 → 0.3.0a1` **22/22**（2 NOT RUN）：版本切换、记录保留、旧包对 schema-3 记录明确拒绝且不重写。报告 `.zotero-chatgpt-dev/verification/scope-2026-09-12/`。
- **性能样本**（Apple M5 / 16 GB / macOS 26.6.2，Zotero 9.0.6，DPR 2，两页合成 PDF，全文范围，`performance.now` DOM 可交互测量，非硬件呈现延迟）：

  | 项目 | 样本 | 0.3.0a1（1000×600） | 0.4.0a1（1512×949） |
  | --- | --- | --- | --- |
  | 缓存 sidebar 打开可交互 | n=30 | p95 8.25ms | p95 22.23ms，max 26.25ms |
  | 本地设置有效状态反馈 | n=30 | p95 1.28ms | p95 2.39ms |
  | 首次输入出现 / 本地文本准备 | n=1 | 4.80ms / 177.93ms | 9.07ms / 83.99ms |

  均满足 250ms/100ms 门槛；未测 Zotero 冷启动、真实论文/长书、模型等待/流式渲染、长时内存/多显示器/全部主题。首次宿主运行的真实失败（`page.getTextContent` 在 Zotero 9.0.6 不存在；`getPageData` 跨窗口 `DataCloneError`，改用 `Cu.cloneInto`；`PathUtils.join` 复合参数失败，改逐段）已修复，失败报告保留在 `.zotero-chatgpt-dev/verification/scope-2026-09-11/`。

- **真实模型：无任何证据。** `--live`、`--live-model` NOT RUN；历史 typed quota 拒绝与"限额约 2026-09-15"只是旧报告，不作为当前账户状态。

## 架构重构（2026-09-18）

目标：让目录结构直接表达产品分层（Chat Mode 是主体，Agent Mode 动作能力是叠加层），并让“读取”与“写入”在代码里就是两件事。每个可验证变更一个本地提交（`b6df0e5`、`013df5b`、`11cf37d`、`823e62d`）。**本轮不产生真实模型证据。**

- **契约**：`contracts/src/agent.ts` → `contracts/src/native.ts`，端口拆成 `NativeReaderPort`（只读：引文定位、标注/条目/附件检查、元数据预览、DOI 查重）与 `NativeActionPort extends NativeReaderPort`（写入）；`NativeAgentError` → `NativeOperationError`。任务契约 `AgentTask*` → `ActionTask*`（`schemaVersion: 1` 与 JSON 字段不变，持久化记录兼容）。`NATIVE_ANNOTATION_PROVENANCE` 的字面值 `[AI · Zotero Codex Reader]` 原样保留：它写进真实标注。（2026-09-18 重命名后该字面值为 `[AI · Zotero ChatGPT]`。）
- **Zotero 适配**：删除 `zotero/agent/`。`agent/native.ts` 拆成 `library/native-read.ts`（读取）、`library/native-support.ts`（共享宿主访问与校验）、`actions/native.ts`（写入，`createNativeActionPort`）。`reader/library.ts` → `library/reference.ts`。宿主私有类型集中到 `host/native.ts`。
- **修掉的越界依赖**：`reader/source-highlight.ts` 曾从 action 层借类型。根因是 `reader/document.ts` 的 `TextPdf.getPageData` 少声明了原生字符盒；把该形状补全到 reader 自己的 `DocumentSource` 后，读取侧不再引用写入侧。
- **UI**：`zotero/workspace/` → `zotero/preferences/`（`pane`/`registration`/`service`/`entry`/`history-section`），消除与 `core/workspace`（数据层）同名的歧义。
- **删除的兼容层**：`reader/metadata.ts` 只是 `core/context/bibliography.ts` 的再导出，连同只断言该再导出的 `tests/zotero/reader/metadata.test.ts` 一起删除；调用方直接 import core。
- **测试**：`tests/zotero/` 按模块分到 `reader/`、`library/`、`actions/`、`chat/`、`preferences/`；`native-agent-driver.ts` → `native-action-driver.ts`。新增 `tests/build/dependency-boundaries.test.ts`（7 条）静态强制分层，并用负向对照验证过它会真的失败。
- **产品行为**：未发送会话标签改为 **New chat**（中文“新建对话”），不再显示文章标题；`PresenterState.paperTitle` 删除。宿主检查相应改名为 `new-chat-tab-before-or-with-connection`，断言也反转为“标签是 New chat”。`same-title-attachments-separated` 原本靠“面板 textContent 含文章标题”证明隔离，而该标题当时只出现在标签上，因此把该断言改成读取侧证明（shell 绑定到 sibling 附件、草稿未跨、不重用主附件的会话）；a10 `--context` 32/32 已实跑通过这两条。
- **产品命名**：manifest `name`、偏好设置面板标签与面板文案、core 的 `clientInfo.title` 从 “Zotero Codex Reader” 改为 “Zotero GPT Reader”。**当时刻意未改**的持久化/历史身份：addon id `{8a5f5bde-…}`、存储目录 `zotero-codex-reader/v1/`、pref key `extensions.zcr.*`、`zcr.ftl`、CSS 类名、XPI 文件名 `zotero-codex-reader-*`、标注 provenance 字符串、`bootstrap.js` 的 `ZoteroCodexReader` 全局名。**以上这些已在同日稍后的“项目重命名”全部改掉**（见上节），本节按当时的提交事实保留原文。
- **未改的判定**：侧栏/工具栏/助手显示名仍是 “Codex”（指后端 runtime，不是产品名），`NATIVE_ANNOTATION_PROVENANCE` 与 `clientInfo.name = zotero_codex_reader` 当时作为协议/持久化身份保留。2026-09-18 的重命名已把 `clientInfo.name` 改为 `zotero_chatgpt`、provenance 改为 `[AI · Zotero ChatGPT]`；侧栏/工具栏的 “Codex” 仍保留，因为那是对后端 runtime 的指称，改成产品名属于单独的产品文案决定。
- **忽略目录操作（不产生提交）**：`rm dist/*.xpi dist/SHA256SUMS` 后重建。被删的 a9 `dist/` 副本可由 `.zotero-chatgpt-dev/context/profile/extensions/{8a5f5bde-…}.xpi`（hash 与 `3207d7e7…` 一致）核对；a4/a5 备份未触碰。

## Stage 1：契约与模式冻结（2026-09-18）

依据[仓库重构计划](repository-refactor-plan.md) §I Stage 1 与 §L，把“每轮请求的模式”做成显式、可冻结、可单测的契约，并在本阶段内消除 Chat 路径对 `core/tasks` 的唯一生产依赖。四个本地提交 `aa7446a`、`27ec1ef`、`7a58d12`、`25a7e76`，**均未 push**（前一条已记录基线 `2d3d757`）。**本阶段不产生真实模型证据，也不产生新发行物。**

- **决策（owner 2026-09-18，`aa7446a`，纯文档）**：D1 先把 `parseAnnotationCandidates` 迁出 `core/tasks` 再让边界断言在 Stage 1 即为绿，不交付故意失败的测试；D2 模式用独立字段 `RequestMode = 'chat' | 'agent'` 承载，不扩展/复用 `WorkflowKind`；D3 已持久化且无 `mode` 的请求一律解释为 `'chat'`；D4 本阶段即授权实施。计划书附录 1 第 2、3 项据此标为已决。
- **搬迁（`27ec1ef`）**：`parseAnnotationCandidates` 及其逐候选校验器从 `packages/core/src/tasks/controller.ts` 纯搬迁到 `packages/contracts/src/tasks.ts`，与 `AnnotationProposal` 同处；`controller.ts` 改为从 `contracts` import `validateAnnotationProposal`。行为、限额、错误文案与 `INVALID_REQUEST` 均不变，`contracts` 未引入 Node/Zotero/DOM。这消除了 `chat` → `core/tasks` 的唯一生产边（此前 `presenter.ts` 从 `core/tasks` import 该解析器），且零新增模块/目录/层。
- **契约（`7a58d12`）**：`contracts/src/index.ts` 新增 `RequestMode`，`SendInput` 加 `readonly mode?`、`Message` 加可选 `mode`；`validateSendInput` 只接受恰好 `'chat'`/`'agent'`，缺省保持缺省、语义固定为 `'chat'`（D3），不把默认值写回校验结果。
- **边界（`27ec1ef`）**：`tests/build/dependency-boundaries.test.ts` 新增断言——`packages/zotero/src/chat/**` 不得 import `core/src/tasks/**`（与既有的“chat 不得 import `zotero/actions`”并列），迁移后即刻为绿。
- **冻结与持久化（`25a7e76`）**：请求输入 hash 升到 `hashVersion: 3`，额外 hash `mode ?? 'chat'`；`reconstructInput` 按记录自身的 `hashVersion` 重新 hash，v1/v2 记录仍逐字重建（不因新字段变 `uncertain`，不变量 11）。`RequestRecord.hashVersion` 接受 `2 | 3`；store 读写可选 `mode`，缺字段的旧记录仍可读、不迁移、不重写；`schemaVersion` 未变。`presenter.ts` 在 `frozenWorkflow` 同一快照上冻结 `mode`（`frozenMode()`：skill 为 `read` → `'chat'`，其它 skill → `'agent'`），因 `mode` 在契约上是 `readonly`，它随交给会话的请求副本传递而非像 `workflow` 那样回写。**未新增模式 UI，也没有任何动作按 `mode` 门禁。**
- **门禁（2026-09-18，HEAD `25a7e76`）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1079 passed / 0 skipped**（5.64s）。相对 Stage 1 前基线 `2d3d757` 的 1073 为 **+6**：`27ec1ef` 分层断言 +1、`7a58d12` `mode` 校验 +1、`25a7e76` 的 `recovery.test.ts` +3 与 `store.test.ts` +1，`aa7446a` 纯文档 +0。`package:dev`、`verify:artifacts`、`install:dev`、`verify:install`、`release:dry-run` 与 `tests/host/**` 驱动**均未运行**，故**无新 XPI**、`dist/` 仍是 0.4.0a11 字节。
- **临时性（诚实标注）**：`mode` 当前由冻结时的 skill 推导，**没有用户控制**；`PresenterServices.getTasks` 仍是注入项，`getTasks`/`getReading` 成为唯一 Agent 入口是计划中的 Stage 4。这是过渡桥，不是最终设计。

证据层级：**代码 + 单元测试**。**真实宿主 NOT RUN**（未执行任何 `tests/host/**` 驱动）；**真实模型 NOT RUN**。

## Stage 2：共享文档上下文（2026-09-18）

依据[仓库重构计划](repository-refactor-plan.md) §F/§I Stage 2 与 D5，把「当前 PDF + reader 状态」收敛为**唯一属主**，Chat 与 Agent 读同一对象。一个本地提交 `2d83c26`，**未 push**。**本阶段不产生真实模型证据，也不产生新发行物。**

- **D5 落地（属主位置）**：新增 `packages/zotero/src/reader/context.ts`，属主只存在于 `zotero` 适配层。`packages/contracts` **未新增任何**「当前文档」契约：`PaperScope`（身份）与 `DocumentContext`（抽取文本）已存在，本模块只**组合**它们与 `reader/document.ts` 的 `ReaderDocumentCache`，不复制字段、不重算 revision/hash（附录 1 第 1 项据此标为已决：适配层聚合，不进 `contracts`）。
- **聚合内容**：`AttachmentIdentity`（宿主标题 + key/library）、`paper: PaperScope`、`identity: PaperIdentity`（由 `paperIdentityOf` 冻结）、`prepared: DocumentContext | null`（`prepared.revision` 即冻结文件版本）、请求页范围 `range`、`enabled`/`disclosure`/`phase`/`progress`/`error`。`readerRevision()` 读 `prepared.revision`，不另存一份版本。
- **迁移的消费方（原分散点）**：(1) `chat/presenter.ts` 的 `PresenterState.document` 不再是自建字段组，而是**直接持有**这一 `ReaderContext`；presenter 构造签名改为 `(context, services)`，不再自己拼 `paper`/`title`/`identity`，`paper`/`identity` 改为读该上下文。(2) `reader/reader-pane.ts` 删除自己的 `attachmentIdentity` 副本，改从 `reader/context.ts` import。(3) `chat/view.ts` 删除自己的 `AttachmentIdentity` 声明，改为再导出该类型。(4) `index.ts`（组合根）用 `readerContextFor` 构造上下文、用 `nativeDocumentServices` 构造 document 端口，因此 PDF 抽取端口也只有一处装配。**没有第二个属主**：全仓库只有 `index.ts` 构造 `ReaderContext`，`tests/zotero/presenter-context.ts` 是测试夹具。
- **不在聚合内的状态（显式决定）**：实时视图锚点（当前页、滚动偏移、zoom、dock 宽度）仍是**每视图 DOM 状态**，由 `reader-pane.ts`/`layout.ts` 持有、需要时经 `capturePosition` 读取。把它们复制进「按附件身份」的上下文会制造第二个属主；`range` 是侧栏**请求**的页范围，不是 PDF 当前所在页的镜像。`reader/document.ts` 的抽取与 revision/hash 逻辑**未改**（KEEP，不提前抽象）；`reader/locate.ts` 仍是纯函数模块。
- **顺带收敛的规则**：`chat/view.ts` 的 `latestCitation` 规则（草稿最新选区，否则回溯最后一条带选区的消息）搬到 `reader/context.ts` 的 `activeCitation()`，数据仍只写在草稿上，避免上下文中出现第二份选区副本。
- **门禁（HEAD `2d83c26`）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1079 passed / 0 skipped**（计数与 Stage 1 相同，只改写既有测试的构造调用）。`tests/build/dependency-boundaries.test.ts` 全绿（新增一条见 Stage 3）。
- **未做/未验证**：本阶段**不改变** reader 渲染、缩放、滚动锚点、焦点与 IME 行为，也未改 `reader/document.ts`。计划建议的「用 `.zotero-chatgpt-dev/` + 合成 PDF 验证选区/页范围」**NOT RUN**（本任务不运行宿主驱动）。

证据层级：**代码 + 单元测试**。**真实宿主 NOT RUN**；**真实模型 NOT RUN**。

## Stage 3：Chat 路径只读化与策略下沉（2026-09-18）

依据 §F/§I Stage 3，把 Chat 路径对 Agent 基础设施的触达收在注入端口后，并把两处重复的「策略」收敛到 `core`。三个本地提交 `3be663d`、`0913d49`、`cad7eea`，**均未 push**。**本阶段不产生真实模型证据，也不产生新发行物。**

- **唯一 Agent 入口（代码核对，非新增断言）**：`packages/zotero/src/chat/presenter.ts` 中所有任务/动作触达都只经 `this.getTasks()`，所有阅读任务触达都只经 `this.getReading()`；采集（acquire）分支只在 skill 的 `workflow === 'acquire'` 时进入，而那正是 `frozenMode()` 判为 `'agent'` 的情形。静态边（`chat` 不得 import `core/tasks`、`zotero/actions`）由 Stage 1 的断言继续守着，本阶段未发现新的 Chat→Agent 边。
- **R5 修复（`3be663d`）**：`chat/presenter.ts` 里那段生产兜底估算（历史字节累计、`PAPER_THREAD_POLICY` + `readingInput` 的指令预留、workflow/图片/问题字节）整体搬进 `core/src/codex/model-capabilities.ts` 的 `estimateRequestBudget()`，与 `buildContextBudget` 同处；presenter 只保留一行委托，注入端口 `PresenterServices.contextBudget?` 仍是宿主覆盖点（无注入时走 core）。**未新增抽象层**。新增单测锁定：`tests/core/model-capabilities.test.ts` 断言每份不同文档只计一次、图片 16384 增量、workflow/图片/问题预留与 `total` 的组成，以及未知窗口时的诚实结论；`tests/zotero/chat/presenter.test.ts` 断言一次真实 send 携带的 `contextReport` 就等于对同一请求调用 core 的结果。
- **策略下沉（`0913d49`）**：`core/workspace/allowed-models.ts` 新增 `offeredModelIds()`（可 offer 的 id 集合、newest-first 排序、以及「列表全失效时退回家族规则而不是清空 picker」的兜底）与 `unofferableAllowedModelIds()`（保存时必须原样保留、但本构建不再渲染的已存 id）。`chat/generation-settings.ts` 删掉自带的家族正则、rank 列表与兜底逻辑，只把 id 映射回 catalog 条目用于渲染；`preferences/pane.ts` 的保存逻辑改为调用 core 的保留规则，不再自己重算。**UI 显示内容未变**（两个既有测试文件未经修改即通过）。
- **边界加强（`cad7eea`）**：`tests/build/dependency-boundaries.test.ts` 新增「`zotero/src/reader/**` 不得 import `zotero/src/chat/**`」——它在 Stage 2 之前会失败（`reader-pane.ts` 当时从 `chat/view.ts` 取 `AttachmentIdentity`），正是那条边造就了身份的第二属主。仍存在的 `library/reference.ts -> chat/pick-images.ts`（剪贴板工具放错目录）按事实记录，留待 Stage 5 的文件动作搬迁，未用白名单掩盖。该文件现为 9 条断言。
- **明确未做**：未新增模式开关 UI、未按 `mode` 门禁任何现有行为、未改 Agent 路径的可观察行为、未新增第二个 presenter/session/context/cache。计划书建议的「把 presenter 的 chat-only 流程抽成 `request-pipeline.ts`」**未实施**：那是 Stage 4/5 的适配层拆分，会与 Agent 端口化同时改动同一大文件，属于计划书自己警告的「跨阶段大爆炸移动」；Stage 3 的验收目标（只读 + 端口唯一 + 策略单一属主）不依赖它。
- **门禁（HEAD `cad7eea`）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1085 passed / 0 skipped**（较 Stage 1 的 1079 为 +6，全部为新增单测，明细见上「测试计数」）。

证据层级：**代码 + 单元测试**。**真实宿主 NOT RUN**（Chat 只读行为、缩放/IME/焦点/滚动锚点均未在真实 Zotero 上观察）；**真实模型 NOT RUN**。

## Stage 4：Agent 能力端口化（2026-09-18）

依据[仓库重构计划](repository-refactor-plan.md) §D.2/§D.3/§F 与 §I Stage 4，把 Agent 专属能力收进**一个显式装配的接口**，使 Chat 路径除了共享上下文与 chat runtime 外，只能经由注入的 Agent 能力触达任务/阅读。两个本地提交 `679e2d7`、`40f47ac`，**均未 push**。**本阶段不改变任何可观察的 Agent 行为，不新增模式开关 UI，也不按 `mode` 门禁任何行为。**

- **单一装配点（`40f47ac`）**：`chat/presenter.ts` 原先的两个可选成员 `PresenterServices.getTasks?()` 与 `getReading?()` 合并为一个显式接口 `PresenterAgent { tasks(); reading(client?) }`，注入点 `PresenterServices.agent?`。`index.ts`（组合根）新增 `assembleAgent(local)`，把 `localServices.getTasks`/`getReading` 组装成该接口；没有第二处构造。Chat 路径对任务的每一次触达仍是 `this.getTasks()`，阅读仍是 `this.getReading()`，二者现在都先要求 `this.services.agent`；不提供 Agent 能力的主机得到既有 `UNSUPPORTED_INTERACTION` 文案，不新增分支。**未引入 DI 容器、注册表、插件框架或事件总线**。
- **属主未动**：审批、写意图、action 账本、对账、撤销仍全部由 `core/src/tasks/controller.ts` 拥有；`packages/zotero/src/actions/native.ts` 的写入语义、provenance 与错误码未改。未新建 `core/src/agent/**` 或第二套 session：Agent Mode 继续复用 `core/sessions`（核对：无 `AgentSession`/`agent-session` 符号）。
- **R4 修复（`679e2d7`）**：`openTaskSource` 曾手搓 `Citation`（页/矩形/revision/校验规则会漂移）。新增域构造器 `citationFromAnnotation`，presenter 只调用它。**与计划措辞的显式偏离**：计划 §H R4 写「在 core 提供」，实际放在 `packages/contracts/src/tasks.ts`，紧邻 Stage 1 已迁来的 `parseAnnotationCandidates`。理由：`Citation`/`validateCitation` 本就属 `contracts`，且 Stage 1 的边界断言禁止 `chat` → `core/tasks`；放进 core 会把 Agent 依赖重新带回 Chat。校验产物是新建对象，无共享引用。
- **R7 断言测试（`40f47ac`）**：会话 id 被任务与阅读共用。既有删除路径已检查未完成任务（`unfinishedWork` 语义）；现补一条阅读侧断言——会话存在未完成阅读任务时 `deleteConversation` 必须拒绝，且不调用 `cancel`/`undo`。另加一条正向断言：完全未装配 Agent 能力时，普通 chat 发送仍成功且 `tasks`/`readingJobs` 为空（不变量 4）。
- **门禁（HEAD `40f47ac`）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1087 passed / 0 skipped**（较 Stage 3 的 1085 为 +2，即上述两条 presenter-workspace 用例）。`package:dev`、`verify:artifacts`、`install:dev`、`verify:install`、`release:dry-run` 与任何 `tests/host/**` 驱动**均未运行**，故无新 XPI、`dist/` 仍是 0.4.0a11 字节。

证据层级：**代码 + 单元测试**。**真实宿主 NOT RUN**（审批/撤销/对账的宿主行为未观察，`packages/zotero/src/actions/native.ts` 与 `core/src/tasks/controller.ts` 未改）；**真实模型 NOT RUN**。

## Stage 5：Zotero 适配层读写收口（2026-09-18）

依据[仓库重构计划](repository-refactor-plan.md) §G/§I Stage 5，把文件 IO 从读端口移出，并消除已记录的 `library → chat` 越界边。一个本地提交 `406dcc6`，**未 push**。**本阶段不改变可观察的 reader/动作行为。**

- **文件动作归属（新 `packages/zotero/src/actions/files.ts`）**：`library/reference.ts` 的 `pickFile`/`exportImage` 迁移到 action 侧（`createFileActions`），读端口只保留 `search`/`read`/`open`/`collections`。二者共享的具体宿主原语（文件选择器、受限读取、`imgITools` 解码、字节→`ImageAttachment`、导出写入）抽到中性的 `packages/zotero/src/library/native-files.ts`（`createNativeFiles`），不是通用文件服务抽象：只有一台宿主、一个 picker、一个解码器。
- **`library → chat` 越界边**：根因是 `library/reference.ts -> chat/pick-images.ts` 的 `imageFromBytes`（纯字节→data URL，带大小/magic/`.pdf` 拒绝）。把它移到 `contracts/src/image.ts`（连同 `sniffImageMime` 与 `LIMITS.imageBytes` 复用），`chat/pick-images.ts` 与 `native-files.ts` 都改为消费它。读侧不再 import `chat/`。
- **组合根装配**：读端口与文件动作在 `index.ts`（组合根）合并为 presenter 所需的单一 `LibraryReferencePort`（`libraryPort()`）；`library/runtime/**` 未改动。`packages/zotero/src/runtime/local-services.ts` 保持原样返回读端口。未改 `xterm`/`runtime` 等高危区。
- **`capturePage` 去留（决定：留在读端口）**：它只把已打开的 PDF 页面在内存中渲染成 `ImageAttachment`，**不产生任何 Zotero 写入**；且冻结的宿主驱动 `tests/host/native-action-driver.ts` 经 `createLibraryReferencePort(...).capturePage` 使用它，该文件本次禁止改动。为保持该接口可编译，`capturePage` 保留在读端口（`NativeLibraryReferencePort`），计划书中“截图移入 actions”一条据此按事实改写。`pickFile`/`exportImage` 已不再出现在读端口。
- **边界加强**：`tests/build/dependency-boundaries.test.ts` 新增「`packages/zotero/src/library/**` 不得 import `packages/zotero/src/chat/**`」（此前因 `reference.ts -> pick-images.ts` 会失败）；既有的「reader/library 不得 import `actions/`」保持并约束新文件。断言现为 10 条。`core` 无 Zotero 依赖的断言未削弱（不变量 5）。
- **未改**：`actions/native.ts` 的写入语义、provenance 字符串与错误码；`runtime/**`、`scripts/**`、`tests/host/**`、`reader/document.ts` 的 revision/hash 逻辑；`contracts` 的 `LibraryReferencePort` 形状（文件成员仍为可选，由组合对象补齐）。
- **门禁（HEAD `406dcc6`）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **79 files / 1088 passed / 0 skipped**（较 Stage 4 的 1087 为 +1，即上述新边界断言）。`package:dev`、`verify:artifacts`、`install:dev`、`verify:install`、`release:dry-run` 与任何 `tests/host/**` 驱动**均未运行**，故无新 XPI、`dist/` 仍是 0.4.0a11 字节。

证据层级：**代码 + 单元测试**。**真实宿主 NOT RUN**（真实文件选择/导出、真实 Zotero 写入均未执行，`pickFile`/`exportImage` 的宿主行为按保守实现处理，未宣称正确）；**真实模型 NOT RUN**。

## 仓库整理（2026-09-15）

目标：只保留 Zotero 原生界面 → TypeScript core → Gecko stdio → 随包 Codex App Server 的源码、四份有效文档与其配套脚本/测试/CI。每个可验证变更一个本地提交（`18d43c5`…HEAD）。

- **删除的文档**：`docs/archive/progress-history-2026-09.md`（信息已迁入本页与 [历史](#历史)）；本页自身由逐轮流水收敛为当前状态/边界/差距（旧原文见 `git log -- docs/progress.md`）；`CHANGELOG.md` 只保留用户可见变更，逐轮门禁数字移出。
- **删除的测试驱动**：`tests/host/{driver,s2-driver,s3-driver,s4-driver}.js`（S1–S4）。它们断言的 context-pane 钩子（`item-details.zchatgpt-chat-active`、`data-zchatgpt-output`、`data-zchatgpt-input`、`data-zchatgpt-selection-bar`、`data-zchatgpt-picker-menu`、`data-zchatgpt-context-title`、`.zchatgpt-menu`）在 `packages/zotero/` 零命中，对任何当前 XPI 都不可能通过。`s5`/`s6` 使用的钩子仍在产品中，保留。`prepare-host-test.mjs` **不再有隐式默认阶段**（无参数即拒绝），`--login` 一并移除。
- **删除的死代码**（零生产调用、零测试）：`pick-images.ts` 的 Gecko FilePicker 路径；`text-scale.ts` `chatScaleFromReaderZoom`；`bibliography.ts` `BIBLIOGRAPHY_LABELS`；`history.ts` `parseHistoryListing`/`parseHistoryReport`；presenter 的 `duplicateSkill`/`setSkillEnabled`/`deleteSkill`/`importSkill`/`exportSkill`/`clipboardImages`/`capturePage`/`exportImage`/`planAnnotations`/`planAcquisition` 包装（实际路径为 `planReturnedAnnotations`、`submit()` 与宿主端口直连）及随之无用的 `LibraryReferencePort.pickSkill`/`exportText` 与 `reader/library.ts` 实现；`sidebar.css` 的 `.zchatgpt-history-archived*`/`.zchatgpt-history-chevron` 规则；`ui-locale.ts` 中 16 条无任何界面发出的 zh 文案；无引用的别名/包装 `PresenterDependencies`、`pickerSummary`（= `modelChipLabel`）、`imagesFromGeckoClipboard`（= `readGeckoClipboardImage(...).images`）与从未被读取的 `CHAT_TEXT_SCALE_PREF`（聊天字号存于 workspace store，不是 Zotero pref）；`build.mjs`/`package.mjs` 对不存在的 `locales/` 目录的拷贝与白名单。
- **删除的遗留写路径**：archive/restore（侧栏与偏好面板早已不提供）。移除 `archiveConversation`/`setConversationArchived`/`HistoryManager.setArchived*`，`HistoryAction` 收窄为 `'delete'`。**读路径不变**：旧记录的 `archivedAt` 仍被校验、列出并当作普通会话显示，任何记录不被重写。
- **文档/配置更正**：development/module-design 版本 a5 → a6；CONTRIBUTING 的 CI 陈述与 `ci.yml` 对齐；`.cursor/install.sh` 注释 0.144.1 → 0.154.0；本页泄露的 owner 真实 profile 目录名按 `18e2770` 的隐私约定替换。
- **保留并记录**：`runtime/README.md` 末句 "license audit remains an S6 task"（固定运行资产的独立声明）；`contracts/src/index.ts` 两处 `rust-v0.144.1` 注释（协议形状出处）；一批只被单元测试引用的纯函数导出（`bibliographyView`、`resolveAllowedModels`、`historyCounts`、`imagesFromClipboardItems`、`contextUsageLabel` 等）；`LibraryReferencePort.capturePage` 端口（`native-action-driver.ts` 与 `tests/zotero/library/reference.test.ts` 使用）；`WorkspaceStore.saveSkill/importSkill/deleteSkill`（Epic C 的数据层）；`s5-driver.js` 的 leftover 注入只认 schema 1（功能仍成立、覆盖减弱，未改）；`.github/` 模板与 `.cursor/` 环境配置。
- **忽略目录清理（不产生提交）**：删除 `dist/zotero-chatgpt-0.4.0a5-dev.xpi`（`426542c2…`，从未宿主验证、从未安装、已不在 `SHA256SUMS`）；删除前复核 `.zotero-chatgpt-dev/artifact-backup/` 的 `68529c36…` 仍在且 hash 一致。更早轮次已删 `dist/` 的 `0.3.0a1`/`0.4.0a1`–`a4` 旧包、`build/`、`.zotero-chatgpt-dev/` 旧日志与旧报告；保留 `.zotero-chatgpt-dev/{profile,data,context,live,verification,pin-bump,probes,fixtures,s6-virgin,s6-upgrade,runtime-cache,artifact-backup}`。
- **一次误操作（如实记录）**：为观察"无阶段即拒绝"的失败回归，在实现前直接执行了无参数的 `node scripts/prepare-host-test.mjs`。旧行为默认 S1 阶段，于是它在 `.zotero-chatgpt-dev/profile`（已登录开发 profile）上重写了 `user.js`、把 `extensions/{8a5f5bde-…}.xpi` 从 `0.3.0a1` 替换为当时的 a6（`bc9d1370…`）、写入 S1 驱动 XPI、重写 `fixtures/reading.pdf`。执行前脚本已确认无 Zotero 实例在用该 profile。补救：立即删除驱动 XPI；被替换的 `0.3.0a1` 字节无备份、不可恢复（可从 tag 重打包）；`records/`、`account/` 未触碰、未读取。此事件是把默认阶段改为显式拒绝的直接理由；此后失败回归改用纯模块 `selectHostStage([])` 观察。

## 剩余差距与下一任务

按**谁能证明**拆分；在 owner 完成一次官方登录前，任何"真实模型行为已通过"的说法都不成立。

| Epic | 目标 | 证据类别 | 阻塞 |
| --- | --- | --- | --- |
| **A 真实模型行为** | 回答/流式/停止/在途恢复、无选区提问、跨页定义、More details、中途切换模型设置、图表/公式读取、引用链接点击路径、图像生成、配额/用量诚实 | 真实模型（隔离合成数据 + 请求记录） | owner 须在 `.zotero-chatgpt-dev/live/` 隔离树完成**一次**官方登录并授权配额；助手不登录、不代走 OAuth。驱动：`tests/host/live-model-driver.js`、`context-driver.js` |
| **B 长文档/多模态读取** | 扫描页从记录 `status:'empty'/'error'` 升级为可选、需显式授权的 OCR 端口（`reader/document.ts`）；`core/context/planner.ts` 的词重叠打分升级为章节/段落切分 + 问题检索；在图像预算内自动附加图/公式页图（今天只有手动 `capturePage` 端口与文件/剪贴板附图） | 代码 + 单元（自主） | 无；真实识别质量依赖 A |
| **C 工作区作者能力** | skill 创建/编辑/复制/导入/导出/试跑 UI —— 2026-09-15 已删除 presenter 里无 view 调用的 CRUD 包装，数据层 `WorkspaceStore.saveSkill/importSkill/deleteSkill` 与 presenter `selectSkill`/`saveSkill` 保留，UI 需在其上重建；research-topic profile 与 per-chat override 的 UI（数据层在 `contracts/src/workspace.ts`）；固定来源 + 从选中来源新建会话；`@collection`/`@note`/`@annotation`（kind 已声明，`library/reference.ts` `search()` 只返回 `article`）；参考文件拖拽（今天只有图片） | 代码 + 单元（自主） | 无；UI 目视与真实库接线归 D |
| **D 视觉/交互/长时** | 偏好面板 zh/en + 暗色/亮色 + 键盘 Tab；真实 Gecko 高亮与阅读锚点视觉；真实 IME；多窗口一致性；窄窗/多显示器/主题溢出；reduced-motion；Cursor 式标签条在真实 dock 宽度/主题下的表现 | 真实宿主视觉（截图/录屏 + 人工） | 需 owner 在场目视；契约级检查可自主做 |
| **E 发行与安装生命周期** | 无 Node 安装、下载隔离、干净 checkout 重建（历史上在临时 worktree 复现过一次，未重跑）、升级/回退、**签名**公开发行，全部在真实产物上 | 真实产物 + 签名发行 | 签名与公开发行需 owner 明确授权（当前授权不含 push/publish/付费服务） |
| **F 模式与共享上下文** | Chat Mode / Agent Mode 的模式切换 UI 与模式路由；两种模式共用同一文档上下文层与同一会话、跨模式续用先前对话与文档引用；上下文分层取用（轻量元数据 / 即时 reader / 按需全文）在真实请求中的体现；Chat Mode 轮次不计入 Agent/动作额度 | 代码 + 单元（自主）；额度记账与真实请求归 A | 无；额度记账需 owner 授权的真实账户 |

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 未验证 / NOT RUN（不得当成通过）

- **a10 已有 `--context` 32/32 宿主证据（见上）；`--context --native` NOT RUN**，真实模型（`--live`/`--live-model`）NOT RUN。a10 改动过当时的 `content/zcr.js`（模块搬迁、未发送标签文案、偏好面板标签），宿主证据只覆盖 `--context` 列出的本地路径与 UI 切换。
- **a11（重命名后）真实宿主与真实模型均 NOT RUN**：新 addon id `{90909501-…}` 与 `content/zchatgpt.js` 字节从未装进 `.zotero-chatgpt-dev/{context,live,s6}*` 的任何树，所以 a11 **没有** `--context` 证据，**不得把 a10 的 32/32 记到 a11 名下**。重跑前需先把 a11 XPI 装进专用树；由于存储目录与 pref 分支都已改名，此前登录的 `account/` 也不在新的 `zotero-chatgpt/v1/` 下。
- **Stage 1（HEAD `25a7e76`）无宿主、无发行物证据**：`package:dev`/`verify:artifacts` 未运行，无新 XPI；未执行任何 `tests/host/**` 驱动，`mode` 的冻结与持久化只有代码 + 单元证据。
- **Stage 2/3（HEAD `cad7eea`）无宿主、无发行物、无真实模型证据**：`package:dev`/`verify:artifacts` 未运行（`dist/` 仍是重命名前的 0.4.0a11 XPI），未执行任何 `tests/host/**` 驱动，`dist/` 中 `zchatgpt.js` 不含 Stage 2/3 改动。具体未观察项：真实 Zotero 中 dock 宽度/主题下的 reader 渲染与缩放、真实滚动锚点与当前页捕获、IME 组合、焦点；Chat 路径的「结构性只读」在真实宿主上的行为（未在真实库中尝试写操作，因此只读是**结构**结论而非观测结论）；`estimateRequestBudget` 与实际模型窗口/服务端计量的一致性（无真实模型调用）；模型目录下沉后原生偏好面板的渲染（未打开真实面板）。
- **Stage 4（HEAD `40f47ac`）无宿主、无发行物、无真实模型证据**：`package:dev`/`verify:artifacts` 未运行（`dist/` 仍是重命名前的 0.4.0a11 XPI）；未执行任何 `tests/host/**` 驱动。审批、写账本、对账、撤销与 Agent Mode 会话均**未在真实 Zotero/真实库观察**；`PresenterAgent` 的装配正确性只有代码 + 单元证据。`actions/native.ts` 与 `core/src/tasks/controller.ts` 未改，故无新增写入风险面。
- **Stage 5（HEAD `406dcc6`）无宿主、无发行物、无真实模型证据**：`package:dev`/`verify:artifacts` 未运行；未执行任何 `tests/host/**` 驱动。真实原生文件选择、受限读取、`imgITools` 解码、图片导出写入与 `capturePage` 光栅化**均未在真实 Zotero 观察**；`pickFile`/`exportImage` 的搬迁按保守实现处理，**不得宣称宿主行为正确**。
- 真实模型输出/流式/停止/在途恢复、真实图像生成、真实档位/用量；`--live` 与 `--live-model` 均 NOT RUN。
- a9 `--context` 报告的 8 项 `notRun`（见上；与 a5 名单相同）。
- Cursor 式标签条在真实 dock 宽度/主题下的**目视**、剪贴板粘贴（含 macOS TIFF）、Attach file 多选、偏好面板从其它插件切到本面板、书目卡片与本地读取状态在真实大论文上的呈现（含 12 秒就绪等待）、历史直删后的焦点/滚动、attach 弹层键盘操作、workflow→skill 文案在原生偏好面板的渲染、IME 组合期间后台会话流式回答不抢焦点、后台会话流式回答的到达顺序。a9 `--context` 覆盖了未建记录的本地会话、一列转录所依赖的已有检查、偏好 `defaultXUL` 与 zh/en 文案，**不**覆盖 a10 的 `new-chat-tab-before-or-with-connection`，也不是上述目视/IME/剪贴板项。
- 面板中/英文与暗色/亮色**目视**、键盘 Tab、真实 IME、真实 Gecko 临时高亮**视觉**、阅读锚点目视；真实文献库 PDF 是否与合成 fixture 一致；真实库原生标注写入/撤销、网络预览与 OA 全文核对。
- 草稿"重启后恢复到输入框"的端到端宿主观察；`install:dev check` 的真机重启证明。
- 无 Node 环境安装、下载隔离、公开签名发行与升级验收；干净 checkout 重建本轮未重跑。

## 历史

- 2026-09 的逐日迭代流水、原样失败报告与历次清理记录曾以 `docs/archive/progress-history-2026-09.md` 归档，2026-09-15 按"先迁移有效信息再按文件删除"移除；原文在 `f48f337` 与 `git log -- docs/archive/progress-history-2026-09.md` 中逐字保留。本页整理前的逐轮版本见 `git log -- docs/progress.md`（整理前最后一版为 `91145ca`）。
- 更早被删除的旧文档/旧代码原文可从这些基线查看：`38b047c`（首轮 12 份旧文档清理前）、`1fdd3dc`（2026-09-11 验证基线）、`a7800ce`（2026-09-14 分支合并清理前，`refs/backup/pre-cleanup-20260914`）。
- 已归档报告的磁盘位置（忽略目录）：a10 32/32 `.zotero-chatgpt-dev/verification/scope-2026-09-18-a10/`、a9 32/32 与中途失败 `.zotero-chatgpt-dev/verification/scope-2026-09-15-a9/`、a8 标题失败 `scope-2026-09-15-a8/`、a3 失败 `.zotero-chatgpt-dev/verification/scope-2026-09-13-a3/`、a4 32/32 `scope-2026-09-13-a4/`、a5 32/32 `scope-2026-09-14-a5/`、0.4.0a1 三份 `scope-2026-09-12/`、0.3.0a1 `scope-2026-09-11/`。
- 0.4 之前的宿主证据（旧外壳、旧包，不继承到当前 dock/样式/发行）：S1 外壳/启停 27/27（2026-09-08）；S2 原生 runtime 12/12、3 NOT RUN（2026-09-09，真实 turn 被 typed quota 拒绝）；S3 选区 23/23、2 NOT RUN；S4 交互 40/40、5 NOT RUN（包 `c1b898ac…`）；S5 恢复 17/17、1 NOT RUN；S6 virgin 15/15、a1→a2→a1 19/19（a2 `445f4724…`）。S1–S4 驱动已随 2026-09-15 整理删除。
