# 当前进度与验收

2026-09-12。本轮交付：**A 的可授权清理与基础修复，以及 B 的本地全文/会话/请求链路开发预览**。A 中受保护的未提交旧资料仍保留；B 的真实模型回答与完整预算/恢复门槛未通过，C–F 尚未交付。唯一产品行为权威为 [规格](zotero-codex-user-flow.md)，架构/迁移在 [module-design](module-design.md)，复现命令在 [development](development.md)。不把目标、代码、单元、宿主、模型或发行证据混为一谈。

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
| `npm run test:unit` | 305 PASS / 1 FAIL，39 files | **325 PASS / 40 files**；基线失败是固定日期硬断言 Today，已固定测试时钟；新增请求/上下文/取消/隔离/存储等回归 |
| `npm run package:dev` | 0.3.0a1，sha 196f0dc… | PASS，完整本地开发 XPI（含固定 runtime） |
| `npm run verify:artifacts` | 76 files PASS | **76 files PASS**，hash/白名单/许可/无私有记录与 Node 导入 |
| `npm run verify:install -- build-info … --json` | 未作为基线执行 | PASS，实际本地 XPI 身份；不等于宿主升级/回退验收 |
| `npm run release:dry-run` | 旧版曾执行 | PASS，githubRelease=null，没有公开上传；脚本说明改指 development |
| `node scripts/prepare-host-test.mjs --context` + 专用 Zotero | 未执行 | **16/16 PASS**，下述宿主范围；signedOut，0 请求记录 |
| 文档链接 / `git diff --check` / 构建依赖图 | 旧入口相互重复/冲突 | 12 个维护/保护文档链接目标有效；diff 无空白错误；生产图覆盖 37 个运行 TS 模块，另有必要的 host-types 纯类型模块 |

工具链 Node 24.11.0 / npm 11.6.1。当前开发包：`dist/zotero-codex-reader-0.3.0a1-dev.xpi`，SHA-256 **`29b86b1e80cc610e860b597eeb4f5b8e691701794981f1925c1dc58a00a615a9`**。实际固定二进制 `codex-cli 0.144.1`，其生成的实验 JSON schema 在 verification/protocol。model/list 没有初始上下文窗口，tokenUsage 通知的 modelContextWindow 可为 null；当前显示未知，未猜容量。

宿主实际覆盖：完整 XPI 加载；标题/输入先可用；两页文本与罗马/数字标签；本地/未发送说明；页范围遗漏；返回原页和关闭保留页；signedOut 本地会话；同父/同名附件隔离；草稿恢复；30 次开关/设置；单一 dock/按钮；无模型请求记录。报告：[本轮宿主报告](../.zcr-dev/verification/scope-2026-09-11/host-current-pdf.json)。未读取/复制认证文件，未向真实库写条目。CUA 在关闭测试实例后自动重选日常窗口，随即停止该窗口操作；之后仅按已核对的专用 PID 管理测试进程。

## 性能实测与失败修复

Apple M5 / 16 GB / macOS 26.6.2 (25G83)，Zotero 9.0.6，1000×600 CSS px，DPR 2，**两页合成 PDF，全文范围，未调用模型**。计时使用 performance.now，按恢复会话＋可用输入或设置导致的上下文状态变化判定，10ms 轮询。是 DOM 可交互/状态更新测量，不是硬件输入到屏幕呈现延迟。

| 项目 | 样本 | 当前数值 |
| --- | --- | --- |
| 缓存 sidebar 打开可交互 | n=30 | p95 **8.25ms**，max 8.27ms |
| 本地设置有效状态反馈 | n=30 | p95 **1.28ms**，max 1.44ms |
| 首次插件输入出现 / 本地文本准备 | 各 n=1，PDF 已加载 | 4.80ms / 177.93ms |

该样本满足对应 250ms/100ms 初始门槛；未测整个 Zotero 冷启动、真实论文/长书、模型等待/流式渲染、长时内存/多显示器/全部主题，不能外推。

首次宿主运行真实失败：标准 page.getTextContent 在 Zotero 9.0.6 不存在；原生 getPageData 跨窗口直接传对象又产生 DataCloneError。专用 Run JavaScript 实测 Cu.cloneInto 后返回第一页 1278 字符，已据此替换旧接口并重跑成功。之后驱动报告汇总 PathUtils.join 的复合路径参数失败，改为逐段路径后全通过。两份失败报告保存在 verification/host-before-*.json，不删除或包装成 PASS。曾尝试的 install CLI --help 不支持，已将文档换成实际 build-info 命令。

## 清理与保留

已实际删除 **12 份已提交且无未提交改动的旧文档**，没有搬到 archive：4 份 archive 草案/索引；2 份旧阶段/接口计划；5 份已合并 QA（s0-s1、s2、s5、s6、acceptance）；旧 release 说明。有效约束分别迁到产品规格、架构、开发说明；有效旧证据及未运行项迁到下表。空归档目录也移除，Git 历史未重写。

代码清理：删除仅为测试保留的 renderPreview/默认渲染后门并让调用方显式注入真实 shell；删除旧 context-pane takeover 样式；删除 Coming later 设置占位及样式，替换为实际全文开关/范围 UI；移除错误的标准 PDF.js 提取接口，只有一套原生字符链路。更新脚本/文档入口与测试行为断言，不删失败测试或放宽阈值。没有新增依赖；markdown-it、DOMPurify、KaTeX 及其字体/许可仍有实际调用/打包用途。

保留特殊项：runtime/manifest.ts 与 runtime/licenses、bootstrap/manifest/locale、合成 PDF fixture、S 名称宿主驱动、故障恢复/构建/发行测试和 CI 均仍有维护用途；host-types 是必要类型边界。`.zcr-dev` profile/data/account 和既有私有内容不作为临时垃圾删除。

受保护而暂留：`docs/project-decisions.md` 改为短入口；已有未提交修改的 `docs/qa/s3.md`、`s4.md` 和未跟踪的 `feedback-2026-09-10-mvp-ui.md` 保留原内容，仅加历史标识和修复链接。新规格不引用其旧行为为要求。未获得这些未提交内容的删除授权，**不能宣称全仓冗余已清理干净**。

```text
README.md / AGENTS.md / CONTRIBUTING.md / CHANGELOG.md
docs/  zotero-codex-user-flow.md  module-design.md  development.md  progress.md
       project-decisions.md（短入口）  qa/（3 份受保护资料）
packages/  contracts/  core/  zotero/
runtime/   manifest.ts  licenses/
scripts/   tests/   .github/
build/ dist/ .zcr-dev/（忽略的生成/测试内容）
```

## 剩余差距与下一任务

| 要求 / 代码位置 | 现在与缺口 | 迭代 |
| --- | --- | --- |
| 标题/会话/全文：reader/document、chat、core/sessions | 上述本地/协议链路已验证；真实模型问答、选区全文推理/引文质量、host 文件替换和多窗口未测 | B |
| 预算/长文/缓存 | 3 份 × 每份 2MiB 本地文本上限，不裁剪；窗口未知。自动章节/问题检索、实际预算预留、语义章节/段落坐标、OCR/页面图片未接；LRU 驱逐后的随机来源 ID 可能重复存档/发送；相同 size/mtime/fingerprint 的替换不能保证识别 | B |
| 历史/恢复：presenter/store | 重开与隔离已验；离线 runtime 不可用时读历史、草稿/滚动重启持久化、空会话过滤、改名/跨文搜索/分支/队列仍缺。新 schema 2 单元恢复通过，旧版本会拒绝读取，宿主升级/回退未重跑 | B/C/F |
| 统一 @文章/@chat、/skill、personalization | 规格保留，尚未实现；reader policy 仍禁止任意工具/脚本，不能直接放开 | C |
| 模型/多模态/上下文 | 目录/按轮配置/粘贴图片/Markdown/KaTeX 有代码和单元；真实档位/多图、文件拖拽/截图/排序、图像生成、完整已发送/已引用面板及精确用量仍缺 | C |
| 标注 / 获取整理 agent | 未实现；需候选定位、任务审批、原生写入/撤销/人工冲突、DOI/列表查重与合法全文核对、写入 ledger | D/E |
| 安装/登录/发行/性能 | 当前只在 signedOut 专用树验证本地 XPI。官方新登录、真实输出/停止/在途恢复、干净 checkout/无 Node/下载隔离、长时压力/完整原生视觉矩阵、项目 LICENSE、公开发布均未完成 | F |

**下一条可执行任务**：先稳定来源 ID 与版本校验，完成预算/长文策略和来源恢复测试；在用户通过官方流程登录的隔离 profile 中，仅用合成材料验证“无需选区提问＋跨页定义＋More details＋停止＋模型设置切换”。本轮未调用真实模型，不能把过去限额日期当作现在的阻塞证据。随后按 C→D→E→F 完成全量目标，持续清理与性能回归。

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话；未发送草稿目前仅在插件寿命内保留，重启不会恢复。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 已迁移的旧版证据（不是本次通过）

来源为被合并的 Git 已追踪 QA；原始历史可从 HEAD `1fdd3dc` 查看。本表只保存仍影响当前判断的证据，不延续逐日流水账。环境均旧 macOS arm64 / Zotero 9.0.6 专用 profile / 合成材料。

| 旧验证 | 构建/结果 | 尚未证明 |
| --- | --- | --- |
| S1 外壳/启停 | 2026-09-08 的早期 shell 开发包，27/27；不继承到新 dock | 当前样式、模型或发行 |
| S2 原生 runtime | 2026-09-09 XPI；12/12 executed，3 NOT RUN；真实 turn 被 typed quota 拒绝 | 流式非空回答/停止、完整点击登录/取消/网络失败 |
| S3 选区 | 旧包，23/23 executed，2 NOT RUN；Ask 草稿/来源/A-B恢复 | 真实回答/追问停止；详见保留的 s3 |
| S4 交互 | `c1b898ac4e35de49a65c96ce56e08db6949071b62618ff7c34a01672b942a0db`，40/40，5 NOT RUN，无模型发送 | 新 in-reader dock，主题/800px/底边/发送组合；详见保留的 s4 |
| S5 恢复 | 同 c1b898ac 包，17/17，1 NOT RUN；自有进程 TERM 与 fixture uncertain 隔离 | 在途 turn resume、掉电持久性 |
| S6 virgin/升级 | 同 a1 包：15/15；a1→a2→a1：19/19（各2 NOT RUN），a2 `445f47243bb4108a0fc73c0e7c179702cc5c1068bbefb38b96d2a2a43c7b0309` | 公开下载/Gatekeeper、无 Node、真实模型、新 schema 回退 |
| 工作树副本重建 | 旧工作树 npm ci 后复现 c1b898ac；release dry-run githubRelease=null | 不等于 clean git HEAD，不等于发布；项目 LICENSE 待作者决定 |
| 2026-09-10 UI | 最新工作树曾 306 tests /39 files，XPI 196f0dc… 装到专用 acceptance profile，无 driver | 当时 screenshot paste、新样式真实目视、图像模型发送未完成；基线今日发现跨日失败 |

历史限额“约 2026-09-15”只是旧报告，当前账户可用性未读取，不作为当前结果。真实库不用于验证，不读旧认证或模型日志来猜状态。
