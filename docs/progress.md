# 当前进度与验收

本页只记录当前结论和证据边界。产品要求见 [zotero-chatgpt-user-flow](zotero-chatgpt-user-flow.md)，机制见 [module-design](module-design.md)，命令见 [development](development.md)。旧阶段流水、旧包 hash 和被替代结论从 Git 基线 `3ea1070` 查询。

## 交付结论

当前状态是**部分完成，尚未交付可宣称端到端可用的最终 XPI**。

- Agent 高亮和选中文献整理的受控链路已经落到代码：自然语言识别 → 冻结上下文 → 真实模型的严格 JSON 候选接口 → review → 原生写入 → 读回 → 对账/撤销。自动测试和部分真实 Zotero native API 证据存在。
- Chat 官方页面 actor 方案已实现代码和自动测试，但当前真实宿主探测仍失败，未证明真实问题、PDF 上下文和回复处于同一官方 ChatGPT 对话。
- Chat 和 Agent 的远端历史已经按不同服务建模，不再声称共享一个远端 session。Chat 本地恢复不应启动 Codex；显式进入 Agent 才允许恢复 Agent 工作。
- 最终版本号、最终 XPI、完整全量门禁和最终宿主复验仍在进行。工作树 manifest 候选号或目录里存在的旧 XPI 都不能当最终交付身份。

## 当前证据矩阵

以下为本轮已经明确提供的证据；最终复跑结果到达前不补写预计数字。

| 层级 | 状态 | 已观察结果 | 不能推出什么 |
| --- | --- | --- | --- |
| 变更前自动基线 | **PASS** | 1210 tests PASS | 不覆盖本轮 actor、自然语言高亮、整理和恢复改动 |
| 本轮定向自动回归 | **PASS** | 高亮路由/恢复、组织选择冻结/队列/策略、task controller、native doubles、跨页跳转等定向测试已通过；typecheck 在中间整合点通过 | 最终全仓计数和最终构建仍待统一复跑 |
| 本轮中间全量自动门禁 | **FAIL** | 运行到 1266 PASS / 3 FAIL；失败随后分别定位并修复 | 修复后尚未统一复跑，旧失败不能改写为 PASS |
| 最新 HEAD 全量自动门禁 | **NOT RUN** | 尚无同一 HEAD 的 typecheck/lint/test:unit/package/verify 全套结果 | 定向回归不能替代完整门禁 |
| 最新 native 整轮 | **PASS** | `.zotero-chatgpt-dev/context-runs/native-a21-r2/host-report.json` 为 17/17：组织 review/写入/读回/冲突撤销；全局歧义拒绝；两处全局唯一 MULTILINE quote 产生至少 2 个原生 rect，并验证保存/幂等/撤销；重开引用后缩放与旋转保持 | driver 编译工作树生产模块，subject 只提供 a21 身份；候选不是模型输出，也不是最终 XPI UI 接线证明。此前失败报告继续保留 |
| Chat actor a19 宿主探测 | **FAIL** | trusted-scheme 路径失败 | 未抵达真实 ChatGPT 提交或回答 |
| Chat actor a20 宿主探测 | **FAIL** | 页面停在 `about:blank` 并加载超时 | 未抵达官方登录、composer 或服务响应 |
| Chat actor a21 宿主探测 | **FAIL** | actor 已在真实宿主注册并响应，但 30 秒内返回 `unsupported-composer`，没有发送 | 只证明桥已抵达页面 actor；下一步需真实 DOM 诊断，不能写成 Chat 可用 |
| 真实 ChatGPT 服务 | **NOT RUN** | 没有一次完整 PASS 证明随机合成 PDF token 被真实回答引用 | 页面/actor 单测和 browser 可见均不能替代 |
| 真实 Codex 高亮/整理服务 | **NOT RUN** | 没有一份完整报告同时证明真实模型候选、review、原生写入、读回和撤销全部通过 | native driver 的合成候选不能替代模型证据；局部 host check 不能替代整轮 |
| 最终候选 XPI | **NOT RUN** | manifest 候选仍在推进；最终可能继续升版 | 旧 a18/a19/a20 产物和当前候选号都不是最终交付物 |
| 公开发行 | **NOT RUN** | 未 push、未发布、未建立有效更新频道 | 开发 XPI 不等于签名公开发行 |

失败报告必须保留；后续成功用新的 run id 写新报告，不能覆盖上述 a19/a20 或 native 整轮失败。

## 已落地的当前机制

### Chat

- Chat 档承载官方 `chatgpt.com` 页面，不通过 Codex 代答。
- 受限 JSWindowActor 只允许精确官方 origin，设计为在可见发送动作上冻结 PDF/选区并回填同一 composer；不读取回答或认证。
- Chat More details / Ask 与 Agent presenter 分路，Chat 快捷动作不能静默启动 Codex。
- 官方 `/c/<id>` 绑定与 Agent conversation/thread 分开；插件不保存官方 transcript。
- 当前真实宿主 actor 链路仍 FAIL，因此 Chat 完整产品流未通过。

### Agent 高亮

- 无需选择 skill 的中英文自然语言高亮可冻结为 annotate workflow。
- 候选只包含 quote/page hint/reason；程序按冻结 revision 做全 PDF 唯一匹配和真实矩形解析。
- 支持跨行和相邻两页原生位置；原文跳转保留两页 rects，且单元回归确认不改缩放。
- modelRequestId 重放复用任务；同一冻结位置的现存/不确定任务阻止第二次写入；确认撤销后允许重新创建。
- 写前意图、reserved key、写后 readback、uncertain reconcile 和精确撤销已实现。

### Agent 整理

- 只从绑定主窗口 `itemsView` 冻结普通条目选择，不从当前 Reader 父条目或其它窗口猜范围。
- 只允许现有、同库、可编辑集合；模型只使用数组索引，不能选择 native key。
- 操作为 additive tags + collection membership；不创建集合、不移除已有关系、不改元数据/附件。
- transaction 写入后读回 before/after 和实际 delta；账本 delta 在撤销前做语义校验，损坏记录安全拒绝。
- 部分人工移除、后来人工编辑、丢失写后快照和无法证明所有权的结果不会被当作成功撤销。

### 隔离与恢复

- 请求 mode 和 organization scope 进入 v3 hash；排队点击时冻结，后续切模式/选择不改变请求。
- Chat 本地读取与 Agent 上游恢复分开；显式 Agent 动作才允许启动 runtime。
- strict runtime 禁止 shell、外部工具、MCP、插件、浏览器、记忆和多 agent。
- 宿主报告记录随机 fixture token、run id、subject build hash 和 driver source hash。

## 当前阻塞与下一门槛

1. 让官方页面 actor 在隔离 Zotero 宿主真实加载，保留 strict origin/resource 限制；不得通过关闭安全机制制造成功。
2. 由操作者在命名专用 profile 完成官方 ChatGPT 登录，验证一次带随机 PDF token 的真实提问、回复、流式、停止、历史和重启恢复。
3. 用 `--context --live --live-core-flows --login-wait-seconds ...` 完成一次完整真实 Codex 高亮与整理报告；任何 fixture/driver 失败都使整轮 FAIL。
4. 在最新 HEAD 运行 typecheck、lint、完整 unit、package、artifact verification，并记录唯一最终 XPI 的版本、大小和 SHA-256。
5. 用最终 XPI 重新执行 context/native/embed/服务所需阶段；工作树 adapter PASS 不能继承给包内 UI 接线。
6. 完成干净 checkout、无 Node 环境、安装/升级/回退和必要人工 UI（IME、焦点、缩放、窄窗、多窗口）验收。

## 安全状态

测试只允许命名 `.zotero-chatgpt-dev/` 子树和合成资料。不删除或复制任何 auth/cookie/token；需要干净状态就创建新 profile。真实库、日常 Zotero、公开发布、付费服务和外部消息均未由本轮自动授权。
