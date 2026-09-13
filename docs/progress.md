# 当前进度与验收

本页只保留**当前状态、验证边界、剩余差距/下一任务与执行计划**。逐日迭代流水、原样失败记录与旧版证据已搬到 [docs/archive/progress-history-2026-09.md](archive/progress-history-2026-09.md)。代码、单元测试、真实宿主、真实模型与发行物是不同层次的证据，不得互相冒充；未运行项一律保留为 NOT RUN，不补写原因。


## 当前状态（2026-09-14 仓库清理后）

- **Git**：`main` 已把 `codex/product-agent-v0.4` 快进合并（98 个提交逐字保留、历史未改写），随后删除已完成的本地分支与空目录 `.worktrees/`；`origin/codex/product-agent-v0.4` 保留不动，未 push、未打 tag。清理前 HEAD `a7800ce5de13d65d3fe90c5c0313f37db5db26f0` 存于本地安全 ref `refs/backup/pre-cleanup-20260914`。
- **工作树**：干净。本轮只改被跟踪的 `packages/zotero/assets/sidebar.css`（死代码）与本页/其它文档；`dist/`、`build/`、`.zcr-dev/` 的清理不产生提交。
- **开发版本**：npm `0.4.0-alpha.1` / Zotero `0.4.0a4`（未提升）。
- **门禁（2026-09-14 同一树、按序）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **988 passed / 77 files / 0 skipped**；`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a4-dev.xpi`（**92,661,386 bytes**，SHA-256 `061f46801f494b900d2fc27445f05ad1e57052a7f3f3962a0f72a014d652ea6e`）；`npm run verify:artifacts` **79 files PASS**，与 `dist/SHA256SUMS` 一致。均为代码 + 单元 + 产物证据。
- **产物诚实边界**：owner 安装且完成真实宿主 `--context` **32/32** 的是**上一份** a4 字节（92,661,563 bytes，SHA-256 `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`，构建于 `96f8c2c`）。本次清理后重打的同版本 a4（`061f4680…`）**取代**其 digest：源码差异只有**可证死代码**的 CSS 规则删除（`f1e8044` 的 `.zcr-history-archived-label`，加上本轮删掉的 `.zcr-appearance*` 与 `.zcr-workspace-check`——均无渲染路径、无行为变化），故**未重跑宿主**。宿主已验证的旧字节原样保存在忽略路径 `.zcr-dev/artifact-backup/zotero-codex-reader-0.4.0a4-dev.host-verified-5a6bb161.xpi`，需要时可还原。**同版本重装脚枪**：owner profile 装的仍是 `5a6bb161` 字节，若再侧载 `061f4680` 而同为 `0.4.0a4`，Zotero 会按同版本 no-op 而看不到变化——下一次要 owner 可见应提升版本号。
- **本轮删除（忽略目录，不产生提交）**：`dist/` 旧包 `0.3.0a1`（102,969,823 B）/ `0.4.0a1`（92,643,635 B）/ `0.4.0a2`（92,643,635 B）/ `0.4.0a3`（92,668,286 B）、`build/`（215 MB）、`.zcr-dev/` 旧日志 37 份（11 MB）与旧报告/ `build-info-*.json` 6 份。保留 `dist/0.4.0a4` + `SHA256SUMS`，以及 `.zcr-dev/{profile,data,context,live,verification,pin-bump,probes,fixtures,s6-virgin,s6-upgrade,runtime-cache}` 与新增的 `artifact-backup/`。删除前已用 `ps` 确认无 Zotero 进程使用任何 `.zcr-dev/` profile，且逐文件 `rg` 确认无仓库引用。
- **安装状态**：owner 正常 profile 当前装的是宿主已验证的 a4（`5a6bb161…`，构建于 `96f8c2c`）供验收。

## 实际交付路径

- 在当前 PDF 打开 Codex，先显示完整文章标题对应的会话和可输入界面；无需登录即可创建/恢复本地会话。打开本身不产生模型请求。
- 自动本地读取当前附件的全部可提取文本；正文来自 Zotero 原生 getPageData/getPageLabels2 字符接口，保留段落/换行/页标签。上下文可展开预览并返回原页，可指定物理 PDF 页范围，明确未覆盖/空白/失败/partial 页。
- 首次外发范围说明；真实设置可关闭自动全文。发送边界复核其他视图的全局关闭设置；问题、选区、图片、模型设置与请求附件冻结。解析失败/取消不发送书目替代回答，问题保留，准备期间新输入不被旧请求清掉。
- 同附件并发打开不再生成重复会话；同名正文与补充附件隔离。新建对话有独立草稿，切回恢复原草稿；两视图订阅不互相顶掉。删除活动/不确定聊天被拒绝，不把删除当取消、不丢请求日志。
- core 已把全文接入真实 turn/start 参数构造；同会话同来源追问复用，压缩通知/恢复/失败后重新带入原文。全文存为独立不可变 source 文件，逐轮消息只存摘要，避免重复写全文。**这一协议路径已过模拟集成，尚无本轮真实模型回答证据。**

## 验证：基线与现在

开始时 main / HEAD `1fdd3dc`，56 个已有修改/未跟踪文件。未提交、未推送。原内容与 diff 保存在忽略的 `.zcr-dev/verification/scope-2026-09-11/baseline/`；当前 diff 包含这些既有工作，不能全部归为本轮新增。

| 检查 | 本轮开始 | 当前结果与边界 |
| --- | --- | --- |
| `npm run typecheck` / `npm run lint` | PASS | PASS |
| `npm run test:unit` | 305 PASS / 1 FAIL，39 files | **699 PASS / 60 files**（合并后连续两次无 flake）；含新增契约/上下文/任务/工作区/原生/图像/来源链接/请求计时回归，以及 schema-3 回退 fixture 解析回归；仅为单元证据 |
| `npm run package:dev` | 0.3.0a1，sha 196f0dc… | PASS，`dist/zotero-codex-reader-0.4.0a1-dev.xpi`（含固定 runtime 与项目 MIT LICENSE）；本轮重建 digest 仍为 `d33ab244…`（与提交前一致，字节可复现） |
| `npm run verify:artifacts` | 76 files PASS | **77 files PASS**，hash/白名单/许可/无私有记录与 Node 导入；digest 读 `dist/SHA256SUMS` |
| 临时 `git worktree` + `npm ci` 的 clean HEAD 重建 | 未执行 | **PASS**：typecheck PASS；`test:unit` 631（无 `dist/` 时 629+2 skip）；`package:dev` → 0.4.0a1 XPI；`verify:artifacts` 77 files，digest 与主树一致；复用本地固定 runtime 缓存，未重新下载 |
| `npm run verify:install -- build-info … --json` | 未作为基线执行 | PASS，实际本地 XPI 身份；不等于宿主升级/回退验收 |
| `npm run release:dry-run` | 旧版曾执行 | PASS，githubRelease=null，没有公开上传；脚本说明改指 development |
| `node scripts/prepare-host-test.mjs --context` + 专用 Zotero | 未执行 | 0.3.0a1 曾 **16/16 PASS**；本轮在 **0.4.0a1 复现 16/16 PASS**，signedOut，0 请求记录 |
| `node scripts/prepare-host-test.mjs --context --native` + 专用 Zotero | 未执行 | 旧 0.3.0a1 的 12 项原生驱动；本轮在 **0.4.0a1 复现 12/12 PASS**（4 类 NOT RUN），driverIssuedModelRequests=0 |
| `node scripts/prepare-host-test.mjs --s6 --upgrade-xpi 0.4 --rollback-xpi 0.3` + 专用 Zotero | 旧 a1→a2→a1，19/19 | **22/22 PASS**（2 NOT RUN）：0.3→0.4→0.3 版本切换、记录保留、新 schema 回退安全拒绝 |
| 文档链接 / `git diff --check` / 构建依赖图 | 旧入口相互重复/冲突 | 12 个维护/保护文档链接目标有效；diff 无空白错误；生产图覆盖 37 个运行 TS 模块，另有必要的 host-types 纯类型模块 |
| `.github/workflows/ci.yml` / `release.yml` | Node 只写 `24`（浮动 major），只跑 typecheck/lint/test:unit，从不打包 | Node 改为 `node-version-file: .nvmrc`（24.11.0，与 engines `>=24 <25` 一致）；`check` 跑 `npm ci`/`typecheck`/`lint`/`test:unit`，`package` 跑 `runtime-prepare`/`package:dev`/`verify:artifacts`；无 upload/publish/tag 步骤，宿主与 `--live` 明确排除 |

工具链 Node 24.11.0 / npm 11.6.1。当前开发包：`dist/zotero-codex-reader-0.4.0a1-dev.xpi`；`package:dev` + `verify:artifacts` 实测 **77 files**，SHA-256 以 `dist/SHA256SUMS` 为准。**2026-09-13 分支合并后的树**实测 **`24d82e17ca2f1bae5ee5b2806d69845c600bed63a848abd070fb2321e9baf534`**（含重绘 icon.svg）；上节宿主证据对应的合并前构建为 **`d33ab244f49e24da983daa2bfdbf542b8f6f28c5b40ad5b295ffd8c613311049`**。项目 MIT `LICENSE` 已随包。实际固定二进制 `codex-cli 0.144.1`，其生成的实验 JSON schema 在 verification/protocol。model/list 没有初始上下文窗口，tokenUsage 通知的 modelContextWindow 可为 null；当前显示未知，未猜容量。

宿主实际覆盖：完整 XPI 加载；标题/输入先可用；两页文本与罗马/数字标签；本地/未发送说明；页范围遗漏；返回原页和关闭保留页；signedOut 本地会话；同父/同名附件隔离；草稿恢复；30 次开关/设置；单一 dock/按钮；无模型请求记录。报告：[本轮宿主报告](../.zcr-dev/verification/scope-2026-09-11/host-current-pdf.json)。未读取/复制认证文件，未向真实库写条目。CUA 在关闭测试实例后自动重选日常窗口，随即停止该窗口操作；之后仅按已核对的专用 PID 管理测试进程。

## 性能实测与失败修复

Apple M5 / 16 GB / macOS 26.6.2 (25G83)，Zotero 9.0.6，1000×600 CSS px，DPR 2，**两页合成 PDF，全文范围，未调用模型**。计时使用 performance.now，按恢复会话＋可用输入或设置导致的上下文状态变化判定，10ms 轮询。是 DOM 可交互/状态更新测量，不是硬件输入到屏幕呈现延迟。

| 项目 | 样本 | 当前数值 |
| --- | --- | --- |
| 缓存 sidebar 打开可交互 | n=30 | p95 **8.25ms**，max 8.27ms |
| 本地设置有效状态反馈 | n=30 | p95 **1.28ms**，max 1.44ms |
| 首次插件输入出现 / 本地文本准备 | 各 n=1，PDF 已加载 | 4.80ms / 177.93ms |

0.4.0a1 同一驱动重跑（2026-09-13，报告内环境 1512×949 DPR 2，同一台 M5，两页合成 PDF，未调用模型）：

| 项目 | 样本 | 0.4.0a1 实测 |
| --- | --- | --- |
| 缓存 sidebar 打开可交互 | n=30 | p95 **22.23ms**，max 26.25ms |
| 本地设置有效状态反馈 | n=30 | p95 **2.39ms** |
| 首次插件输入出现 / 本地文本准备 | 各 n=1 | 9.07ms / 83.99ms |

两次都满足 250ms/100ms 门槛；0.4 数值更高来自本机负载与更多的本地持久化/工作区初始化，样本仍是 DOM 可交互测量，不能外推为硬件呈现延迟或长时压力结论。

该样本满足对应 250ms/100ms 初始门槛；未测整个 Zotero 冷启动、真实论文/长书、模型等待/流式渲染、长时内存/多显示器/全部主题，不能外推。

首次宿主运行真实失败：标准 page.getTextContent 在 Zotero 9.0.6 不存在；原生 getPageData 跨窗口直接传对象又产生 DataCloneError。专用 Run JavaScript 实测 Cu.cloneInto 后返回第一页 1278 字符，已据此替换旧接口并重跑成功。之后驱动报告汇总 PathUtils.join 的复合路径参数失败，改为逐段路径后全通过。两份失败报告保存在 verification/host-before-*.json，不删除或包装成 PASS。曾尝试的 install CLI --help 不支持，已将文档换成实际 build-info 命令。

## 剩余差距与下一任务

| 要求 / 代码位置 | 现在与缺口 | 迭代 |
| --- | --- | --- |
| 标题/会话/全文：reader/document、chat、core/sessions | 上述本地/协议链路已验证；真实模型问答、选区全文推理/引文质量、host 文件替换和多窗口未测 | B |
| 预算/长文/缓存 | 本地文本缓存最多 **3 份、每份 16 MiB UTF-8**，超限要求缩小页范围；来源 ID 由文献身份/版本/解析器/页范围/文本摘要确定性生成，LRU 驱逐不改变身份；加载字节与磁盘 SHA-256 比较可发现 size/mtime 不变的替换。已接 runtime 窗口优先、否则固定 catalog 的预算与聚焦/多轮计划；自动章节/问题检索、语义坐标、OCR/页面图片仍未接。以上为代码+单元证据，真实模型预算行为未测 | B |
| 历史/恢复：presenter/store | 离线历史、草稿/滚动持久化、改名/分支/排队、schema 3 读写与旧 schema 1/2 安全拒绝已有代码与单元回归；**0.3↔0.4 宿主升级/回退与 schema-3 回退安全拒绝本轮已在 s6 隔离树验证（22/22）**，真实模型在途恢复仍未测 | B/C/F |
| 统一 @文章/@chat、/skill、personalization | WorkspaceStore、@article 元数据先行/选定后读取、@chat 有界快照、SKILL.md 解析与 revision 冲突、偏好/研究配置已有代码与单元；第三方 skill 仍不能授予权限。真实库接线与 UI 目视未验 | C |
| 模型/多模态/上下文 | 固定 catalog 模态/窗口、provider 能力与 rate-limit 解析、每轮预算、粘贴图片、生成图 16 MiB 校验与导出、diagram 线程能力已有代码与单元；真实档位/多图/真实图像生成、文件拖拽/截图排序、精确用量与完整已发送/已引用面板仍未测 | C |
| 标注 / 获取整理 agent | 候选 JSON 解析、按 PDF 版本原文定位、任务审批、账本写意图/撤销/冲突检测、DOI/链接查重与 OA 附件校验已有代码与单元；真实库原生写入/撤销、网络预览与合法全文核对未在宿主验证 | D/E |
| 设置/偏好设置窗口：preferences-*、workspace-store | 原生面板注册/清理、面板端口与快照写入、侧边栏去重已有代码与单元；**2026-09-13 已在真实宿主预检：注册身份正确、真实 Preferences 窗口能挂载面板（沙箱桥对片段可见）、禁用/启用不叠加、无错误日志**；**面板文案已随 store 的 `uiLanguage` 本地化，并在真实 Preferences 窗口实测双向切换（zh：图例 `对话`、store 读回 `zh`、六个内置 skill 的 id/名字逐字不变；切回 en：`Chat`、store 回 `en`）**。仍缺面板的中文**视觉**（字体回退、暗色/亮色、键盘 Tab）、打开窗口时的真实 store 并发，以及片段挂载前占位与“插件未运行”告警的英文（那时没有可读 store，无持久化语言可用） | F |
| 论断溯源：reader/locate、reader/source-highlight、reader-policy | 冻结 revision 校验、逐字引用定位与临时高亮导航、诚实 miss、无库写入已有代码与单元；**2026-09-13 已在真实宿主用生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑：回到引用页 `highlighted`、缺失 quote 诚实 `unlocated`、无库写入**；仍缺真实 Gecko 高亮**视觉**、长引用真实定位质量、以及真实模型是否输出逐字引用（点击真实回答链接的完整路径未验） | F |
| 安装/登录/发行/性能 | 项目已按 MIT 许可并在包内包含 `LICENSE`；本轮实测 `package:dev`/`verify:artifacts`。官方新登录、真实输出/停止/在途恢复、无 Node/下载隔离、长时压力、完整原生视觉矩阵、公开签名发行均未完成；本轮已复现 clean HEAD 重建（见上） | F |

**下一条可执行任务（含本轮新增）**：`--context` 已能程序化打开真实偏好设置窗口、确认 `Zotero Codex Reader` 面板挂载与禁用/启用幂等，并在该窗口内实测面板文案随 store 语言双向切换；`close-preserves-current-page` 的间歇性丢失已定位为 pdf.js 提交页/位置之间的真实竞态并修复，驱动另有 `reopen-keeps-current-page` 守住“关闭再打开仍回到同页”。剩余的是**目视**核对面板（中文/英文、暗色/亮色、键盘 Tab、保存与导出失败提示）与真实 Gecko 临时高亮的**视觉**表现，需人工对照；随后在用户通过官方流程登录的隔离 profile 中，仅用合成材料验证“无需选区提问＋跨页定义＋More details＋停止＋模型设置切换”和真实图像生成（含真实模型回答里引用链接的点击路径）；随后用真实宿主复核最终 0.4 XPI 的原生任务/获取 UI，再按 F 的门槛处理升级/回退、无 Node 安装与公开签名发行。本轮未调用真实模型，不能把过去限额日期当作现在的阻塞证据。

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话；未发送草稿目前仅在插件寿命内保留，重启不会恢复。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 当前全量执行计划

- [x] 重新验证整合基线，建立功能分支与本地 checkpoint；收敛剩余旧文档。
- [x] B（代码+单元）：稳定文件/来源身份，预算与长文覆盖，草稿/滚动持久化、全局历史/改名/分支/排队、离线历史；代码在 contracts、core/sessions、reader/document、chat/presenter。
- [x] C（代码+单元）：可持久化 WorkspaceStore（偏好/研究配置/skills/引用）、统一 @文章/@chat 与 /skill；冻结本轮版本和权限。
- [x] UI（代码+单元）：单标题/四区、自然布局 composer、统一候选键盘交互、稳定消息 DOM、字号/焦点/图像预览；view.ts/sidebar.css 单一写入负责人。
- [x] D（代码+单元）：原生 quote 定位适配＋持久化任务 ledger；模型产生候选，审批后写入，冲突检测与撤销；真实库标注仍待宿主验证。
- [x] E（代码+单元）：DOI/链接/列表未保存元数据、查重、指定 collection、OA PDF 校验与恢复；原生适配与 ledger 共用；网络/真实库未验。
- [x] 多模态/能力（代码+单元）：模型目录/usage/上下文预算来源；粘贴/截图多图；固定 runtime 图像生成能力与 16 MiB 生成图校验；真实模型图像生成未验。
- [ ] F（BLOCKED）：真实隔离登录/问答/停止/恢复、各用户路径、主题/窄窗/大字/压力、无 Node/公开下载仍在对应条件成立时验收。**版本升级/回退与 schema-3 回退安全拒绝本轮已在 s6 隔离树验证（22/22）**；仍需要隔离官方登录、真实模型、真实宿主原生 UI、签名 XPI 与公开发布授权。
- [x] 合并 `feat/usage-batch-1` 与 `fix/audit-bugs-ui` 并补完耗时 UI（代码+单元）：两侧测试均保留，全量 `test:unit` 连续两次 **699 tests / 60 files**，重打包 `verify:artifacts` **77 files**；真实宿主/模型仍未重跑。
- [x] 设置迁移（代码+单元+**2026-09-13 宿主预检**）：全局设置进入 Zotero 原生偏好设置面板（注册/反注册/失败与关闭竞态已测），侧边栏只保留每对话内容并指向原生设置；XPI 已含片段与脚本，`verify:artifacts` 把它们列为必需文件。**真实宿主已确认面板注册身份、Preferences 窗口挂载、禁用/启用幂等，以及面板文案随 store 的 `uiLanguage` 双向切换且 skill id/名字逐字不变**；面板的中文**视觉**（字体回退/主题/Tab）仍待宿主目视。
- [x] 阅读锚点竞态（代码+单元+**2026-09-13 宿主复核**）：`close-preserves-current-page` 的间歇失败定位为 pdf.js “跳页已提交、`_location` 尚未刷新”的真实竞态；`capturePosition` 改以已提交页为准、`setZoom` 先对齐恢复目标，失败优先单测先在未修复代码上失败；最终包连续 5 次 `--context` 23/23 PASS（另 `--context --native` 13/13），并新增 `reopen-keeps-current-page`。未复现失败的统计局限已在文中写明。
- [x] 论断溯源（代码+单元+**2026-09-13 宿主预检**）：点击引文先校验冻结 revision，再按链接 title 的逐字引用在冻结页面字符盒上定位，命中才做临时高亮，未命中诚实提示；点击路径无任何库写入。**真实宿主已用生产 `nativeSourceNavigator`+`openSourcePage` 与合成 quote 确认回到引用页的临时高亮导航、诚实 miss 与无库写入**；真实 Gecko 高亮**视觉**与真实模型是否遵守逐字引用指令仍未测。
- [x] CI 计时（代码+单元，2026-09-13）：`check` 作业在全量并行下超时的一类根因是**多兆字节 base64 往返叠加 vitest 对多 MiB `Uint8Array` 的通用深比较**（3 MiB 单次深比较实测 **~2.4s**，而 base64 编解码本身仅 ~110ms）。`reader-library.test.ts` 的导出上限用例改为精确的 **2 MiB+1** 边界（隔离 2.7s→**1.8s**，全量并行 **~3.5-4.3s**），`generated-image.test.ts` 的 16 MiB 边界用例补上与既有先例一致的 **15000ms** 显式预算（隔离 **~1.7s**，全量并行 **~3.0-4.5s**）；工作、边界与断言均未删改，也未全局抬高 `testTimeout` 或降低 worker 并发。本机连续 3 次全量 **746/746（67 files）**；另用 12 与 30 个 CPU 占用进程施压仍全绿（两个重测分别 ~7.3s 与 ~12.8s，均在预算内），未施压时最坏 ~4.5s。以上为单元/打包证据，不是宿主或真实模型结论。
- [x] 0.4.0a3 版本提升、门禁、打包与产物校验（代码+单元+产物）：提交 `8828c15`；`typecheck`/`lint` PASS、`test:unit` 77 files（打包后 **961 passed / 0 skipped**）、`package:dev` → `dist/zotero-codex-reader-0.4.0a3-dev.xpi`（92,668,286 bytes，SHA-256 `3abeb8c2…`）、`verify:artifacts` 79 files PASS；owner profile 已装入 a3 供验收（profile 变更，非仓库提交）。**但真实宿主不等同通过**：见下条。
- [ ] 真实宿主 `--context`（2026-09-13 0.4.0a3）：**FAILED**。新阶段（`b9165c1`）首次真机运行，在 `automatic-background-preparation` 处 60s 超时（5 项已通过；两次运行同一处未满足），报告原样归档于 `.zcr-dev/verification/scope-2026-09-13-a3/`；未修改驱动、未重试到通过。产品侧根因未定位，后续检查因此都未跑到。`--live-model`（需 owner 登录）仍 NOT RUN。
- [x] 0.4.0a4 版本提升、门禁、打包与产物校验（代码+单元+产物）：提交 `96f8c2c`；`typecheck`/`lint` PASS、`test:unit` 打包前 968+2 skip、打包后与清理后均 **970/970（76 files，0 skipped）**、`package:dev` → `dist/zotero-codex-reader-0.4.0a4-dev.xpi`（92,661,563 bytes，SHA-256 `5a6bb161…`）、`verify:artifacts` 79 files PASS；owner profile 已装入 a4 供验收（profile 变更，非仓库提交）。
- [x] 真实宿主 `--context`（2026-09-13 0.4.0a4，**取代 a3 的 FAILED 结论**）：**32 executed / 32 PASS / 0 FAIL**，`recordedRequests = 0`，`build` 0.4.0a4 且 SHA-256 与产物一致；首次命中 `Appearance`/`外观` 图例 canary；a3 曾失败的 `automatic-whole-pdf-background-preparation-without-panel` 通过（`productGate` 2/2、10 次自动读取、`preparationObserved: true`）。报告归档 `.zcr-dev/verification/scope-2026-09-13-a4/`。8 项 `notRun`（含 `--live-model` 需 owner 登录）不得当作通过。
- [x] 死代码清理（代码+单元，2026-09-13）：移除 `sidebar.css` 中已无引用的 `.zcr-history-archived-label` 规则，并删掉 `sidebar-styles.test.ts` fixture 中同 class 的无断言 span；提交 `f1e8044`，清理后 970/970。
- [x] 开发 XPI 安装流自校验（代码+单元+只读真实 profile，2026-09-13）：新增 `npm run install:dev`（`plan`/`install`/`check`/`revert`/`rollback`）与 18 条单元/临时树回归（`test:unit` 988/988、77 files），脚枪与命令见 development；真机 `check` 仍需一次目标 profile 重启才能证明，owner 当前实例按决定未重启。
- [ ] 收尾：版本升级与小提交本轮完成；干净 checkout 重建本轮已在临时 worktree 复现（typecheck/单元/package:dev/verify:artifacts 与主树同 digest）；CI/release 工作流已按真实脚本与 `.nvmrc` 加固且保持无 upload/publish；产物/隐私/文档链接复查仍待执行，只留必要测试/运行资产。

UI 参考已只读核验本机官方扩展 26.908.31748 的样式资产；不是复制源码/品牌。使用 28px 桌面控件、宿主字体/主题、4/8/12/16px 间距、13px 正文和克制边框。原生宿主视觉还须在改动后实际检查。

## 未验证 / NOT RUN（不得当成通过）

本轮 2026-09-14 清理**未运行任何真实宿主、真实模型、图像生成或公开发行检查**。当前仍未验证：

- 真实模型输出/流式/停止/在途恢复（`--live` 与 `--live-model` 均 NOT RUN；`--live-model` 需 owner 本人在 `.zcr-dev/live/` 隔离树完成一次官方登录）；真实图像生成；真实文献库原生标注写入与撤销；`--context` 报告里的 8 项 `notRun`（`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister`、`acknowledge-context-resumes-the-pending-explain`）。
- 面板中/英文与暗色/亮色的**目视**、键盘 Tab、真实 **IME** 输入、真实 Gecko 临时高亮**视觉**、真实阅读锚点目视；真实文献库 PDF 是否与合成 fixture 行为一致。
- 无 Node 环境安装、下载隔离、公开签名发行与升级验收；干净 checkout 重建（历史上已在临时 worktree 复现过一次，本轮未重跑）。
- a3 的 `--context` 失败（`automatic-background-preparation` 60s 超时）已被 a4 的 32/32 取代；a3 失败报告与过程原样保留在归档。


## 历史

- 逐日迭代流水、原样失败报告、旧版证据与历次清理记录：见 [docs/archive/progress-history-2026-09.md](archive/progress-history-2026-09.md)（2026-09-14 从本页搬出，内容未改写，仅调整相对链接）。
- 被删除的旧文档与旧代码的原文可从归档中记录的基线提交查看。

