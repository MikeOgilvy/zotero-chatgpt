# 当前进度与验收

2026-09-12 全量迭代收尾，分支 `codex/product-agent-v0.4`。基于 `38b047c` 的开发工作已按功能拆成小提交落在本地（未推送）；当时 HEAD 通过 `typecheck`/`lint`/`test:unit`（**632 tests / 57 files**）。下列早期迭代证据仍保留其原始范围，不代表本轮新证据。并入 2026-09-13 的两个功能分支后为 **699 tests / 60 files**；随后补上“设置迁入原生偏好设置窗口”“论断溯源”，再补上“阅读锚点竞态修复”与“原生偏好面板本地化”后，当前工作树为 **746 tests / 67 files**（见下节）。

2026-09-13 补充：在最终 0.4.0a1 开发包上重跑了专用宿主验证（`--context`、`--context --native`）与 s6 隔离树的升级/回退，并为“新 schema 回退安全拒绝”补了宿主检查与单元回归。证据目录 `.zcr-dev/verification/scope-2026-09-12/`（忽略），过程与失败报告见下节。

### 2026-09-13 0.4.0a3 版本提升、最终打包、真实宿主证明与 owner 安装（代码 + 单元 + 产物 + 真实宿主证据，含失败）

本轮为收尾组装：把开发版本从 `0.4.0a2` 提升到 `0.4.0a3`（原因同 `edd2b3a`：owner 的 profile 已装 `0.4.0a2`，再发同版本字符串会让 Zotero 把重装当成同版本 no-op，owner 看不到任何变化），在同一棵干净树上跑门禁、打包、校验产物，再用 `.zcr-dev/` 专用树跑真实宿主 `--context` 阶段，并按 owner 的验收要求把新包装到其正常 profile。**全程 0 模型请求；`--live-model` 需 owner 本人完成官方登录，未运行。**

**版本提升**（本地提交 `8828c15`，绝对 HEAD `8828c1551d8348bb3f81c9c58ec8f5ca751425e7`；基线 HEAD 为 `29d11a1`）。`packages/zotero/manifest.json` 的 Zotero 版本字面量（唯一真实来源：`scripts/build.mjs` 原样复制、`scripts/package.mjs` 据此命名 XPI）改为 `0.4.0a3`；同步更新前向文档 `docs/development.md`（当前版本行、目标文件名、`verify:install -- build-info` 示例、发行边界段）与 `docs/module-design.md`（工作树实现版本）。文件集与上次同版本 no-op 修复 `edd2b3a` 完全一致（3 文件 / 6 行）。npm 版本仍是 `0.4.0-alpha.1`，与 `edd2b3a` 一样有意不动（npm 版本与 Zotero 读的 addon 版本是两套字面量）。`rg -n "0\.4\.0a2" packages docs scripts tests` 已无任何前向字面量；`docs/progress.md` 里大量 `0.4.0a1`/`0.4.0a2` 是描述过去包与宿主证据的**历史记录**，按约定原样保留、不当作待更新字面量。被忽略的生成目录 `build/` 仍含旧值，`package:dev` 会重建。

**门禁（同一工作树）**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **77 files**——打包前为 959 passed + 2 skipped（2 条 skip 是 `tests/build/install-lifecycle.test.ts` 中以“当前 manifest 版本对应的 XPI 是否存在”为条件的 `it.skipIf`，当时 a3 XPI 尚未生成），打包后复跑为 **961 passed / 0 skipped**。均为代码 + 单元证据。

**打包与产物**：`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a3-dev.xpi`；`npm run verify:artifacts` **79 files PASS**。产物实测 **92,668,286 bytes**，SHA-256 `3abeb8c25ee139fd5b767570e9c81ffbfb919592d7d277ff5ed1a49d43e34a6f`（与 `dist/SHA256SUMS` 一致），包内 `manifest.json` 声明 `0.4.0a3`。未手工改包、未重打包、未“修”产物。

**真实宿主证明（`.zcr-dev/context/{profile,data}`，合成 PDF，0 模型请求）：阶段失败**

命令为 `node scripts/prepare-host-test.mjs --context`，随后按 development 的专用命令启动 `/Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile "$PWD/.zcr-dev/context/profile" -datadir "$PWD/.zcr-dev/context/data"`。启动前用 `ps -axo comm=` 确认没有其它 Zotero 实例（未启动第二个、未 kill 任何实例）；只用 `.zcr-dev/` 子树与合成材料；实例由本流程启动，停止前用 `ps -axo pid,args` 核对其完整 `-profile`/`-datadir` 参数，并确认该 profile 的 `records/conversations/*.json`（排除 `.source.json`）无 `activeRequestId` 后才 `TERM` 自己的 PID。准备脚本装入被测 XPI 的 SHA-256 与产物一致（`3abeb8c2…`），报告 build 为 `0.4.0a3`。

- **结果：`status: failed`，`failedStep: automatic-background-preparation`。** 通过 5 项真实宿主检查：`isolated-context-profile`、`full-xpi-active`、`two-pages-extracted`（2 页，标签 `i`/`1`）、`text-from-both-pages-and-page-labels`（第 1 页 1546 字符、第 2 页 1544 字符且含 `ORCHID-72`）、`title-before-or-with-connection`。随后驱动在真实宿主 PDF 对象上挂好 `getPageData`/`getPageLabels2` 观测包装（`nativePreparation: "observable"`，探针命中 `pageIndex 0`，证明包装对宿主的 Xray 查找可见），点开侧栏后等待产品**自己的**整篇 PDF 预取在 **60s** 内对 `pageIndex 0` 与 `1` 各发一次原生 `getPageData`；该 `await until(..., 'automatic-background-preparation', 60000)` 超时，驱动按约定把 `status` 记为 `failed`、`failedStep` 记为 `automatic-background-preparation`（`startedAt` 08:45:30Z、`finishedAt` 08:46:31Z，恰为 60s 窗口），未进入任何后续检查。
- **不是一次性**：同一 60s 步骤两次运行都没满足。第一次运行进程在该步骤期间直接消失、未写出终态（报告停在 `status: running`、5 项通过），原样归档为 `.zcr-dev/context/host-report-0.4.0a3-ABORTED-after-5-checks.json`（sha256 `699a0858…`）；第二次运行写出上述 `status: failed` 报告，原样归档为 `.zcr-dev/verification/scope-2026-09-13-a3/host-context-0.4.0a3-FAILED-automatic-background-preparation.json`（sha256 `187c82a4…`）。按约定**未重试到通过、未修改 `tests/host/**` 或任何驱动、未放宽断言**。
- **未运行的项（原样）**：失败报告在 `skip()` 执行前中止，`notRun` 只有默认 5 个名字、**没有**逐项原因：`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`。不能把它们当作通过，也不为本轮补写驱动未记录的原因。
- **归因边界（诚实）**：触发该检查的 `--context` 阶段重写（`b9165c1 test(host): re-encode the --context stage for panel-less PDF context`，2026-09-13 15:45）是 HEAD 的祖先；本轮是这套新阶段**第一次**在真实宿主上产出报告（`.zcr-dev/` 与 `dist/` 中此前没有包含 `context-ring-reports-honest-unknown-state` 或 `automatic-whole-pdf-background-preparation-without-panel` 的报告）。因此只能结论为：**0.4.0a3 包在该新宿主检查上失败（打开侧栏后 60s 内未观测到产品自动整篇预取对两页各发一次原生 `getPageData`）**；既不能断言这是相对早先 0.4.0a1 `--context` 通过（其驱动更旧、无此检查）的回归，也不能断言是驱动时序问题——产品侧根因未定位。

**owner 验收安装（profile 变更，非仓库变更，不计入提交）**：安装前 `ps -axo comm=` 确认 Zotero 未运行。把 owner 正常 profile（`~/Library/Application Support/Zotero/Profiles/mi2zhr2s.default`）中已装的 `extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi` 先复制备份为 `{8a5f5bde-…}.xpi.zcr-bak-20260913-165059-0.4.0a2`（版本 `0.4.0a2`、92,643,635 bytes、SHA-256 `ac3fb6aa2073802e233f4139c6f9466c016d43bbec9d2796c16f71ae1ee46180`，与 `dist/zotero-codex-reader-0.4.0a2-dev.xpi` 逐字节一致），再把 `dist/zotero-codex-reader-0.4.0a3-dev.xpi` 复制到该路径（现为版本 `0.4.0a3`、92,668,286 bytes、SHA-256 `3abeb8c2…`）。**只改这一个 XPI 文件**：未改 `prefs.js`、未改 `extensions.json`/`addonStartup.json.lz4`、未设临时 `extensions.startupScanScopes`（a3 的版本与 mtime 均已变，Zotero 下次启动会据此更新已注册的同 id 插件，故判定不需要，也就不留待还原的改动）、未动任何其它 profile、未读/复制/记录认证文件、未动文献库数据。回滚（先退出 Zotero）：`cp -p "<上述备份路径>" "<profile>/extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi"`。**安装 ≠ 宿主通过**：上述宿主失败就发生在同一 a3 包上；owner 首次启动后应能观察到版本由 0.4.0a2 变为 0.4.0a3。

**仍未验证（不得当成通过）**：真实模型输出/流式/停止/在途恢复（本轮 0 模型请求）；`--live-model` 模型目录测量（须 owner 本人在 `.zcr-dev/live/` 隔离树完成一次官方登录，**NOT RUN**）；真实图像生成；真实文献库原生标注写入与撤销；本轮 `--context` 因 `automatic-background-preparation` 失败而未跑到的全部后续检查（context ring 诚实未知态、引用溯源、同意路径、空白 PDF 拒绝、性能采样、偏好面板预检等）；偏好面板中/英文与暗色/亮色的**目视**、真实 **IME** 输入、真实 Gecko 临时高亮视觉、真实阅读锚点目视；无 Node 环境安装与公开签名发行。本轮的宿主结论只覆盖上列 5 项通过 + 1 项失败，**不代表整篇 `--context` 通过**。

### 2026-09-13 0.4.0a4 版本提升、门禁、打包、真实宿主 `--context` 与 owner 安装（代码 + 单元 + 产物 + 真实宿主证据）

本轮把 `0.4.0a3` 之后的产品改动（面板改名与模型族、研究指令简化、workflow 精简、历史简化与全选删除、archive 概念移除、有界可见的本地读取失败）真正放到宿主上：提升 Zotero 开发版本号、跑门禁、打包校验产物、在 `.zcr-dev/context/{profile,data}` 合成树上重跑真实宿主 `--context`、清理两处死代码、并把新包装到 owner 正常 profile。**全程 0 模型请求（`recordedRequests = 0`）；`--live-model` 需 owner 本人完成官方登录，仍未运行。** 上一节的 0.4.0a3 宿主失败记录原样保留为历史，本轮 a4 运行取代其在“当前状态”上的结论。

**版本提升**（本地提交 `96f8c2c`；基线 HEAD `8e7d1fa`，本次唯一写入者、工作树干净）。严格沿用 `8828c15`/`edd2b3a` 的文件集：`packages/zotero/manifest.json` 的 Zotero 版本字面量（唯一真实来源）改为 `0.4.0a4`；`docs/development.md` 4 行（当前版本行、目标文件名、`verify:install -- build-info` 示例、发行边界段）；`docs/module-design.md` 1 行（工作树实现版本）。**npm `version` 仍 `0.4.0-alpha.1` 有意不动**（与历次提升一致）。`rg -n "0\.4\.0a3" packages docs scripts tests` 复查后**剩余出现全部是历史**，刻意保留：(1) `docs/progress.md` 中描述过去 a3 包、宿主失败与安装的记录；(2) `tests/host/context-driver.js:181` 引用归档报告文件名 `host-report-0.4.0a3-DIAG4`；(3) `tests/host/context-driver.js:621` 解释图例 canary 为何同时钉两行的历史注释（a3 包渲染 `Chat`、`f6592a3` 改名为 `Appearance`）。未改任何驱动行为。

**门禁（同一工作树）**：打包前 `npm run typecheck` PASS、`npm run lint` PASS、`npm run test:unit` **968 passed / 2 skipped（76 files）**（2 条 skip 是 `install-lifecycle` 以“当前 manifest 版本对应 XPI 是否存在”为条件的 `it.skipIf`，此时 a4 XPI 尚未生成）。打包后复跑 **970 passed / 0 skipped（76 files）**。Phase 5 清理后再复跑 **970 passed / 0 skipped（76 files）**。均为代码 + 单元证据。

**打包与产物**：`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a4-dev.xpi`；`npm run verify:artifacts` **79 files PASS**（`dist/SHA256SUMS` digest 同为 `5a6bb161…`）。产物实测 **92,661,563 bytes**，SHA-256 `5a6bb1616bfe0d54eb2bb6ef5230beb5825c8c1be6e7d5ba29c75b0cb94014cf`，包内 `manifest.json` 声明 `0.4.0a4`。未手工改包、未重打包。

**真实宿主 `--context` 证明（`.zcr-dev/context/{profile,data}`，合成 PDF，0 模型请求）**：运行前用 `ps -axo args=` 确认没有任何 Zotero 实例（未启动第二个、未 kill 任何实例）。`node scripts/prepare-host-test.mjs --context` 装入的 XPI SHA-256 与产物一致（`5a6bb161…`），随后按 development 的专用命令启动，进程参数核对为 `-profile …/.zcr-dev/context/profile -datadir …/.zcr-dev/context/data`；驱动在写出报告后自行退出该实例（`ps` 复核无残留）。报告归档 `.zcr-dev/verification/scope-2026-09-13-a4/host-context-0.4.0a4-PASS-32of32.json`（sha256 `136bc17c…`）。

- **结果：`status: passed`，32 executed / 32 PASS / 0 FAIL**；报告 `build` 为 `{"version":"0.4.0a4","sha256":"5a6bb161…"}`，`recordedRequests: 0`。32 项为：`isolated-context-profile`、`full-xpi-active`、`read-observation-armed-on-shared-host-apis`、`title-before-or-with-connection`、`two-pages-extracted`、`text-from-both-pages-and-page-labels`、`automatic-whole-pdf-background-preparation-without-panel`、`removed-document-panel-stays-off-the-chat-surface`、`context-ring-reports-honest-unknown-state`、`native-runtime-handshake-ready`、`local-conversation-independent-of-login`、`context-source-hidden-without-a-citation`、`context-source-points-at-the-selected-page`、`context-source-returns-to-the-cited-page`、`consent-path-reachable-without-the-removed-panel`、`close-preserves-current-page`、`reopen-keeps-current-page`、`draft-preserved`、`same-title-attachments-separated`、`attachment-switch-keeps-draft`、`reader-zoom-keeps-chat-text-scale-independent`、`warm-open-p95-under-250ms`、`local-feedback-p95-under-100ms`、`single-dock-and-toggle-after-cycles`、`no-model-request-in-this-conversation`、`not-ready-send-refuses-with-error-alert`、`pref-pane-registered-once-after-startup`、`pref-pane-window-mounts-real-form`、`pref-pane-copy-matches-stored-ui-language`、`pref-pane-copy-follows-language-switch-with-verbatim-identifiers`、`pref-pane-copy-reverts-with-the-stored-language`、`pref-pane-no-duplicates-across-disable-enable`。
- **图例 canary 首次命中新行**：三个 `pref-pane-copy-*` 检查这次匹配的是 **`Appearance`/`外观`** 行（`sectionCopy: {"en":"Appearance","zh":"外观"}`；切到 zh 后 `legend: "外观"`；切回 en 后 `legend: "Appearance"`），而非 a3 包的 `Chat`/`对话`。驱动同时钉两行、未知段落名会响亮失败，未改驱动来“使其通过”。
- **a3 最初失败的那项现已通过**：`automatic-whole-pdf-background-preparation-without-panel` PASS。`details` 关键字段：`preparationObserved: true`、`productGate: {"statCalls":2,"digestCalls":2}`、`automaticPdfTextReads` 有 10 条（`ms` 316…4463，均 `enabled: true`）、`productLoggedErrors: []`、`nonFatal: false`、`legacyVerdict: "wrapper not armed: the product was observed only through the host APIs it looks up itself"`；其 `note` 原文为 “Assertion source: the product's own revision gates for this file (IOUtils.stat + computeHexDigest, counted only after the driver's own disk probe). A second gate means the product reached its own validate() after reading the whole document. The driver never calls those on this PDF.” 诚实边界：本轮驱动（`tests/host/*` 在 a3 失败后经多次提交改写为“只观测产品自身查找的宿主 API”）在 21:47 的另一次运行中已对 a3 包通过该项（该报告归档为 `.zcr-dev/context/host-report-0.4.0a3-tree-driver-PASS-before-a4.json`），因此 a4 的通过证明的是**当前树 + 当前驱动**，不能单独归因于某一次产品修复。
- **未运行项（原样，共 8）**：`real-model-answer`、`official-login`、`in-flight-model-stop`、`long-term-memory`、`image-understanding`、`pref-pane-visual-theme-and-keyboard`、`pref-pane-registrar-isolated-from-host-auto-unregister` **在报告中只有名字、没有逐项原因**（不为其补写）；`acknowledge-context-resumes-the-pending-explain` 的原因原文为 “Acknowledging re-runs the pending explain, which starts the official login (signed out) or a real model request (signed in). --context must do neither, so the resume click is deliberately not executed.” 不把任何 `notRun` 当作通过。

**两处死代码清理**（本地提交 `f1e8044`，Phase 1-4 通过后执行）：移除 `packages/zotero/assets/sidebar.css` 中已无任何产品引用的 `.zcr-history-archived-label` 规则（archive 界面已从历史面板移除，CSS 规则是移除 worker 文件清单外的遗留）；对应地删掉 `tests/zotero/sidebar-styles.test.ts` fixture 中构造该 class 的 `el('span','zcr-history-archived-label','Archived')`——该 span 没有任何独立断言（没有 `cs()`/`shippedRule()` 读取它），所以**没有可替换的有意义断言，属无存活用途而删除**；其余 archive 段断言与其它断言一字未改、未放宽。清理后 `typecheck`/`lint` PASS、`test:unit` **970/970、0 skipped（76 files）**、`verify:artifacts` 仍 79 files PASS。

**产物与树的诚实边界**：a4 产物在提交 `96f8c2c`（版本提升）时构建并完成宿主验证；其后的 `f1e8044` 才做死代码清理。产物字节与最终 HEAD 的 CSS 会因此不同——但被删的是一条**死规则**（`zcr-history-archived-label` 无任何渲染路径），运行时行为不受影响，故本轮“宿主验证的产物 = 安装的产物”，而 HEAD 比产物多一个无行为影响的清理提交。按 Phase 3 约定未重新打包产物。

**owner 验收安装（profile 变更，非仓库变更，不计入提交）**：安装前再次 `ps` 确认 Zotero 未运行。把 owner 正常 profile（`~/Library/Application Support/Zotero/Profiles/mi2zhr2s.default`）中已装的 `extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi` 先复制备份为 `{8a5f5bde-…}.xpi.zcr-bak-20260913-215714-0.4.0a3`（版本 `0.4.0a3`、92,668,286 bytes、SHA-256 `3abeb8c2…`，与已装 a3 逐字节一致），再把本轮宿主验证过的 `dist/zotero-codex-reader-0.4.0a4-dev.xpi` 复制到该路径（现为版本 `0.4.0a4`、92,661,563 bytes、SHA-256 `5a6bb161…`）。**只改这一个 XPI 文件**：未改 `prefs.js`、未改 `extensions.json`/`addonStartup.json.lz4`、未设临时 `extensions.startupScanScopes`（a4 版本与 mtime 均已变，判定不需要，因此没有待还原的改动）、未动任何其它 profile、未读/复制/记录任何认证文件、未动文献库数据。回滚（先退出 Zotero）：`cp -p "<上述备份路径>" "<profile>/extensions/{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}.xpi"`。**安装 ≠ 宿主通过**：本轮 32/32 是 `.zcr-dev/context` 专用树上的结果，owner 正常 profile 的首次启动体验与真实文献库 PDF 仍需本人目视验收。

**仍未验证（不得当成通过）**：真实模型输出/流式/停止/在途恢复（本轮 0 模型请求）；`--live-model` 模型目录测量（须 owner 本人在 `.zcr-dev/live/` 隔离树完成一次官方登录，**NOT RUN**）；真实图像生成；真实文献库原生标注写入与撤销；上述 8 个 `notRun`；面板中/英文与暗色/亮色的**目视**、键盘 Tab、真实 **IME** 输入、真实 Gecko 临时高亮**视觉**、真实阅读锚点目视；真实文献库 PDF 是否与合成 fixture 行为一致；无 Node 环境安装与公开签名发行。本轮宿主结论只覆盖已列出的 32 项通过 + 8 项 `notRun`，不代表整篇 `--context` 之外的门槛。

### 2026-09-13 Codex 运行时升级 0.144.1 → 0.154.0（代码 + 单元证据，未打包）

按已完成的重审（`.zcr-dev/pin-bump/0.154.0/REPORT.md`）应用：`runtime/manifest.ts` 固定 `rust-v0.154.0` darwin/arm64（归档 88080735 B / `344310a0…f9d7`，二进制 222655232 B / `4f859826…afcc`）；`packages/core/src/index.ts` 两处版本字面量改为 0.154.0；`reader-policy.ts` 只改两个已证实的键（`chatgpt_base_url` 现为 `https://chatgpt.com/backend-api/`，`experimental_thread_config_endpoint` 已从 schema 移除）。内嵌回退目录更新为 11 个 id（首个可见默认 `gpt-6-astra`，含两个 daybreak id；sol/terra/luna 回退窗口 372000 → 272000），并保持目录身份字面量与 manifest 绑定——否则每次查找都会返回 null。许可证只刷新 `RATATUI-LICENSE`（一行年份），其余三个逐字节相同。

本地证据：`node scripts/runtime-prepare.mjs` 通过（先按 manifest 校验归档，再解包并校验二进制，macOS `codesign --verify --strict` 通过）；独立复核归档/二进制大小与 SHA-256 与 manifest 一致，`codesign -dvvv` 为 `Developer ID Application: OpenAI OpCo, LLC (2DC432GLL2)`，在隔离临时 `HOME`/`CODEX_HOME` 下 `codex-cli --version` 输出 `0.154.0`。直连 GitHub release 在此时严重限速/中断，实际归档字节取自已重审且与 GitHub 发布摘要一致的本地副本，再由 `runtime-prepare` 独立校验。

新增/更新单测锁定 pin：目录身份等于 manifest、目录内每个 id 都能解析（覆盖“身份不一致导致全为 null”的回归）、首个 id 为 `gpt-6-astra`、两个 0.154.0 策略键（错误 base URL 仍 fail-closed）。**未运行** `package:dev`/`verify:artifacts`：等本升级、会话归档与 chrome 改动全部落地后，只从干净树打一个包。真实账户是否真的可选到 `gpt-6-astra` 等新模型仍是 **UNKNOWN**，需真实登录宿主验证，本升级不保证。

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

### 2026-09-13 阅读锚点竞态修复 + 原生偏好面板本地化（代码 + 单元 + 真实宿主证据）

两项收尾缺口。以下宿主证据为最终包 `f23fe414…`（及修复期的中间包 `4c1a044d…`），仍只用 `.zcr-dev/context/{profile,data}` 与合成材料，GUI 全程分离启动、`ps` 核对后 `TERM`；未 `--live`、未登录、0 模型请求。证据目录 `.zcr-dev/verification/scope-2026-09-13/anchor-fix/`（忽略）。

**A. 间歇性丢失阅读锚点（真实竞态，非宿主计时假象）**

- 现象：`close-preserves-current-page` 曾在一个 `--context` 运行中 FAIL（原样保留在“最终 0.4 宿主验收”一节列出的 `host-context-0.4.0a1-FAILED-close-preserves-current-page.json`，该报告早于诊断字段，`details` 为空）。
- 机制（对照真实源码）：程序化跳页时 `pdfViewer.scrollPageIntoView` → `#scrollIntoView`（`resource/reader/pdf/web/viewer.mjs:12835`）**同步**写入 `currentPageNumber` 并滚动容器；`_location` 只由容器 scroll 监听经 `watchScroll` 的 requestAnimationFrame 合并后到达 `_scrollUpdate` → `update()` → `_updateLocation`（同文件 `166-196`/`12653`/`12934`）才刷新。在“跳页已提交、位置尚未刷新”的那一帧内关闭侧边栏，`capturePosition` 读到的仍是跳页前的页，`ReaderLayoutController.close()`（`layout.ts:80-86`）随即把它当作恢复锚点，预设缩放又按同一过期位置重新锚定，于是阅读位置被拉回原页。
- 修复：`capturePosition` 改以已提交页 `currentPageNumber` 为准，与 `_location` 不一致时恢复该页且不臆造偏移（`reader-pane.ts:34-52`）；`setZoom` 在触发原生预设缩放前先把 `_location` 对齐到恢复目标，避免 `#setScaleUpdatePages` 用过期位置重锚（`reader-pane.ts:173-191`）；适配器新增可选 `currentPageNumber`（`host-types.ts:7-14`）。
- 失败优先回归：`tests/zotero/reader-pane.test.ts` 新增用例先在未修复代码上失败（`capturePosition()` 返回 `pageIndex 0` 而 `currentPageNumber` 已是 2），修复后通过；未放宽任何既有断言。
- 宿主复核：驱动新增 `reopen-keeps-current-page`，并让 `close-preserves-current-page` 在失败时记录 `location`/dock/侧栏状态。最终包连续 5 次 `--context` **23/23 PASS**（修复期另有 6 次全 PASS），该检查每次都记录 `{"page":2,"location":{"pageNumber":2,…}}`，即“跳页提交页”与“位置”已一致。
- 诚实边界：修复前约 1/5 复现，5 次通过本身不是统计证明；真正的保证是代码级——位置落后时不再读取 `_location`，因此该窗口不可能再决定恢复目标。

**B. 原生偏好设置面板本地化（复用既有机制）**

- 语言来源与侧边栏完全一致：面板挂载同一个 `mountUILocale`，语言取 store 里持久化的 `uiLanguage`；`sync()` 在每次重读后重新应用，所以切换语言立即生效、切回也恢复英文，语义与 store 行为均未改变。
- 范围：四个分区标题、字段标签、下拉选项、五个按钮、成功/失败与校验提示、工作流明细行的 `Unavailable:` 前缀。`ui-locale.ts` 只新增面板自己的选择器与文案；profile 名、skill 名与 id、版本、workflow id 一律不匹配、不翻译（内置 skill 名是 `read`/`derive`/… 这类机器标识）。`Chat text scale (0.5–3)` 与 `Choose a chat text scale from 0.5 to 3.` 走既有 `progress()` 模式，后者同时让侧边栏里同一条 store 消息也本地化。
- 单元：`tests/zotero/preferences-pane.test.ts` 新增 zh 全量文案 + 标识符逐字（`builtin-read`/`read`/`v1.0.0`、`Formal`、`Study`、`user · v1.0 · read`、`imported · v1.0 · read · 不可用：mcp`）与双向切换（含面板自己的结果提示）用例；原先在 zh 场景下断言英文文案的既有用例改为断言精确中文消息，属于加强。全量 **746 tests / 67 files**。
- 真实宿主（**只有真实 Preferences 窗口能看到**）：驱动新增 `pref-pane-copy-matches-stored-ui-language`、`pref-pane-copy-follows-language-switch-with-verbatim-identifiers`、`pref-pane-copy-reverts-with-the-stored-language`——在真实窗口内用面板自己的控件把 store 语言切到 `zh`（store 读回 `zh`、图例变 `对话`、六个内置 skill 的 id/名字逐字不变），再切回 `en`（store 回 `en`、图例回 `Chat`、标识符列表与切换前逐字节相同）。只写并恢复 UI 语言这一项设置，未写任何业务记录。
- 诚实边界：片段里的 `Loading Zotero Codex Reader preferences…` 占位在面板挂载前短暂显示，仍是英文；`preferences-entry.ts` 在“插件未运行/面板无法显示”时的两条告警没有可读 store，也就没有持久化语言可用，保持英文。中文面板的**视觉**（字体回退、暗色/亮色、Tab 顺序）仍未目视，继续列为 NOT RUN。

**收尾门禁（同一工作树）**：`npm run typecheck` PASS、`npm run lint` PASS、`npm run test:unit` **746 tests / 67 files** PASS、`npm run package:dev` → `dist/zotero-codex-reader-0.4.0a1-dev.xpi`、`npm run verify:artifacts` **79 files PASS**，SHA-256 `f23fe4142b0f517de5834d898f87596de506e4b02e0b9a79ad4d252c6b443c5e`。本地提交 `170e83f`、`227820d`、`8a96c08`、`394481c`、`0eca7a2`（未推送、未打 tag）。受影响的原生路径另跑一次 `--context --native`：**13/13 PASS**（5 类 NOT RUN），`citation-quote-navigation-on-frozen-revision` 仍为 `highlighted`、`currentPageNumber: 1`、无库写入。仍未运行：隔离官方登录、真实模型回答/停止、真实图像生成、真实库写入、签名公开发行。

### 2026-09-13 最终 0.4 宿主验收（真实宿主证据，scope-2026-09-13）

对象仍为 `c881ad0a…` 的最终 0.4.0a1 开发包；只用 `.zcr-dev/context/{profile,data}` 与合成材料，GUI 经 LaunchServices 完全分离启动、按完整 `-profile`/`-datadir` 核对后 `TERM`；未 `--live`、未登录、0 模型请求。证据目录（忽略）`.zcr-dev/verification/scope-2026-09-13/`。

| 运行 | 结果 | 与上一轮（`d33ab244…`，`scope-2026-09-12`）对照 |
| --- | --- | --- |
| `--context` | **16 executed / 16 PASS / 0 FAIL**，5 类 NOT RUN | 检查名、通过状态、NOT RUN 列表逐项相同；无新增/删除/翻转。**无回归** |
| `--context --native` | **12 executed / 12 PASS / 0 FAIL**，4 类 NOT RUN | 同上，逐项相同；**无回归** |

**新增有界宿主预检（driver 补充，不改变上述 16/12 检查）**

- 原生偏好设置面板：`pref-pane-registered-once-after-startup`（`pluginPanes` 中恰有一个 `zcr-prefpane-settings`，pluginID 为被测插件，src/scripts 落在已装 XPI 内，label 正确）、`pref-pane-window-mounts-real-form`（真实 `Zotero.Utilities.Internal.openPreferences('zcr-prefpane-settings')` 打开 Preferences 窗口，**沙箱脚本写到 `Zotero` 上的 pane 桥对片段内联 `onload` 可见**，面板挂载真实表单 15 个控件/6 个设置字段，无“不可用”提示，窗口正常关闭）、`pref-pane-no-duplicates-across-disable-enable`（禁用后 0 个、重新启用后恰 1 个，不叠加；无偏好面板相关错误日志）。三个独立会话均 PASS。仍不可验证：面板的暗色/亮色与键盘焦点的**实际视觉**（未截图、未目视），以及 `remove()` 与 Zotero 自身“插件关闭自动反注册”的隔离（1→0 只证明可观察终态，注册器逻辑由 `tests/zotero/preferences-registration.test.ts` 单元覆盖）。
- 论断溯源：`citation-quote-navigation-on-frozen-revision` 用生产 `nativeSourceNavigator` + `openSourcePage` 在冻结 revision 上实跑合成 quote（`quoteIsSyntheticFixture=true`、`modelProducedQuote=false`）：先移到第 2 页，再回到第 1 页且 `outcome=highlighted`；不存在的 quote 返回诚实 `unlocated`；`libraryWrite=false`、标注数不变。仍不可验证：点击真实模型回答里引用链接的完整路径（需要已授权真实模型输出逐字引用），列为 NOT RUN。

**诚实的失败**：`close-preserves-current-page` 在一次 `--context` 运行中 FAIL（关闭侧边栏后 `currentPageNumber` 不是 2）。该失败报告原样保留（`host-context-0.4.0a1-FAILED-close-preserves-current-page.json`），随后 4 次运行均 PASS（通过时为 `{"page":2}`），未复现，按间歇性页面位置问题报告，**未解决、也不宣称本轮新增代码导致**。（该问题已在上一节“阅读锚点竞态修复”中定位为 pdf.js 提交页与 `_location` 之间的真实竞态并修复；此处保留当时的原样记录。）

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
| 设置/偏好设置窗口：preferences-*、workspace-store | 原生面板注册/清理、面板端口与快照写入、侧边栏去重已有代码与单元；**2026-09-13 已在真实宿主预检：注册身份正确、真实 Preferences 窗口能挂载面板（沙箱桥对片段可见）、禁用/启用不叠加、无错误日志**；**面板文案已随 store 的 `uiLanguage` 本地化，并在真实 Preferences 窗口实测双向切换（zh：图例 `对话`、store 读回 `zh`、六个内置 skill 的 id/名字逐字不变；切回 en：`Chat`、store 回 `en`）**。仍缺面板的中文**视觉**（字体回退、暗色/亮色、键盘 Tab）、打开窗口时的真实 store 并发，以及片段挂载前占位与“插件未运行”告警的英文（那时没有可读 store，无持久化语言可用） | F |
| 论断溯源：reader/locate、reader/source-highlight、reader-policy | 冻结 revision 校验、逐字引用定位与临时高亮导航、诚实 miss、无库写入已有代码与单元；**2026-09-13 已在真实宿主用生产 `nativeSourceNavigator`+`openSourcePage` 以合成 quote 实跑：回到引用页 `highlighted`、缺失 quote 诚实 `unlocated`、无库写入**；仍缺真实 Gecko 高亮**视觉**、长引用真实定位质量、以及真实模型是否输出逐字引用（点击真实回答链接的完整路径未验） | F |
| 安装/登录/发行/性能 | 项目已按 MIT 许可并在包内包含 `LICENSE`；本轮实测 `package:dev`/`verify:artifacts`。官方新登录、真实输出/停止/在途恢复、无 Node/下载隔离、长时压力、完整原生视觉矩阵、公开签名发行均未完成；本轮已复现 clean HEAD 重建（见上） | F |

**下一条可执行任务（含本轮新增）**：`--context` 已能程序化打开真实偏好设置窗口、确认 `Zotero Codex Reader` 面板挂载与禁用/启用幂等，并在该窗口内实测面板文案随 store 语言双向切换；`close-preserves-current-page` 的间歇性丢失已定位为 pdf.js 提交页/位置之间的真实竞态并修复，驱动另有 `reopen-keeps-current-page` 守住“关闭再打开仍回到同页”。剩余的是**目视**核对面板（中文/英文、暗色/亮色、键盘 Tab、保存与导出失败提示）与真实 Gecko 临时高亮的**视觉**表现，需人工对照；随后在用户通过官方流程登录的隔离 profile 中，仅用合成材料验证“无需选区提问＋跨页定义＋More details＋停止＋模型设置切换”和真实图像生成（含真实模型回答里引用链接的点击路径）；随后用真实宿主复核最终 0.4 XPI 的原生任务/获取 UI，再按 F 的门槛处理升级/回退、无 Node 安装与公开签名发行。本轮未调用真实模型，不能把过去限额日期当作现在的阻塞证据。

人工试用：按 development 的 `--context --acceptance` 方式运行，移除自动驱动再使用；保留合成文献和已保存会话；未发送草稿目前仅在插件寿命内保留，重启不会恢复。无需 Node/CLI 的最终用户安装体验仍等待发行验收。

### 2026-09-13 原生偏好面板简化：单个 Codex 指令框、只保留 annotate、历史全选删除、去掉 storage/archive 与说明文字（代码 + 单元证据）

owner 逐段拍照反馈后的面板简化，均为代码 + 单元证据；未跑宿主测试、未调用真实模型、未改 `manifest.json`（版本仍 `0.4.0a3`）。

- **Item 1 指令**：`Research preferences` 的六个控件（`language`/`detail`/`mathematics`/`background`/`citationStyle`/`annotationStyle`）收敛为 Codex 形状的一段：标题 `Codex instructions`、一行说明、一个多行文本框 + `Save`。文本框复用**已存在**的 `background` 字段（不新增 shape）；其余五项仍是记录的一部分，保存时按存储原样回写，并继续随冻结的 `workflow.preferences` 发送。`Research profiles` 区块整块移除 UI，**数据保留**：磁盘上的 profile 不删、不裁剪、不迁移，面板只是不再渲染。`Export preferences` 保留（仍如实导出存储的 `preferences` + `profiles`，是查看隐藏字段的唯一出口），并移到面板级操作行，不再暗示只导出指令。请求链路本就把整个 `Personalization` 合进 `SendInput.workflow.preferences`（`presenter.frozenWorkflow`），因此指令此前已在发送；新增行为测试断言改动文本框后普通提问的 `sent[0].workflow.preferences.background` 随之改变。
- **Item 2 workflow 列表**：`Installed workflows` 只列出 `builtin-annotate`（`OFFERED_BUILTIN_SKILLS`，可逆：把 id 加回集合即恢复），owner 自己的 user/imported workflow 仍列出。**只撤列表项、不动定义与默认路径**：六个 builtin 定义仍在记录里、仍 `enabled`；普通提问的 draft `skillId: null`，根本不带 workflow。`WorkflowKind` 联合类型未改（持久化记录与导入 skill 仍按 `read | annotate | acquire | diagram` 校验）。代价：面板不再提供 `read`/`derive`/`compare`/`acquire`/`diagram` 的启用开关；侧边栏 `/` 菜单是另一个界面，本轮未改。
- **Item 3 历史**：`Chat history` 一段重写——每行一个对话、标题只出现一次、`Search chats…` 只作为输入框自身名称（`aria-label` + placeholder）、`Paper` 与搜索并排但不再被拉伸、批量操作只在有选中时才出现、新增全选（只覆盖实际渲染的最多 200 行，被截断时明说 200/总数、计数为“实际选中数”）。删除是唯一的移除路径：确认语点名数量并声明永久，`unfinishedWork` 的对话被拒绝并说明，不静默跳过。
- **Item 3 storage 全链路删除**：`HistoryStorageStop`/`HistoryStorageChat`/`HistoryStorageReport` 契约、`validateHistoryStorageReport`、core `isHistoryStorageReport`、`workspace/history-storage.ts`、`measureRecords`/`readStorageReport` 端口与 service/entry/index/面板接线、`Calculate size` 动作与全部 storage 文案及 locale key、对应测试（`preferences-history-storage.test.ts`、`preferences-storage-wiring.test.ts` 改为 `preferences-live-models-wiring.test.ts`）全部删除。**测量被移除，历史数据本身一字未动**。
- **Item 3 archive 概念**：面板侧 archive（归档/恢复、范围筛选、`archivedAt` 徽标）移除；`isHistoryListing` 仍按 `activeCount`/`archivedCount` 整表校验，`archivedAt` 记录仍随 `listing()` 两个 scope 合并后**作为普通对话列出、可像普通对话一样删除**，字段从未被改写。**侧边栏的 Archived 段本轮未移除**：它由 `chat/presenter.ts`（不在本 worker 可写白名单）负责把 `history` 与 `archivedHistory` 分区，若只改 `view.ts` 会让 `archivedAt` 对话从侧边栏消失，违反“必须仍可见”的硬约束；因此改为交付 `chat/presenter.ts` + `chat/view.ts` 的补丁文本，等 owner/协调者一并应用。core 的 `HistoryManager.setArchived`/`HistorySource.setConversationArchived` 因侧边栏仍在使用而保留，待侧边栏补丁一并清理。
- **Item 4 说明文字**：删掉 `PDF text` 的“Changes affect future requests…”整句、历史段长引言（已随 archive 移除）、storage 说明、以及模型段原来的长免责声明；模型来源说明**压缩为一行**保留（“这是随包目录，并非你账户的实时权限；GPT-5.3-Spark 来自运行时，报告后才出现；实际发送的是确切 id”）。删除确认与 `unfinishedWork` 拒绝属操作后果，保留。
- **门禁**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **966 passed / 76 files**（较上轮 977 少 11 条，全部是被删除的 storage/archive/五字段相关用例；净新增覆盖：面板单指令框与 profile 保留、only-annotate 与“普通提问不带 workflow”、历史全选/截断/未完成拒绝/archivedAt 当普通对话、指令进入请求 payload、live 模型接线改名）。失败先行的观察：把面板/locale/历史段临时换回改动前版本后，新用例分别以 `expected [ 'builtin-read', … ] to equal [ 'builtin-annotate', … ]`、`expected <input data-zcr-pref="preference-language"> to be null`、`Missing [data-zcr-history-id]` 失败，恢复后全绿。
- **未验证**：上述均为代码 + 单元证据。真实宿主与真实模型未跑；面板中文/CJK 视觉、`Codex instructions` 在真实 Gecko 下的行高与换行、侧边栏 archive 移除后的真实历史popover 行为都仍需宿主目视。

### 2026-09-13 开发 XPI 安装流自校验与脚枪文档（代码 + 单元 + 只读真实 profile 观察；**真机重启用例未跑**）

把“把开发 XPI 装进真实 Zotero profile”从手工多步（ps 核对 → cp 备份 → cp 新包 → 手记版本/SHA → 手动设/撤 `extensions.startupScanScopes` → 人工重启核对）收敛为一条自校验命令；操作与机制小节见 [development](development.md)。

- **已有 vs 新增**：`.zcr-dev/` 隔离树生命周期工具 `scripts/install-lifecycle.mjs`（`verify:install`）已提供 XPI 备份、`readXpiIdentity`、SHA-256 与忙碌检测；本轮**新增** `scripts/install-dev-xpi.ts`（`npm run install:dev -- plan|install|check|revert|rollback`）并复用上述原语（从 lifecycle 导出 `SUBJECT_ID`），未另起并行机制。`tsconfig.json` 打开 `allowJs`、纳入 `scripts/**/*.ts`；`package.json` 增脚本。
- **为什么是脚本而不是文档化命令**：a3/a4 的 owner 安装是多步且易错的流程，其记录明确写了“未设临时 `extensions.startupScanScopes`（版本与 mtime 已变，判定不需要）”——正是会静默留下陈旧版本字符串、且没有可还原记录的路径；因此判为脚本更安全。
- **脚枪的只读真实证据（owner profile `mi2zhr2s.default`，PID 50356，未重启）**：`extensions.json` 报告 `0.4.0a2`（文件 mtime 2026-09-13T06:10:43Z），而磁盘 `extensions/{8a5f5bde-…}.xpi` 为 92,661,563 bytes / SHA-256 `5a6bb161…`（与 `dist` 的 0.4.0a4 产物逐字节一致），`lsof` 显示 PID 50356 以 inode 59247502 持有该文件，`prefs.js` 无 `startupScanScopes`。即“执行的是 a4、登记的是 a2”。这些是**只读观察**；机制出处（`omni.ja` 的默认 pref、`XPIProvider.sys.mjs`、`plugins.js`）在 development 小节引用。
- **本轮对 owner profile 只读**：只执行一次 `install:dev plan --profile <owner profile> --xpi dist/zotero-codex-reader-0.4.0a4-dev.xpi`（结果 `already-installed`），前后 `prefs.js`/`extensions.json`/`addonStartup.json.lz4`/XPI 的 size+mtime 完全一致，`user.js` 与工具记录文件始终不存在；未重启、未启动第二个实例、未改任何偏好。
- **门禁**：`npm run typecheck` PASS；`npm run lint` PASS；`npm run test:unit` **988 passed / 77 files / 0 skipped**（此前 970/76）。新增 `tests/build/install-dev-xpi.test.ts` 18 条：纯逻辑（pref 解析与杠杆规划、`lsof`/`ps` 解析、备份命名、参数解析）+ 临时 profile 本地流（plan 不写盘、install 的备份+SHA+记录+杠杆、`already-installed` 幂等、运行中/外来 `user.js`/缺 profile 的拒绝、`--rescan never`、check 的实测通过/闲置 `failed`、rollback 还原并备份旧包）。
- **未证明（不得当成通过）**：真机端到端仍需**一次目标 profile 的重启**才能证明——`install` 后启动该 profile 的 Zotero 一次再 `check`，才能观测“运行实例持有已安装文件 + `extensions.json` 版本追平”。本轮只跑 dry-run 与临时目录 + 注入式 deps（`lsof`/`ps` 为合成输出），故 `check` 的真实 `lsof`/`ps` 路径和“真实 Gecko 确实按杠杆重扫”**未在真机验证**；owner 实例 mid-acceptance，按 owner 决定未重启。

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
