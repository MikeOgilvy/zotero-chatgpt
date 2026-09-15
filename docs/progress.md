# 当前进度与验收

本页只保留**当前状态、产物与证据边界、剩余差距与下一任务**。逐轮迭代流水、原样失败报告与被取代的数字不在本页维护，只保留在 Git 历史（见文末 [历史](#历史)）。代码、单元测试、真实宿主、真实模型与发行物是不同层次的证据，不得互相冒充；未运行项一律为 NOT RUN，不补写原因。

## 当前状态

- **Git**：`main` 基线 `f48f337`（已快进合并 `codex/product-agent-v0.4`，历史未改写；合并前 HEAD 存于本地 ref `refs/backup/pre-cleanup-20260914`）。2026-09-15 的仓库整理在分支 `cursor/repo-cleanup-becf` 上按可验证变更逐个本地提交，未 push、未打 tag、未发布。`dist/`、`build/`、`.zcr-dev/` 不在版本控制内。
- **版本**：npm `0.4.0-alpha.1` / Zotero `0.4.0a6`（a5 已被"同版本不同字节"污染，见下）。工具链 Node 24.11.0 / npm 11.6.1；固定运行时 `codex-cli 0.154.0`（`runtime/manifest.ts`）。
- **本轮门禁（2026-09-15 整理分支 HEAD，同一树、按序）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **1075 passed / 80 files / 0 skipped**；`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a6-dev.xpi`（92,680,039 bytes，SHA-256 `64568ebf91afea2c5695b92051302d27ee6d5776d6f70790ac28ce84cae7911a`）；`npm run verify:artifacts` **84 files PASS**；打包后复跑 `test:unit` 同为 1075 / 80 / 0 skipped。最后一个提交（删除四个无调用的别名/包装）前后打出的 XPI 字节相同（esbuild 已将其摇掉），门禁在该提交后完整复跑仍为同一结果。以上均为代码 + 单元 + 产物证据；**真实宿主、真实模型 NOT RUN**。

### 产物边界

| 字节（SHA-256） | 版本 | 位置 | 证据层次 |
| --- | --- | --- | --- |
| `64568ebf91afea2c5695b92051302d27ee6d5776d6f70790ac28ce84cae7911a`（92,680,039 B） | 0.4.0a6 | `dist/`（`SHA256SUMS` 唯一条目） | 代码 + 单元 + 产物；**无宿主证据，从未安装** |
| `68529c36cfd422268a7f24fc05eaf350b057c1457923d1f8320a6bdc7129261b`（92,665,647 B） | 0.4.0a5 | `.zcr-dev/artifact-backup/…host-verified-68529c36.xpi`；`.zcr-dev/context/profile/extensions/`；owner 正常 profile 当前安装 | **真实宿主 `--context` 32/32 PASS**（2026-09-14，专用 `.zcr-dev/context` 树） |
| `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`（92,661,563 B） | 0.4.0a4 | `.zcr-dev/artifact-backup/…host-verified-5a6bb161.xpi`；owner profile 侧 `.zcr-bak-20260914-090331-0.4.0a4` | 真实宿主 `--context` 32/32（2026-09-13，已被 a5 取代） |

- owner 正常 profile 装的是宿主已验证的 a5 字节；那是 profile 变更，**不是**宿主验证证据，也没有任何版本在 owner 真实文献库被目视/使用的证据。
- **同版本脚枪**：a5 曾出现"版本串相同、字节不同"（`dist/` 的 `426542c2…` 与已验证的 `68529c36…`），`about:addons` 无法区分，且 development 记录的"换包后报告版本停在旧值"同样适用。规则：**侧载新字节前先提升版本号**；a6 正是为此提升。`426542c2…` 从未宿主验证，已于 2026-09-15 从 `dist/` 删除（忽略目录，不产生提交）。
- 更早的两份 a6 字节均未宿主验证、已被重建覆盖：整理前的 `bc9d1370…`（92,682,832 B，两列只读转录回合打出）只残留在 `.zcr-dev/profile/extensions/`（见 [仓库整理](#仓库整理2026-09-15) 的误操作记录）；整理中途的 `61225f4e…`（92,682,070 B）已不在磁盘上。`0.3.0a1` XPI 字节已不在磁盘上，只能从 tag `v0.3.0a1`（`2b5b310`）重打包；历史上用它跑过的 s6 升级/回退因此无法逐字重跑。

### 测试计数（唯一权威）

本页**只有这一处**声明当前测试计数；其它出现过的数字都是历史值，只在 Git 历史中。

- 本机（macOS，`dist/` 存在当前 manifest 版本的 XPI）：**1075 passed / 80 files / 0 skipped**（2026-09-15 整理分支 HEAD，打包后复跑）；打包前同树同为 1075（首次运行时 `dist/` 已有当前版本的 XPI，两条条件用例均执行）。与整理前 1081 / 80 的差额 −6 全部来自删除：`client.test.ts` archive 1 条、`history-management.test.ts` archive 2 条、`prepare-acceptance.test.ts` `--login` 1 条、`sidebar-styles.test.ts` 归档区样式 1 条、`reader-library.test.ts` `pickSkill`/`exportText` 1 条。
- 差额来自 `tests/build/install-lifecycle.test.ts` 的两条 `it.skipIf`：(1) `copies the existing packaged XPI into a virgin isolated tree` 要求 `dist/` 有当前版本 XPI；(2) `verifies the Apple signature of the Codex binary inside the existing XPI` 还要求 `darwin` 与 `/usr/bin/codesign`。
- CI：`ci.yml` 的 `package` 作业在 `package:dev` **之后**再跑一次 `test:unit`，故 (1) 执行、(2) 在 linux runner 上始终 skip，预期为"本机计数 − 1 passed / 1 skipped"。CI 打出的 XPI 是 darwin/arm64 产物、在 linux 上构建、从不宿主执行。

## 已交付路径（代码 + 单元；宿主/模型证据另见下节）

- 在当前 PDF 打开 Codex：先显示完整文章标题对应的会话和可输入界面；无需登录即可创建/恢复本地会话；打开本身不产生模型请求。
- 自动本地读取当前附件全部可提取文本（Zotero 原生 `getPageData`/`getPageLabels2` 字符接口，保留段落/换行/页标签）；上下文可展开预览并返回原页，可指定物理页范围，明确未覆盖/空白/失败/partial 页；文档就绪等待 12 秒且可取消。侧栏显示 reader 实际读到的书目卡片与"实际发生的本地读取"，字段清单与请求里的紧凑书目块共用 `core/src/context/bibliography.ts`。
- 首次外发范围说明；真实设置可关闭自动全文；发送边界复核全局关闭设置；问题、选区、图片、模型设置与请求附件冻结。解析失败/取消不发送书目替代回答，准备期间新输入不被旧请求清掉。
- 本地文本缓存最多 3 份、每份 16 MiB；来源 ID 由文献身份/版本/解析器/页范围/文本摘要确定性生成；加载字节与磁盘 SHA-256 比较可发现 size/mtime 不变的替换。预算取 runtime 窗口、否则固定 catalog；聚焦/多轮计划。全文存为独立不可变 source 文件，逐轮消息只存摘要。
- 会话：同附件并发打开不重复建会话；同名正文与补充附件隔离；新建对话独立草稿；离线历史、改名/分支/排队；schema 3 读写与旧 schema 1/2 安全拒绝；删除活动/不确定聊天被拒绝。**未发送草稿会持久化并在插件重启后恢复**（`presenter.ts` `stageDraft`/`flushDraft` → `workspace.saveDraft`；`index.ts` `shutdown` 屏障强制 flush；恢复在 `loadLocal`；只有 `pageRange` 故意不恢复）——代码/单元结论，重启后端到端宿主观察未做。
- 多会话：dock 可同时打开多个会话面板（标题条切换，方向键只移焦点）；宽度 ≥ 574px 且随独立聊天字号缩放时显示第二列**只读转录**（`chat/pane-layout.ts`），只读列无 composer、无操作控件，点击正文/Enter 激活并把焦点送回唯一 composer；命名取同标题兄弟的最小空闲后缀，已有标题永不重写。
- 侧栏：无三点菜单（重命名在标题、账户用量在模型选择器）；`+`/历史靠右，`+` 开出可见空会话；附件弹层只有图片与区域截图，区域截图另有独立按钮；reference 与 skill 分入口；面向用户一律称 "skill"，存储 schema/id/名称逐字不变；历史行直删。
- 全局设置在 Zotero 原生偏好设置面板（`startup()` 注册、`shutdown()` 清理，JSON 文本函数桥，一次一个校验快照/skill 修订，拒绝写入即重读）；面板文案随 store 的 `uiLanguage`。侧栏只保留每对话内容。
- 论断溯源：点击 `zcr.invalid/source/<id>/<page>` 引文先校验冻结 revision，再按链接 title 的逐字引用在该页字符盒定位，命中临时高亮、未命中诚实提示；点击路径无库写入。
- 标注/获取整理 agent：候选 JSON 解析、按 PDF 版本原文定位、任务审批、账本写意图/撤销/冲突检测、DOI/链接查重与 OA 附件校验；第三方 skill 不能授予权限。
- 模型/多模态：固定 catalog 模态/窗口、provider 能力与 rate-limit 解析、每轮预算、粘贴/截图多图（2 MiB 输入）、16 MiB 生成图校验、diagram 线程能力；诚实耗时指示（首个文本到达即冻结）。
- 安装/发行：`install:dev`（`plan`/`install`/`check`/`revert`/`rollback`）自校验；MIT `LICENSE` 与 5 个打包依赖许可（`linkify-it`/`mdurl`/`uc.micro`/`punycode.js` MIT，`entities@4.5.0` BSD-2-Clause）随包，`verify:artifacts` 列为必需；CI 用 `.nvmrc`，无 upload/publish/tag。

## 已取得的宿主证据（合成 PDF、专用 `.zcr-dev/` 树、未调用模型）

- **0.4.0a5 `68529c36…` `--context`（2026-09-14）**：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 与产物一致。含 `automatic-whole-pdf-background-preparation-without-panel`（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）与三个 `pref-pane-copy-*`（`Appearance`/`外观` 图例，zh 时段 skill id/名字逐字不变）。**8 项 `notRun` 不得当作通过**：`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`acknowledge-context-resumes-the-pending-explain`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister`。报告 `.zcr-dev/verification/scope-2026-09-14-a5/host-context-0.4.0a5-PASS-32of32.json`（SHA-256 `03c7a614f9bd388f6e05c4d2f8e19bbf96734a49aac4178c99bff5b5da18d187`）。该运行**只**证明那份字节在合成 PDF 上的本地路径、原生 UI/会话/附件切换、偏好面板注册与中英文切换、合成性能样本。
- **2026-09-13 宿主预检（0.4.0a3/a4 期间）**：偏好面板注册身份正确、真实 Preferences 窗口能挂载片段、禁用/启用不叠加、文案双向 zh/en 切换；生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑回到引用页 `highlighted`、缺失 quote `unlocated`、无库写入；`close-preserves-current-page` 的间歇失败定位为 pdf.js "跳页已提交、`_location` 未刷新"的竞态并修复（`capturePosition` 以已提交页为准），最终包连续 5 次 `--context` 23/23，另有 `reopen-keeps-current-page`。a3 曾在 `automatic-background-preparation` 60s 超时 FAILED（报告 `.zcr-dev/verification/scope-2026-09-13-a3/`，未改驱动、未重试到通过），由 a4/a5 的 32/32 取代。
- **0.4.0a1（2026-09-12/13）**：`--context` 16/16、`--context --native` 12/12（`driverIssuedModelRequests = 0`，4 类 NOT RUN）、s6 `0.3.0a1 → 0.4.0a1 → 0.3.0a1` **22/22**（2 NOT RUN）：版本切换、记录保留、旧包对 schema-3 记录明确拒绝且不重写。报告 `.zcr-dev/verification/scope-2026-09-12/`。
- **性能样本**（Apple M5 / 16 GB / macOS 26.6.2，Zotero 9.0.6，DPR 2，两页合成 PDF，全文范围，`performance.now` DOM 可交互测量，非硬件呈现延迟）：

  | 项目 | 样本 | 0.3.0a1（1000×600） | 0.4.0a1（1512×949） |
  | --- | --- | --- | --- |
  | 缓存 sidebar 打开可交互 | n=30 | p95 8.25ms | p95 22.23ms，max 26.25ms |
  | 本地设置有效状态反馈 | n=30 | p95 1.28ms | p95 2.39ms |
  | 首次输入出现 / 本地文本准备 | n=1 | 4.80ms / 177.93ms | 9.07ms / 83.99ms |

  均满足 250ms/100ms 门槛；未测 Zotero 冷启动、真实论文/长书、模型等待/流式渲染、长时内存/多显示器/全部主题。首次宿主运行的真实失败（`page.getTextContent` 在 Zotero 9.0.6 不存在；`getPageData` 跨窗口 `DataCloneError`，改用 `Cu.cloneInto`；`PathUtils.join` 复合参数失败，改逐段）已修复，失败报告保留在 `.zcr-dev/verification/scope-2026-09-11/`。

- **真实模型：无任何证据。** `--live`、`--live-model` NOT RUN；历史 typed quota 拒绝与"限额约 2026-09-15"只是旧报告，不作为当前账户状态。

## 仓库整理（2026-09-15）

目标：只保留 Zotero 原生界面 → TypeScript core → Gecko stdio → 随包 Codex App Server 的源码、四份有效文档与其配套脚本/测试/CI。每个可验证变更一个本地提交（`18d43c5`…HEAD）。

- **删除的文档**：`docs/archive/progress-history-2026-09.md`（信息已迁入本页与 [历史](#历史)）；本页自身由逐轮流水收敛为当前状态/边界/差距（旧原文见 `git log -- docs/progress.md`）；`CHANGELOG.md` 只保留用户可见变更，逐轮门禁数字移出。
- **删除的测试驱动**：`tests/host/{driver,s2-driver,s3-driver,s4-driver}.js`（S1–S4）。它们断言的 context-pane 钩子（`item-details.zcr-chat-active`、`data-zcr-output`、`data-zcr-input`、`data-zcr-selection-bar`、`data-zcr-picker-menu`、`data-zcr-context-title`、`.zcr-menu`）在 `packages/zotero/` 零命中，对任何当前 XPI 都不可能通过。`s5`/`s6` 使用的钩子仍在产品中，保留。`prepare-host-test.mjs` **不再有隐式默认阶段**（无参数即拒绝），`--login` 一并移除。
- **删除的死代码**（零生产调用、零测试）：`pick-images.ts` 的 Gecko FilePicker 路径；`text-scale.ts` `chatScaleFromReaderZoom`；`bibliography.ts` `BIBLIOGRAPHY_LABELS`；`history.ts` `parseHistoryListing`/`parseHistoryReport`；presenter 的 `duplicateSkill`/`setSkillEnabled`/`deleteSkill`/`importSkill`/`exportSkill`/`clipboardImages`/`capturePage`/`exportImage`/`planAnnotations`/`planAcquisition` 包装（实际路径为 `planReturnedAnnotations`、`submit()` 与宿主端口直连）及随之无用的 `LibraryReferencePort.pickSkill`/`exportText` 与 `reader/library.ts` 实现；`sidebar.css` 的 `.zcr-history-archived*`/`.zcr-history-chevron` 规则；`ui-locale.ts` 中 16 条无任何界面发出的 zh 文案；无引用的别名/包装 `PresenterDependencies`、`pickerSummary`（= `modelChipLabel`）、`imagesFromGeckoClipboard`（= `readGeckoClipboardImage(...).images`）与从未被读取的 `CHAT_TEXT_SCALE_PREF`（聊天字号存于 workspace store，不是 Zotero pref）；`build.mjs`/`package.mjs` 对不存在的 `locales/` 目录的拷贝与白名单。
- **删除的遗留写路径**：archive/restore（侧栏与偏好面板早已不提供）。移除 `archiveConversation`/`setConversationArchived`/`HistoryManager.setArchived*`，`HistoryAction` 收窄为 `'delete'`。**读路径不变**：旧记录的 `archivedAt` 仍被校验、列出并当作普通会话显示，任何记录不被重写。
- **文档/配置更正**：development/module-design 版本 a5 → a6；CONTRIBUTING 的 CI 陈述与 `ci.yml` 对齐；`.cursor/install.sh` 注释 0.144.1 → 0.154.0；本页泄露的 owner 真实 profile 目录名按 `18e2770` 的隐私约定替换。
- **保留并记录**：`runtime/README.md` 末句 "license audit remains an S6 task"（固定运行资产的独立声明）；`contracts/src/index.ts` 两处 `rust-v0.144.1` 注释（协议形状出处）；`reader/metadata.ts`（有意的分层入口，有生产导入）；一批只被单元测试引用的纯函数导出（`bibliographyView`、`resolveAllowedModels`、`historyCounts`、`imagesFromClipboardItems`、`MIN_TWO_COLUMN_WIDTH`、`contextUsageLabel` 等）；`LibraryReferencePort.capturePage` 端口（`native-agent-driver.ts` 与 `reader-library.test.ts` 使用）；`WorkspaceStore.saveSkill/importSkill/deleteSkill`（Epic C 的数据层）；`s5-driver.js` 的 leftover 注入只认 schema 1（功能仍成立、覆盖减弱，未改）；`.github/` 模板与 `.cursor/` 环境配置。
- **忽略目录清理（不产生提交）**：删除 `dist/zotero-codex-reader-0.4.0a5-dev.xpi`（`426542c2…`，从未宿主验证、从未安装、已不在 `SHA256SUMS`）；删除前复核 `.zcr-dev/artifact-backup/` 的 `68529c36…` 仍在且 hash 一致。更早轮次已删 `dist/` 的 `0.3.0a1`/`0.4.0a1`–`a4` 旧包、`build/`、`.zcr-dev/` 旧日志与旧报告；保留 `.zcr-dev/{profile,data,context,live,verification,pin-bump,probes,fixtures,s6-virgin,s6-upgrade,runtime-cache,artifact-backup}`。
- **一次误操作（如实记录）**：为观察"无阶段即拒绝"的失败回归，在实现前直接执行了无参数的 `node scripts/prepare-host-test.mjs`。旧行为默认 S1 阶段，于是它在 `.zcr-dev/profile`（已登录开发 profile）上重写了 `user.js`、把 `extensions/{8a5f5bde-…}.xpi` 从 `0.3.0a1` 替换为当时的 a6（`bc9d1370…`）、写入 S1 驱动 XPI、重写 `fixtures/reading.pdf`。执行前脚本已确认无 Zotero 实例在用该 profile。补救：立即删除驱动 XPI；被替换的 `0.3.0a1` 字节无备份、不可恢复（可从 tag 重打包）；`records/`、`account/` 未触碰、未读取。此事件是把默认阶段改为显式拒绝的直接理由；此后失败回归改用纯模块 `selectHostStage([])` 观察。

## 剩余差距与下一任务

按**谁能证明**拆分；在 owner 完成一次官方登录前，任何"真实模型行为已通过"的说法都不成立。

| Epic | 目标 | 证据类别 | 阻塞 |
| --- | --- | --- | --- |
| **A 真实模型行为** | 回答/流式/停止/在途恢复、无选区提问、跨页定义、More details、中途切换模型设置、图表/公式读取、引用链接点击路径、图像生成、配额/用量诚实 | 真实模型（隔离合成数据 + 请求记录） | owner 须在 `.zcr-dev/live/` 隔离树完成**一次**官方登录并授权配额；agent 不登录、不代走 OAuth。驱动：`tests/host/live-model-driver.js`、`context-driver.js` |
| **B 长文档/多模态读取** | 扫描页从记录 `status:'empty'/'error'` 升级为可选、需显式授权的 OCR 端口（`reader/document.ts`）；`core/context/planner.ts` 的词重叠打分升级为章节/段落切分 + 问题检索；在图像预算内自动附加图/公式页图（今天只有手动 `captureRegion`/`capturePage` 端口） | 代码 + 单元（自主） | 无；真实识别质量依赖 A |
| **C 工作区作者能力** | skill 创建/编辑/复制/导入/导出/试跑 UI —— 2026-09-15 已删除 presenter 里无 view 调用的 CRUD 包装，数据层 `WorkspaceStore.saveSkill/importSkill/deleteSkill` 与 presenter `selectSkill`/`saveSkill` 保留，UI 需在其上重建；research-topic profile 与 per-chat override 的 UI（数据层在 `contracts/src/workspace.ts`）；固定来源 + 从选中来源新建会话；`@collection`/`@note`/`@annotation`（kind 已声明，`reader/library.ts` `search()` 只返回 `article`）；参考文件拖拽（今天只有图片） | 代码 + 单元（自主） | 无；UI 目视与真实库接线归 D |
| **D 视觉/交互/长时** | 偏好面板 zh/en + 暗色/亮色 + 键盘 Tab；真实 Gecko 高亮与阅读锚点视觉；真实 IME；多窗口一致性；窄窗/多显示器/主题溢出；reduced-motion；多会话标题条与两列只读转录在真实 dock 宽度/主题下的表现 | 真实宿主视觉（截图/录屏 + 人工） | 需 owner 在场目视；契约级检查可自主做 |
| **E 发行与安装生命周期** | 无 Node 安装、下载隔离、干净 checkout 重建（历史上在临时 worktree 复现过一次，未重跑）、升级/回退、**签名**公开发行，全部在真实产物上 | 真实产物 + 签名发行 | 签名与公开发行需 owner 明确授权（当前授权不含 push/publish/付费服务） |

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 未验证 / NOT RUN（不得当成通过）

- 真实模型输出/流式/停止/在途恢复、真实图像生成、真实档位/用量；`--live` 与 `--live-model` 均 NOT RUN。
- a5 `--context` 报告的 8 项 `notRun`（见上）。
- 2026-09-14 之后所有未打包/未宿主运行的 UI 改动的真实宿主行为：书目卡片与本地读取状态在真实大论文上的呈现（含 12 秒就绪等待）、历史直删后的焦点/滚动、`+` 开出空会话、attach 弹层键盘操作、workflow→skill 文案在原生偏好面板的渲染、多会话标题条的换行/滚动/截断与对比度、两列只读转录在 574px 门槛附近的切换与真实 `ResizeObserver` 时机、只读列 `region` 播报、IME 组合期间的激活、后台会话流式回答的到达顺序。
- 面板中/英文与暗色/亮色**目视**、键盘 Tab、真实 IME、真实 Gecko 临时高亮**视觉**、阅读锚点目视；真实文献库 PDF 是否与合成 fixture 一致；真实库原生标注写入/撤销、网络预览与 OA 全文核对。
- 草稿"重启后恢复到输入框"的端到端宿主观察；`install:dev check` 的真机重启证明。
- 无 Node 环境安装、下载隔离、公开签名发行与升级验收；干净 checkout 重建本轮未重跑。

## 历史

- 2026-09 的逐日迭代流水、原样失败报告与历次清理记录曾以 `docs/archive/progress-history-2026-09.md` 归档，2026-09-15 按"先迁移有效信息再按文件删除"移除；原文在 `f48f337` 与 `git log -- docs/archive/progress-history-2026-09.md` 中逐字保留。本页整理前的逐轮版本见 `git log -- docs/progress.md`（整理前最后一版为 `91145ca`）。
- 更早被删除的旧文档/旧代码原文可从这些基线查看：`38b047c`（首轮 12 份旧文档清理前）、`1fdd3dc`（2026-09-11 验证基线）、`a7800ce`（2026-09-14 分支合并清理前，`refs/backup/pre-cleanup-20260914`）。
- 已归档报告的磁盘位置（忽略目录）：a3 失败 `.zcr-dev/verification/scope-2026-09-13-a3/`、a4 32/32 `scope-2026-09-13-a4/`、a5 32/32 `scope-2026-09-14-a5/`、0.4.0a1 三份 `scope-2026-09-12/`、0.3.0a1 `scope-2026-09-11/`。
- 0.4 之前的宿主证据（旧外壳、旧包，不继承到当前 dock/样式/发行）：S1 外壳/启停 27/27（2026-09-08）；S2 原生 runtime 12/12、3 NOT RUN（2026-09-09，真实 turn 被 typed quota 拒绝）；S3 选区 23/23、2 NOT RUN；S4 交互 40/40、5 NOT RUN（包 `c1b898ac…`）；S5 恢复 17/17、1 NOT RUN；S6 virgin 15/15、a1→a2→a1 19/19（a2 `445f4724…`）。S1–S4 驱动已随 2026-09-15 整理删除。
