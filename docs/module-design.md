# 架构与数据契约

本文描述当前工作树的机制，不声明产品已经通过真实服务或最终 XPI 验收。产品要求见 [zotero-chatgpt-user-flow](zotero-chatgpt-user-flow.md)，操作命令见 [development](development.md)，证据见 [progress](progress.md)。

## 总体边界

```text
Zotero Reader sidebar
├── Chat mode  ── official chatgpt.com browser + constrained page actor
└── Agent mode ── TypeScript core ── Gecko stdio ── bundled Codex App Server
                                      │
                                      └── reviewed ActionTasks ── Zotero native APIs

Shared local context: attachment identity, frozen PDF revision/text, selection and settings
```

Chat 与 Agent 共用本地 Reader 上下文，但不共用远端执行生命周期。ChatGPT 页面拥有自己的登录、对话和 transcript；Agent 会话存储 Codex thread/turn。插件只能保存规范化的官方 ChatGPT conversation URL 绑定，不能把两端历史合并成一个虚构的远端会话。

Node 24 只用于构建和测试。运行包保留 Zotero 原生界面 → TypeScript core → Gecko Subprocess 私有 stdio → 随包 Codex App Server。模型没有 shell、任意文件、MCP、插件、浏览器或通用 Zotero 工具；它输出的数据必须经过宿主契约。

## 分层与依赖

```text
packages/contracts       纯数据契约与边界校验
        ↑
packages/core
  codex                  App Server 协议、策略、模型与历史对账
  sessions               本地会话、请求哈希、队列与恢复
  context                PDF 预算、聚焦与多轮阅读
  workspace              草稿、设置、skill、历史索引
  tasks                  审批、写前意图、结果账本、对账与撤销
        ↑
packages/zotero
  reader                 当前附件、版本、选区、定位、缩放与 dock
  library                只读库查询、选择冻结、集合列表、文件读取
  actions                原生标注、标签、集合、条目、附件写入
  chat                   Chat/Agent presenter、官方页面桥与任务投影
  runtime                GeckoStorage、随包资产和惰性 Codex 进程
```

依赖只向上。contracts 不依赖 core/zotero；core 不依赖 DOM、Zotero 或 Node；reader/library/chat 不 import actions 实现。`tests/build/dependency-boundaries.test.ts` 静态检查边界。`core/tasks/controller.ts` 是审批、写入意图和账本的唯一所有者，`zotero/actions/native.ts` 是无状态执行器。

## Chat 官方页面桥

宿主创建一个顶层 XUL browser 承载 `https://chatgpt.com`。页面不显示时移出视口而非销毁，以保留该隔离 profile 内的官方 cookie 和页面会话。Chat 表面与 Agent 原生 transcript 互斥显示。

JSWindowActor 只匹配 `https://chatgpt.com/*` 的顶层 frame。actor 模块通过只允许 content access 的窄 `resource://` substitution 暴露，XPI 中其它运行资产和记录不可读。父/子消息必须同时验证 origin、页面身份、请求 marker、消息形状和当前绑定；lookalike host、HTTP、credentials、异常端口、子 frame 和过期请求均拒绝。

页面 actor 捕获官方输入框的可见发送意图。父进程在动作边界前后复核自动 PDF 文本开关，生成带覆盖说明、冻结 PDF 文本、冻结选区、原问题和随机 marker 的 prompt。actor 只把 prompt 放回可见 composer 并触发同一次官方提交；它不读取回答、认证、cookie 或 transcript。当前真实宿主探测仍未让这条 actor 链路通过，见 progress；代码存在不等于平台接入成功。

官方远端历史只保存 canonical `https://chatgpt.com/c/<id>` 绑定。查询串、fragment、share URL、其它路径和其它 origin 不进入映射。Chat 新会话和 Agent 新会话分别建立各自远端身份。

## Agent 请求、运行时与恢复

`RequestMode = 'chat' | 'agent'` 在点击发送/排队时冻结并进入 `hashVersion: 3` 请求哈希。用户消息和 accepted 记录先原子保存，随后才能外发。queued 请求包含模式、PDF、引用、skill、设置及组织选择快照；等待期间 UI 变化不重定向请求。

打开侧栏、读取本地会话和停留 Chat 不启动 Codex。只有显式进入 Agent、Agent 登录/发送/重试或恢复 Agent 工作才允许 `AgentRuntime.connection()` 准备私有目录、启动随包进程并握手。普通 `get/select/current` 必须保持本地读取；Chat 打开含旧 Agent 消息的会话也不能隐式恢复 thread 或任务。

Agent 请求状态为 accepted → dispatching → running → terminal。只对从未派发的 accepted 请求续派一次；dispatching/running 在中断后变为 uncertain，通过 `thread/resume`/`thread/read` 和 request ID 对账，不自动重发。服务端审批或未授权工具活动一律拒绝并关闭受影响连接。

## PDF 与高亮任务

PDF 身份由 `PaperScope(clientId, libraryId, attachmentKey)` 和 `DocumentRevision(fingerprint,size,modifiedAt,sha256)` 共同确定。Reader 从已加载 `getData()` 计算 SHA，并与磁盘文件比较；size/mtime 不变的替换也会使旧坐标失效。

annotate 模型输出只允许 `{candidates:[{quote,pageIndex,reason}]}`。`pageIndex` 不限制搜索范围；程序在冻结 PDF 全局验证 quote 唯一性，最多可靠检查 256 页/2,000,000 规范化字符。唯一结果从 Zotero 原生字符盒生成行矩形；跨页只接受相邻两页。候选重复、历史任务仍拥有同一输出或写入结果不明时，不能分配第二个写 key。

批准前只持久化 review。批准后先把 reserved key 与 `annotation-create` writing 意图落盘，再调用 `Annotations.saveFromJSON`，最后按 key 读回完整原生快照。适配器在写前重新解析 quote 和 revision，不信任账本坐标。恢复时 writing/unknown 先 inspect，不重发。

原文跳转把第一页 rects 和相邻第二页 `nextPageRects` 一次传给 Reader.navigate；它不调用缩放或旋转方法。撤销要求当前标注仍精确等于写后快照且带本插件 provenance，否则 conflict。

## 选中文献整理任务

选择只从与当前插件实例绑定的 Zotero 主窗口 `ZoteroPane.itemsView.getSelectedItems(false)` 读取。附件、笔记、已删条目和非 regular item 排除；所有 identity 在第一次 await 前复制，去重后限制为同一 library、最多 50 项。每项立即通过 `inspectOrganizationItem` 冻结书目、标签、集合、附件、时间与完整签名。

模型上下文是安全投影：`itemIndex + metadata + tags + existing collectionIndexes`，以及 `collectionIndex + name`。完整 item/collection key、时间和签名只在本地持久化并参与 v3 请求哈希。模型返回只允许 `{itemIndex,tags,collectionIndexes}`；索引必须落在冻结数组内，不能指定 native key。

`planOrganization` 把索引映射成具体 before 快照和同库 collection targets。批准时先落 `organization-add` 意图；native transaction 重新核对 item、library 和 collection 可编辑且当前快照等于 before，然后只新增标签和集合成员关系。写后读回必须等于期望 tags/collections，且整理范围外的 signature 不变。

账本保存 before、after、实际 addedTags 与 addedCollectionKeys。撤销前先验证这个 delta 与 before/after 语义一致，再要求当前状态精确等于 after；只删除实际新增值。后续人工编辑、部分人工删除、丢失写后快照或无法证明所有权分别成为 conflict/uncertain，不采用当前“看起来相同”的值。

当前范围只包含已有可编辑集合。创建/重命名/删除集合、删除标签、移动或删除条目、改元数据和操作附件不属于整理任务授权。

## 文献获取任务

acquire 输入只接受 DOI/公开 URL 和一个明确 collection。预览阶段不保存 translator 结果；先查 DOI 重复。批准后可创建固定字段白名单条目，或只给已存在条目新增 collection membership。OA 下载逐跳验证公网 URL、MIME、大小、第一页标题/DOI、补充材料标志和哈希；无法确认不创建附件。

## 持久化与兼容

根目录为 profile 下 `zotero-chatgpt/v1/`：

| 路径 | 内容 |
| --- | --- |
| `records/papers/*.json` | 附件会话索引 |
| `records/conversations/*.json/.jsonl` | schema 1/2/3 会话与请求日志 |
| `records/conversations/*.<document>.source.json` | 不可变 PDF 来源正文 |
| `records/workspace/settings.json`、`skills/*/SKILL.md`、`drafts/*` | 设置、skill 与草稿 |
| `records/tasks/*.json` | 原生任务 review、意图、结果与撤销账本 |
| `records/reading/*` | 多轮阅读任务 |
| `account/` | 插件专用 Codex home 与官方授权数据 |
| `home/`、`scratch/`、`tmp/` | 运行环境、受限工作目录与临时文件 |

schema 1/2/3 会话继续可读；缺失字段不被补写后冒充旧格式。新字段均为可选，旧 v3 请求在没有 organization 时保持原哈希。`NativeItemSnapshot` 保持旧 acquisition 形状，组织任务使用扩展 `NativeOrganizationItemSnapshot`。未知 task kind、损坏文件或哈希不匹配安全拒绝并保留原文件。

GeckoStorage 使用受限相对路径、符号链接检查、原子替换和 flush；不承诺断电目录级 fsync 或跨文件事务。账户目录不进入普通备份或诊断。

## 宿主适配与安全

- `getPageData({pageIndex})` / `getPageLabels2()` 提供字符与页标签；跨 realm 参数复制，`partial` 的 Zotero 基础数据语义不冒充文本截断。
- `Reader.open` 和后台引用保留已有用户 tab；只关闭插件仍拥有且未被用户接管的临时 tab。
- PDF.js Xray 只对已确认宿主页对象 waive；渲染不改变缩放、焦点或当前页。
- 原生标注调用自身 `saveTx`，不能再套外层 DB transaction；标签/集合整理使用一个 native transaction 和一次 item save。
- strict config 禁用 shell、网络搜索、外部工具、MCP、插件、记忆、多 agent 和任意环境继承；diagram 仅在明确选择时临时开启已核实的图像能力。
- 资料、网页、PDF、模型和 skill 都不能授予权限。诊断只输出白名单状态，不输出正文、签名、认证或原始 stdio。

历史阶段、旧产物和旧证据从 Git 基线 `3ea1070` 及其父提交查询；当前文档不再复制阶段流水。
