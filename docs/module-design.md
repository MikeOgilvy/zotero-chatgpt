# 架构与契约

本文描述 **0.4.0a6 工作树实现**。产品行为由[产品规格](zotero-codex-user-flow.md)定义，命令见[开发与测试](development.md)，已验证范围和剩余问题统一见[进度与验收](progress.md)。代码、单元测试、真实宿主、真实模型和最终 XPI 是不同层次的证据。

运行路径为 Zotero 9 原生扩展 → TypeScript core → Gecko Subprocess 私有 stdio → 随包 Codex App Server。Node 24 只用于构建和测试。模型没有通用脚本、库写入或文件系统工具；本地阅读、标注、文献导入通过有明确输入和权限边界的原生端口完成。

## 模块与寿命

| 模块 | 责任 |
| --- | --- |
| `packages/contracts/src` | 文献身份、来源版本、消息、工作区、原生任务和端口；`validation`、`document`、`workspace-validation` 校验跨模块数据 |
| `core/codex` | JSONL、握手、模型/能力/用量、固定版本策略、错误及恢复历史解析 |
| `core/sessions` | 会话、请求哈希、串行状态变更、持久化队列、上游线程、取消与对账 |
| `core/context` | 全文/聚焦/分批计划、预算估算、固定输入与分步结果、恢复和批次占用；`bibliography.ts` 是书目字段清单、长度上限与"缺失即缺失"规则的唯一实现，同时供请求的紧凑书目块与侧栏书目卡片使用 |
| `core/workspace` | 离线历史、草稿、图片资产、偏好、研究主题和 SKILL.md |
| `core/tasks` | 原生任务候选、任务级审批、写入意图、结果账本、对账与撤销 |
| `zotero/reader` | 当前附件、原生 dock/缩放/选区、文本及版本校验、原文定位、页面图像、显式文章引用；`selection.ts` 从 Zotero 条目抽取书目字段，`metadata.ts` 只是 `core/context/bibliography.ts` 的再导出以保留原有导入路径 |
| `zotero/agent` | 无状态 NativeAgentPort：定位引文、标注、元数据/查重、集合成员关系及 OA 附件 |
| `zotero/chat` | Presenter 与视图投影、统一输入、历史/任务/上下文、净化 Markdown 和 KaTeX |
| `zotero/runtime` | 本地服务、GeckoStorage、发行资产校验、生成图像加载、自有进程监督器 |

core 只依赖 contracts，不依赖 DOM、Zotero 或 Node。bootstrap/index 负责组装；视图借用服务端口，不持有原始管道或账户目录。关闭 sidebar 或卸载某个视图不结束任务。原生任务、阅读批次和模型请求各自保存状态；它们不以一个仍然打开的阅读器窗口作为存续条件。

本地工作区和原生任务记录可在运行组件未启动、离线或未登录时读取。发送模型请求仍需可用 runtime 和官方登录。监督器只管理自己启动的进程，确认退出后才替换；插件关闭分别停止本地工作和 runtime，一方清理失败不能跳过另一方，也不能提前丢掉仍待终止的进程句柄。阅读协调器停止新派发并等待自己的写入结束后才能交给替代实例。

## 身份、发送与队列

`PaperScope` 是持久随机 profile `clientId`、`libraryId`、`attachmentKey` 的组合；数值 itemID 只用于当前宿主查找。标题、文件名或父条目不是附件身份。正文与补充材料分别拥有会话和来源。

发送前复制问题、附件/库/profile、PDF 版本、选区、图像、引用、skill 版本、偏好和模型设置。文献内容与第三方 skill 只能提供数据，不能选择原生写入 key、集合、任意路径或新增权限。同名附件、切标签、编辑草稿和下一轮设置不改变已捕获的请求。

`requestId` 和输入 SHA-256 共同去重。新请求使用 `hashVersion: 2`，包括明确提供的书目信息；重建时保留字段缺省状态，不能补入另一个标题后改变哈希。旧 V1 哈希按旧规则核对。不同内容复用同一 ID 会被拒绝。

用户消息与 `accepted` 先保存，`dispatching` 在上游提交前保存，取得 turnId 后进入 `running`。仅持久化且从未派发的 accepted 请求可继续派发一次。dispatching/running 在连接中断后进入 uncertain，通过 `thread/resume` 和 `thread/read` 按请求 ID 对账；超时、重开视图和重启均不自动重发不确定写入。恢复后的上游 item ID 与本地消息绑定，避免把一段部分输出和完整输出存成两条回答。恢复历史与实时事件使用相同的工具活动边界。

同一会话只有一个 activeRequestId。`enqueue` 保存下一问题的完整快照，取消等待项不影响正在执行的请求；取消活动项先检查会话归属，并等待上游终态。`activeBatchId` 使普通问题排在整个多轮阅读批次后面，而非穿插进两次阅读之间。确认取消或结束批次后释放占用；存在活动/不确定轮次时不能强行释放。

视图先订阅再取快照，只应用 seq 大于 lastSeq 的事件。文本增量约 80ms 合并，消息结束与整个 turn 结束分别处理。改名、分支和重新生成保留来源；新分支不重放原生写入。模型、effort、serviceTier 按轮固定，实际目录不支持的组合会被拒绝。

## 当前 PDF、引用与预算

默认只准备当前附件；打开 PDF 可在本地逐页读取，外发发生在发送或已授权任务边界。`@article` 搜索先返回元数据，选定后才读取对应 PDF。`@chat` 是明确消息的有界快照，不递归展开嵌套引用，也不被当作文献原始证据。

本地文本缓存最多保留 3 份结果，每份 **16 MiB UTF-8 文本**，超过上限要求缩小页范围，不静默裁剪。来源 ID 由文献身份、版本、解析器、页范围和文本摘要确定，LRU 驱逐不会把同一来源变成随机新身份。片段保留来源关联、物理页号、印刷页标签、空白/失败状态及实际覆盖；页内分块或不完整文本使用 partial。

本地上限不等于模型窗口。每轮先采用本模型/线程的有效 runtime 窗口报告，否则按固定 runtime/hash 对应的精确 model ID 目录值估算；无可靠值时明确未知。预算为指令、历史、工作流、问题、图像、输出和安全余量预留空间。UTF-8 字节近似 token、图像额度与安全余量均是保守策略，不是 tokenizer 实测、账户容量承诺或图像成本精确值。累计 total usage 不是当前上下文占用。

可容纳时发送全部授权文本；否则生成聚焦范围或多轮阅读计划。分批阅读固定原始问题、全部来源、设置及 request IDs，每个 map 和 reduce 使用新的上游线程；中间结果只来自已完成并保存的真实回答。reduce 只接收已完成的来源摘要，不再次堆入全部原文/图片。摘要或共享上下文超预算时暂停并说明，不能截短后冒充完成。最终 diagram 可用已验证图像作为成果；map 仍需文字证据摘要。批次状态与结果哈希另行持久化。

普通连续问答可在同一上游线程复用当前来源；压缩、恢复或失败后重新提供所需来源。缓存不代表服务端永久保留上下文，也不代表免计费。

## 本地记录与兼容性

基础目录是 Zotero profile 下的 `zotero-codex-reader/v1/`。目录中的 v1 是命名空间，不是所有文件的 schema 版本。

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

新会话和新发送写 schema 3；读取兼容 schema 1、2、3。schema 1 的旧消息不要求文献正文；schema 2 的独立 source 文件结构继续使用；schema 3 增加工作流、引用来源、批次、用量、生成图像和上游消息关联。原生任务、阅读任务和工作区使用各自 schema，不跟随会话版本编号变化。

加载时校验来源身份、引用关联、哈希和数据形状。缺失/损坏文件、未知 schema 与不支持的旧二进制会明确拒绝，保留原文件，不重置为空；这叫安全拒绝，不是“旧版本可继续写新记录”。降级/回滚的实际行为必须在隔离副本上验证。GeckoStorage 使用受限相对路径、符号链接检查、原子快照和 flush；请求日志支持坏尾恢复，但不宣称断电时目录级 fsync 或跨文件事务保证。

SKILL.md 正文与注册表不再维护两份副本。读取时从文件重新解析有限 frontmatter 和正文；UI 编辑与外部编辑通过 revision 冲突检查。旧内嵌正文迁移到 SKILL.md 后从注册表移除。内置 skill 来自随包定义，可启停，修改需复制。导入默认不启用；脚本、MCP、依赖等未支持能力不会执行，不能因导入或声明 permissions 获得权限。

## 原生任务与撤销

标注先将严格的模型候选 JSON 解析为原文引用，再按冻结 PDF 版本校验唯一文字位置和真实矩形。无法定位、歧义或几何不可靠时只保留建议。`planAnnotations` 按 modelRequestId 持久化去重；再次打开视图或恢复同一模型请求不会复制候选任务。准备阶段的取消会忽略迟到的只读结果。

只有任务批准后才执行被选中的写入。每次原生操作先保存 writing 意图；创建条目/标注先保留 key，修改已有条目保存其原快照。PDF 附件的 key 由宿主生成，账本先保存父条目和获取意图，成功后记录实际附件 key；结果不明时不能假定未写入而重试。`Annotations.saveFromJSON` 是按 key 更新的接口，适配器拒绝陌生已有 key；它自行调用 saveTx，不能外套另一个 DB transaction。原生写入有单独账本，不伪造为 assistant 消息。

获取流程使用显式 DOI/链接和目标 collection：原生翻译器返回未保存元数据 → DOI 查重 → 用户选择 → 创建或添加已有条目的集合成员关系 → 尝试 OA 附件。批准的元数据只接受固定字段，不携带 notes、tags、relations、路径或执行权限。下载只使用原生 OA 结果和经过逐跳校验的匿名 HTTP；PDF 类型、首页标题/DOI、补充材料标志及哈希不能确认时，保留正确元数据并报告未获取/不确定。OA 解析器提供的版本标签不冒充独立版本鉴定。

撤销只处理账本中仍与精确快照一致的输出：标注保护后续文字/颜色/标签等编辑；集合撤销只移除本任务添加的成员关系；新条目和附件在字段、文件哈希及子标注检查后移入原生垃圾箱，保留文件。未知写入先检查保留 key/结果，不盲目重试。丢失完整写后快照、无法判断后续人工修改的结果保持 uncertain，不把当前人工内容重新认作可撤销的任务成果。

## 运行时、图像与宿主适配

固定运行时由 `runtime/manifest.ts` 锁定 **Codex 0.154.0 / darwin arm64**、归档/二进制 SHA-256 和许可证。`app-server --strict-config`、配置值与来源校验、空执行环境目录、`CODEX_EXEC_SERVER_URL=none` 禁用 shell、外部工具、MCP、插件、记忆和任意环境继承。普通阅读不启用图像生成；明确选择 diagram 后才开启对应线程能力，并用运行时特性报告核实。下一次普通阅读恢复禁止生成，实时和恢复历史中的未授权工具活动都关闭连接。

输入图像每张 **2 MiB**，生成输出每张 **16 MiB**，不为适配上限自动缩图。输出只接受已完成 imageGeneration 的可验证 PNG/JPEG/WebP 内联数据或显式白名单目录中的文件，校验编码、magic、大小、路径和符号链接；未识别的编码不算成功。生成图与原文截图有不同 origin。已保存且验证过的生成图优先用于恢复，不能因运行时临时文件过期抹去已确认成果。

Zotero 9.0.6 的关键适配集中在 reader：

- `getPageData({pageIndex})` / `getPageLabels2()` 提供原生字符和标签，跨 realm 参数通过 Cu.cloneInto 传递。getPageData 的 native `partial: true` 恒指基础页面数据尚未增加引用/overlay 信息；它不表示字符提取被截断。适配器只映射已知字符/边界，不转发这个不同语义的标志。
- 通过 `await getData()` 取得已加载 PDF 字节，在插件 realm 计算一次 SHA；每次捕获/校验比较磁盘 SHA，防止 size/mtime 不变的替换。选区和页面图像保留 documentRevision；旧坐标不能落到新文件上。
- Reader.open 的 tabID 指向已有容器。后台引用先通过原生 Tabs.add 保留容器，再打开 reader；只关闭仍由自己拥有、未被用户接管的标签。已有用户标签保持原状。
- await 得到的 PDFPageProxy 可能被 Xray 隐去 getViewport/render/view；只对已确认的宿主页对象用 Cu.waiveXrays，再以原生坐标渲染，不改变 PDF 缩放或焦点。

已有 **12 项 native 驱动通过**的证据来自工作树生产模块被打包进独立测试 driver。它证明对应原生 API 流程，不等于最终 0.4 XPI 的 UI 接线、真实图像生成、升级或完整平台验收；详情仅在[进度与验收](progress.md)维护。

账户、缓存、历史、原生标注、删除聊天和卸载相互独立。诊断只输出白名单版本/状态/错误码，不含正文、图像、认证或原始管道内容。认证目录不进入普通备份/报告；没有跨设备同步承诺。
