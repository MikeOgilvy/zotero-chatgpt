# 开发、测试与发行

从仓库根目录执行，Node **24.x** / npm **11.6.1**，版本以 package.json、.nvmrc、manifest 为准。macOS Apple Silicon 是当前宿主验证目标。编辑器可用 Cursor + 官方 Codex 扩展；同一文件单一写入负责人，不自动提交或推送。

## 从 checkout 构建

```sh
npm ci
node scripts/runtime-prepare.mjs
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

runtime-prepare 只从 `runtime/manifest.ts` 固定的官方归档获取、校验二进制到忽略的 `.zcr-dev/runtime-cache/`。不更换系统 CLI，不操作凭据。build 缺运行资产时明确失败，不用 fixture 假装正式包。

| 实际 npm script | 作用 |
| --- | --- |
| `build` / `dev` | esbuild 输出 build/dev；dev 监听，不自动重置或重载 Zotero |
| `typecheck` / `lint` / `test:unit` | 类型、ESLint、Vitest；包含模拟协议/DOM和构建行为，均不证明模型/宿主通过 |
| `package:dev` | build 后生成 dist/ 中按 Zotero manifest 版本命名的完整开发 XPI 和 SHA256SUMS |
| `verify:artifacts` | 校验 XPI/目录白名单、runtime hash、许可证、无 Node 导入/账户/论文文件 |
| `verify:install` | 安装生命周期 CLI；必须提供子命令（prepare/seed-records/upgrade/rollback/extract/updates-json/build-info），参数示例见下方（没有 --help 入口） |
| `release:dry-run` | 本地发行计划，githubRelease=null；拒绝 publish/upload，不公开发布 |

没有 test:live/test:integration 正式 npm script。当前 XPI 文件名为 `dist/zotero-codex-reader-0.3.0a1-dev.xpi`；不要在文档多个位置复制易过期摘要，实际 digest 读取 dist/SHA256SUMS 和 [progress](progress.md)。

用实际 XPI 生成本地发行身份（不会启动 Zotero）：

```sh
npm run verify:install -- build-info --xpi dist/zotero-codex-reader-0.3.0a1-dev.xpi --out .zcr-dev/build-info.json --json
```

## 隔离宿主与人工试用

**所有宿主操作仅 `.zcr-dev/`，不得使用正常 Zotero profile/library。已有开发 profile 也可能含私有资料，不能清空、批量导出或读取认证文件。** 准备前关闭目标专用实例，保留正常 Zotero 运行。

```sh
npm run package:dev
node scripts/prepare-host-test.mjs --acceptance
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote -profile "$PWD/.zcr-dev/profile" -datadir "$PWD/.zcr-dev/data"
```

`--acceptance` 安装完整本地 XPI、刷新合成 reading.pdf，并移除自动 driver；不会主动发送。仅打开 `.zcr-dev/fixtures/reading.pdf` 的合成条目试用。目标行为见 [产品规格](zotero-codex-user-flow.md)。官方网页登录保留在浏览器中，不复制 token；测试账户最新可用性须查询协议，不能把历史限额日期当现状。

## 当前 PDF 宿主回归

```sh
node scripts/prepare-host-test.mjs --context
/Applications/Zotero.app/Contents/MacOS/zotero \
  -no-remote -profile "$PWD/.zcr-dev/context/profile" -datadir "$PWD/.zcr-dev/context/data"
```

该模式使用独立 context 树，只创建合成主文与补充 PDF；验证本地全文/页码范围/来源跳转/标题会话/草稿/附件切换/30 次性能样本，不调用模型。报告位于 `.zcr-dev/context/host-report.json`。不得将新的 scope 测试改成正常 profile。

人工试用本轮结果：先关闭专用 context 实例，再执行 `node scripts/prepare-host-test.mjs --context --acceptance`，然后用上方同一 profile/data 启动命令打开。该组合保留合成库和已保存会话记录并移除自动驱动；不会改动既有 `.zcr-dev/profile`。登录需用户在官方浏览器完成，不能从别的 profile 复制认证。

## 自动宿主验证

`node scripts/prepare-host-test.mjs --s2|--s3|--s4|--s5|--s6` 安装自动 driver。默认不带参数也会装 driver，不能当人工试用入口；运行期间不要操作测试窗口。脚本/fixture 的 S 命名为可执行验证标识，不再是产品计划。

- s2/s3 在已登录时会发合成请求；`--login` 会启动官方授权。只用合成资料，额度拒绝不是模型回答。
- s4 验证布局/目录/选区，不发模型；s5 仅终止自己专用 profile 的 Codex 进程并检查恢复，含明确 fixture 的 uncertain 记录，不发模型。
- s6 默认 `.zcr-dev/s6-virgin/{profile,data}`，用 AddonManager 安装本地 XPI，不发模型。两个版本用 `--s6 --upgrade-xpi <local-new.xpi> --rollback-xpi <local-old.xpi>`，目标 `.zcr-dev/s6-upgrade/`，不得使用已登录树。
- s2–s5 报告 `.zcr-dev/host-report.json`；s6 报告在所选专用子树。每次记录版本、XPI sha、设备、运行路径与 PASS/FAIL/NOT RUN；旧报告不自动适用于新 build。
- driver 运行后先 `--acceptance` 再人工试用。更改 bootstrap/原生注册/进程代码须生命周期重载，watch 不代表热更新。

## 存储、恢复与诊断

[架构文档](module-design.md) 定义唯一数据/迁移契约。普通记录备份只处理插件 records；认证 account/ 不纳入备份/诊断/测试材料。损坏记录保持原样，未知 schema 不重置为空。未实现跨设备同步。复制诊断只用程序白名单；截图/报告用合成资料。

## 发行

当前 npm 0.3.0-alpha.1 / Zotero 0.3.0a1 是本地开发预览，update_url 为 zcr-dev.invalid 占位，**未启用更新频道**。runtime/licenses 与构建第三方许可必须保留；项目自身 LICENSE 尚待作者决定，不能替作者授权开源。

发行前必须：干净 checkout 重建 → verify:artifacts 与 SHA256SUMS → 正式许可/平台资产审查 → 从真实下载包在无 Node/CLI 机器原生安装登录提问 → 下载隔离属性/签名、更新保留任务与数据、回退/损坏、多窗口、压力及隐私验收。未提交工作树副本重建不叫 clean HEAD；本地 XPI 安装不叫公开下载验收。Intel/Windows/Linux 未经同等宿主验证不能进支持表。

`npm run release:dry-run` 仅可审查本地计划。push、公开上传、Release 和付费新服务必须另有明确授权；本次授权止于可逆本地开发/测试。
