# Zotero GPT Reader

独立社区项目：融入 Zotero 的 GPT 式文献阅读与问答插件，定位是一个 **ChatGPT 式的论文阅读侧栏**。**Chat Mode** 自动以当前打开的 PDF 为上下文做只读问答；**Agent Mode** 在同一上下文上叠加标注、笔记、文献库整理与多步动作能力。保留公式、图表、引用与历史。与 Zotero、OpenAI 无官方隶属或背书关系。

当前打开的 PDF 是**隐式上下文**，不是需要手动上传或附加的文件：只要 Reader 里有打开的 PDF，两种模式都自动以它为默认上下文。

当前是 **macOS Apple Silicon / Zotero 9 开发预览**，不是已完成发行验收的正式产品。已有原生阅读器停靠、选区操作、附件会话、模型目录、图像粘贴和恢复链路。本轮已接入当前 PDF 本地全文、范围预览及请求参数链路；真实模型回答尚未验证。统一引用/skills、标注与获取整理的实际状态以 [进度与验收](docs/progress.md) 为准；目标不等于已经可用。

## 安装与使用

目标是一个包含运行组件的平台 XPI，经 Zotero 插件管理器安装后点击 **Sign in with ChatGPT**。普通用户不需要 Node、CLI、终端、token 或 companion。当前只有本地开发 XPI；下载来源的系统安全检查、无 Node 机器和完整升级验收尚未完成，不提供虚构的 Release 链接。

开发者从本仓库构建和试用的命令见 [开发与发行](docs/development.md)。测试仅使用 `.zcr-dev/` 专用 profile/data 和合成 PDF，保留正常文献库。

PDF 工具栏搜索左侧的助手开关打开会话；**Ask in sidechat** 加入选区等待发送，**More details** 请求解释。打开侧栏本身不发送。默认全文背景的外发范围、关闭方式和提取状态必须在界面明确显示；历史回答不是文献证据。

## 开发入口

- [AGENTS.md](AGENTS.md)：可执行规则与安全边界。
- [唯一产品规格](docs/zotero-codex-user-flow.md)：目标功能、体验与验收要求。
- [架构与契约](docs/module-design.md)：实际模块、状态、协议与存储。
- [开发、测试与发行](docs/development.md)：复现与安装命令。
- [进度、差距与证据](docs/progress.md)：当前执行计划、实测边界及剩余工作。

运行组件固定为 Codex **0.154.0**，发行身份和校验在 `runtime/manifest.ts`；不随系统 CLI 自动更新。平台支持只按实际宿主验收声明。登录由官方流程管理；插件本地记录尚无云同步。
