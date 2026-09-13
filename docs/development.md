# 开发、测试与发行

当前开发版本是 npm **0.4.0-alpha.1** / Zotero **0.4.0a4**。从仓库根目录执行，Node **24.x**（`.nvmrc` 为 24.11.0）、npm **11.6.1**；最终身份以 package.json、manifest 和实际 XPI 为准。当前目标平台是 macOS Apple Silicon / Zotero 9.0.6。

四份权威文档分别负责[产品行为](zotero-codex-user-flow.md)、[架构与数据契约](module-design.md)、本文的开发操作、[进度与验收结果](progress.md)。不要再复制旧阶段计划或把单元、宿主、模型、发行证据混写成一个 PASS。

## 构建与本地验证

```sh
npm ci
node scripts/runtime-prepare.mjs
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

`runtime-prepare.mjs` 仅在固定运行资产需要准备时执行：从 manifest 指定的官方归档获取并校验 Codex 0.154.0 到忽略的 `.zcr-dev/runtime-cache/`。它不替换系统 CLI，也不操作认证。缺少真实运行资产时构建失败，不用测试 fixture 冒充发行包。

| 命令 | 作用与证据边界 |
| --- | --- |
| `npm run build` / `npm run dev` | 构建或监听工作树；不自动重置 profile，也不保证已打开 Zotero 热重载 |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run test:unit` | 协议、存储、DOM、范围、任务和构建等回归；宿主替身或模拟回答不是真实模型证据 |
| `npm run package:dev` | 生成完整开发 XPI、固定运行资产及 SHA256SUMS |
| `npm run verify:artifacts` | 检查发行白名单、hash、许可、无 Node 导入及私有记录 |
| `npm run verify:install -- <command>` | 本地安装生命周期工具；需要明确子命令，没有通用 `--help` 入口 |
| `npm run install:dev -- <command>` | 真实 Zotero profile 的开发 XPI 安装与自校验（`plan`/`install`/`check`/`revert`/`rollback`）；见下节 |
| `npm run release:dry-run` | 检查本地发行计划，githubRelease=null；不发布或上传 |

当前目标文件名为 `dist/zotero-codex-reader-0.4.0a4-dev.xpi`。不要在文档多处手写 digest；以 `dist/SHA256SUMS`、实际包身份和 progress 为准。

```sh
npm run verify:install -- build-info \
  --xpi dist/zotero-codex-reader-0.4.0a4-dev.xpi \
  --out .zcr-dev/build-info.json --json
```

非平凡行为先观察有意义的失败回归再实现，只扩大受影响检查。普通文档/配置直接核对，不写源码字符串测试。保持一文件一负责人，保护已有未提交改动；本地提交遵循当前会话授权，不自动推送。

GitHub Actions 只覆盖上述非宿主命令：`ci.yml` 的 `check` 作业跑 `npm ci`/`typecheck`/`lint`/`test:unit`，`package` 作业跑 `runtime-prepare`/`package:dev`/`verify:artifacts`；`release.yml` 是手动触发的同一组检查加 `release.mjs --dry-run`。Node 版本一律取 `.nvmrc`。宿主 GUI、原生标注、升级/回退和 `--live` 模型检查不在 CI 内，因为它们需要 macOS Zotero 界面、专用 profile 和已授权账户；工作流没有任何 upload/publish/tag 步骤。

## 专用 context 树

**当前产品/原生功能验收只用 `.zcr-dev/context/{profile,data}` 和合成材料。** 安装生命周期测试另用下述 s6 隔离树；所有目标都必须是经核对的 `.zcr-dev/` 专用子树。正常 Zotero 可以继续运行。已有 `.zcr-dev/profile`、旧测试账号和其他 Codex 会话都不能被清空、复制认证或当临时垃圾处理。

更换 driver、安装包或准备模式前，先退出目标专用实例。自动管理进程时必须用 ps 核对完整 `-profile` / `-datadir` 参数；只看 runner.pid 或进程名不够。停止前只读该 profile 的 `records/conversations/*.json`（排除 `.source.json`）确认没有 activeRequestId；不读 account/auth。禁止 killall、清 profile、git clean/reset 或 blanket rm。

人工试用使用明确的无 driver 模式：

```sh
npm run package:dev
node scripts/prepare-host-test.mjs --context --acceptance
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote -profile "$PWD/.zcr-dev/context/profile" \
  -datadir "$PWD/.zcr-dev/context/data"
```

该准备过程安装本地完整 XPI，刷新合成主文和补充 PDF，移除自动 driver，保留已有合成库和记录。打开助手本身不发模型请求。登录必须在此专用实例通过官方浏览器流程完成，不从日常 profile 或其他客户端复制 token。

## 自动宿主模式

以下模式互斥；选好一种准备后，用上方同一条专用启动命令运行。**准备脚本默认也会装自动 driver，不带参数不代表人工模式。**

| 准备命令 | 会自动执行的内容 |
| --- | --- |
| `node scripts/prepare-host-test.mjs --context` | 当前 PDF 本地提取、页面标签/范围、原生 UI/会话/附件切换及合成性能样本；重启会话后还预检原生偏好设置面板（注册身份、真实打开 Preferences 窗口并挂载面板、禁用/启用不叠加面板）且不写业务记录；不发模型请求 |
| `node scripts/prepare-host-test.mjs --context --native` | 将工作树生产模块编入独立测试 driver；新建合成条目、PDF、collection 和标注，执行审批/撤销/冲突、SHA、截图、后台引用；并对冻结 revision 用合成 quote 实跑临时高亮导航（不写文献库）；还会尝试固定公开 DOI 的**未保存网络元数据预览**，不调用模型或下载 OA PDF |
| `node scripts/prepare-host-test.mjs --context --live` | 本地检查后对合成 PDF **真实调用已登录账户的模型**，检查回答来源及停止/完成竞态；会消耗实际可用额度，执行前必须有对应授权 |
| `node scripts/prepare-host-test.mjs --context --acceptance` | 无自动 driver 的人工试用 |

`--native` 不与 `--live` 或 `--acceptance` 合用。`--live` 不等于新登录测试，也不自动证明图像生成；实际模型、回答、取消结果和能力均以当次报告为准。脚本可优先选择目录中存在的 Spark，不通过改推理强度伪造速度档位，不因旧限额日期推断当前账户状态。

context 报告写入 `.zcr-dev/context/host-report.json`。每次重跑前归档明确的失败报告；记录 subject 版本、包 hash、工作树/driver 来源、设备和实际执行范围。不要覆盖失败后只留下 PASS。native driver 直接导入工作树适配器，装着旧 subject XPI 时的通过不能当成新包 UI 验收。已有工作树 native API 证据、最终包验证及未运行项统一记在 [progress](progress.md)。

自动 driver 完成后，先退出该专用实例并重新准备 `--context --acceptance`，再进行人工交互。不要在自动测试正在运行时操作其窗口，也不要让 CUA 自动切回日常 Zotero 后继续操作。bootstrap、原生注册、跨 realm 适配或进程代码变更需要重新打包并完成宿主生命周期重载；watch 不是重载证据。

## 有针对性的恢复与安装测试

纯本地回归可只选择相关测试文件：

```sh
npm run test:unit -- tests/core/tasks.test.ts tests/core/reading-coordinator.test.ts
npm run test:unit -- tests/zotero/document-version.test.ts tests/zotero/reader-library.test.ts
npm run test:unit -- tests/runtime/generated-image.test.ts
```

保留的 `--s2` 至 `--s6` 是测试驱动标识，不是新的产品授权范围。s2/s3 在已登录时可能发合成模型请求，`--login` 会启动官方授权；s5 会管理自己启动的运行进程；s6 用独立 virgin/upgrade 树验证安装生命周期。运行前读相应 driver 与参数，不复用正常或用途不明的 profile。

```sh
node scripts/prepare-host-test.mjs --s6
```

需要两版本升级/回滚测试时，在已有明确授权下向 s6 同时传入 `--upgrade-xpi <本地新包>` 和 `--rollback-xpi <本地旧包>`；目标为 `.zcr-dev/s6-upgrade/`。驱动会先装旧包、用 `AddonManager` 升到新包、再回退，并检查版本切换、握手、仍为 signedOut、不生成与记录保留；随后在一个新建的合成附件上写入 schema 3 会话并重新打开，要求旧包**明确拒绝且不重写该记录**（`schema3-record-refused-without-rewrite-after-downgrade`）。该检查只证明“记录了的新 schema 会话被按版本拒绝且原文件保留”，不证明回退后连接状态仍为 ready，也不替代公开签名发行的升级验收。

历史注意：`834b7fc` 自身无法独立通过 `typecheck`（`tests/zotero/source-links.test.ts` 引用了当时 `DocumentRevision` 尚未提供的 `sha256` 字段）；其后的提交都可独立构建。历史不重写，`git bisect` 请以 `834b7fc^` 为已知良好基点或对该提交 `skip`。

存储/恢复测试必须覆盖旧 schema 1/2、当前 schema 3、缺失/损坏来源、哈希不匹配、请求与上游 item 关联、取消竞态、批次释放及 uncertain 不重发。兼容性机制见[架构文档](module-design.md)。备份与诊断只处理明确的非认证记录；不包含 account/、原始 stdio 或未经白名单过滤的日志。草稿、聊天、原生标注、缓存和退出登录有独立寿命，不能用删除其中一种代替停止另一种任务。

## 把开发 XPI 装进真实 profile（自校验）

**脚枪：换掉 profile 里已侧载的 XPI 后，*报告版本*会停在旧值，而*实际执行的代码*已是新包。** 装载不走登记：Zotero 的 `plugins.js` `_loadScope` 用 `loadSubScriptWithOptions(addon.getResourceURI() + 'bootstrap.js', { ignoreCache: true })` 从 XPI 现读 `bootstrap.js`；而 `about:addons` 与插件 `version` 来自 `extensions.json` / `addonStartup.json.lz4`，这两个文件经 `JSONFile` 以 `finalizeAt: AddonManagerPrivate.finalShutdown` 在**退出时**写入。因此换包后启动一次，`clientInfo.version`（`packages/core/src/index.ts`）与白名单诊断（`packages/core/src/sessions/service.ts`）仍是旧版本字符串。`pluginVersion` **没有功能闸门作用**：兼容性只看 `codexVersion !== '0.154.0'`（同文件），不要把它说成会拒绝加载。

**为什么单纯重启不解决**：编译默认是 `pref("extensions.startupScanScopes", 0)`（`/Applications/Zotero.app/Contents/Resources/app/omni.ja` → `defaults/preferences/zotero.js`）。同一 build 启动时 `XPIProvider.checkForChanges` 传 `aAppChanged === false`，`XPIStates.scanForChanges(ignoreSideloads)` 命中 `if (ignoreSideloads && !(loc.scope & startupScanScopes)) continue;`，直接跳过 profile 位置（`SCOPE_PROFILE = 1`），从不比较文件 mtime/size；启动也不调用 `AddonManager.getNewSideloads()`。只有一次**包含 profile scope 的扫描**才会让登记追上。

```sh
npm run install:dev -- plan     --profile "<profile 目录>" --xpi dist/zotero-codex-reader-0.4.0a4-dev.xpi
npm run install:dev -- install  --profile "<profile 目录>" --xpi dist/zotero-codex-reader-0.4.0a4-dev.xpi
npm run install:dev -- check    --profile "<profile 目录>"
npm run install:dev -- revert   --profile "<profile 目录>"
npm run install:dev -- rollback --profile "<profile 目录>"
```

- `plan` 只读：不写文件、不改偏好；`install` 在目标 profile 正在运行时拒绝执行（先退出该实例）。
- `install` 先把当前 XPI 备份为同目录 `{addonId}.xpi.zcr-bak-<UTC 时间戳>-<版本>`，记录其版本 + SHA-256，再把产物放到唯一路径，并复核落盘字节与产物 SHA-256 一致（不一致即失败，不报成功）。它**不**手改 `prefs.js`、`extensions.json`、`addonStartup.json.lz4`。若 `extensions.startupScanScopes` 尚不含 profile scope，它写一个受管 `user.js`（仅含这一条 `user_pref`，带标记）把下次启动的扫描扩到 profile；若 `user.js` 已存在但不是本工具所写，或 `prefs.js` 里有人故意设过非默认值，宁可直接拒绝并要人工处理。
- `check` **按测量**而非元数据：用 `lsof` 确认运行中的实例打开的正是已安装 XPI（inode + size 与磁盘一致），并读 `extensions.json` 的 `version` 对照产物版本。实例仍在运行时该文件保持上次退出值，故报 `not-measured` 而非假通过；空闲且版本落后就 `failed` 并给出 Config Editor 手动步骤。`check` 顺带推进杠杆还原：把受管 `user.js` 钉回默认，或当 `prefs.js` 从未落值时直接删除它。
- `revert` 只还原杠杆（不换包）；`rollback` 换回最近的 `.zcr-bak-*` 备份（同样先把当前包另存为备份）。所有子命令加 `--json` 输出结构化结果。

`install:dev` 面向真实 profile；`.zcr-dev/` 隔离树的生命周期测试仍用 `verify:install`，两者不互相代替。

## 人工登录的模型目录实测

`--live-model` 是与 `--context` 并列的独立阶段，只在 `.zcr-dev/live/{profile,data}` 合成树上测量运行时实际解析出的模型目录：选择器中的模型 id、每个可选模型的推理强度档位与速度开关、以及当前选中的模型。报告写入 `.zcr-dev/live/host-report.json`，只含模型 id 与非识别性目录元数据。

该阶段**不发任何模型请求**：没有 `turn/start`、没有问题、没有图像生成，也不读取、复制、记录或截图任何凭据文件。它必须有操作者在场，且只做**一次**由人完成的官方登录——driver 只等待侧栏变为 `signedIn`，绝不点击登录按钮、绝不输入凭据、绝不代替人走 OAuth 流程；等待超时（默认 30 分钟）时以 `login-not-completed` 结束，而不是伪造通过。driver 只被打进 `.zcr-dev/live/` 的隔离测试插件（`zcr-host-test@local`），**从不进入产品 XPI**。

```sh
node scripts/prepare-host-test.mjs --live-model
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote -profile "$PWD/.zcr-dev/live/profile" \
  -datadir "$PWD/.zcr-dev/live/data"
```

`--live-model` 与 `--context`、`--native`、`--live`、`--acceptance` 互斥，也不在 CI 内（需要 macOS GUI 与操作者本人授权）。阶段名与 `.zcr-dev/live/` 树的映射由 `tests/build/host-test-stage.test.ts` 固定；具体模型、档位与账户能力一律以当次报告为准。

## 发行边界

0.4.0a4 是开发预览，`update_url` 仍为 zcr-dev.invalid 占位，未启用公开更新频道。固定 runtime 及第三方库/字体的许可必须随资产保留；项目自身按 MIT 许可发布，正文见根目录 `LICENSE`，`package.json` 的 `license` 字段与之一致。Intel、Windows、Linux 未经过同等验证，不能进入已支持平台声明。

发行前还需以实际最终包完成干净 checkout 重建、无 Node 环境、下载隔离属性、长期性能和多窗口等验收；隔离官方登录、真实输出与图像生成仍未完成。0.3→0.4→0.3 的升级保留记录与回退安全拒绝已在 s6 隔离树验证（见 progress），但这不等于签名公开发行的升级验收。**目前不能从工作树 native 驱动通过推断最终 0.4 XPI 的原生 UI 接线、真实图像生成或公开发行已通过。** 所有结果与未完成门槛只在 progress 更新。

推送、公开 Release、发布站点、启用付费新服务和操作真实文献库不在本地开发命令的隐含授权中。`release:dry-run` 只是可审查的本地计划；开发分支使用 `codex/` 前缀，实际提交/发行继续遵循当前会话授权。
