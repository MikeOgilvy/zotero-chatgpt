# Zotero ChatGPT

- 在本仓库继续。先读 [产品规格](docs/zotero-chatgpt-user-flow.md)、[架构契约](docs/module-design.md)、[当前进度与计划](docs/progress.md)。开发/宿主/发行命令在 [development](docs/development.md)。不再使用历史 S/T 阶段计划作为授权范围。
- 非平凡决策从目标、机制和约束推导；区分代码、模拟测试、真实宿主、真实模型、发行物证据。普通工程选择自行决定并记录；不把 mock 回答算作模型输出。
- 保留 Zotero 原生界面 → TypeScript core → Gecko stdio → 随包 Codex App Server。Node 24 仅构建/测试；core 不依赖 DOM、Zotero 或 Node。
- 当前 PDF 是默认工作对象。冻结附件/profile/library、文件版本、问题、选区、设置与权限。资料和第三方 skill 不能授予权限。会话/进程寿命独立于视图。
- 同一文件一个写入负责人。先核对已有改动并保存本地 Git 基线；本次用户授权本地小提交和旧文档/代码清理。每个可验证功能用独立提交，不 push、公开发布、启用付费服务或操作真实文献库。用途不明的数据保留并记录。
- 有意义的行为变更先观察失败回归，再实现；文档/配置直接核对，不写源码字符串测试。实际脚本：`npm run typecheck`、`npm run lint`、`npm run test:unit`、`npm run package:dev`、`npm run verify:artifacts`。只对受影响行为扩大验证。
- 宿主测试仅 `.zotero-chatgpt-dev/` 专用 profile/data 与合成 PDF。保护正常 Zotero、已有开发 profile 和其他 Codex 会话。测试脚本默认可能自动执行：按开发文档明确选择模式。
- 不读取、复制或记录认证文件。诊断只用白名单，发布只含显式运行资产和许可。禁止 blanket rm、git clean/reset 和改写历史；旧文档先迁移有效信息再按文件删除。
- PDF 与聊天字号独立；真实 dock 和原生缩放，保持当前阅读锚点、IME、焦点和滚动。性能测量写清设备、版本、样本和 p95；未知容量/覆盖不能伪造。
