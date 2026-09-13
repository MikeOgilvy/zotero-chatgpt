import { Window as HappyWindow } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountUILocale } from '../../packages/zotero/src/chat/ui-locale.ts';

function setup() {
  const document = new HappyWindow().document as unknown as Document;
  const root = document.createElement('section'); root.className = 'zcr-chat'; document.body.append(root);
  const add = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '', parent: HTMLElement = root) => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; parent.append(node); return node;
  };
  return { document, root, add };
}

it('switches visible controls, accessible names and placeholders without replacing focused input or values', () => {
  const { document, root, add } = setup();
  const send = add('button', 'zcr-button', 'Send'); send.dataset.zcrAction = 'send'; send.setAttribute('aria-label', 'Send'); send.title = 'Send';
  const input = add('textarea', 'zcr-input'); input.placeholder = 'Ask a question…'; input.setAttribute('aria-label', 'Question'); input.value = 'Send 新想法'; input.focus(); input.setSelectionRange(3, 6);
  const locale = mountUILocale(root); locale.update('zh');
  expect(send.textContent).toBe('发送'); expect(send.title).toBe('发送'); expect(send.getAttribute('aria-label')).toBe('发送');
  expect(input.placeholder).toBe('提出问题…'); expect(input.getAttribute('aria-label')).toBe('问题');
  expect(document.activeElement).toBe(input); expect(input.value).toBe('Send 新想法'); expect(input.selectionStart).toBe(3); expect(input.selectionEnd).toBe(6);
  locale.update('en'); expect(send.textContent).toBe('Send'); expect(input.placeholder).toBe('Ask a question…'); expect(send.title).toBe('Send'); locale.dispose();
});

it('never translates source, chat, history, candidate, profile or workflow content even when it matches a control', () => {
  const { root, add } = setup(); const protectedNodes: HTMLElement[] = [];
  for (const className of ['zcr-current-title', 'zcr-initial-title', 'zcr-history-item', 'zcr-command-option', 'zcr-message-text', 'zcr-message-reference', 'zcr-citation-text', 'zcr-source-text', 'zcr-task-question', 'zcr-task-quote', 'zcr-task-scope']) {
    const node = add('div', className, 'Send'); node.setAttribute('aria-label', 'Send'); protectedNodes.push(node);
    const embedded = add('button', 'zcr-button', 'Stop', node); embedded.dataset.zcrAction = 'send'; protectedNodes.push(embedded);
  }
  const preview = add('div', 'zcr-workspace-preview'); protectedNodes.push(add('pre', '', 'Global preferences', preview));
  const settings = add('div', 'zcr-workspace-settings'); const workflows = add('details', '', '', settings); add('summary', '', 'Installed workflows', workflows);
  const skill = add('details', '', '', workflows); protectedNodes.push(add('summary', '', 'Global preferences', skill));
  const profile = add('select', '', '', settings); profile.dataset.zcrProfile = ''; const option = add('option', '', 'Send', profile); option.value = 'profile-one'; protectedNodes.push(option);
  const chip = add('span', 'zcr-workspace-chip'); const chipName = add('button', 'zcr-workspace-control', 'Send', chip); chipName.title = 'Preview Send'; protectedNodes.push(chipName);
  const row = add('div', 'zcr-task-row'); protectedNodes.push(add('p', 'zcr-task-muted', 'Completed', row));
  const model = add('button', 'zcr-picker-option'); model.dataset.zcrSetting = 'model'; protectedNodes.push(add('span', 'zcr-picker-option-label', 'High', model));
  const before = protectedNodes.map(node => node.textContent); const locale = mountUILocale(root); locale.update('zh');
  expect(protectedNodes.map(node => node.textContent)).toEqual(before); expect(root.querySelector('.zcr-history-item')!.getAttribute('aria-label')).toBe('Send');
  expect(chipName.title).toBe('预览 Send'); locale.update('en'); expect(chipName.title).toBe('Preview Send'); locale.dispose();
});

it('preserves form elements, selection values, names and whitespace in translated labels', () => {
  const { document, root, add } = setup(); const settings = add('div', 'zcr-workspace-settings');
  const label = add('label', '', '  Answer detail\n', settings); const select = add('select', '', '', label); select.name = 'detail';
  const brief = add('option', '', 'Brief', select); brief.value = 'brief'; const standard = add('option', '', 'Standard', select); standard.value = 'standard'; select.value = 'standard'; select.focus();
  const textNode = label.firstChild; const locale = mountUILocale(root); locale.update('zh');
  expect(label.firstChild).toBe(textNode); expect(textNode!.textContent).toBe('  回答详细程度\n'); expect(brief.textContent).toBe('简短');
  expect(select.value).toBe('standard'); expect(select.name).toBe('detail'); expect(document.activeElement).toBe(select);
  locale.update('en'); expect(textNode!.textContent).toBe('  Answer detail\n'); expect(standard.textContent).toBe('Standard'); locale.dispose();
});

it('localizes controls added by later renders and restores the latest externally authored status', async () => {
  const { root, add } = setup(); const status = add('p', 'zcr-status-line', 'Responding…');
  const locale = mountUILocale(root); locale.update('zh'); expect(status.textContent).toBe('正在回答…');
  status.firstChild!.textContent = 'Stopped'; const button = add('button', 'zcr-task-button', 'Reconcile task'); button.setAttribute('aria-label', 'Reconcile task');
  await vi.waitFor(() => { expect(status.textContent).toBe('已停止'); expect(button.textContent).toBe('核对任务状态'); expect(button.getAttribute('aria-label')).toBe('核对任务状态'); });
  locale.update('en'); expect(status.textContent).toBe('Stopped'); expect(button.textContent).toBe('Reconcile task'); locale.dispose();
});

it('translates only fixed task and PDF progress templates while preserving identifiers and source page labels', () => {
  const { root, add } = setup(); const task = add('details', 'zcr-task-card'); task.dataset.zcrTaskId = 'one'; const summary = add('summary', '', 'Annotations · Review · 2/3 selected', task);
  const counts = add('p', 'zcr-task-counts', '2 ready · 1 unresolved', task);
  const reading = add('details', 'zcr-task-card'); reading.dataset.zcrReadingJob = 'job'; const progress = add('summary', '', 'Reading · running · 1/3 passes', reading);
  const pdf = add('details', 'zcr-document-context'); const pdfSummary = add('summary', '', 'Current PDF · 12/20 pages with text', pdf);
  const pages = add('div', 'zcr-context-pages'); const page = add('details', '', '', pages); const pageSummary = add('summary', '', 'p. Send · text extracted', page);
  const locale = mountUILocale(root); locale.update('zh');
  expect(summary.textContent).toBe('标注 · 待审核 · 已选择 2/3'); expect(counts.textContent).toBe('2 待处理 · 1 未定位');
  expect(progress.textContent).toBe('阅读 · 运行中 · 1/3 轮'); expect(pdfSummary.textContent).toBe('当前 PDF · 12/20 页有文本'); expect(pageSummary.textContent).toBe('第 Send 页 · 已提取文本');
  locale.update('en'); expect(summary.textContent).toBe('Annotations · Review · 2/3 selected'); expect(pageSummary.textContent).toBe('p. Send · text extracted'); locale.dispose();
});

it('translates workflow and reference action labels without translating dynamic names', () => {
  const { root, add } = setup(); const button = add('button', 'zcr-workspace-control', 'Try in draft'); button.setAttribute('aria-label', 'Try Send in draft'); button.title = 'Try Send in draft';
  const remove = add('button', 'zcr-workspace-control', '×'); remove.setAttribute('aria-label', 'Remove workflow Stop');
  const locale = mountUILocale(root); locale.update('zh'); expect(button.textContent).toBe('在草稿中试用'); expect(button.title).toBe('在草稿中试用 Send'); expect(remove.getAttribute('aria-label')).toBe('移除工作流 Stop');
  locale.update('en'); expect(button.title).toBe('Try Send in draft'); locale.dispose();
});

it('localizes model-context, task-scope, workflow-source and profile-delete templates while keeping identifiers verbatim', () => {
  const { root, add } = setup();
  const context = add('div', 'zcr-document-context');
  const unknown = add('p', '', 'Model context window: unknown. Figures and complex formulas may need page images. Text is not silently truncated.', context);
  const known = add('p', '', 'Model context window: 12,000 tokens · runtime reported. Last source budget: 8,000 tokens after 4,000 reserved; text sizing is an estimate. Figures and complex formulas may need page images. Text is not silently truncated.', context);
  const card = add('details', 'zcr-task-card'); const body = add('div', 'zcr-task-body', '', card);
  const pdfScope = add('p', 'zcr-task-muted', 'PDF PDFONE01 · candidate pages 1, 3', body);
  const emptyScope = add('p', 'zcr-task-muted', 'PDF PDFONE01 · candidate pages none', body);
  const collectionScope = add('p', 'zcr-task-muted', 'Target collection: My Papers', body);
  const editor = add('div', 'zcr-workspace-editor');
  const source = add('p', 'zcr-workspace-muted', 'Source: user\nPermissions: read, write\nUnsupported dependencies: none', editor);
  const settings = add('div', 'zcr-workspace-settings'); const skill = add('details', '', '', settings); const actions = add('div', 'zcr-workspace-actions', '', skill); const prompt = add('span', '', 'Delete Derive?', actions);
  const locale = mountUILocale(root); locale.update('zh');
  expect(unknown.textContent).toBe('模型上下文窗口：未知。图表和复杂公式可能需要页面图像。不会静默截断文本。');
  expect(known.textContent).toContain('12,000 词元');
  expect(known.textContent).toContain('上次来源预算：预留 4,000 后为 8,000 词元');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · 候选页 1, 3');
  expect(emptyScope.textContent).toBe('PDF PDFONE01 · 候选页 无');
  expect(collectionScope.textContent).toBe('目标分类：My Papers');
  expect(source.textContent).toBe('来源：user\n权限：read, write\n不支持的依赖：无');
  expect(prompt.textContent).toBe('删除 Derive？');
  locale.update('en');
  expect(unknown.textContent).toBe('Model context window: unknown. Figures and complex formulas may need page images. Text is not silently truncated.');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · candidate pages 1, 3');
  expect(prompt.textContent).toBe('Delete Derive?'); locale.dispose();
});

it('stays inside its pane and stops observing after disposal', async () => {
  const { document, root, add } = setup(); const outside = add('button', 'zcr-button', 'Send', document.body); const inside = add('button', 'zcr-button', 'Send');
  const locale = mountUILocale(root); locale.update('zh'); expect(inside.textContent).toBe('发送'); expect(outside.textContent).toBe('Send');
  locale.dispose(); expect(inside.textContent).toBe('Send'); inside.textContent = 'Stop'; locale.update('zh');
  await new Promise(resolve => setTimeout(resolve, 20)); expect(inside.textContent).toBe('Stop');
});

it('localizes completed metadata outcomes, annotation review counts and switches while keeping model captions intact', () => {
  const { root, add } = setup(); const task = add('details', 'zcr-task-card');
  const summary = add('summary', '', 'Acquire literature · Completed · 2 metadata item(s) · 0 PDFs attached', task);
  const header = add('div', 'zcr-task-row-header', '', task); const outcome = add('span', 'zcr-task-muted', 'Metadata saved; PDF unavailable (download failed)', header);
  const review = add('button', 'zcr-button', 'Review 3 annotation suggestions'); review.dataset.zcrAction = 'review-annotations';
  const speed = add('button', 'zcr-switch'); speed.dataset.zcrSetting = 'speed'; speed.setAttribute('aria-label', 'Fast');
  const meta = add('div', 'zcr-message-meta', 'High'); const editor = add('div', 'zcr-workspace-editor'); const editHeading = add('strong', '', 'Edit Send', editor);
  const locale = mountUILocale(root); locale.update('zh');
  expect(summary.textContent).toBe('获取文献 · 已完成 · 2 个元数据条目 · 已附加 0 个 PDF');
  expect(outcome.textContent).toBe('元数据已保存；PDF 不可用（下载失败）'); expect(review.textContent).toBe('审核 3 条标注建议');
  expect(speed.getAttribute('aria-label')).toBe('快速'); expect(meta.textContent).toBe('High'); expect(editHeading.textContent).toBe('编辑 Send');
  locale.update('en'); expect(summary.textContent).toBe('Acquire literature · Completed · 2 metadata item(s) · 0 PDFs attached'); expect(editHeading.textContent).toBe('Edit Send'); locale.dispose();
});
