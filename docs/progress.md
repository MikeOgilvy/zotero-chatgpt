# 当前进度与验收

2026-09-12 全量迭代收尾，分支 `codex/product-agent-v0.4`。基于 `38b047c` 的开发工作已按功能拆成小提交落在本地（未推送）；当时 HEAD 通过 `typecheck`/`lint`/`test:unit`（**632 tests / 57 files**）。下列早期迭代证据仍保留其原始范围，不代表本轮新证据。并入 2026-09-13 的两个功能分支后为 **699 tests / 60 files**；本轮再补上“设置迁入原生偏好设置窗口”与“论断溯源”两处缺口后，当前工作树为 **743 tests / 67 files**（见下节）。

2026-09-13 补充：在最终 0.4.0a1 开发包上重跑了专用宿主验证（`--context`、`--context --native`）与 s6 隔离树的升级/回退，并为“新 schema 回退安全拒绝”补了宿主检查与单元回归。证据目录 `.zcr-dev/verification/scope-2026-09-12/`（忽略），过程与失败报告见下节。

### 2026-09-13 分支合并与耗时 UI（代码 + 单元证据）

把两个独立完成、各自在各自工作树验证过的分支并入本分支（均基于 `c2822f2`）：

- `feat/usage-batch-1`：数学/货币渲染不再破坏正文；core 记录每请求 `acceptedAt`/`firstTextAt`/`settledAt` 并派生诚实进度；库级跨库 `@` 搜索；模型省略 comment 时仍保留可定位的标注候选；打开面板即准备当前 PDF；剪贴板/拖放多图全部保留；条目面板图标重绘。
- `fix/audit-bugs-ui`：修复引用渲染经 `structuredClone` 后回答被清空（用户报告“回答变空白”）；运行时重连后重新订阅；单个视图异常不再污染会话状态；回答/代码复制入口可见；回答排版与每视图统一样式表；composer 卡片间距；切换研究配置后生效；剩余动态模板本地化；诚实的当前上下文 chip；同一论文复用空会话而非叠加；非法/反向页范围拒绝与重试；splitter 拖动按帧合并；dock 首屏不再闪白（暗色回退）。

合并仅做两个 `--no-ff`；`tests/zotero/presenter.test.ts` 两侧新增用例经 Git 自动合并后逐侧核对，双方用例均保留，未删除或放宽任何断言。合并后立即 `typecheck` 与 `render-answer`/`chat-view`/`request-timing` 测试通过，用于排查语义（非文本）冲突。

补完推迟的耗时 UI：presenter 的 `apply` 现在对每个事件调用 `advanceRequestTiming`（此前仅展开会保留旧计时，完成后计数器仍会继续走）；view 复用现有 clock 图标，渲染“等待 N 秒 / 首字到达即冻结 / 用 N 秒回答”，仅在未完成时以单个 `setInterval(…, 1000)` 计时，并在既有 teardown 中清除。计时数据缺失时显示明确的“耗时无法确定”，既不编造时长，也不在回答语言与 UI 语言之间做假设，更不暗示本地应用是上游配额/排队的等待原因。DOM 单元测试覆盖：等待计时、首字冻结、完成后不再计时、teardown 无泄漏、无数据不臆造。

修复真实 flaky：`tests/zotero/reader-library.test.ts` 的 3 MiB 生成图导出测试在并行全量下偶发超过 vitest 默认 5s（隔离实测约 2.5–2.7s，属 CPU 竞争敏感而非损坏）。只给该用例显式 `{ timeout: 15000 }` 并注明实测值与原因；断言与真实工作量不变。全量 `npm run test:unit` 连续两次 **699 tests / 60 files** 均通过。

诚实边界：以上均为代码 + 单元证据。并入重绘图标后的树重新执行 `package:dev` + `verify:artifacts`：产物 `dist/zotero-codex-reader-0.4.0a1-dev.xpi`，**77 files PASS**，SHA-256 `24d82e17ca2f1bae5ee5b2806d69845c600bed63a848abd070fb2321e9baf534`（`dist/SHA256SUMS`），并确认包内 `content/assets/icon.svg` 与源文件逐字节一致。上节 2026-09-13 的真实宿主证据对应该合并之前的 `d33ab244…` 包；合并后的树尚未重跑真实宿主或真实模型，F 与登录/发行门槛仍未打勾。

本轮交付（**代码 + 单元测试证据，非真实模型/宿主证据**）：**B 的来源身份与预算/长文/会话恢复、C 的工作区/引用/skill、UI 的四区视图、D 的原生标注任务账本、E 的获取整理，以及多模态/能力/图像输出**。真实隔离登录与真实模型回答、最终 0.4 XPI 的宿主 UI、真实图像生成和公开发行门槛仍未验证。唯一产品行为权威为 [规格](zotero-codex-user-flow.md)，架构/迁移在 [module-design](module-design.md)，复现命令在 [development](development.md)。不把目标、代码、单元、宿主、模型或发行证据混为一谈。

### 2026-09-13 设置迁入原生偏好设置窗口 + 论断溯源（代码 + 单元证据）

本轮处理用户报告的最后一组产品缺口：设置应位于 **Zotero 原生偏好设置窗口**而不是侧边栏；回答中的论断应能点击 **回溯到原文并高亮**。以下均为代码 + 单元证据，未运行宿主测试、未调用真实模型。

**设置（A）**

- 原生面板注册：`packages/zotero/src/workspace/preferences-registration.ts` 在 `startup()` 用 `Zotero.PreferencePanes.register` 注册固定 id `zcr-prefpane-settings`，`shutdown()` 反注册。注册幂等（本次会话已注册则直接返回），失败时先清理同 id 的旧面板再重试一次，仍失败只 `logError` 并返回 `undefined`，不阻断插件其余功能；异步注册与关闭竞态由 `stopped` 守卫处理（关闭后完成的注册会被立即反注册）。
- 面板装载：脚本 `packages/zotero/src/preferences-entry.ts` 随构建产出 `content/preferences/pane.js`，由 Zotero 以偏好设置窗口 sandbox 加载（脚本先于片段），把 pane 对象发布到共享的 `Zotero` 上；片段 `packages/zotero/preferences/preferences.xhtml` 的 `onload`/`onunload` 调用 mount/unmount——与 Zotero 内置面板同一机制（load 事件派发在 pane-container 的顶层子元素上）。重复 load 不会叠加第二个表单。
- 端口最小化：`preferences-service.ts` 只暴露 JSON 文本函数（readSettings/writeSettings/setSkillEnabled/exportPreferences/newProfileId），面板拿不到 store 对象、路径或权限。所有读写都经过既有 WorkspaceStore：整份校验快照或单个 skill（`saveSkill` 保留 revision 冲突），写失败后用 store 自己的消息报错并重读真实状态，且清除先前的“已保存”提示，不出现互相矛盾的两个结果。
- 展示的真实设置：界面语言、聊天字号、六项研究偏好（回答语言/详细程度/数学解释/研究背景/引用风格/标注风格）、研究配置（新增/更新/删除，id 由插件沙箱生成）、已安装工作流的可用性，以及“导出偏好”（快照定义收敛到 `packages/core/src/workspace/export.ts` 一处，侧边栏与原生面板共用同一 payload 与原生保存对话框）。
- 侧边栏只留本文对话相关内容（研究配置选择、每对话覆盖、引用与工作流编撰）并明确指向原生偏好设置；全局偏好表单、研究配置增删改、工作流可用性开关已从侧边栏移除，避免第二处设置来源。
- 证据：`tests/zotero/preferences-registration.test.ts`（幂等注册、失败重试、关闭竞态、反注册）、`preferences-service.test.ts`（快照读写、skill revision 冲突、导出与导出失败）、`preferences-pane.test.ts`（渲染真实片段、保存、冲突、导出失败、卸载后不再写入、失败不复用旧成功提示）、`preferences-entry.test.ts`（真实片段 + 真实 pane 模块挂到假桥上：正常挂载/卸载、宿主缺失时的诚实提示、读取失败不渲染半成品、重复 load 只挂载一次）、`tests/core/workspace-export.test.ts`、更新后的 `workspace-view.test.ts`。`scripts/verify-artifacts.mjs` 现在把两个偏好文件列为必需项（删任一即验证失败，见 `tests/build/verify-artifacts.test.ts`），这是加强而非放宽校验。
- **只有真实偏好设置窗口能确认**：sandbox 原型链上 `Zotero` 对象写入是否对片段内联处理器可见、XUL 片段 onload/onunload 的实际派发时机、HTML 控件在 XUL 文档中的原生主题/暗色/键盘焦点表现，以及真实 store 与打开窗口的并发行为。本轮未运行宿主测试。

**论断溯源（B）**

- 点击路径：回答中的 `https://zcr.invalid/source/<documentId>/<pageIndex>` 由 `linkAnswerSources` 绑定；点击时把链接 title 的逐字引用经 `normalizeQuote` 归一化（空白/引号；未提供则 null）后传给 `openDocumentPage`，由 `openSourcePage` **先校验冻结 revision**，再定位、再导航。结果是 `highlighted` / `opened` / `unlocated` 三态；只有 `unlocated` 时在链接旁显示“已打开引用页，但无法定位精确段落”，不伪造高亮。
- 定位：`packages/zotero/src/reader/locate.ts` 在冻结版本页面的字符盒上做纯函数匹配（归一化空白/连字符/引号后大小写敏感；跨行字符合并为矩形；多义、部分字形边界、几何非法都判为 unresolved）；`nativeSourceNavigator` 用原生 `getPageData` 取字符盒后再次比对 revision，再调用原生 `navigate({ position })` 做临时高亮。页号越界、页面读取失败、定位歧义都返回诚实 miss。
- 不写文献库：`SourcePageNavigator` 端口刻意不含 annotation/library 能力，`tests/zotero/source-highlight.test.ts` 断言点击路径只发生 validate/locate/navigate 三种调用，revision 不匹配时拒绝定位（`tests/zotero/locate.test.ts`、`source-links.test.ts`、`chat-view.test.ts` 覆盖点击解析、诚实 miss 与无库写入）。
- 策略：`packages/core/src/codex/reader-policy.ts` 的引文指令要求在链接 title 给出逐字短引用，无法逐字引用时省略 title（`tests/core/policy.test.ts` 断言）。**这是代码 + 单元证据，未跑真实模型，不能断言真实模型会遵守该指令。**
- **只有真实宿主能确认**：Gecko/XUL 侧临时高亮的真实视觉效果、真实 reader iframe 的字符盒坐标与滚动锚点、以及长引用在真实页面上的定位质量。

本轮收尾全量门禁（同一工作树）：`npm run typecheck` PASS、`npm run lint` PASS、`npm run test:unit` **743 tests / 67 files** PASS（本轮该树无 skip；`install-lifecycle` 的两条 `skipIf` 在存在 `dist/*.xpi` 时实际执行并通过）、`npm run package:dev` 产出 `dist/zotero-codex-reader-0.4.0a1-dev.xpi`、`npm run verify:artifacts` **79 files PASS**，SHA-256 `c881ad0a3e793398f2514632d0b8ed70f50ded5103aabf22807591f46b9d53f2`（`dist/SHA256SUMS`，含 `content/preferences/preferences.xhtml` 与 `content/preferences/pane.js`）。均为代码 + 单元 + 产物证据；真实宿主与真实模型证据仍为空。

### 2026-09-13 最终 0.4 宿主验收（真实宿主证据，scope-2026-09-13）

对象仍为 `c881ad0a…` 的最终 0.4.0a1 开发包；只用 `.zcr-dev/context/{profile,data}` 与合成材料，GUI 经 LaunchServices 完全分离启动、按完整 `-profile`/`-datadir` 核对后 `TERM`；未 `--live`、未登录、0 模型请求。证据目录（忽略）`.zcr-dev/verification/scope-2026-09-13/`。

| 运行 | 结果 | 与上一轮（`d33ab244…`，`scope-2026-09-12`）对照 |
| --- | --- | --- |
| `--context` | **16 executed / 16 PASS / 0 FAIL**，5 类 NOT RUN | 检查名、通过状态、NOT RUN 列表逐项相同；无新增/删除/翻转。**无回归** |
| `--context --native` | **12 executed / 12 PASS / 0 FAIL**，4 类 NOT RUN | 同上，逐项相同；**无回归** |

**新增有界宿主预检（driver 补充，不改变上述 16/12 检查）**

- 原生偏好设置面板：`pref-pane-registered-once-after-startup`（`pluginPanes` 中恰有一个 `zcr-prefpane-settings`，pluginID 为被测插件，src/scripts 落在已装 XPI 内，label 正确）、`pref-pane-window-mounts-real-form`（真实 `Zotero.Utilities.Internal.openPreferences('zcr-prefpane-settings')` 打开 Preferences 窗口，**沙箱脚本写到 `Zotero` 上的 pane 桥对片段内联 `onload` 可见**，面板挂载真实表单 15 个控件/6 个设置字段，无“不可用”提示，窗口正常关闭）、`pref-pane-no-duplicates-across-disable-enable`（禁用后 0 个、重新启用后恰 1 个，不叠加；无偏好面板相关错误日志）。三个独立会话均 PASS。仍不可验证：面板的暗色/亮色与键盘焦点的**实际视觉**（未截图、未目视），以及 `remove()` 与 Zotero 自身“插件关闭自动反注册”的隔离（1→0 只证明可观察终态，注册器逻辑由 `tests/zotero/preferences-registration.test.ts` 单元覆盖）。
- 论断溯源：`citation-quote-navigation-on-frozen-revision` 用生产 `nativeSourceNavigator` + `openSourcePage` 在冻结 revision 上实跑合成 quote（`quoteIsSyntheticFixture=true`、`modelProducedQuote=false`）：先移到第 2 页，再回到第 1 页且 `outcome=highlighted`；不存在的 quote 返回诚实 `unlocated`；`libraryWrite=false`、标注数不变。仍不可验证：点击真实模型回答里引用链接的完整路径（需要已授权真实模型输出逐字引用），列为 NOT RUN。

**诚实的失败**：`close-preserves-current-page` 在一次 `--context` 运行中 FAIL（关闭侧边栏后 `currentPageNumber` 不是 2）。该失败报告原样保留（`host-context-0.4.0a1-FAILED-close-preserves-current-page.json`），随后 4 次运行均 PASS（通过时为 `{"page":2}`），未复现，按间歇性页面位置问题报告，**未解决、也不宣称本轮新增代码导致**。

**同树本地门禁复核**：`typecheck` PASS、`lint` PASS、`test:unit` **743 / 67 files** PASS、`verify:artifacts` 79 files PASS 且 digest 仍为 `c881ad0a…`。`package:dev` 为父级已产出、未重建，故宿主所测包与已验证 digest 字节一致。仍未运行：隔离官方登录、真实模型回答/停止、真实图像生成、真实文献库写入、签名公开升级与公开发行。

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

## 0.4.0a1 真实宿主证据（2026-09-13，scope-2026-09-12）

对象为 `dist/zotero-codex-reader-0.4.0a1-dev.xpi`，SHA-256 `d33ab244f49e24da983daa2bfdbf542b8f6f28c5b40ad5b295ffd8c613311049`；驱动来自工作树 `tests/host/*`；设备 Apple M5 / macOS 26.6.2 / Zotero 9.0.6 / 1512×949 DPR 2；只用 `.zcr-dev/` 专用 profile 与合成材料。三次运行均为独立进程启动，运行前用 `ps` 核对完整 `-profile`/`-datadir` 参数后才 `TERM` 自己启动的实例；日常 Zotero 实例未被本流程的信号操作。

| 运行 | 结果 | 报告（忽略目录 `.zcr-dev/verification/scope-2026-09-12/`） |
| --- | --- | --- |
| `--context`（当前 PDF 本地路径） | **16 executed / 16 PASS / 0 FAIL**，5 类 NOT RUN（真实模型回答、官方登录、在途停止、长期记忆、图像理解） | `host-context-0.4.0a1-16of16.json` |
| `--context --native`（原生 API 合成探针） | **12 executed / 12 PASS / 0 FAIL**，4 类 NOT RUN（真实模型候选、OA PDF 下载、官方登录、已安装 XPI 的最终 UI 接线） | `host-native-0.4.0a1-12of12.json` |
| s6 隔离树升级/回退（0.3.0a1 → 0.4.0a1 → 0.3.0a1） | **22 executed / 22 PASS / 0 FAIL**，2 类 NOT RUN（live-model-send、同版本 XPI 替换） | `host-s6-0.4.0a1-PASS-22of22-with-downgrade-probe.json` |

与旧声明对照：`docs/progress.md` 早前记录的 `16/16` context 与 `12` 原生项来自 **0.3.0a1** 包（scope-2026-09-11）。本次在同一专用树上用 **0.4.0a1** 重跑，两者都被原样复现，未出现差异；差异只在性能数值（本机负载）与报告内的 build 身份。

原生驱动证据要点：`driverIssuedModelRequests=0`，`modelProposalSource=deterministic-synthetic-fixture`（不把合成候选算作模型输出）；整篇 PDF 文本与加载字节 SHA-256 一致；quote 坐标定位；批量复审 0 个原生标注、批准后一次性写入、撤销只删任务标注、撤销保留用户后续手改；截图产物 `origin=paper`（非生成图）；文章引用的后台 reader 生命周期；DOI `10.1038/nature14539` 的**未保存**元数据预览（网络 translator，1 个候选，`libraryItemIDsUnchanged=true`、`saved=false`、`pdfDownloaded=false`）。

升级/回退证据（两条真实版本，而非同版本替换）：0.3.0a1 初始安装 → `AddonManager` 升级到 0.4.0a1 后握手 ready、仍 signedOut、不生成、记录保留 → 回退安装 0.3.0a1 后版本恢复、握手 ready、记录保留。旧构建读新 schema 的**安全拒绝**现由宿主检查 `schema3-record-refused-without-rewrite-after-downgrade` 覆盖：0.3 构建读到 schema 3 会话时给出 `Saved conversation data could not be read; it was left untouched.`，记录字节不变、`schemaVersion` 仍为 3。该 fixture 同时有单元回归（`tests/core/store.test.ts`），保证它是“合法的新 schema 记录被按版本拒绝”，不是损坏文件。

诚实的失败与边界：s6 首次运行在 90s 内未达到 runtime handshake 而 FAIL（`host-s6-0.4.0a1-FAILED-01-runtime-handshake.json`），随后两次运行均通过（21/21、22/22），未复现，最可能是该复用树首次启动的 runtime/account 初始化开销；为不破坏既有 profile，未做清空式排查。另外，把新 schema 会话设为某论文的“当前会话”时，旧构建会在面板上进入 not-ready 并显示上述拒读提示（记录本身不变）；这是“明确拒绝”而非静默重置，但“回退后连接状态仍为 ready”并不成立。


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

## 清理与保留

已实际删除 **12 份已提交且无未提交改动的旧文档**，没有搬到 archive：4 份 archive 草案/索引；2 份旧阶段/接口计划；5 份已合并 QA（s0-s1、s2、s5、s6、acceptance）；旧 release 说明。有效约束分别迁到产品规格、架构、开发说明；有效旧证据及未运行项迁到下表。空归档目录也移除，Git 历史未重写。

代码清理：删除仅为测试保留的 renderPreview/默认渲染后门并让调用方显式注入真实 shell；删除旧 context-pane takeover 样式；删除 Coming later 设置占位及样式，替换为实际全文开关/范围 UI；移除错误的标准 PDF.js 提取接口，只有一套原生字符链路。更新脚本/文档入口与测试行为断言，不删失败测试或放宽阈值。没有新增依赖；markdown-it、DOMPurify、KaTeX 及其字体/许可仍有实际调用/打包用途。

保留特殊项：runtime/manifest.ts 与 runtime/licenses、bootstrap/manifest/locale、合成 PDF fixture、S 名称宿主驱动、故障恢复/构建/发行测试和 CI 均仍有维护用途；host-types 是必要类型边界。`.zcr-dev` profile/data/account 和既有私有内容不作为临时垃圾删除。

已按本次新授权删除剩余 `project-decisions.md` 短入口和 qa/ 下三份旧资料；有效 UI/安全要求在规格和架构中，旧证据在本页，原文可从基线提交 `38b047c` 查看。

```text
README.md / AGENTS.md / CONTRIBUTING.md / CHANGELOG.md
docs/  zotero-codex-user-flow.md  module-design.md  development.md  progress.md
packages/  contracts/  core/  zotero/
runtime/   manifest.ts  licenses/
scripts/   tests/   .github/
build/ dist/ .zcr-dev/（忽略的生成/测试内容）
```

## 剩余差距与下一任务

| 要求 / 代码位置 | 现在与缺口 | 迭代 |
| --- | --- | --- |
| 标题/会话/全文：reader/document、chat、core/sessions | 上述本地/协议链路已验证；真实模型问答、选区全文推理/引文质量、host 文件替换和多窗口未测 | B |
| 预算/长文/缓存 | 本地文本缓存最多 **3 份、每份 16 MiB UTF-8**，超限要求缩小页范围；来源 ID 由文献身份/版本/解析器/页范围/文本摘要确定性生成，LRU 驱逐不改变身份；加载字节与磁盘 SHA-256 比较可发现 size/mtime 不变的替换。已接 runtime 窗口优先、否则固定 catalog 的预算与聚焦/多轮计划；自动章节/问题检索、语义坐标、OCR/页面图片仍未接。以上为代码+单元证据，真实模型预算行为未测 | B |
| 历史/恢复：presenter/store | 离线历史、草稿/滚动持久化、改名/分支/排队、schema 3 读写与旧 schema 1/2 安全拒绝已有代码与单元回归；**0.3↔0.4 宿主升级/回退与 schema-3 回退安全拒绝本轮已在 s6 隔离树验证（22/22）**，真实模型在途恢复仍未测 | B/C/F |
| 统一 @文章/@chat、/skill、personalization | WorkspaceStore、@article 元数据先行/选定后读取、@chat 有界快照、SKILL.md 解析与 revision 冲突、偏好/研究配置已有代码与单元；第三方 skill 仍不能授予权限。真实库接线与 UI 目视未验 | C |
| 模型/多模态/上下文 | 固定 catalog 模态/窗口、provider 能力与 rate-limit 解析、每轮预算、粘贴图片、生成图 16 MiB 校验与导出、diagram 线程能力已有代码与单元；真实档位/多图/真实图像生成、文件拖拽/截图排序、精确用量与完整已发送/已引用面板仍未测 | C |
| 标注 / 获取整理 agent | 候选 JSON 解析、按 PDF 版本原文定位、任务审批、账本写意图/撤销/冲突检测、DOI/链接查重与 OA 附件校验已有代码与单元；真实库原生写入/撤销、网络预览与合法全文核对未在宿主验证 | D/E |
| 设置/偏好设置窗口：preferences-*、workspace-store | 原生面板注册/清理、面板端口与快照写入、侧边栏去重已有代码与单元；**2026-09-13 已在真实宿主预检：注册身份正确、真实 Preferences 窗口能挂载面板（沙箱桥对片段可见）、禁用/启用不叠加、无错误日志**（详见上节）；仍缺面板的暗色/亮色与键盘焦点**目视**、以及打开窗口时真实 store 并发 | F |
| 论断溯源：reader/locate、reader/source-highlight、reader-policy | 冻结 revision 校验、逐字引用定位与临时高亮导航、诚实 miss、无库写入已有代码与单元；**2026-09-13 已在真实宿主用生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑：回到引用页 `highlighted`、缺失 quote 诚实 `unlocated`、无库写入**；仍缺真实 Gecko 高亮**视觉**、长引用真实定位质量、以及真实模型是否输出逐字引用（点击真实回答链接的完整路径未验） | F |
| 安装/登录/发行/性能 | 项目已按 MIT 许可并在包内包含 `LICENSE`；本轮实测 `package:dev`/`verify:artifacts`。官方新登录、真实输出/停止/在途恢复、无 Node/下载隔离、长时压力、完整原生视觉矩阵、公开签名发行均未完成；本轮已复现 clean HEAD 重建（见上） | F |

**下一条可执行任务（含本轮新增）**：`--context` 已能程序化打开真实偏好设置窗口并确认 `Zotero Codex Reader` 面板挂载、禁用/启用不叠加；剩余的是**目视**核对面板（暗色/亮色、键盘 Tab、保存与导出失败提示）与真实 Gecko 临时高亮的**视觉**表现，需人工对照；随后在用户通过官方流程登录的隔离 profile 中，仅用合成材料验证“无需选区提问＋跨页定义＋More details＋停止＋模型设置切换”和真实图像生成（含真实模型回答里引用链接的点击路径）；随后用真实宿主复核最终 0.4 XPI 的原生任务/获取 UI，再按 F 的门槛处理升级/回退、无 Node 安装与公开签名发行。本轮未调用真实模型，不能把过去限额日期当作现在的阻塞证据。

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话；未发送草稿目前仅在插件寿命内保留，重启不会恢复。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

## 已迁移的旧版证据（不是本次通过）

来源为被合并的 Git 已追踪 QA；原始历史可从 HEAD `1fdd3dc` 查看。本表只保存仍影响当前判断的证据，不延续逐日流水账。环境均旧 macOS arm64 / Zotero 9.0.6 专用 profile / 合成材料。

| 旧验证 | 构建/结果 | 尚未证明 |
| --- | --- | --- |
| S1 外壳/启停 | 2026-09-08 的早期 shell 开发包，27/27；不继承到新 dock | 当前样式、模型或发行 |
| S2 原生 runtime | 2026-09-09 XPI；12/12 executed，3 NOT RUN；真实 turn 被 typed quota 拒绝 | 流式非空回答/停止、完整点击登录/取消/网络失败 |
| S3 选区 | 旧包，23/23 executed，2 NOT RUN；Ask 草稿/来源/A-B恢复 | 真实回答/追问停止；原始记录见 Git 基线 |
| S4 交互 | `c1b898ac4e35de49a65c96ce56e08db6949071b62618ff7c34a01672b942a0db`，40/40，5 NOT RUN，无模型发送 | 新 in-reader dock，主题/800px/底边/发送组合；原始记录见 Git 基线 |
| S5 恢复 | 同 c1b898ac 包，17/17，1 NOT RUN；自有进程 TERM 与 fixture uncertain 隔离 | 在途 turn resume、掉电持久性 |
| S6 virgin/升级 | 同 a1 包：15/15；a1→a2→a1：19/19（各2 NOT RUN），a2 `445f47243bb4108a0fc73c0e7c179702cc5c1068bbefb38b96d2a2a43c7b0309` | 公开下载/Gatekeeper、无 Node、真实模型；**新 schema 回退已由 2026-09-13 的 0.3→0.4→0.3 运行补上（22/22）** |
| 工作树副本重建 | 旧工作树 npm ci 后复现 c1b898ac；release dry-run githubRelease=null | 不等于 clean git HEAD，不等于发布；项目已采用 MIT（根 `LICENSE`） |
| 2026-09-10 UI | 最新工作树曾 306 tests /39 files，XPI 196f0dc… 装到专用 acceptance profile，无 driver | 当时 screenshot paste、新样式真实目视、图像模型发送未完成；基线今日发现跨日失败 |

历史限额“约 2026-09-15”只是旧报告，当前账户可用性未读取，不作为当前结果。真实库不用于验证，不读旧认证或模型日志来猜状态。

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
- [x] 设置迁移（代码+单元+**2026-09-13 宿主预检**）：全局设置进入 Zotero 原生偏好设置面板（注册/反注册/失败与关闭竞态已测），侧边栏只保留每对话内容并指向原生设置；XPI 已含片段与脚本，`verify:artifacts` 把它们列为必需文件。**真实宿主已确认面板注册身份、Preferences 窗口挂载与禁用/启用幂等**；真实偏好设置窗口的原生主题/键盘焦点**视觉**仍待宿主目视。
- [x] 论断溯源（代码+单元+**2026-09-13 宿主预检**）：点击引文先校验冻结 revision，再按链接 title 的逐字引用在冻结页面字符盒上定位，命中才做临时高亮，未命中诚实提示；点击路径无任何库写入。**真实宿主已用生产 `nativeSourceNavigator`+`openSourcePage` 与合成 quote 确认回到引用页的临时高亮导航、诚实 miss 与无库写入**；真实 Gecko 高亮**视觉**与真实模型是否遵守逐字引用指令仍未测。
- [ ] 收尾：版本升级与小提交本轮完成；干净 checkout 重建本轮已在临时 worktree 复现（typecheck/单元/package:dev/verify:artifacts 与主树同 digest）；CI/release 工作流已按真实脚本与 `.nvmrc` 加固且保持无 upload/publish；产物/隐私/文档链接复查仍待执行，只留必要测试/运行资产。

UI 参考已只读核验本机官方扩展 26.908.31748 的样式资产；不是复制源码/品牌。使用 28px 桌面控件、宿主字体/主题、4/8/12/16px 间距、13px 正文和克制边框。原生宿主视觉还须在改动后实际检查。
