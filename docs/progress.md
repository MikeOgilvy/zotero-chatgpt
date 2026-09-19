# 当前进度与验收

本页记录当前可安装开发包和实际证据。产品要求见 [zotero-chatgpt-user-flow](zotero-chatgpt-user-flow.md)，架构契约见 [module-design](module-design.md)，命令见 [development](development.md)。状态只使用 **PASS / FAIL / BLOCKED / NOT RUN**；自动测试、Zotero 宿主、真实服务和最终 XPI 分开记录。

## 当前候选

当前开发候选为 **Zotero ChatGPT 0.4.0a33**：

- XPI：`dist/zotero-chatgpt-0.4.0a33-dev.xpi`
- SHA-256：`5447f33870bc56677796437764b9600c0892ef492db0c339fc083c86dcd69631`，87 个文件
- 版本 commit：`9374ac8`；本次 Chat 修复 commit：`f942eeb`、`08d53ba`、`482e35a`；审查修复：`9374ac8`
- 平台范围：macOS Apple Silicon、Zotero 9.0.6；这是本地开发 XPI，不是已签名公开发行包

自动门禁通过：typecheck、lint、100 files / 1336 tests / 0 skipped（`--maxWorkers=4`）、package 和 artifact verification。独立 detached worktree 在版本 commit 上 `npm ci` 后重建，得到逐字节相同的 SHA。干净专用 profile 在启动 PATH 不含 Node 时加载最终 XPI，46/46 PASS、提取 2 页、0 模型请求。

a33 只比 a32 多一处审查发现的外观修复：Chat 面板的“重新加载”按钮此前复用了时钟图标，而图标表里已有专用的 `reload` 箭头。该修复只改图标，不影响任何发送、重发或交互安全逻辑；因为产物哈希变化，a32 上的真实服务证据不自动继承，故本轮在 a33 上重跑了全部可运行的验证。

## 本轮修复（a30 → a33）

本轮之前 a30 的状态是：两条 Agent 真实服务流程 PASS，但 Chat 的真实提问仍未通过。查清后确认是**三个独立的真实缺陷**，都在产品代码里，已修复并各自补了回归测试：

1. **登录页被整页锁死**（`f942eeb`）。actor 探针把“没有 composer 的页面”一律当作不可交互，于是 ChatGPT 的登录页（包括 Apple 登录表单）被设成 `pointer-events: none`，用户能输入却点不动任何控件。现在 `composer-missing` 保持页面可点击，同时所有 PDF 上下文与发送命令在恢复未完成时仍被拒绝。
2. **官方编辑器的重排被误判成“用户改了草稿”**（`482e35a`）。插入长文本后，官方富文本编辑器会按自己的状态重新渲染，并重写块之间的空白（实测甚至整段丢掉一个换行）。此前用逐字节相等判断“草稿是否还是我插入的那份”，于是产品自己把这次重排读成用户编辑，报 `draft-changed`，一条消息都没发出去。现在只有**非空白字符**变化才算用户编辑，并且仍要求请求标记存在。该次运行发生在 a31 候选上，报告已被后续 prepare 覆盖，因此以回归测试（`official-chat-child.test.ts` 的“re-render”两个用例）和 a33 的真实 PASS 作为证据。
3. **同一次发送的重复点击会被页面忽略**（`08d53ba`）。新会话上首次点击发送控件可能没有效果。现在在“草稿未变、没有标记消息、没有停止按钮”这三个信号都指向页面没接住时，允许重发**同一份**已冻结提交，最多一次；页面一旦接住（清空草稿或出现停止按钮）就不会重发。返回体带 `attempts` 供验收核对。

诚实说明第 3 点：a32 与 a33 的四次真实 Chat 运行里 `attempts` 都是 1，也就是说这条重发路径**没有被实际触发**。它是针对 a30 观测到的 `not-accepted`（点击后 20 秒内没有出现标记消息）加的有界保护，并用回归测试锁定了“页面未接住时才重发、页面已接住时绝不重发”这两个方向；但它目前只有单元级证据，没有真实服务证据证明它是必需的。

## 三条核心流程的最终结果

| 流程 | 最终 a33 XPI | 证据 |
| --- | --- | --- |
| Chat 真实提问（当前 PDF 作上下文） | **PASS** | `a33-web-live-PASS.json`：14/14；真实官方页面用运行时生成的随机 PDF token 回答，`attempts=1`，Codex 进程 0→0 |
| Chat 重启恢复 + 停止生成 | **PASS** | `a33-web-resume-stop-PASS.json`：5/5；重启后恢复保存的官方会话与历史答案，随后一轮可见生成被官方 Stop 停止，`attempts=1`，Codex 0→0 |
| Agent 原生高亮 | **BLOCKED（Codex 周额度）** | a30 `a30-live-core-PASS.json` 12/12 PASS；a32 两次尝试都在模型轮次上失败，见下；a33 未重跑（同样受额度阻断） |
| Agent 整理选中文献 | **BLOCKED（Codex 周额度）** | 同上 |

**Agent 两条流程为什么是 BLOCKED 而不是 FAIL。** a33 上没有重跑 Agent（额度已耗尽）。a32 上的两次运行（`a32-live-core-annotate-turn-failed-FAIL.json`、`a32-live-core-r2-annotate-turn-failed-FAIL.json`）都走完了登录、打开 Reader、在可见界面发送、记录 1 个模型轮次，然后在 `annotation-review-terminal-preparation` 超时。会话事件日志显示请求状态为 `accepted → dispatching → running → failed`，从 `running` 到 `failed` 约 115 秒，与模型侧拒绝一致；用户随后确认 Codex 周额度已用尽。因此失败发生在**模型服务侧**，不是产品回归。

支持这一结论的静态事实：`a30 → a33` 的产品代码改动只有 `packages/zotero/actors/OfficialChatChild.mjs`、`packages/zotero/src/chat/embed.ts` 和 `packages/zotero/src/chat/view.ts`（图标）三个 **Chat 面**文件，Agent 的高亮/整理/任务/原生写入路径没有任何改动（`git diff --name-only 9311836..HEAD -- packages/` 可复核，其中不含 tasks/annotation/organization/native/reader/codex 任何文件）。a30 上这些路径已对真实模型跑通完整链路。任务要求“不要用旧版本成功自动继承”，所以本页仍把 a33 上的 Agent 真实服务标为 BLOCKED，而不是 PASS。

## 指令第 7 节验收矩阵

“最终 XPI”列只表示同一 a33 文件是否直接接受过该场景。

| 场景 | 自动 | Zotero 宿主 | 真实服务 | 最终 a33 XPI | 当前证据与边界 |
| --- | --- | --- | --- | --- | --- |
| 干净环境安装发布包 | PASS | PASS | NOT RUN | PASS | `final-a33-install-PASS.json`：46/46，PATH 无 Node，2 页提取，0 请求 |
| Agent 未登录或运行时不可用 | PASS | PASS | PASS | PASS | a33 真实 Chat 运行前后 Codex 进程 0→0；Chat 失败时不会切换服务或模式 |
| Chat 真实提问 | PASS | PASS | PASS | PASS | `a33-web-live-PASS.json` 14/14，随机 token 命中，`attempts=1` |
| 当前 PDF 作为上下文 | PASS | PASS | PASS | PASS | 同上；官方回答只含第二页运行时生成的 token |
| PDF A/B 快速切换、多窗口 | PASS | PASS | NOT RUN | NOT RUN | a33 clean host 覆盖同名附件隔离、附件切换草稿和单 dock；真实多窗口服务绑定未完整运行 |
| Chat/Agent 来回切换 | PASS | PASS | PASS | PASS | clean host 覆盖模式切换与独立状态；真实 Chat 运行未触发 Codex |
| Agent 高亮 | PASS | PASS | BLOCKED | BLOCKED | a30 5 candidates、0 prewrite、5 原生 readback、undo PASS；a32/a33 被 Codex 额度阻断 |
| Agent 整理 | PASS | PASS | BLOCKED | BLOCKED | a30 冻结 2 条目、加法写入/readback、冲突撤销保留后续编辑；a32/a33 被 Codex 额度阻断 |
| 超时、取消、重试、进程中断 | PASS | PASS | PASS | PASS | 单元回归覆盖 reservation/idempotency/uncertain；a33 停止验证确认 `attempts=1` 且无重复轮次 |
| 撤销 | PASS | PASS | PASS | PASS | `a33-native-16-PASS-DOI-UNAVAILABLE.json` 的 16 项本地检查覆盖标注精确撤销、后续人工编辑保留、整理冲突撤销 |
| 登录过期、网络失败、额度不足 | PASS | PASS | BLOCKED | BLOCKED | 经典 Apple 邮箱/密码登录为手工 PASS；passkey 在 Gecko ESR 140.12.0 BLOCKED；Codex 周额度耗尽已实测 |
| 重启 Zotero | PASS | PASS | PASS | PASS | `a33-web-resume-stop-PASS.json` 恢复真实官方历史与 token，重启后仍可定位 |

## 证据索引

| 证据 | 状态 | 实际结果 |
| --- | --- | --- |
| `a33-{typecheck,lint,unit,package,artifacts}.log` | PASS | 100 test files / 1336 tests / 0 skipped；87-file XPI hash 校验通过 |
| `9374ac8b4ca0aff703c3d5ebf0d76b2fce27061b/final-status.txt` | PASS | detached worktree 在版本 commit 上 `npm ci` 重建，与根 XPI 逐字节相同 |
| `final-a33-install-PASS.json` | PASS | 最终 a33 XPI，46/46，无 Node PATH，0 模型请求 |
| `a33-native-16-PASS-DOI-UNAVAILABLE.json` | PARTIAL | 16/16 本地检查 PASS；额外的公开 DOI translator 预览返回 `UNAVAILABLE`（真实网络查询，a30 同样失败、a32 曾通过，属网络相关抖动） |
| `a33-web-live-PASS.json` | PASS | 最终 a33 XPI，真实官方页面 14/14，随机 PDF token 命中，Codex 0→0 |
| `a33-web-resume-stop-PASS.json` | PASS | 最终 a33 XPI，5/5，重启恢复 + 一轮生成被官方 Stop 停止，Codex 0→0 |
| `a32-native-PASS-17.json` | PASS | a32 上该项 17/17（含 DOI 预览通过），说明该检查随网络变化 |
| `a30-web-live-fresh-conversation-not-accepted.json` | FAIL | 真实暴露“新会话首击未被页面接住、提交未确认”，0 条消息、0 次接受；`08d53ba` 已修复，报告保留 |
| `482e35a` 的回归测试 | PASS | 复现并锁定“编辑器重排被误判为改稿”（该次运行的报告已被后续 prepare 覆盖，因此以回归测试和 a33 PASS 作为证据，不引用已不存在的报告） |
| `a32-web-resume-stale-manifest-FAIL.json` | FAIL | harness 使用了上一版本的 resume manifest；删旧 manifest 后重跑 PASS，属测试脚本状态问题 |
| `a32-live-core-annotate-turn-failed-FAIL.json`、`a32-live-core-r2-annotate-turn-failed-FAIL.json` | FAIL/BLOCKED | Agent 模型轮次在服务侧失败；用户确认 Codex 周额度耗尽 |
| `a30-live-core-PASS.json` | PASS | a30 上真实模型恰好 2 轮，annotate + organize 12/12（Agent 代码自 a30 起未变） |

失败报告保留且不被后续成功覆盖。机器可读白名单摘要位于 `.zotero-chatgpt-dev/verification/delivery-20260919/acceptance-current.json`，不含正文、认证、cookie、原始 URL、私人路径或完整 native signatures。

## 当前产品边界

- Chat 使用官方 `chatgpt.com` 页面；可见用户提交才允许传送上下文。默认当前 PDF brief 只来自本地提取的纯文本，最多 12,000 字符；不会自动传送页面图像，也不能据此声称读懂扫描页、公式或图表。
- Agent 使用随包 Codex runtime。strict config 禁止 shell、外部工具、MCP、插件、记忆、多 agent 和任意环境继承。
- 高亮候选只含 quote/page hint/reason；程序按冻结 revision 做全 PDF 唯一匹配和原生坐标解析。重复/不确定 ownership 会阻止第二次写入；确认撤销后才可重新创建。
- 整理范围只来自绑定 Zotero 主窗口的 `itemsView`，冻结普通 library 条目。操作仅为现有同库可编辑集合和 additive tags；不创建集合、不移除已有关系、不改元数据或附件。
- 写操作保存 intent、readback 和实际 delta。撤销前验证 ledger；后续人工编辑、部分人工移除或所有权不明时保留用户状态并报告冲突/不确定。

## 安装与剩余限制

在支持范围内，可在 Zotero 的 **Tools → Plugins → 齿轮菜单 → Install Add-on From File…** 选择 `dist/zotero-chatgpt-0.4.0a33-dev.xpi`，核对上述 SHA 后重启 Zotero。运行不需要系统 Node；Node 24 只用于源码构建/测试。该 XPI 仅验证了 macOS Apple Silicon / Zotero 9.0.6，本轮没有签名、发布、更新频道、其它 CPU/系统、Gatekeeper 下载来源、升级/回退或公开安装验证。

仍待完成：Agent 两条真实服务流程需要 Codex 额度恢复后在 a33 上复跑；`public-doi-unsaved-native-translator-preview` 依赖真实网络查询，本轮为 `UNAVAILABLE`，建议额度恢复后与 Agent 一起复跑；PDF A/B 真实服务多窗口；真实登录过期/断网；必要人工 IME、焦点、窄窗和多窗口检查；公开发行流程。Apple passkey 保持 BLOCKED；经典 Apple 邮箱/密码登录为手工 PASS。

## 安全状态

测试只使用明确命名的 `.zotero-chatgpt-dev/` 专用 profile/data 和合成资料。没有读取、复制或记录认证文件，没有操作日常 Zotero 或真实文献库，也没有 push、公开发布或启用未授权付费服务。
