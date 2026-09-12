export type UILanguage = 'en' | 'zh';

const COPY: Readonly<Record<string, string>> = {
  'Sign in with ChatGPT': '使用 ChatGPT 登录', 'Cancel sign-in': '取消登录', Reconnect: '重新连接',
  'New chat': '新建对话', 'Chat history': '对话历史', 'Search chats…': '搜索对话…',
  'Delete chat': '删除对话', 'Rename chat': '重命名对话', 'Save name': '保存名称', 'Chat name': '对话名称',
  'New content': '新内容', 'Ask a question…': '提出问题…', Question: '问题', Send: '发送', Stop: '停止',
  More: '更多', 'Chat options': '对话选项', 'Return to source': '返回原文', Remove: '移除', You: '你', Copy: '复制',
  'Model and generation settings': '模型与生成设置', Effort: '推理强度', Options: '选项', Fast: '快速', Model: '模型',
  Low: '低', Medium: '中', High: '高', 'Extra High': '极高', Today: '今天', Yesterday: '昨天', Older: '更早',
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
  Attach: '添加附件', 'Choose images…': '选择图片…', 'Capture selected region': '截取所选区域',
  'Capture page': '截取页面', 'PDF page to capture': '要截取的 PDF 页码', 'Save literature to': '文献保存位置',
  'Target collection': '目标分类', 'Choose a collection…': '选择分类…', 'Preview image': '预览图片',
  'Image preview': '图片预览', 'Close image preview': '关闭图片预览', 'Save image…': '保存图片…',
  'Move image earlier': '将图片前移', 'Move image later': '将图片后移',
  'Use current PDF text automatically': '自动使用当前 PDF 文本',
  'Changes affect future requests. Earlier text remains in this chat; start a new chat to exclude it.': '更改将影响之后的请求。已有文本仍保留在当前对话中；新建对话即可排除它。',
  'Current PDF': '当前 PDF', 'Current PDF context': '当前 PDF 上下文',
  'Current PDF · automatic text off': '当前 PDF · 自动文本已关闭', 'Current PDF · text not ready': '当前 PDF · 文本尚未就绪',
  'Source included in a recorded request. Its exact page coverage is listed below.': '原文已包含在记录的请求中，具体页码范围见下方。',
  'Local preparation only — not sent to Codex.': '仅在本地准备，尚未发送至 Codex。',
  'Only this PDF is in scope. Other tabs and your library are not included.': '范围仅限此 PDF，不包含其他标签页或文献库。',
  'First PDF page': 'PDF 起始页', 'Last PDF page': 'PDF 结束页', 'Use pages': '使用这些页面', 'Whole PDF': '完整 PDF',
  'Continue with current PDF': '继续使用当前 PDF', 'Open page': '打开页面', 'Show more pages': '显示更多页面',
  'Last recorded request': '上次记录的请求',
  'When you send, extracted text from this PDF, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic PDF text off in Settings.': '发送时，此 PDF 的提取文本、选中文本和附加图片将通过你的 ChatGPT 账户发送至 Codex。打开侧栏仅会在本地准备文本。你可以在设置中关闭自动使用 PDF 文本。',
  'Included material describes what was supplied. The answer’s citations identify the evidence the model claims to use.': '所含材料说明实际提供的内容。回答中的引用标识模型声称使用的证据。',
  'The source could not be located. Reopen the PDF and check its version.': '无法定位原文。请重新打开 PDF 并检查其版本。',
  'Add references or workflows': '添加引用或工作流', 'Close preview': '关闭预览', 'Reference preview': '引用预览',
  'Use reference pages': '使用这些引用页面', 'Use entire reference': '使用完整引用',
  'Reference first PDF page': '引用 PDF 起始页', 'Reference last PDF page': '引用 PDF 结束页',
  'Research profile for this chat': '此对话的研究配置', 'Global preferences': '全局偏好',
  'Answer language': '回答语言', 'Answer detail': '回答详细程度', 'Mathematical explanation': '数学解释方式',
  'Research background': '研究背景', 'Citation style': '引用风格', 'Annotation style': '标注风格',
  Brief: '简短', Standard: '标准', Detailed: '详细', Automatic: '自动', 'Intuition first': '直觉优先', 'Formal derivation': '形式推导',
  'Save global preferences': '保存全局偏好', 'Save preferences': '保存偏好', 'Export preferences': '导出偏好',
  'Research profile name': '研究配置名称', 'Save as new profile': '另存为新配置', 'Update selected profile': '更新所选配置', 'Delete selected profile': '删除所选配置',
  'Chat overrides': '当前对话设置', 'Answer language for this chat': '此对话的回答语言',
  'Answer detail for this chat': '此对话的回答详细程度', 'Mathematics for this chat': '此对话的数学解释方式',
  Inherit: '继承', 'Clear chat overrides': '清除此对话的设置',
  'Installed workflows': '已安装的工作流', 'Create workflow': '创建工作流', 'Import workflow': '导入工作流',
  Name: '名称', Description: '说明', Version: '版本', Workflow: '工作流', 'SKILL.md content': 'SKILL.md 内容',
  'Read and explain': '阅读与解释', 'Review annotations': '审核标注', 'Acquire literature': '获取文献', 'Create diagram': '生成示意图',
  Enabled: '已启用', 'Save workflow': '保存工作流', 'Cancel editing': '取消编辑', Duplicate: '创建副本', Export: '导出',
  'Try in draft': '在草稿中试用', Edit: '编辑', Delete: '删除', Cancel: '取消',
  'Preferences saved.': '偏好已保存。', 'Research profile saved.': '研究配置已保存。', 'Workflow saved.': '工作流已保存。',
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
};

// Content areas are never localized, including controls embedded in rendered Markdown.
const CONTENT = [
  '.zcr-message-text', '.zcr-rendered', '.zcr-citation-text', '.zcr-source-text', '.zcr-current-title', '.zcr-initial-title',
  '.zcr-history-item', '.zcr-message-reference', '.zcr-command-option', '.zcr-command-label', '.zcr-command-description',
  '.zcr-task-question', '.zcr-task-quote', '.zcr-task-scope', '.zcr-workspace-preview pre', '.zcr-workspace-preview-title strong',
  'script', 'style', 'svg', 'math', '[data-zcr-ui="false"]',
].join(',');
const BUTTONS = 'button[data-zcr-action],.zcr-button,.zcr-icon-button,.zcr-task-button,.zcr-workspace-control';
const TEXT = [
  BUTTONS, '.zcr-picker-heading', '[data-zcr-setting="effort"] .zcr-picker-option-label', '.zcr-picker-toggle-row > span',
  '.zcr-history-heading', '.zcr-history-empty', '.zcr-message-author', '.zcr-status-line', '.zcr-message-meta',
  '.zcr-settings-content > label', '.zcr-settings-content > p', '.zcr-document-context > summary', '.zcr-document-context > p',
  '.zcr-context-disclosure > p', '.zcr-context-pages details > summary', '.zcr-sent-context > strong', '.zcr-sent-context > p',
  '.zcr-workspace-settings label', '.zcr-workspace-settings > details > summary', '.zcr-workspace-status', '.zcr-workspace-editor > strong',
  '.zcr-workspace-settings > details > div > p.zcr-workspace-muted',
  '.zcr-workspace-settings select[name="detail"] option', '.zcr-workspace-settings select[name="mathematics"] option',
  '.zcr-workspace-settings select[name="workflow"] option', '.zcr-workspace-settings select[name="override-detail"] option',
  '.zcr-workspace-settings select[name="override-mathematics"] option', '[data-zcr-profile] option[value=""]',
  '[data-zcr-collection-target] option[value=""]', '.zcr-appearance > summary', '.zcr-appearance label',
  '.zcr-attachment-menu > summary', '.zcr-acquisition-target', '.zcr-command-heading', '.zcr-command-status',
  '.zcr-task-card > summary', '.zcr-task-row-header > .zcr-task-muted', '.zcr-task-check', '.zcr-task-field',
  '.zcr-task-field option[value=""]', '.zcr-task-counts', '.zcr-task-body > .zcr-task-muted',
  '[data-zcr-reading-job] .zcr-task-row > p:first-child', '[data-zcr-ui="true"]',
].join(',');
const ATTRIBUTES = [
  BUTTONS, '.zcr-input', '.zcr-history-panel', '.zcr-history-search', '.zcr-settings-menu', '.zcr-picker-menu', '[data-zcr-picker]', '[data-zcr-setting="speed"]',
  '.zcr-document-context > summary', '.zcr-context-range input', '.zcr-appearance input', '.zcr-appearance select',
  '.zcr-attachment-menu input', '.zcr-conversation-actions input', '[data-zcr-collection-target]', '.zcr-workspace-preview',
  '.zcr-workspace-preview input', '.zcr-image-preview', '.zcr-command-list', '.zcr-task-view', '.zcr-task-check input', '[data-zcr-ui="true"]',
].join(',');
const STATUS: Readonly<Record<string, string>> = {
  queued: '已排队', reserved: '待开始', running: '运行中', completed: '已完成', paused: '已暂停', uncertain: '未确认', cancelled: '已取消', failed: '失败',
  preparing: '准备中', review: '待审核', 'partly completed': '部分完成', unconfirmed: '未确认', undone: '已撤销', conflict: '存在冲突',
  ready: '待处理', unresolved: '未定位', skipped: '已跳过', 'writing…': '正在写入…', applied: '已应用',
  'metadata saved': '元数据已保存', 'undoing…': '正在撤销…', 'changed output preserved': '已保留修改后的结果',
};

function progress(text: string): string {
  let match = /^Preparing PDF · (\d+)\/(\d+|\?)$/u.exec(text);
  if (match) return `正在准备 PDF · ${match[1]}/${match[2]}`;
  match = /^Current PDF · (\d+)\/(\d+) pages with text$/u.exec(text);
  if (match) return `当前 PDF · ${match[1]}/${match[2]} 页有文本`;
  match = /^p\. (.+) · (text extracted|no text|extraction failed|partial extraction)$/u.exec(text);
  if (match) return `第 ${match[1]} 页 · ${{ 'text extracted': '已提取文本', 'no text': '无文本', 'extraction failed': '提取失败', 'partial extraction': '部分提取' }[match[2]!]}`;
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
  match = /^Local text: (\d+\/\d+) pages\. (\d+) pages have no text; (\d+) extraction errors; (\d+) partial pages\. (\d+) pages outside the selected range\.$/u.exec(text);
  if (match) return `本地文本：${match[1]} 页。${match[2]} 页无文本；${match[3]} 页提取失败；${match[4]} 页部分提取。所选范围之外有 ${match[5]} 页。`;
  match = /^Review (\d+) annotation suggestions$/u.exec(text);
  if (match) return `审核 ${match[1]} 条标注建议`;
  match = /^Metadata saved; PDF unavailable \((no doi|no oa candidate|existing pdf|download failed|file type mismatch|identity unconfirmed|supplementary|file too large)\)$/u.exec(text);
  if (match) {
    const reason: Readonly<Record<string, string>> = { 'no doi': '无 DOI', 'no oa candidate': '无开放获取来源', 'existing pdf': '已有 PDF', 'download failed': '下载失败', 'file type mismatch': '文件类型不符', 'identity unconfirmed': '文献身份未确认', supplementary: '补充材料', 'file too large': '文件过大' };
    return `元数据已保存；PDF 不可用（${reason[match[1]!]!}）`;
  }
  return text;
}

function actionLabel(text: string): string {
  const fixed = COPY[text]; if (fixed) return fixed;
  const trySkill = /^Try (.+) in draft$/u.exec(text); if (trySkill) return `在草稿中试用 ${trySkill[1]}`;
  for (const [source, target] of [
    ['Preview workflow ', '预览工作流 '], ['Remove workflow ', '移除工作流 '], ['Preview profile ', '预览配置 '], ['Remove profile ', '移除配置 '],
    ['Preview ', '预览 '], ['Remove ', '移除 '], ['Confirm delete ', '确认删除 '], ['Cancel delete ', '取消删除 '],
    ['Duplicate ', '创建副本：'], ['Export ', '导出 '], ['Edit ', '编辑 '], ['Delete ', '删除 '],
  ] as const) if (text.startsWith(source)) return target + text.slice(source.length);
  return text;
}

interface Original { source: string; rendered: string }
/** Translate only known UI surfaces. Source text and user-defined names stay in their original language. */
export function mountUILocale(root: HTMLElement): { update(language: UILanguage): void; dispose(): void } {
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
