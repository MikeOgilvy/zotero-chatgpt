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

it('translates the open-chat strip name while a chat named like a control stays verbatim', () => {
  const { root, add } = setup();
  const strip = add('div', 'zcr-panes'); strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', 'Open chats');
  const tab = add('div', 'zcr-pane-tab', '', strip);
  tab.dataset.zcrPaneTab = ''; tab.dataset.zcrAction = 'select-pane'; tab.setAttribute('aria-selected', 'true'); tab.title = 'Send';
  const label = add('span', 'zcr-pane-tab-label', 'Send', tab);
  const fresh = add('div', 'zcr-pane-tab', '', strip);
  fresh.dataset.zcrPaneTab = ''; fresh.dataset.zcrConversationId = 'new-chat'; fresh.setAttribute('aria-label', 'New chat');
  const freshLabel = add('span', 'zcr-pane-tab-new', 'New chat', fresh);
  const locale = mountUILocale(root); locale.update('zh');
  expect(strip.getAttribute('aria-label')).toBe('已打开的对话');
  // A chip carries the chat's own name: a chat called "Send" keeps that name on screen and for AT.
  expect(label.textContent).toBe('Send');
  expect(tab.title).toBe('Send');
  // The unbound New chat tab is copy, unlike named titles.
  expect(freshLabel.textContent).toBe('新建对话');
  expect(fresh.getAttribute('aria-label')).toBe('新建对话');
  locale.update('en');
  expect(strip.getAttribute('aria-label')).toBe('Open chats');
  expect(freshLabel.textContent).toBe('New chat');
  locale.dispose();
});

it('never translates source, chat, history, candidate, profile or workflow content even when it matches a control', () => {
  const { root, add } = setup(); const protectedNodes: HTMLElement[] = [];
  for (const className of ['zcr-current-title', 'zcr-initial-title', 'zcr-history-item', 'zcr-pane-tab-label', 'zcr-command-option', 'zcr-message-text', 'zcr-message-reference', 'zcr-citation-text', 'zcr-task-question', 'zcr-task-quote', 'zcr-task-scope']) {
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
  const { document, root, add } = setup(); const settings = add('div', 'zcr-preferences');
  const label = add('label', '', '  Instructions\n', settings); const select = add('select', '', '', label); select.name = 'paper'; select.dataset.zcrHistory = 'paper';
  const all = add('option', '', 'All papers', select); all.value = ''; const busy = add('option', '', 'work in progress', select); busy.value = 'busy'; select.value = 'busy'; select.focus();
  const textNode = label.firstChild; const locale = mountUILocale(root); locale.update('zh');
  expect(label.firstChild).toBe(textNode); expect(textNode!.textContent).toBe('  指令\n'); expect(all.textContent).toBe('全部文献');
  expect(select.value).toBe('busy'); expect(select.name).toBe('paper'); expect(document.activeElement).toBe(select);
  locale.update('en'); expect(textNode!.textContent).toBe('  Instructions\n'); expect(busy.textContent).toBe('work in progress'); locale.dispose();
});

it('localizes controls added by later renders and restores the latest externally authored status', async () => {
  const { root, add } = setup(); const status = add('p', 'zcr-status-line', 'Responding…');
  const locale = mountUILocale(root); locale.update('zh'); expect(status.textContent).toBe('正在回答…');
  status.firstChild!.textContent = 'Stopped'; const button = add('button', 'zcr-task-button', 'Reconcile task'); button.setAttribute('aria-label', 'Reconcile task');
  await vi.waitFor(() => { expect(status.textContent).toBe('已停止'); expect(button.textContent).toBe('核对任务状态'); expect(button.getAttribute('aria-label')).toBe('核对任务状态'); });
  locale.update('en'); expect(status.textContent).toBe('Stopped'); expect(button.textContent).toBe('Reconcile task'); locale.dispose();
});

it('translates only fixed task progress templates while preserving identifiers', () => {
  const { root, add } = setup(); const task = add('details', 'zcr-task-card'); task.dataset.zcrTaskId = 'one'; const summary = add('summary', '', 'Annotations · Review · 2/3 selected', task);
  const counts = add('p', 'zcr-task-counts', '2 ready · 1 unresolved', task);
  const reading = add('details', 'zcr-task-card'); reading.dataset.zcrReadingJob = 'job'; const progress = add('summary', '', 'Reading · running · 1/3 passes', reading);
  const locale = mountUILocale(root); locale.update('zh');
  expect(summary.textContent).toBe('标注 · 待审核 · 已选择 2/3'); expect(counts.textContent).toBe('2 待处理 · 1 未定位');
  expect(progress.textContent).toBe('阅读 · 运行中 · 1/3 轮');
  locale.update('en'); expect(summary.textContent).toBe('Annotations · Review · 2/3 selected'); expect(progress.textContent).toBe('Reading · running · 1/3 passes'); locale.dispose();
});

it('translates skill chip action labels without translating the skill name', () => {
  const { root, add } = setup();
  const preview = add('button', 'zcr-workspace-control', '/Send'); preview.setAttribute('aria-label', 'Preview skill Send'); preview.title = 'Preview skill Send';
  const remove = add('button', 'zcr-workspace-control', '×'); remove.setAttribute('aria-label', 'Remove skill Stop');
  const locale = mountUILocale(root); locale.update('zh');
  expect(preview.textContent).toBe('/Send'); expect(preview.title).toBe('预览 skill Send'); expect(remove.getAttribute('aria-label')).toBe('移除 skill Stop');
  locale.update('en'); expect(preview.title).toBe('Preview skill Send'); expect(remove.getAttribute('aria-label')).toBe('Remove skill Stop'); locale.dispose();
});

it('localizes task-scope, workflow-source and profile-delete templates while keeping identifiers verbatim', () => {
  const { root, add } = setup();
  const card = add('details', 'zcr-task-card'); const body = add('div', 'zcr-task-body', '', card);
  const pdfScope = add('p', 'zcr-task-muted', 'PDF PDFONE01 · candidate pages 1, 3', body);
  const emptyScope = add('p', 'zcr-task-muted', 'PDF PDFONE01 · candidate pages none', body);
  const collectionScope = add('p', 'zcr-task-muted', 'Target collection: My Papers', body);
  const editor = add('div', 'zcr-workspace-editor');
  const source = add('p', 'zcr-workspace-muted', 'Source: user\nPermissions: read, write\nUnsupported dependencies: none', editor);
  const settings = add('div', 'zcr-workspace-settings'); const skill = add('details', '', '', settings); const actions = add('div', 'zcr-workspace-actions', '', skill); const prompt = add('span', '', 'Delete Derive?', actions);
  const locale = mountUILocale(root); locale.update('zh');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · 候选页 1, 3');
  expect(emptyScope.textContent).toBe('PDF PDFONE01 · 候选页 无');
  expect(collectionScope.textContent).toBe('目标分类：My Papers');
  expect(source.textContent).toBe('来源：user\n权限：read, write\n不支持的依赖：无');
  expect(prompt.textContent).toBe('删除 Derive？');
  locale.update('en');
  expect(pdfScope.textContent).toBe('PDF PDFONE01 · candidate pages 1, 3');
  expect(prompt.textContent).toBe('Delete Derive?'); locale.dispose();
});

it('localizes the context ring accessible report in both directions', () => {
  const { root, add } = setup();
  const ring = add('span', 'zcr-context-ring', ''); ring.dataset.zcrContextState = 'runtime-reported';
  ring.setAttribute('aria-label', 'Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.');
  ring.title = 'Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.';
  const unknown = add('span', 'zcr-context-ring', ''); unknown.setAttribute('aria-label', 'Current context is unknown: the runtime has not reported usage for this model.');
  const noWindow = add('span', 'zcr-context-ring', ''); noWindow.setAttribute('aria-label', 'Last runtime usage report: 12,300 input tokens; the model window is unknown. This is the last report, not remaining context.');
  const locale = mountUILocale(root); locale.update('zh');
  // The ring never carries text: only its accessible report is localized.
  expect(ring.textContent).toBe('');
  expect(ring.getAttribute('aria-label')).toBe('上次运行时用量报告：12,345 个输入词元；模型窗口 128,000（运行时报告）。这是上次报告，并非剩余空间。');
  expect(ring.title).toBe('上次运行时用量报告：12,345 个输入词元；模型窗口 128,000（运行时报告）。这是上次报告，并非剩余空间。');
  expect(unknown.getAttribute('aria-label')).toBe('当前上下文未知：运行时尚未报告此模型的用量。');
  expect(noWindow.getAttribute('aria-label')).toBe('上次运行时用量报告：12,300 个输入词元；模型窗口未知。这是上次报告，并非剩余空间。');
  locale.update('en');
  expect(ring.getAttribute('aria-label')).toBe('Last runtime usage report: 12,345 input tokens; model window 128,000 (runtime reported). This is the last report, not remaining context.');
  expect(unknown.getAttribute('aria-label')).toBe('Current context is unknown: the runtime has not reported usage for this model.'); locale.dispose();
});

it('localizes the context coverage disclosure while keeping counts and the planner reason verbatim', () => {
  const { document, root, add } = setup();
  const details = add('div', 'zcr-context-details');
  const title = add('p', 'zcr-context-details-title', 'Context supplied to the last request', details); title.setAttribute('data-zcr-ui', 'true');
  // Mirrors the real `line()` shape: label span, a literal space, then the value span.
  const row = (label: string, value: string) => {
    const line = add('p', 'zcr-context-detail', '', details);
    const name = add('span', 'zcr-context-detail-label', label, line); name.setAttribute('data-zcr-ui', 'true');
    const text = add('span', 'zcr-context-detail-value', value, line); text.setAttribute('data-zcr-ui', 'true');
    text.before(document.createTextNode(' '));
    return text;
  };
  const pagesValue = row('Pages supplied', '14 of 312 pages');
  const windowValue = row('Model window', '128,000 tokens (runtime reported)');
  const allowanceValue = row('Text allowance', 'not asserted');
  const setValue = row('Page numbers', '1–4, 7, and 3 more');
  const noFit = add('p', 'zcr-context-detail zcr-context-detail-nofit', 'Fit was not asserted: model capacity or retained history is unknown.', details); noFit.setAttribute('data-zcr-ui', 'true');
  // The planner's recorded reason has no `data-zcr-ui` marker, so it is data, not copy.
  const reason = add('p', 'zcr-context-detail-reason', 'Recorded source gaps: 3 pages with no text, and 2 more.', details);
  const locale = mountUILocale(root); locale.update('zh');
  expect(title.textContent).toBe('上次请求提供的上下文');
  expect(details.querySelector('.zcr-context-detail-label')!.textContent).toBe('已提供页数');
  // Counts, page sets and token figures are re-emitted verbatim; only the phrase changes.
  expect(pagesValue.textContent).toBe('14 / 312 页');
  expect(windowValue.textContent).toBe('128,000 词元（运行时报告）');
  expect(allowanceValue.textContent).toBe('未断言');
  expect(setValue.textContent).toBe('1–4, 7，另有 3 个');
  expect(noFit.textContent).toBe('未断言是否适配：模型容量或保留的历史记录未知。');
  expect(reason.textContent).toBe('Recorded source gaps: 3 pages with no text, and 2 more.');
  locale.update('en');
  expect(pagesValue.textContent).toBe('14 of 312 pages');
  expect(windowValue.textContent).toBe('128,000 tokens (runtime reported)');
  expect(setValue.textContent).toBe('1–4, 7, and 3 more');
  expect(reason.textContent).toBe('Recorded source gaps: 3 pages with no text, and 2 more.'); locale.dispose();
});

it('localizes the honest elapsed-time states while keeping the measured seconds verbatim', () => {
  const { root, add } = setup();
  const waiting = add('p', 'zcr-request-timing'); add('span', 'zcr-request-timing-text', 'Waiting 7s', waiting);
  const answered = add('p', 'zcr-request-timing'); add('span', 'zcr-request-timing-text', 'Answered in 42s', answered);
  const unknown = add('p', 'zcr-request-timing'); add('span', 'zcr-request-timing-text', 'Elapsed time unavailable', unknown);
  const locale = mountUILocale(root); locale.update('zh');
  expect(waiting.textContent).toBe('等待 7 秒');
  expect(answered.textContent).toBe('回答用时 42 秒');
  expect(unknown.textContent).toBe('耗时无法确定');
  locale.update('en');
  expect(waiting.textContent).toBe('Waiting 7s'); expect(answered.textContent).toBe('Answered in 42s'); locale.dispose();
});

it('localizes the local PDF read failures the composer alert can now show', () => {
  const { root, add } = setup();
  const timedOut = add('p', 'zcr-error', 'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.');
  const unreadable = add('p', 'zcr-error', 'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.');
  const changed = add('p', 'zcr-error', 'The PDF file changed while this reader was open. Reopen it to load the current version.');
  const empty = add('p', 'zcr-error', 'No extractable text was found in the pages supplied from this PDF. Attach the relevant page image if you want to ask about them.');
  const locale = mountUILocale(root); locale.update('zh');
  // The three local causes stay distinct in Chinese: timeout, unreadable, and a changed revision.
  expect(timedOut.textContent).toBe('当前 PDF 未能及时加载完成，无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。');
  expect(unreadable.textContent).toBe('当前 PDF 无法在本地读取。请等待其加载完成或重新打开；你的问题已保留。');
  expect(changed.textContent).toBe('此阅读器打开期间 PDF 文件已更改。请重新打开以载入当前版本。');
  expect(empty.textContent).toBe('从此 PDF 提供的页面中未找到可提取的文本。如需就此提问，请附加相关页面图像。');
  locale.update('en');
  expect(timedOut.textContent).toBe('The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.');
  expect(unreadable.textContent).toBe('The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.');
  locale.dispose();
});

it('localizes the close-chat control without touching the destructive delete label', () => {
  const { root, add } = setup();
  const close = add('button', 'zcr-current-close'); close.dataset.zcrAction = 'close-conversation'; close.setAttribute('aria-label', 'Close chat'); close.title = 'Close chat';
  const del = add('button', 'zcr-icon-button'); del.dataset.zcrAction = 'delete-conversation'; del.setAttribute('aria-label', 'Delete chat');
  const locale = mountUILocale(root); locale.update('zh');
  expect(close.getAttribute('aria-label')).toBe('关闭对话');
  expect(close.title).toBe('关闭对话');
  expect(del.getAttribute('aria-label')).toBe('删除对话');
  locale.update('en');
  expect(close.getAttribute('aria-label')).toBe('Close chat');
  expect(close.title).toBe('Close chat'); locale.dispose();
});

it('translates the local reading status and re-emits every page count verbatim', () => {
  const { root, add } = setup();
  const all = add('p', 'zcr-document-status', 'Read all 12 pages locally');
  const some = add('p', 'zcr-document-status', 'Read 8 of 12 pages locally');
  const waiting = add('p', 'zcr-document-status', 'Reading this PDF… 3 of 12 pages');
  const alone = add('p', 'zcr-document-status', 'Reading this PDF…');
  const none = add('p', 'zcr-document-status', 'No text could be read from this PDF locally');
  const locale = mountUILocale(root); locale.update('zh');
  expect(all.textContent).toBe('已在本地读取全部 12 页');
  expect(some.textContent).toBe('已在本地读取 12 页中的 8 页');
  expect(waiting.textContent).toBe('正在读取此 PDF……第 3/12 页');
  expect(alone.textContent).toBe('正在读取此 PDF……');
  expect(none.textContent).toBe('无法在本地从此 PDF 提取到文本');
  locale.update('en');
  expect(some.textContent).toBe('Read 8 of 12 pages locally'); locale.dispose();
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

it('translates the plus section headings and each row title and description', () => {
  const { add } = setup();
  const group = add('div', 'zcr-plus-group');
  add('div', 'zcr-plus-heading', 'Attach', group);
  add('div', 'zcr-plus-heading', 'Reference', group);
  const row = add('button', 'zcr-plus-row', '', group);
  row.dataset.zcrAction = 'pick-file'; row.setAttribute('aria-label', 'Attach file…'); row.title = 'Attach file…';
  const title = add('span', 'zcr-plus-row-title', 'Attach file…', row);
  const description = add('span', 'zcr-plus-row-description', 'Text or image from your computer', row);
  const locale = mountUILocale(group); locale.update('zh');
  const headings = [...group.querySelectorAll<HTMLElement>('.zcr-plus-heading')].map(node => node.textContent);
  expect(headings).toEqual(['添加附件', '引用']);
  expect(title.textContent).toBe('附加文件…');
  expect(description.textContent).toBe('来自你电脑的文本或图片');
  expect(row.getAttribute('aria-label')).toBe('附加文件…'); expect(row.title).toBe('附加文件…');
  locale.update('en'); expect(title.textContent).toBe('Attach file…'); expect(description.textContent).toBe('Text or image from your computer'); locale.dispose();
});

it('translates the attach-file row and the file refusals while leaving the file name verbatim', () => {
  const { root, add } = setup();
  const row = add('button', 'zcr-plus-row', ''); row.dataset.zcrAction = 'pick-file';
  row.setAttribute('aria-label', 'Attach file…'); row.title = 'Attach file…';
  const title = add('span', 'zcr-plus-row-title', 'Attach file…', row);
  const description = add('span', 'zcr-plus-row-description', 'Text or image from your computer', row);
  const error = add('div', 'zcr-error', 'This file has no text to attach.');
  const empty = add('div', 'zcr-error', 'This file is not UTF-8 text, so it cannot become text context. Attach a text file or an image.');
  // An attached file is data, so its own name is never translated, even when it matches a UI word.
  const chip = add('div', 'zcr-workspace-chip', 'Send');
  const locale = mountUILocale(root); locale.update('zh');
  expect(title.textContent).toBe('附加文件…');
  expect(description.textContent).toBe('来自你电脑的文本或图片');
  expect(row.getAttribute('aria-label')).toBe('附加文件…'); expect(row.title).toBe('附加文件…');
  expect(error.textContent).toBe('此文件没有可附加的文本。');
  expect(empty.textContent).toBe('此文件不是 UTF-8 文本，无法作为文本上下文。请附加文本文件或图片。');
  expect(chip.textContent).toBe('Send');
  locale.update('en'); expect(title.textContent).toBe('Attach file…'); expect(error.textContent).toBe('This file has no text to attach.'); locale.dispose();
});
