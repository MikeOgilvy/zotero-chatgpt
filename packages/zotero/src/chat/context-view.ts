import type { DocumentContext, UsageReport } from '../../../contracts/src/index.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import { getPinnedModelCapabilities } from '../../../core/src/codex/model-capabilities.ts';

export interface ContextUsage {
  /** Input tokens from the last runtime usage report; never reconstructed from message text. */
  usedTokens: number;
  window: number | null;
  provenance: 'runtime-reported' | 'pinned-catalog' | 'unknown';
}

/**
 * The runtime reports usage per turn, so this is the last reported input size, not a live count.
 * It stays null for a different model to avoid attributing another model's report to this one.
 */
export function currentContextUsage(modelId: string | null | undefined, usage: UsageReport | null | undefined): ContextUsage | null {
  if (!modelId || !usage || usage.model !== modelId) return null;
  const reported = usage.contextWindow;
  const pinned = getPinnedModelCapabilities(modelId)?.contextWindow ?? null;
  const window = reported ?? pinned;
  return { usedTokens: usage.last.inputTokens, window, provenance: reported != null ? 'runtime-reported' : pinned != null ? 'pinned-catalog' : 'unknown' };
}

export function formatContextTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

export function contextUsageLabel(usage: ContextUsage | null): string {
  if (!usage) return 'Context unknown';
  return usage.window === null ? `Context ${formatContextTokens(usage.usedTokens)} tokens · window unknown` : `Context ${formatContextTokens(usage.usedTokens)} / ${formatContextTokens(usage.window)} tokens`;
}

export function contextUsageTitle(usage: ContextUsage | null): string {
  if (!usage) return 'Current context is unknown: the runtime has not reported usage for this model.';
  const used = usage.usedTokens.toLocaleString('en-US');
  const tail = 'This is the last report, not remaining context.';
  if (usage.window === null) return `Last runtime usage report: ${used} input tokens; the model window is unknown. ${tail}`;
  const window = usage.window.toLocaleString('en-US');
  const origin = usage.provenance === 'runtime-reported' ? 'runtime reported' : 'bundled catalog estimate';
  return `Last runtime usage report: ${used} input tokens; model window ${window} (${origin}). ${tail}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** How much of the ring is filled: used/window when a window is known, otherwise nothing. */
export function contextRingRatio(usage: ContextUsage | null): number | null {
  if (!usage || usage.window === null || usage.window <= 0) return null;
  return Math.min(1, Math.max(0, usage.usedTokens / usage.window));
}

export interface ContextRing { element: HTMLElement; update(usage: ContextUsage | null): void }
/**
 * A small ring instead of a text chip. It fills by used/window when the runtime or the pinned
 * catalog reports a window, and stays neutral when the window is unknown. The numbers live in the
 * hover title and the accessible name, so no token figure occupies the composer's control row.
 */
export function mountContextRing(parent: HTMLElement): ContextRing {
  const doc = parent.ownerDocument;
  const element = doc.createElementNS(HTML_NS, 'span');
  element.className = 'zcr-context-ring'; element.dataset.zcrContextUsage = ''; element.setAttribute('role', 'status');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of [['viewBox', '0 0 20 20'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['focusable', 'false']] as const) svg.setAttribute(name, value);
  const circle = (className: string) => {
    const node = doc.createElementNS(SVG_NS, 'circle');
    node.setAttribute('class', className); node.setAttribute('cx', '10'); node.setAttribute('cy', '10'); node.setAttribute('r', String(RING_RADIUS)); node.setAttribute('fill', 'none');
    return node;
  };
  const track = circle('zcr-context-ring-track');
  const fill = circle('zcr-context-ring-fill');
  fill.setAttribute('transform', 'rotate(-90 10 10)');
  svg.append(track, fill); element.append(svg); parent.append(element);
  const update = (usage: ContextUsage | null) => {
    const ratio = contextRingRatio(usage);
    element.dataset.zcrContextState = ratio === null ? 'unknown' : usage!.provenance;
    fill.setAttribute('stroke-dasharray', `${(RING_CIRCUMFERENCE * (ratio ?? 0)).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
    const title = contextUsageTitle(usage);
    if (element.title !== title) element.title = title;
    if (element.getAttribute('aria-label') !== title) element.setAttribute('aria-label', title);
  };
  update(null);
  return { element, update };
}

/**
 * Compact coverage plus an on-demand local source preview. Never equates parsing with sending.
 *
 * The panel is collapsed on purpose: local preparation runs in the background, so the reader gets a
 * one-line status instead of an expanded block. Nothing here ever sets `open`; only the reader can.
 */
export function mountDocumentContext(parent: HTMLElement, presenter: ConversationPresenter, openPage?: (document: DocumentContext, pageIndex: number) => Promise<void>) {
  const doc = parent.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
    const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.textContent = text; return node;
  };
  const button = (text: string, click: () => void) => { const node = el('button', text); node.type = 'button'; node.className = 'zcr-button'; node.addEventListener('click', click); return node; };
  const details = el('details'); details.className = 'zcr-document-context'; details.dataset.zcrDocumentContext = '';
  details.open = false;
  const summary = el('summary', 'Current PDF'); summary.setAttribute('aria-label', 'Current PDF context');
  const status = el('p'); status.setAttribute('role', 'status');
  const coverage = el('p');
  const limits = el('p', 'Model context window: unknown. Figures and complex formulas may need page images. Text is not silently truncated.');
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
    // The consent prompt is not a permanent banner: it appears only when a request actually needs
    // it, so the collapsed status line stays the only thing above the transcript by default.
    disclosure.hidden = !state.pendingExplain;
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
