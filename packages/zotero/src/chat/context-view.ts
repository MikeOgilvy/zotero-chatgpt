import type { DocumentContext } from '../../../contracts/src/index.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import { getPinnedModelCapabilities } from '../../../core/src/codex/model-capabilities.ts';

/** Compact coverage plus an on-demand local source preview. Never equates parsing with sending. */
export function mountDocumentContext(parent: HTMLElement, settings: HTMLElement, presenter: ConversationPresenter, openPage?: (document: DocumentContext, pageIndex: number) => Promise<void>) {
  const doc = parent.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.textContent = text; return node;
  };
  const button = (text: string, click: () => void) => { const node = el('button', text); node.type = 'button'; node.className = 'zcr-button'; node.addEventListener('click', click); return node; };
  const checkLabel = el('label', 'Use current PDF text automatically');
  const enabled = el('input'); enabled.type = 'checkbox'; enabled.dataset.zcrAutomaticPdf = '';
  enabled.addEventListener('change', () => presenter.setDocumentEnabled(enabled.checked));
  checkLabel.prepend(enabled);
  settings.append(checkLabel, el('p', 'Changes affect future requests. Earlier text remains in this chat; start a new chat to exclude it.'));
  const details = el('details'); details.className = 'zcr-document-context'; details.dataset.zcrDocumentContext = '';
  const summary = el('summary', 'Current PDF'); summary.setAttribute('aria-label', 'Current PDF context');
  const status = el('p'); status.setAttribute('role', 'status');
  const coverage = el('p');
  const limits = el('p', 'Model context window: unknown. Text is not silently truncated. Figures and complex formulas may need page images.');
  const sent = el('div'); sent.className = 'zcr-sent-context'; sent.dataset.zcrSentContext = '';
  const controls = el('div'); controls.className = 'zcr-context-range';
  const first = el('input'); const last = el('input');
  for (const [node, label] of [[first, 'First PDF page'], [last, 'Last PDF page']] as const) { node.type = 'number'; node.min = '1'; node.placeholder = label; node.setAttribute('aria-label', label); }
  controls.append(first, last, button('Use pages', () => presenter.setDocumentRange(Number(first.value), Number(last.value))), button('Whole PDF', () => presenter.setDocumentRange(null, null)));
  const preview = el('div'); preview.className = 'zcr-context-pages';
  details.append(summary, status, coverage, controls, limits, sent, preview);
  const disclosure = el('div'); disclosure.className = 'zcr-context-disclosure'; disclosure.dataset.zcrContextDisclosure = '';
  const disclosureCopy = el('p', 'When you send, extracted text from this PDF, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic PDF text off in Settings.');
  const acknowledge = button('Continue with current PDF', () => presenter.acknowledgeContext());
  disclosure.append(disclosureCopy, acknowledge); parent.append(disclosure, details);
  let key = '';
  return { update(state: PresenterState): void {
    enabled.checked = state.document.enabled;
    disclosure.hidden = !state.document.disclosure || !state.document.enabled;
    acknowledge.hidden = !state.pendingExplain;
    const current = state.document; const prepared = current.prepared;
    const request = state.conversation?.messages.filter(m => m.role === 'user').at(-1);
    const recorded = request?.document;
    const modelId = state.draft.settings?.model ?? state.conversation?.settings.model;
    const usage = state.conversation?.usage;
    const report = request?.contextReport;
    const measured = usage && usage.model === modelId ? usage.contextWindow : null;
    const pinned = modelId ? getPinnedModelCapabilities(modelId) : null;
    const capacity = measured ?? pinned?.contextWindow;
    const nextKey = JSON.stringify([current.enabled, current.phase, current.progress, current.error, current.range, prepared?.id, request?.id, usage, modelId]);
    if (nextKey === key) return; key = nextKey;
    details.dataset.zcrContextPhase = current.phase;
    details.dataset.zcrContextTextPages = String(prepared?.pages.filter(p => p.status === 'text').length ?? 0);
    details.dataset.zcrContextTotalPages = String(prepared?.totalPages ?? 0);
    const count = prepared?.pages.filter(p => p.status === 'text').length ?? 0;
    summary.textContent = !current.enabled ? 'Current PDF · automatic text off'
      : current.phase === 'preparing' ? `Preparing PDF · ${current.progress.done}/${current.progress.total || '?'}`
      : prepared ? `Current PDF · ${count}/${prepared.totalPages} pages with text` : 'Current PDF · text not ready';
    status.textContent = current.error ?? (recorded && prepared && (recorded.sourceId ?? recorded.id) === (prepared.sourceId ?? prepared.id) ? 'Source included in a recorded request. Its exact page coverage is listed below.' : 'Local preparation only — not sent to Codex.');
    coverage.textContent = prepared ? `Local text: ${count}/${prepared.totalPages} pages. ${prepared.pages.filter(p => p.status === 'empty').length} pages have no text; ${prepared.pages.filter(p => p.status === 'error').length} extraction errors; ${prepared.pages.filter(p => p.partial).length} partial pages. ${prepared.totalPages - prepared.pages.length} pages outside the selected range.` : 'Only this PDF is in scope. Other tabs and your library are not included.';
    limits.textContent = `Model context window: ${capacity ? `${capacity.toLocaleString()} tokens · ${measured ? 'runtime reported' : 'bundled catalog estimate'}` : 'unknown'}. ${report?.textBudgetTokens != null ? `Last source budget: ${report.textBudgetTokens.toLocaleString()} tokens after ${report.reservedTokens?.toLocaleString() ?? '?'} reserved; text sizing is an estimate. ` : ''}Figures and complex formulas may need page images. Text is not silently truncated.`;
    sent.replaceChildren();
    if (request) {
      sent.append(el('strong', 'Last recorded request'));
      sent.append(el('p', `${recorded ? `Current PDF: ${recorded.pages.map(page => page.pageLabel).join(', ')} (${recorded.pages.length}/${recorded.totalPages} pages).` : 'No raw current-PDF text in this request.'} ${request.images?.length ?? 0} attached images; ${request.citations.length} selections.`));
      if (report) sent.append(el('p', `${report.mode} · ${report.reason}`));
      for (const reference of request.references ?? []) {
        const source = request.referenceDocuments?.find(source => source.referenceId === reference.id)?.document;
        sent.append(el('p', `${reference.kind === 'chat' ? 'Chat snapshot' : 'Article'}: ${reference.label}${source ? ` · ${source.pages.length}/${source.totalPages} pages · version ${source.revision.sha256?.slice(0, 8) ?? 'unverified'}` : ''}`));
      }
      if (request.workflow?.skill) sent.append(el('p', `Workflow: ${request.workflow.skill.name} · v${request.workflow.skill.version}. Permissions come from the selected operation.`));
      if (usage) sent.append(el('p', `Last runtime usage: ${usage.last.inputTokens.toLocaleString()} input + ${usage.last.outputTokens.toLocaleString()} output tokens. Cumulative usage: ${usage.total.totalTokens.toLocaleString()}; this is not remaining context.`));
      sent.append(el('p', 'Included material describes what was supplied. The answer’s citations identify the evidence the model claims to use.'));
    }
    first.value = current.range ? String(current.range[0]) : ''; last.value = current.range ? String(current.range[1]) : '';
    preview.replaceChildren();
    if (!prepared) return;
    let shown = 0;
    const more = button('Show more pages', () => addPages());
    const addPages = () => {
      more.remove();
      for (const page of prepared.pages.slice(shown, shown + 50)) {
        const row = el('details'); const label = el('summary', `p. ${page.pageLabel} · ${page.partial ? 'partial extraction' : page.status === 'text' ? 'text extracted' : page.status === 'empty' ? 'no text' : 'extraction failed'}`);
        row.append(label);
        if (openPage) row.append(button('Open page', () => { void openPage(prepared, page.pageIndex).catch(() => { status.textContent = 'The source could not be located. Reopen the PDF and check its version.'; }); }));
        row.addEventListener('toggle', () => {
          if (row.open && !row.querySelector('pre')) { const text = el('pre', page.text || 'No text available for this page.'); text.className = 'zcr-source-text'; row.append(text); }
        });
        preview.append(row);
      }
      shown += 50; if (shown < prepared.pages.length) preview.append(more);
    };
    addPages();
  } };
}
