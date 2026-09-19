# 当前进度与验收

本页只记录当前结论和证据边界。产品要求见 [zotero-chatgpt-user-flow](zotero-chatgpt-user-flow.md)，机制见 [module-design](module-design.md)，命令见 [development](development.md)。旧阶段流水、旧包 hash 和被替代结论从 Git 基线 `3ea1070` 查询。

## 交付结论

当前状态是**部分完成，尚未交付可宣称端到端可用的最终 XPI**。

- **a25 自动、产物、可复现构建和干净安装已通过**：`0.4.0a25` XPI SHA-256 为 `3019db5e379b1e141c7f245093b29b73659c43b6c1d7563ec3f4ffddd51c28a6`，87 个文件；独立 detached worktree 重建逐字节相同；最终 a25 clean context 宿主报告 46/46 PASS，启动 PATH 不含 Node。
- **当前代码/产物候选已升到 a27**：`0.4.0a27` XPI SHA-256 为 `338407a177df879641776636beef41295e330564cc6ebe79438aad24093e7374`，87 个文件；typecheck、lint、100 files / 1317 tests / 0 skipped（`--maxWorkers=4`，断言未变）、package 和 artifact verification PASS。a25 的 clean install / byte-for-byte 证据不自动继承给 a27。
- **真实 Agent 高亮已经跑通一轮完整链路**：真实 `gpt-6-astra` / medium 返回 5 个候选，review 前 0 写入，批准后创建并读回 5 个原生标注，撤销读回 PASS。
- **真实 Agent 整理仍未完成，但已恢复到 review**：同一 a25 live-core 运行冻结了正确的 2 条目范围，真实模型返回 2 条严格 JSON 候选；a26 从保存的真实响应恢复出 production organization task，状态为 `review`、2 candidates、0 写入。恢复 driver 两次分别停在多余的 `agent-runtime-ready` gate 与 `stored-conversation-history-row`，均早于 review UI 操作；批准、原生写入、读回和撤销仍待执行。
- **Chat 真实服务仍未通过**：a25 pointer gate 问题由 `98cdbda` 修复；a26 watch 结束后，用户手工确认经典 Apple 邮箱/密码登录成功，该手工 PASS 不是 watch 自动证据。passkey 路径在 Zotero 的 Gecko ESR 140.12.0 宿主中 BLOCKED。a27 真实 nonce 提交在同一 WindowGlobal 下返回 `not-accepted`，未观察到 question/answer token，因此真实 Chat 流程为 FAIL。
- Chat 和 Agent 的远端历史已经按不同服务建模，不再声称共享一个远端 session。Chat 本地恢复不应启动 Codex；显式进入 Agent 才允许恢复 Agent 工作。
- 当前机器可读摘要为 `.zotero-chatgpt-dev/verification/delivery-20260919/acceptance-current.json`；只含白名单状态/计数/请求 provenance，不含正文、认证、cookie、URL 或完整 native signatures。

## 当前证据矩阵

以下只列实际已运行证据；代码修复与复验结果分开记录。

| 层级 | 状态 | 已观察结果 | 不能推出什么 |
| --- | --- | --- | --- |
| a25 自动门禁 | **PASS** | typecheck、lint、package、artifact verification PASS；100 files / 1310 tests / 0 skipped；XPI 87 files | 自动测试不是宿主/服务证据 |
| a25 可复现构建 | **PASS** | clean detached worktree commit `c195011…` 重建 SHA 与根 a25 XPI 完全相同，`cmp` PASS | 只证明给定 commit/依赖/runtime 在本机可逐字复现 |
| a25 clean install / context | **PASS** | `.zotero-chatgpt-dev/context-runs/final-a25-install/host-report.json`：46/46，Zotero 9.0.6，2 页提取，4578 bytes，9 次自动 PDF 偏好读取，0 模型请求；启动 PATH 不含 Node | 不含真实登录或模型请求 |
| a26 自动门禁/产物 | **PASS** | typecheck、lint、package、artifact verification PASS；100 files / 1315 tests / 0 skipped；XPI 87 files，SHA-256 `5ec41bd…3037` | 尚无 a26 clean-source byte-for-byte 重建；自动测试不是服务证据 |
| a27 自动门禁/产物 | **PASS** | typecheck、lint、package、artifact verification PASS；100 files / 1317 tests / 0 skipped（4 workers）；XPI 87 files，SHA-256 `338407a…7374` | 尚无 a27 clean install / byte-for-byte 重建；自动测试不是服务证据 |
| native adapter 整轮 | **PASS** | `native-a21-PASS-17.json`：17/17，组织 review/写入/读回/冲突撤销、歧义拒绝、跨页坐标、引用导航等 | adapter 由 driver 编译工作树模块；候选为 deterministic fixture，不是模型输出，也不证明最终 XPI UI 接线 |
| a25 真实 Agent 高亮 | **PASS** | 请求 `5fc2…29a9`：agent / annotate / `gpt-6-astra` / medium；5 候选，review 前 0 写入，创建读回 5，撤销读回 PASS | 仅该高亮请求通过；不能把后续整理失败抹掉 |
| a25 真实 Agent 整理 | **FAIL** | 请求 `04e6…2812`：agent / organize / `gpt-6-astra` / medium；冻结 2 条目，返回 item indexes 0/1 的 2 条 JSON 候选；进入 review 前被 named collection 严格校验拒绝 | `c89a45b` 为代码修复；尚无恢复后 review/写入/读回/撤销 PASS |
| a25 Chat 页面/actor 加载 | **PASS** | 官方页面加载，actor probe 到 `draft`；操作者截图/观察确认页面可见 | 只证明页面/actor 组件；a25 pointer gate 仍阻断交互，不能推出服务回答 |
| a26 整理任务恢复到 review | **PASS** | 保存请求/2 条 scope/2 候选/native prewrite 状态与安装 XPI 均核对；production task 已为 `review`、2 candidates、0 写入 | 只证明缓存真实响应恢复为 review，不证明批准/原生变更完成 |
| a26/a27 整理 recovery driver | **FAIL** | 三次 driver 分别在 `agent-runtime-ready`、`stored-conversation-history-row`、`visible-stored-conversation-history-row` 提前失败 | driver FAIL 必须保留，不能用 production task 状态覆盖 |
| 整理批准/原生写入/读回/撤销 | **NOT RUN** | production task 尚未批准，native writes=0 | review 不是完成 |
| a26 Chat pointer/login gate | **PASS** | `98cdbda` 修复 pointer gate；a26 已安装，actor probe=`ready`、pointer events inline/computed=`auto`；用户在 watch 结束后手工确认经典 Apple 邮箱/密码登录成功 | 登录 PASS 为手工证据；没有证明问题/回答 |
| Apple passkey 登录 | **BLOCKED** | Zotero Gecko ESR 140.12.0 有 WebAuthn backend，但缺少 Firefox `browser.js` prompt handler / `PopupNotifications`；本次尝试未捕获 `webauthn-prompt` | 经典邮箱/密码登录成功不能推出 passkey 可用；也不能把本次 spinner 的事件级原因写成已证明 |
| a27 真实 ChatGPT nonce 问答 | **FAIL** | `a27-web-live-not-accepted.json`：提交时仍是同一 WindowGlobal，但结果为 `not-accepted`；question/answer token 均未观察到 | 页面、actor、登录和截图都不能替代真实回答；未发生可验证回复 |
| 公开发行 | **NOT RUN** | 未 push、未发布、未建立有效更新频道 | 开发 XPI 不等于签名公开发行 |

失败报告必须保留；后续成功用新的 run id 写新报告，不能覆盖上述 a19/a20 或 native 整轮失败。

## 已落地的当前机制

### Chat

- Chat 档承载官方 `chatgpt.com` 页面，不通过 Codex 代答。
- 受限 JSWindowActor 只允许精确官方 origin，设计为在可见发送动作上冻结 PDF/选区并回填同一 composer；不读取回答或认证。
- Chat More details / Ask 与 Agent presenter 分路，Chat 快捷动作不能静默启动 Codex。
- 官方 `/c/<id>` 绑定与 Agent conversation/thread 分开；插件不保存官方 transcript。
- a26 已证明官方页面、actor、pointer gate 和经典 Apple 邮箱/密码登录可用；a27 真实提交为 `not-accepted`，passkey 仍 BLOCKED，因此 Chat 完整产品流仍未通过。

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

1. 继续已恢复的 organization review：必须批准并完成原生写入、读回和撤销全部 PASS；同时让 recovery driver 越过 `visible-stored-conversation-history-row` 并完成相同断言，不得把 review 当作任务成功。
2. 诊断 a27 同一 WindowGlobal 下的 `not-accepted`，重新验证 PDF token、回复、流式、停止、历史和重启恢复。经典 Apple 邮箱/密码登录已由用户手工确认，passkey 仍单独 BLOCKED。
3. 用最终版本 XPI 重跑所需 context/native/embed/服务阶段；a21 adapter PASS 和 a25 高亮 PASS 不能自动继承给新包。
4. 为最终版本补 clean install 与独立 clean-source byte-for-byte 重建；a27 自动门禁已经通过，但 a25 的安装/重建 hash 不能继承。
5. 完成必要人工 UI（IME、焦点、缩放、窄窗、多窗口）与安装/升级/回退验收；保持 Chat/Agent、自动/宿主/真实服务证据分层。

## 安全状态

测试只允许命名 `.zotero-chatgpt-dev/` 子树和合成资料。不删除或复制任何 auth/cookie/token；需要干净状态就创建新 profile。真实库、日常 Zotero、公开发布、付费服务和外部消息均未由本轮自动授权。
