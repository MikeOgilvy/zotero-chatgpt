export type UILanguage = 'en' | 'zh';

const COPY: Readonly<Record<string, string>> = {
  'Sign in with ChatGPT': '使用 ChatGPT 登录', 'Cancel sign-in': '取消登录', Reconnect: '重新连接',
  'New chat': '新建对话', 'Chat history': '对话历史', 'Search chats…': '搜索对话…',
  'Close chat': '关闭对话', 'Delete chat': '删除对话', 'Rename chat': '重命名对话', 'Save name': '保存名称', 'Chat name': '对话名称',
  'New content': '新内容', 'Ask a question…': '提出问题…', Question: '问题', Send: '发送', Stop: '停止',
  More: '更多', 'Chat options': '对话选项', 'Return to source': '返回原文', Remove: '移除', You: '你', Copy: '复制',
  'Model and generation settings': '模型与生成设置', Effort: '推理强度', Options: '选项', Fast: '快速', Model: '模型',
  Low: '低', Medium: '中', High: '高', 'Extra High': '极高', Today: '今天', Yesterday: '昨天', 'Previous 7 days': '过去 7 天', Older: '更早',
  'Open the Codex sidebar to connect.': '打开 Codex 侧栏以连接。', 'Starting Codex…': '正在启动 Codex…',
  'Codex is unavailable': 'Codex 暂不可用', 'Finish signing in to ChatGPT in your browser.': '请在浏览器中完成 ChatGPT 登录。',
  'Sign in with ChatGPT to ask a question.': '使用 ChatGPT 登录后即可提问。', 'Responding…': '正在回答…',
  Recorded: '已记录', Stopped: '已停止', Failed: '失败', Queued: '已排队', 'Cancelled before sending': '发送前已取消',
  'Unconfirmed: the connection was interrupted. The request was not sent again.': '状态未确认：连接已中断，未重新发送此请求。',
  'No saved chats match this search.': '没有匹配的已保存对话。',
  Appearance: '外观', 'Chat text size': '聊天字号', 'Interface language': '界面语言',
  'Queue question': '将问题加入队列', 'Cancel queued question': '取消排队的问题',
  'Regenerate in new chat': '在新对话中重新生成', 'Edit in new chat': '在新对话中编辑',
  'Review annotation suggestions': '审核标注建议',
  Attach: '添加附件', 'Add images or context': '添加图片或上下文', 'Choose images…': '选择图片…', 'Capture selected region': '截取所选区域',
  'Capture page': '截取页面', 'PDF page to capture': '要截取的 PDF 页码', 'Save literature to': '文献保存位置',
  Reference: '引用', 'From your computer': '来自你的电脑',
  'Saved chats, articles and workflows': '已保存的对话、文章与工作流',
  'Target collection': '目标分类', 'Choose a collection…': '选择分类…', 'Preview image': '预览图片',
  'Image preview': '图片预览', 'Close image preview': '关闭图片预览', 'Save image…': '保存图片…',
  'Move image earlier': '将图片前移', 'Move image later': '将图片后移',
  'Use current PDF text automatically': '自动使用当前 PDF 文本',
  'Continue with current PDF': '继续使用当前 PDF',
  'When you send, extracted text from this PDF, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic PDF text off in Zotero\'s Preferences window.': '发送时，此 PDF 的提取文本、选中文本和附加图片将通过你的 ChatGPT 账户发送至 Codex。打开侧栏仅会在本地准备文本。你可以在 Zotero 的偏好设置窗口中关闭自动使用 PDF 文本。',
  'This action could not be completed.': '此操作未能完成。',
  'The source could not be opened.': '无法打开原文。',
  'The image could not be saved.': '无法保存图片。',
  'The clipboard image could not be attached.': '无法附加剪贴板图片。',
  'The dropped image could not be attached.': '无法附加拖放的图片。',
  'Collections could not be loaded.': '无法加载分类列表。',
  Copied: '已复制',
  'The answer could not be copied.': '无法复制回答。',
  // Local PDF preparation failures. Kept distinct so the owner can tell "this PDF could not be read
  // here" from "the file changed underneath the reader" from "there was no text to send".
  'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.': '当前 PDF 无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。',
  'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.': '当前 PDF 未能及时加载完成，无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。',
  'The PDF file changed while this reader was open. Reopen it to load the current version.': '此阅读器打开期间 PDF 文件已更改。请重新打开以载入当前版本。',
  'The PDF changed during preparation. Reopen it and send again.': '准备过程中 PDF 已更改。请重新打开后再次发送。',
  'The host cannot verify this loaded PDF version. Reopen the PDF before asking.': '无法校验已加载的 PDF 版本。请重新打开此 PDF 后再提问。',
  'No extractable text was found in the pages supplied from this PDF. Attach the relevant page image if you want to ask about them.': '从此 PDF 提供的页面中未找到可提取的文本。如需就此提问，请附加相关页面图像。',
  'The PDF page text could not be extracted.': '无法提取 PDF 页面文本。',
  'Elapsed time unavailable': '耗时无法确定',
  'The saved research profile is no longer available; global preferences apply.': '已保存的研究配置不可用；将应用全局偏好设置。',
  'Context unknown': '上下文用量未知',
  'Add references or workflows': '添加引用或工作流', 'Close preview': '关闭预览', 'Reference preview': '引用预览',
  'Use reference pages': '使用这些引用页面', 'Use entire reference': '使用完整引用',
  'Reference first PDF page': '引用 PDF 起始页', 'Reference last PDF page': '引用 PDF 结束页',
  "Answer preferences, research profiles and workflow availability are in Zotero's Preferences window.": '回答偏好、研究配置和工作流可用性位于 Zotero 的偏好设置窗口中。',
  'Instructions': '指令', 'Codex instructions': 'Codex 指令', 'Give Codex extra instructions and context for all chats.': '为所有对话提供额外的指令和上下文。',
  'Save': '保存', 'Export preferences': '导出偏好',
  'Installed workflows': '已安装的工作流', 'Create workflow': '创建工作流', 'Import workflow': '导入工作流',
  Name: '名称', Description: '说明', Version: '版本', Workflow: '工作流', 'SKILL.md content': 'SKILL.md 内容',
  'Read and explain': '阅读与解释', 'Review annotations': '审核标注', 'Acquire literature': '获取文献', 'Create diagram': '生成示意图',
  Enabled: '已启用', 'Save workflow': '保存工作流', 'Cancel editing': '取消编辑', Duplicate: '创建副本', Export: '导出',
  'Try in draft': '在草稿中试用', Edit: '编辑', Delete: '删除', Cancel: '取消',
  'Preferences saved.': '偏好已保存。',
  'Name, version and SKILL.md content are required.': '请填写名称、版本和 SKILL.md 内容。', 'No workflows installed.': '尚未安装工作流。',
  References: '引用', All: '全部', Articles: '文献', Chats: '对话', Workflows: '工作流', 'Searching…': '正在搜索…', 'Adding…': '正在添加…', 'No matches': '无匹配项',
  Tasks: '任务', Include: '选中', 'Include this candidate': '选中此候选项', 'Verified metadata': '已核验的元数据',
  'Existing item': '已有条目', 'Choose metadata': '选择元数据', 'Choose existing item': '选择已有条目', 'Obtain a verified PDF': '获取已核验的 PDF',
  'Approve selected': '批准所选项', 'Approving…': '正在批准…', 'Cancel task': '取消任务', 'Cancellation requested': '已请求取消',
  'Reconcile task': '核对任务状态', 'Undo task': '撤销任务', 'Open source': '打开原文', 'Open saved output': '打开已保存的结果',
  'Open reading result': '打开阅读结果', 'Cancel reading': '取消阅读', 'Reconcile reading': '核对阅读状态',
  Preparing: '准备中', Review: '待审核', Running: '运行中', Completed: '已完成', 'Partly completed': '部分完成',
  Cancelled: '已取消', Unconfirmed: '未确认', Undone: '已撤销', Conflict: '存在冲突',
  Ready: '待处理', Unresolved: '未定位', Skipped: '已跳过', 'Writing…': '正在写入…', Applied: '已应用',
  'Metadata saved': '元数据已保存', 'Undoing…': '正在撤销…', 'Changed output preserved': '已保留修改后的结果',
  'Metadata saved; PDF removed': '元数据已保存；PDF 已移除', 'PDF attached': 'PDF 已附加',
  'Metadata saved; PDF result unconfirmed': '元数据已保存；PDF 结果未确认', 'Metadata saved; PDF not requested': '元数据已保存；未请求 PDF',
  'Metadata saved; PDF not attempted': '元数据已保存；未尝试获取 PDF',
  'Reconcile unconfirmed writes before undoing. They will not be resent automatically.': '撤销前请先核对未确认的写入，它们不会被自动重发。',
  'Changed outputs and human changes are preserved. Undo checks the recorded version again.': '已修改的结果和人工更改会被保留。撤销时会再次核对记录的版本。',
  'PDF download is unavailable for this target; approval saves metadata only.': '此目标无法下载 PDF；批准后仅保存元数据。',
  // Native Zotero Preferences pane (workspace/preferences-pane.ts). Messages the store raises
  // through the same text reach the sidebar too, so the key is deliberately shared.
  Chat: '对话',
  Models: '模型', 'PDF text': 'PDF 文本',
  'This is the bundled catalog, not your account\'s live entitlements. GPT-5.3-Spark models come from the running runtime and appear only after it reports them. The exact id is what is sent.': '这是随包目录，并非你账户的实时权限。GPT-5.3-Spark 模型由正在运行的运行时提供，只有在它报告过之后才会出现。实际发送的是确切 id。',
  'These rows combine the models the running runtime reported with the bundled catalog\'s GPT-6 and GPT-5.6. The exact id is what is sent.': '这些行由正在运行的运行时报告的模型，加上随包目录中的 GPT-6 与 GPT-5.6 组成。实际发送的是确切 id。',
  'Interface language saved.': '界面语言已保存。', 'Chat text scale saved.': '聊天字号已保存。',
  'Automatic PDF text preparation is on.': '已开启自动准备 PDF 文本。', 'Automatic PDF text preparation is off.': '已关闭自动准备 PDF 文本。',
  'Preferences exported.': '偏好已导出。',
  'Workflow updated.': '工作流已更新。',
  'The stored preferences could not be read.': '无法读取已保存的偏好。',
  // History management section (workspace/history-section.ts). Counts, paper titles, timestamps and
  // chat titles are data and stay verbatim; only the phrases below are translated.
  Paper: '文献', 'All papers': '全部文献', 'Select all': '全选',
  'Delete selected': '删除所选项',
  'Delete permanently': '永久删除', 'work in progress': '有未完成的工作',
  'The saved chat list could not be read. Nothing was changed.': '无法读取已保存的对话列表，未做任何更改。',
  'The change could not be confirmed. Reopen this section to see what is actually stored.': '无法确认更改结果。请重新打开此部分以查看实际保存的内容。',
  'A chat with an unfinished answer or native task was skipped: finish or cancel it before deleting.': '已跳过包含未完成回答或原生任务的对话：请先完成或取消，再删除。',
  // Context-ring coverage disclosure (rendered by `contextDetailNodes` in chat/view.ts). These are
  // labels and phrases only: page numbers, token figures, model ids and the planner's `reason` line
  // are data and pass through verbatim. `unknown`/`not asserted` are emitted only by the disclosure.
  'Context supplied to the last request': '上次请求提供的上下文',
  Mode: '模式', 'Whole source': '整份来源', 'Question-focused selection': '按问题选取', 'Multi-pass reading': '多轮阅读',
  'Pages supplied': '已提供页数', 'Page numbers': '页码', 'Model window': '模型窗口',
  unknown: '未知', 'Text allowance': '文本配额', 'not asserted': '未断言',
  'Fit was not asserted: model capacity or retained history is unknown.': '未断言是否适配：模型容量或保留的历史记录未知。',
  'What was supplied and what was not': '已提供与未提供的内容',
};

// Content areas are never localized, including controls embedded in rendered Markdown.
const CONTENT = [
  '.zcr-message-text', '.zcr-rendered', '.zcr-citation-text', '.zcr-current-title', '.zcr-initial-title',
  '.zcr-history-item', '.zcr-message-reference', '.zcr-command-option', '.zcr-command-label', '.zcr-command-description',
  '.zcr-task-question', '.zcr-task-quote', '.zcr-task-scope', '.zcr-workspace-preview pre', '.zcr-workspace-preview-title strong',
  'script', 'style', 'svg', 'math', '[data-zcr-ui="false"]',
].join(',');
const BUTTONS = 'button[data-zcr-action],.zcr-button,.zcr-icon-button,.zcr-task-button,.zcr-workspace-control,.zcr-preferences button';
const TEXT = [
  BUTTONS, '.zcr-picker-heading', '[data-zcr-setting="effort"] .zcr-picker-option-label', '.zcr-picker-toggle-row > span',
  '.zcr-history-heading', '.zcr-history-empty', '.zcr-status-line', '.zcr-message-meta',
  '.zcr-settings-content > label', '.zcr-settings-content > p', '.zcr-context-disclosure > p', '.zcr-error',
  '.zcr-workspace-settings label', '.zcr-workspace-settings > details > summary', '.zcr-workspace-status', '.zcr-workspace-editor > strong',
  '.zcr-workspace-settings > details > div > p.zcr-workspace-muted', '.zcr-workspace-editor > p.zcr-workspace-muted', '.zcr-workspace-actions > span',
  '.zcr-workspace-settings select[name="detail"] option', '.zcr-workspace-settings select[name="mathematics"] option',
  '.zcr-workspace-settings select[name="workflow"] option',
  '[data-zcr-collection-target] option[value=""]', '.zcr-plus-menu', '.zcr-plus-heading', '.zcr-plus-row-title', '.zcr-plus-row-description', '.zcr-acquisition-target', '.zcr-command-heading', '.zcr-command-status',
  '.zcr-task-card > summary', '.zcr-task-row-header > .zcr-task-muted', '.zcr-task-check', '.zcr-task-field',
  '.zcr-task-field option[value=""]', '.zcr-task-counts', '.zcr-task-body > .zcr-task-muted',
  '[data-zcr-reading-job] .zcr-task-row > p:first-child', '[data-zcr-ui="true"]', '.zcr-context-ring', '.zcr-request-timing-text',
  // Native Preferences pane: pane copy only. Skill names and ids are never matched.
  '.zcr-preferences legend', '.zcr-preferences label', '.zcr-preferences [data-zcr-pref="uiLanguage"] option',
  '.zcr-preferences [data-zcr-pref="status"]', '.zcr-preferences [data-zcr-pref="error"]', '.zcr-preferences .zcr-preferences-muted',
  // History management section: its own status, select-all count, confirmation lines, paper options.
  '.zcr-preferences [data-zcr-history="error"]', '.zcr-preferences [data-zcr-history="status"]',
  '.zcr-preferences [data-zcr-history="confirm-text"]', '.zcr-preferences [data-zcr-history="selected-count"]',
  '.zcr-preferences [data-zcr-history="paper"] option',
].join(',');
const ATTRIBUTES = [
  BUTTONS, '.zcr-input', '.zcr-history-panel', '.zcr-history-search', '.zcr-settings-menu', '.zcr-picker-menu', '[data-zcr-picker]', '[data-zcr-setting="speed"]',
  '.zcr-plus-menu input', '.zcr-conversation-actions input', '[data-zcr-collection-target]', '.zcr-workspace-preview',
  '.zcr-workspace-preview input', '.zcr-image-preview', '.zcr-command-list', '.zcr-task-view', '.zcr-task-check input', '[data-zcr-ui="true"]', '.zcr-context-ring',
  // The History search box carries copy in its placeholder and aria-label only when it is empty.
  '.zcr-preferences [data-zcr-history="search"]',
].join(',');
const STATUS: Readonly<Record<string, string>> = {
  queued: '已排队', reserved: '待开始', running: '运行中', completed: '已完成', paused: '已暂停', uncertain: '未确认', cancelled: '已取消', failed: '失败',
  preparing: '准备中', review: '待审核', 'partly completed': '部分完成', unconfirmed: '未确认', undone: '已撤销', conflict: '存在冲突',
  ready: '待处理', unresolved: '未定位', skipped: '已跳过', 'writing…': '正在写入…', applied: '已应用',
  'metadata saved': '元数据已保存', 'undoing…': '正在撤销…', 'changed output preserved': '已保留修改后的结果',
};

function progress(text: string): string {
  let match = /^Waiting (\d+)s$/u.exec(text);
  if (match) return `等待 ${match[1]} 秒`;
  match = /^Answered in (\d+)s$/u.exec(text);
  if (match) return `回答用时 ${match[1]} 秒`;
  match = /^(Annotations|Acquire literature) · (Preparing|Review|Running|Completed|Partly completed|Cancelled|Unconfirmed|Undone|Conflict|Failed) · (.+)$/u.exec(text);
  if (match) {
    const outcome = match[3]!.replace(/^(\d+\/\d+) selected$/u, '已选择 $1').replace(/^(\d+\/\d+) annotations applied$/u, '已应用 $1 个标注').replace(/^(\d+) metadata item(?:s|\(s\))? · (\d+) PDFs attached$/u, '$1 个元数据条目 · 已附加 $2 个 PDF');
    if (outcome !== match[3]) return `${match[1] === 'Annotations' ? '标注' : '获取文献'} · ${COPY[match[2]!]!} · ${outcome}`;
  }
  match = /^Reading · (\w+) · (\d+\/\d+) passes$/u.exec(text);
  if (match && STATUS[match[1]!]) return `阅读 · ${STATUS[match[1]!]!} · ${match[2]} 轮`;
  match = /^(Synthesis|Reading pass (\d+)|Read selected sources) · (\w+)$/u.exec(text);
  if (match && STATUS[match[3]!]) return `${match[1] === 'Synthesis' ? '综合' : match[2] ? `阅读第 ${match[2]} 轮` : '阅读所选来源'} · ${STATUS[match[3]!]!}`;
  const counts = text.split(' · ').map(part => /^(\d+) (.+)$/u.exec(part));
  if (counts.length && counts.every(part => part && STATUS[part[2]!])) return counts.map(part => `${part![1]} ${STATUS[part![2]!]!}`).join(' · ');
  match = /^Review (\d+) annotation suggestions$/u.exec(text);
  if (match) return `审核 ${match[1]} 条标注建议`;
  match = /^PDF (\S+) · candidate pages (.+)$/u.exec(text);
  if (match) return `PDF ${match[1]} · 候选页 ${match[2] === 'none' ? '无' : match[2]}`;
  match = /^Target collection: (.*)$/u.exec(text);
  if (match) return `目标分类：${match[1]}`;
  match = /^Source: (\S+)\nPermissions: (.*)\nUnsupported dependencies: (.*)$/u.exec(text);
  if (match) return `来源：${match[1]}\n权限：${match[2] === 'none' ? '无' : match[2]}\n不支持的依赖：${match[3] === 'none' ? '无' : match[3]}`;
  // History management section. Every number and title in these lines is data and is carried
  // through verbatim; only the surrounding sentence is translated. They precede the generic
  // `Delete …?` rule below, which would otherwise only translate the verb.
  match = /^(\d+) stored chats?$/u.exec(text);
  if (match) return `已保存 ${match[1]} 个对话`;
  match = /^(\d+) matching chats?$/u.exec(text);
  if (match) return `匹配 ${match[1]} 个对话`;
  match = /^(\d+) selected$/u.exec(text);
  if (match) return `已选择 ${match[1]} 个`;
  match = /^(\d+) messages?$/u.exec(text);
  if (match) return `${match[1]} 条消息`;
  match = /^(\d+) tasks?$/u.exec(text);
  if (match) return `${match[1]} 个任务`;
  match = /^Showing the (\d+) most recent of (\d+) matching chats\. Narrow the search or the paper filter to see the rest\.$/u.exec(text);
  if (match) return `仅显示最近匹配的 ${match[2]} 个对话中的 ${match[1]} 个。请缩小搜索范围或更改文献筛选以查看其余内容。`;
  match = /^…and (\d+) more papers — search to narrow$/u.exec(text);
  if (match) return `……还有 ${match[1]} 篇文献，请用搜索缩小范围`;
  match = /^Deleted (\d+) of (\d+) chats?\.(?: (\d+) could not be changed\.)?$/u.exec(text);
  if (match) {
    const head = `已删除 ${match[2]} 个对话中的 ${match[1]} 个。`;
    return match[3] ? `${head}有 ${match[3]} 个未能更改。` : head;
  }
  match = /^Delete “(.+)”\? This permanently removes the chat, its messages and its unsent draft from this computer\. Native task outputs and exported files are not undone\. This cannot be undone\.$/u.exec(text);
  if (match) return `删除“${match[1]}”？将从此电脑永久移除该对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`;
  match = /^Delete (\d+) chats\? This permanently removes those chats, their messages and their unsent drafts from this computer\. Native task outputs and exported files are not undone\. This cannot be undone\.$/u.exec(text);
  if (match) return `删除 ${match[1]} 个对话？将从此电脑永久移除这些对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`;
  match = /^Delete (.+)\?$/u.exec(text);
  if (match) return `删除 ${match[1]}？`;
  match = /^Context ([\d.]+k?) \/ ([\d.]+k?) tokens$/u.exec(text);
  if (match) return `上下文 ${match[1]} / ${match[2]} 词元`;
  match = /^Context ([\d.]+k?) tokens · window unknown$/u.exec(text);
  if (match) return `上下文 ${match[1]} 词元 · 窗口未知`;
  // Context-ring coverage disclosure. The template phrases translate; every count, page number and
  // token figure is captured and re-emitted verbatim. `…, and N more` is the page set's own tail.
  match = /^(\d+) of (\d+) pages$/u.exec(text);
  if (match) return `${match[1]} / ${match[2]} 页`;
  match = /^([\d,]+) tokens \((runtime reported|bundled catalog estimate)\)$/u.exec(text);
  if (match) return `${match[1]} 词元（${match[2] === 'runtime reported' ? '运行时报告' : '内置目录估算'}）`;
  match = /^([\d,]+) tokens$/u.exec(text);
  if (match) return `${match[1]} 词元`;
  match = /^(.+), and (\d+) more$/u.exec(text);
  if (match) return `${match[1]}，另有 ${match[2]} 个`;
  match = /^Metadata saved; PDF unavailable \((no doi|no oa candidate|existing pdf|download failed|file type mismatch|identity unconfirmed|supplementary|file too large)\)$/u.exec(text);
  if (match) {
    const reason: Readonly<Record<string, string>> = { 'no doi': '无 DOI', 'no oa candidate': '无开放获取来源', 'existing pdf': '已有 PDF', 'download failed': '下载失败', 'file type mismatch': '文件类型不符', 'identity unconfirmed': '文献身份未确认', supplementary: '补充材料', 'file too large': '文件过大' };
    return `元数据已保存；PDF 不可用（${reason[match[1]!]!}）`;
  }
  // Native Preferences pane. Values, ids and workflow names stay verbatim.
  match = /^Chat text scale \(([\d.]+)–([\d.]+)\)$/u.exec(text);
  if (match) return `聊天字号（${match[1]}–${match[2]}）`;
  match = /^Choose a chat text scale from ([\d.]+) to ([\d.]+)\.$/u.exec(text);
  if (match) return `请选择 ${match[1]} 到 ${match[2]} 之间的聊天字号。`;
  match = /^(.*) · Unavailable: (.+)$/u.exec(text);
  if (match) return `${match[1]} · 不可用：${match[2]}`;
  return text;
}

function actionLabel(text: string): string {
  const fixed = COPY[text]; if (fixed) return fixed;
  const contextUnknown = 'Current context is unknown: the runtime has not reported usage for this model.';
  if (text === contextUnknown) return '当前上下文未知：运行时尚未报告此模型的用量。';
  const contextNoWindow = /^Last runtime usage report: ([\d,]+) input tokens; the model window is unknown\. This is the last report, not remaining context\.$/u.exec(text);
  if (contextNoWindow) return `上次运行时用量报告：${contextNoWindow[1]} 个输入词元；模型窗口未知。这是上次报告，并非剩余空间。`;
  const contextReported = /^Last runtime usage report: ([\d,]+) input tokens; model window ([\d,]+) \((runtime reported|bundled catalog estimate)\)\. This is the last report, not remaining context\.$/u.exec(text);
  if (contextReported) return `上次运行时用量报告：${contextReported[1]} 个输入词元；模型窗口 ${contextReported[2]}（${contextReported[3] === 'runtime reported' ? '运行时报告' : '内置目录估算'}）。这是上次报告，并非剩余空间。`;
  const trySkill = /^Try (.+) in draft$/u.exec(text); if (trySkill) return `在草稿中试用 ${trySkill[1]}`;
  for (const [source, target] of [
    ['Preview workflow ', '预览工作流 '], ['Remove workflow ', '移除工作流 '],
    ['Preview ', '预览 '], ['Remove ', '移除 '], ['Confirm delete ', '确认删除 '], ['Cancel delete ', '取消删除 '],
    ['Duplicate ', '创建副本：'], ['Export ', '导出 '], ['Edit ', '编辑 '], ['Delete ', '删除 '],
  ] as const) if (text.startsWith(source)) return target + text.slice(source.length);
  return text;
}

interface Original { source: string; rendered: string }
/** Translate only known UI surfaces. Source text and user-defined names stay in their original language. */
export function mountUILocale(root: Element): { update(language: UILanguage): void; dispose(): void } {
  let language: UILanguage = 'en'; let disposed = false;
  const texts = new WeakMap<Text, Original>(); const attributes = new WeakMap<Element, Map<string, Original>>();
  const protectedContent = (node: Element) => !!node.closest(CONTENT);
  const original = (current: string, previous: Original | undefined): string => previous?.rendered === current ? previous.source : current;
  const localize = (source: string, node: Element, attribute: boolean): string => {
    if (language === 'en') return source;
    const text = source.trim(); let translated: string;
    if (attribute) translated = actionLabel(text);
    else if (node.matches('.zcr-workspace-editor > strong')) translated = actionLabel(text);
    else if (node.matches('.zcr-message-meta')) {
      const status = /^(Recorded|Responding…|Stopped|Failed|Queued|Cancelled before sending|Unconfirmed: the connection was interrupted\. The request was not sent again\.)( · .+)?$/u.exec(text);
      translated = status ? COPY[status[1]!]! + (status[2] ?? '') : text;
    } else translated = COPY[text] ?? progress(text);
    return translated === text ? source : source.slice(0, source.indexOf(text)) + translated + source.slice(source.indexOf(text) + text.length);
  };
  const candidates = (scope: Element, selector: string) => [...(scope.matches(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
  const apply = (scope: Element) => {
    if (protectedContent(scope)) return;
    for (const node of candidates(scope, TEXT)) {
      if (protectedContent(node) || node.closest('.zcr-workspace-chip') || node.matches('[data-zcr-picker],[data-zcr-setting="model"]')) continue;
      for (const child of node.childNodes) {
        if (child.nodeType !== 3) continue;
        const text = child as Text; const source = original(text.data, texts.get(text)); const rendered = localize(source, node, false);
        texts.set(text, { source, rendered }); if (text.data !== rendered) text.data = rendered;
      }
    }
    for (const node of candidates(scope, ATTRIBUTES)) {
      if (protectedContent(node) || node.matches('[data-zcr-setting="model"]')) continue;
      const saved = attributes.get(node) ?? new Map<string, Original>(); attributes.set(node, saved);
      for (const name of ['aria-label', 'title', 'placeholder']) {
        const current = node.getAttribute(name); if (current === null) { saved.delete(name); continue; }
        const source = original(current, saved.get(name)); const rendered = localize(source, node, true);
        saved.set(name, { source, rendered }); if (current !== rendered) node.setAttribute(name, rendered);
      }
    }
  };
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(records => {
    if (disposed || language === 'en') return;
    const scopes = new Set<Element>();
    for (const record of records) {
      const node = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      if (node && root.contains(node) && !protectedContent(node)) scopes.add(node);
    }
    for (const scope of scopes) apply(scope);
  }) : null;
  observer?.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'placeholder'] });
  return {
    update(next) { if (!disposed) { language = next; apply(root); } },
    dispose() { if (disposed) return; observer?.disconnect(); language = 'en'; apply(root); disposed = true; },
  };
}
