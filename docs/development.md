# 开发、测试与发行

当前 npm 工作区版本、Zotero manifest 版本和最终 XPI 身份不是同一个概念。开发期间 manifest 可能先升为候选版本；只有 `package:dev` 生成、`verify:artifacts` 通过并由 progress 记录 hash 的文件才是已验证产物。不要从文档中的旧版本号猜当前文件名。

目标环境：Node 24.x（`.nvmrc` 固定具体版本）、npm 11.x、macOS Apple Silicon、Zotero 9.0.6。Node 只用于构建与测试，发布 XPI 运行时不依赖系统 Node。

四份文档职责：产品行为见 [zotero-chatgpt-user-flow](zotero-chatgpt-user-flow.md)，模块契约见 [module-design](module-design.md)，本文件只写操作，实际结果见 [progress](progress.md)。

## 本地门禁

```sh
npm ci
node scripts/runtime-prepare.mjs
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

`runtime-prepare.mjs` 只把 manifest 锁定的官方 Codex 0.154.0 darwin-arm64 归档按 SHA-256 准备到忽略目录。它不替换系统 CLI，不读取或迁移其它客户端认证。缺少真实运行资产时打包失败，不能用测试 fixture 冒充。

| 命令 | 能证明什么 |
| --- | --- |
| `npm run typecheck` | TypeScript 边界一致 |
| `npm run lint` | 静态规则通过 |
| `npm run test:unit` | contracts/core/DOM/host doubles 回归；不证明真实 Zotero 或模型 |
| `npm run package:dev` | 生成当前候选 XPI、运行资产与 `dist/SHA256SUMS` |
| `npm run verify:artifacts` | 白名单文件、hash、许可、无 Node 运行导入和无私有记录 |
| `npm run release:dry-run` | 本地发行计划；不上传、不建 tag、不发布 |

每个有意义行为先跑能抓住该故障的红灯回归，再实现并只扩大必要检查。工作树可能有其它负责人改动；一文件一个写入负责人，不 reset、checkout、git clean 或改写历史。

## 隔离宿主树

所有产品/原生/服务验收只使用仓库内明确命名的 `.zotero-chatgpt-dev/` 子树和合成资料。日常 Zotero、已有开发 profile、其它 Codex 会话和用途不明目录不在测试范围。

启动前必须核对完整 `-profile` 和 `-datadir`。自动停止只针对自己启动且参数完全匹配的进程；禁止 `killall`。停止前只读该隔离 profile 的非认证 conversation 记录确认没有 active request；不读取、复制、截图或删除 `account/`、cookie、token、密码、验证码或其它认证材料。

```sh
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote \
  -profile "$PWD/.zotero-chatgpt-dev/context/profile" \
  -datadir "$PWD/.zotero-chatgpt-dev/context/data"
```

非 live 的 context 运行使用明确 `--run-id <短名称>`；其它阶段在重跑前把报告归档到带时间/用途的名字。fixture 在运行时生成随机唯一 token，真实服务验证必须让回答引用该 token。prepare 脚本把实际 driver 源 hash 写入配置和报告；报告的 `driverSourceHash` 必须与本次工作树匹配，避免旧 profile/XPI 缓存的 driver 产生假 PASS。失败报告不能被后续运行覆盖。

## 宿主阶段

准备命令与同一个专用 Zotero 启动命令配合使用：

| 准备命令 | 范围与副作用 |
| --- | --- |
| `node scripts/prepare-host-test.mjs --context --run-id <id>` | 本地 PDF、dock、模式、会话、上下文、偏好和安全边界；默认不发模型请求 |
| `node scripts/prepare-host-test.mjs --context --native --run-id <id>` | 工作树原生适配器 + 合成条目/PDF；真实 Zotero API 写入合成标注、标签、集合并撤销；不调用模型 |
| `node scripts/prepare-host-test.mjs --context --live` | 在 context 合成 PDF 上调用已登录 Codex；会消耗实际额度；该组合不接受 `--run-id` |
| `node scripts/prepare-host-test.mjs --context --live --live-core-flows --login-wait-seconds <0..3600>` | 操作者完成一次官方 Agent 登录后，走自然语言高亮和整理的真实模型候选、review、原生写入、读回、冲突撤销 |
| `node scripts/prepare-host-test.mjs --embed` | 官方 `chatgpt.com` browser/actor 比较探测；不自动登录，不应读取认证或回答正文 |
| `node scripts/prepare-host-test.mjs --embed --web-live` | 官方页面 actor 的真实可见提交路径；不能与 URL/watch/comparison probe 参数合用 |
| `node scripts/prepare-host-test.mjs --embed --watch-seconds <n>` | 比较探测后保留人工页面操作观察窗口；只记白名单网络/console/surface 状态 |
| `node scripts/prepare-host-test.mjs --live-model` | 只读实际 Agent 模型目录；不发问题；登录等待按该阶段内置流程处理 |
| `node scripts/prepare-host-test.mjs --context --acceptance --run-id <id>` | 无自动 driver 的人工试用 |
| `node scripts/prepare-host-test.mjs --s5` | 进程中断与本地恢复隔离阶段 |
| `node scripts/prepare-host-test.mjs --s6` | virgin/升级/回退隔离阶段 |

参数组合由 `scripts/host-test-stage.mjs` 拒绝非法情况：`--native` 不与 `--live`/`--acceptance` 合用；`--live-core-flows` 必须和 `--context --live` 同用；`--login-wait-seconds` 只用于声明的登录等待阶段；不同主阶段互斥。

`--native` 的候选来自 driver 明确写死的合成输入，因此能证明 native API、账本和撤销，不能证明真实 Codex 会选择正确原文。`--live-core-flows` 才可能覆盖真实模型候选，但只有整轮报告 PASS 才能宣称该次端到端通过。局部检查 PASS 不能覆盖同一报告中的 fixture/driver FAIL。

`--embed` 的页面可见、actor 注册和消息单测不能证明真实 ChatGPT 提交。必须在同一隔离 profile 中完成官方登录，并以随机 PDF token 验证一次真实回答；若 trusted scheme、about:blank、CSP、Cloudflare 或站点 DOM 阻断，保留 FAIL/BLOCKED，不关闭安全机制绕过。

自动 driver 结束后先退出该实例，再准备 `--acceptance`。不要在 driver 运行时用 CUA 或人工同时操作窗口。

## 登录与认证

Agent 登录只在专用 profile 通过官方浏览器流程由操作者本人完成。driver 可以等待 `--login-wait-seconds`，不能点击登录、输入密码/验证码或读取 auth 文件。ChatGPT 页面登录同样由操作者在 embed 专用 profile 完成。

不得为“干净环境”删除已命名测试 profile 的认证目录。需要无登录状态时创建新的明确 profile；需要保留状态时复用原 profile。测试准备只清理由脚本拥有、用途明确且可重建的 driver/fixture 文件。

## 产物与安装

以当前 `packages/zotero/manifest.json`、`dist/SHA256SUMS` 和 progress 为准选择 XPI，不复制旧文档文件名：

```sh
npm run package:dev
npm run verify:artifacts
npm run verify:install -- build-info --xpi <dist/current-dev.xpi> \
  --out .zotero-chatgpt-dev/build-info.json --json
```

安装到真实 profile 使用：

```sh
npm run install:dev -- plan    --profile "<profile>" --xpi "<xpi>"
npm run install:dev -- install --profile "<profile>" --xpi "<xpi>"
npm run install:dev -- check   --profile "<profile>"
npm run install:dev -- revert  --profile "<profile>"
npm run install:dev -- rollback --profile "<profile>"
```

`plan` 只读。`install` 在目标 profile 运行时拒绝，先备份旧 XPI，再核对落盘 SHA；只在需要 profile scope 扫描时管理带标记的单一 `user.js` 偏好。它不手改 `extensions.json`/`addonStartup.json.lz4`。`check` 同时核对运行进程打开的 inode/size 与退出后登记版本；运行中无法测量登记值时报告 `not-measured`，不能假 PASS。

公开 push、GitHub Release、签名、更新频道、付费服务、真实文献库操作和日常 profile 安装不由上述命令自动授权。最终发布还需干净 checkout 重建、最终 XPI 专用宿主复验、无 Node 环境、升级/回退和支持平台证据。

历史命令与旧版本证据可从 Git 基线 `3ea1070` 查询；当前文档不再维护逐版本流水。
