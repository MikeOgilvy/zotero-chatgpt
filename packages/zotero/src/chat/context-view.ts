import type { DocumentContext } from '../../../contracts/src/index.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';

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
  const controls = el('div'); controls.className = 'zcr-context-range';
  const first = el('input'); const last = el('input');
  for (const [node, label] of [[first, 'First PDF page'], [last, 'Last PDF page']] as const) { node.type = 'number'; node.min = '1'; node.placeholder = label; node.setAttribute('aria-label', label); }
  controls.append(first, last, button('Use pages', () => presenter.setDocumentRange(Number(first.value), Number(last.value))), button('Whole PDF', () => presenter.setDocumentRange(null, null)));
  const preview = el('div'); preview.className = 'zcr-context-pages';
  details.append(summary, status, coverage, controls, limits, preview);
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
    const recorded = state.conversation?.messages.filter(m => m.role === 'user' && m.document).at(-1)?.document;
    const nextKey = JSON.stringify([current.enabled, current.phase, current.progress, current.error, current.range, prepared?.id, recorded?.id]);
    if (nextKey === key) return; key = nextKey;
    details.dataset.zcrContextPhase = current.phase;
    details.dataset.zcrContextTextPages = String(prepared?.pages.filter(p => p.status === 'text').length ?? 0);
    details.dataset.zcrContextTotalPages = String(prepared?.totalPages ?? 0);
    const count = prepared?.pages.filter(p => p.status === 'text').length ?? 0;
    summary.textContent = !current.enabled ? 'Current PDF · automatic text off'
      : current.phase === 'preparing' ? `Preparing PDF · ${current.progress.done}/${current.progress.total || '?'}`
      : prepared ? `Current PDF · ${count}/${prepared.totalPages} pages with text` : 'Current PDF · text not ready';
    status.textContent = current.error ?? (recorded?.id === prepared?.id && recorded ? 'Included in a recorded request. Request completion is shown in the conversation.' : 'Local preparation only — not sent to Codex.');
    coverage.textContent = prepared ? `Local text: ${count}/${prepared.totalPages} pages. ${prepared.pages.filter(p => p.status === 'empty').length} pages have no text; ${prepared.pages.filter(p => p.status === 'error').length} extraction errors; ${prepared.pages.filter(p => p.partial).length} partial pages. ${prepared.totalPages - prepared.pages.length} pages outside the selected range.` : 'Only this PDF is in scope. Other tabs and your library are not included.';
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
