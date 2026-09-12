# 架构与契约

实际架构：Zotero 9 原生扩展 → TypeScript 核心 → Gecko Subprocess 私有 stdio → 随包 Codex App Server。Node 24 仅构建/测试，不存在 Node companion、业务 HTTP 端口或通用供应商层。产品行为只见 [规格](zotero-codex-user-flow.md)，当前缺口只见 [progress](progress.md)。

## 模块与状态归属

| 位置 | 责任与边界 |
| --- | --- |
| `packages/contracts/src` | PaperScope、Citation、SendInput、Conversation、ReaderEvent、端口和运行时校验；类型定义以代码为准 |
| `packages/core/src/codex` | JSONL、握手、模型目录、账户、固定版本策略、上游错误/历史解析 |
| `packages/core/src/sessions` | 附件会话、请求幂等/串行化、seq、恢复、存储和诊断白名单 |
| `packages/zotero/src/reader` | Zotero 内部 API、附件元数据/选区、原生 dock、缩放/来源定位、PDF 读取 |
| `packages/zotero/src/chat` | Presenter 草稿与消息投影、统一输入、净化 Markdown/KaTeX、焦点/滚动 |
| `packages/zotero/src/runtime` | 随包文件校验、原生进程/文件适配、插件全局监督器 |
| `scripts`、`runtime`、`tests` | 可复现构建/安装/发行、固定 runtime/许可、合成 fixture 和分层验证 |

core 只依赖 contracts，不依赖 DOM/Zotero/Node。bootstrap/index 只组装。视图只借用 ReaderClient，不得到原始管道、凭据或任意路径。监督器 single-flight，只管理自己启动的进程，确认旧进程退出才启动替代；关闭 sidebar 不停任务。

ReaderClient 的当前入口是 `snapshot/observe/refreshAccount/startLogin/cancelLogin/current/newConversation/list/get/select/send/request/cancel/deleteConversation/diagnostics/subscribe/close`，不是早期 status/models/S2Client 草案。

## 身份、请求与恢复

- PaperScope = 持久随机 profile `clientId` + libraryId + attachmentKey；数值 itemID 仅当前宿主导航。标题不是键。选区文字/坐标在点击前复制，正文与补充附件隔离。
- 请求由核心统一负责是否已发送；UI 不维护第二份上游发送记录。requestId + 规范化输入 SHA-256 去重，内容不同的同 ID 拒绝。
- `accepted` 与用户消息先原子保存；`dispatching` 在写上游前落盘；取得 turnId 后 `running`；完成/取消/失败需真实终态。`uncertain` 先 thread/resume→thread/read 对账，不能因超时、关闭或重连重新发送。
- 只有已持久化 accepted 且尚无 dispatching 的请求可以接着派发原 ID 一次。取消与完成竞态尊重已确认终态。未确认的旧 thread 隔离，新请求只能显式新对话。
- 视图先订阅再取一致快照，缓存事件只应用 seq > lastSeq。核心增量约 80ms 合并；关键状态按序持久化，异常断电耐久性未证明。多消息 phase 保留，messageCompleted 不等于整个 turn 完成。
- GenerationSettings 每轮固定 model/serviceTier/effort；目录验证组合，不通过改 effort 模拟速度；有效参数只在上游报告后记录。

## 数据与安全

生产目录位于 Zotero profile 的 `zotero-codex-reader/v1/`：`records/papers/*.json` 附件索引；`records/conversations/*.json` 快照；同名 `.jsonl` 请求状态日志；`account/` 是独立 Codex home；`home/scratch/tmp` 为运行目录。目录命名 v1 不代表所有文件永久同一 schema。

旧会话为 schemaVersion 1；首次接受全文请求升级该会话到 schemaVersion 2，未使用全文的旧会话保持 1。全文只写一次 `conversations/<conversationId>.<documentId>.source.json`，schema 2 快照保存 documentIds 与逐轮来源摘要；加载时核验来源形状和附件一致性，缺失/损坏拒绝而不重置。旧二进制不理解 schema 2，会拒绝打开，不能声称可无缝降级；保留文件、回到新版本才可读取。原子快照与顺序日志同时支撑恢复，坏尾日志有专门测试。任何扩展迁移必须测试旧记录、损坏和回退拒绝写入；不以旧构建的宿主回退记录证明新 schema 可回退。

未提交草稿目前在插件寿命内按附件/会话保留，进程重启后的草稿/滚动恢复仍是缺口。已提交状态只走 ConversationStore。退出登录、清缓存、删聊天、删文献和卸载不是同一动作；没有云同步承诺。

资料与模型内容是数据，不授予权限。输入校验上限、未知字段拒绝、图片类型/大小和选区位置约束以 `contracts/src/validation.ts` 为准；这些是传输/资源上限，不是模型上下文容量。HTML 由 DOMPurify 净化，公式由本地 KaTeX 渲染；工具执行不能由模型文本触发。

诊断仅版本、常量错误码、请求数/状态和通用存储位置，无正文、图像、账号、路径或原始 stdio/stderr。认证文件不得复制、贴 issue 或跟随普通记录备份。原生 profile/data 永不当普通临时目录清空。

## 固定 Codex 版本

`runtime/manifest.ts` 固定 0.144.1 / darwin arm64、归档和二进制 sha256 及许可证，构建不替换成系统 CLI。2026-09-11 当前缓存二进制 --version 与其生成的 JSON schema 已核验（本地证据路径见 progress）。

- model/list 报告模型、effort、serviceTiers；turn/start 支持每轮 model/serviceTier/effort 与 text/image 输入。
- `thread/tokenUsage/updated` 的 modelContextWindow 可为 null，model/list 不提供可靠初始上下文容量；不能由型号名称猜数字。contextWindowExceeded 是真实协议错误类型。
- 官方 account/login/start(type=chatgpt) → 系统浏览器 → 通知后 account/read。重复登录事件不得重复发送。策略不读取其他客户端账户。
- `app-server --strict-config` 和配置 allowlist 禁止外部工具/MCP/插件/内存/环境继承；environments.toml include_local=false、CODEX_EXEC_SERVER_URL=none 去掉执行环境。config/read 校验有效值与来源，任何意外能力 fail closed。
- 0.144.1 旧宿主探测曾证实 null tier 回显 default、codexHome 规范化、thread 策略/目录能力不代表账户可生成。具体校验在 reader-policy.ts；新功能不能随意放开该策略。未来 agent/skills 的有限能力需独立契约与测试。

## Zotero 原生适配

reader 私有 API 均集中在适配器。当前 `#split-view` dock 位于原生 toolbar 下面；Zotero context pane 的注册只保留原生入口，打开助手时协调收起。PDF 锚点用页及 PDF 坐标，固定 scale 暂时 page-width，仅在仍拥有临时缩放时恢复。用户期间打开原生笔记/信息或手调缩放后不抢回。

Zotero 9.0.6 运行时使用 getPageData({pageIndex}) 与 getPageLabels2()；标准 page.getTextContent 并不可用。已在专用合成 PDF 的 Run JavaScript 实测原生字符接口，跨窗口参数经 Cu.cloneInto 转到阅读器 realm。提取逐页调度，保留字符的段落/换行并报告空页/错误/partial 标志；读取正文不等于图像理解，写原生高亮仍需验证坐标。PDF fingerprint 与文件轻量版本不是抗恶意替换的内容哈希；不得据此声称任意同 size/mtime 替换都可识别。

宿主只在经过测试的平台/布局声明支持；堆叠布局、独立窗口、下载隔离属性都不能由 API 存在推断通过。

本地提取缓存最多 3 份、每份 2 MiB 文本（资源限制，不是模型预算），只在用户发送时进入请求。超过上限明确阻止发送，可指定物理 PDF 页范围；模型窗口当前显示未知，预算适配/自动长文检索尚待实现。连续轮次按来源 ID/模型复用，上游压缩、恢复或失败后重新带入来源；没有上游永久缓存承诺。
