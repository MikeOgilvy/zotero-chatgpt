import type { Conversation, DocumentContext, DocumentRevision, DocumentSummary, Message, PaperScope } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { normalizeQuote } from '../reader/locate.ts';
import type { SourceOpenOutcome } from '../reader/source-highlight.ts';

export interface AnswerSource {
  id: string;
  paper: PaperScope;
  revision: DocumentRevision;
  pages: Array<{ pageIndex: number; pageLabel: string }>;
}

/** Frozen document identity needed to re-open a page: scope plus the exact revision to verify. */
export type DocumentPageTarget = Pick<DocumentContext, 'paper' | 'revision'>;

const INTERNAL_HOST = 'zcr.invalid';
const UNAVAILABLE_TEXT = 'This source is not available in this answer.';
const OPEN_FAILED_TEXT = 'The source could not be opened. Reopen the PDF and try again.';
export const UNLOCATED_SOURCE_TEXT = 'Opened the cited page, but the exact passage could not be located.';

interface Binding {
  source: AnswerSource;
  pageIndex: number;
  /** Normalized verbatim quote from the model's link title, or null when none was usable. */
  quote: string | null;
  open: (source: AnswerSource, pageIndex: number, quote: string | null) => Promise<SourceOpenOutcome | void>;
}

interface InternalAttempt {
  id: string | null;
  pageIndex: number | null;
}

/** Original Markdown href, retained after the live attribute is removed, so rebinding stays stable. */
const originalHref = new WeakMap<HTMLAnchorElement, string>();
const bindings = new WeakMap<HTMLAnchorElement, Binding>();
const statuses = new WeakMap<HTMLAnchorElement, HTMLElement>();
const wired = new WeakSet<HTMLAnchorElement>();
const pending = new WeakSet<HTMLAnchorElement>();

function parseInternalReference(href: string | null): InternalAttempt | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // Any link aimed at the reserved citation host is treated as an internal attempt, even when the
  // shape is wrong (trailing dot, userinfo, query/hash, bad path). Only an exact match is usable.
  if (url.hostname.replace(/\.$/u, '') !== INTERNAL_HOST) return null;
  const attempt: InternalAttempt = { id: null, pageIndex: null };
  if (url.hostname !== INTERNAL_HOST) return attempt;
  if (url.username || url.password || url.port) return attempt;
  if (url.search || url.hash) return attempt;
  const parts = url.pathname.split('/');
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'source' || parts[2] === '') return attempt;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(parts[3]!)) return attempt;
  const pageIndex = Number(parts[3]);
  if (!Number.isSafeInteger(pageIndex)) return attempt;
  return { id: parts[2]!, pageIndex };
}

function deepFreezeSource(source: AnswerSource): AnswerSource {
  // Gecko plugin sandboxes do not expose `structuredClone`; use the contract-safe deep copy.
  const frozen = clone(source);
  Object.freeze(frozen.paper);
  Object.freeze(frozen.revision);
  for (const page of frozen.pages) Object.freeze(page);
  Object.freeze(frozen.pages);
  return Object.freeze(frozen);
}

function statusFor(anchor: HTMLAnchorElement): HTMLElement | null {
  const existing = statuses.get(anchor);
  if (existing && existing.parentNode) return existing;
  const parent = anchor.parentNode;
  if (!parent) return null;
  const status = anchor.ownerDocument.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  anchor.after(status);
  statuses.set(anchor, status);
  return status;
}

function setStatus(anchor: HTMLAnchorElement, text: string): void {
  const status = statusFor(anchor);
  if (!status) return;
  status.textContent = text;
}

function clearStatus(anchor: HTMLAnchorElement): void {
  const status = statuses.get(anchor);
  if (!status) return;
  status.remove();
  statuses.delete(anchor);
}

async function openOnce(anchor: HTMLAnchorElement, binding: Binding): Promise<void> {
  if (pending.has(anchor)) return;
  pending.add(anchor);
  try {
    const outcome = await binding.open(binding.source, binding.pageIndex, binding.quote);
    if (outcome === 'unlocated') setStatus(anchor, UNLOCATED_SOURCE_TEXT);
    else clearStatus(anchor);
  } catch {
    setStatus(anchor, OPEN_FAILED_TEXT);
  } finally {
    pending.delete(anchor);
  }
}

function stopInteractive(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function handleClick(event: Event): void {
  const anchor = event.currentTarget as HTMLAnchorElement;
  stopInteractive(event);
  const binding = bindings.get(anchor);
  if (binding) void openOnce(anchor, binding);
}

function handleKeydown(event: Event): void {
  const keyboard = event as KeyboardEvent;
  if (keyboard.key !== 'Enter' || keyboard.isComposing) return;
  const anchor = event.currentTarget as HTMLAnchorElement;
  const binding = bindings.get(anchor);
  if (!binding) return;
  stopInteractive(event);
  void openOnce(anchor, binding);
}

function handleBlocked(event: Event): void {
  stopInteractive(event);
}

function wire(anchor: HTMLAnchorElement): void {
  if (wired.has(anchor)) return;
  wired.add(anchor);
  anchor.addEventListener('click', handleClick);
  anchor.addEventListener('keydown', handleKeydown);
  anchor.addEventListener('auxclick', handleBlocked);
  anchor.addEventListener('contextmenu', handleBlocked);
  anchor.addEventListener('dragstart', handleBlocked);
}

function unbind(anchor: HTMLAnchorElement): void {
  bindings.delete(anchor);
  anchor.removeAttribute('data-zcr-source');
  anchor.removeAttribute('data-zcr-page');
}

/**
 * Citation authority for one rendered answer: the frozen document summaries that the matching
 * request actually supplied. Derived only from persisted message data (`document`, `references`
 * and `referenceDocuments`); no live cache or current-viewer text is consulted, so a stored answer
 * keeps the exact paper scopes and revisions it was answered against.
 *
 * A document without a resolvable `PaperScope` (for example a chat snapshot reference) is omitted.
 * `linkAnswerSources` then reports that citation's link as unavailable instead of dropping it.
 */
export function answerSources(conversation: Conversation, message: Message): AnswerSource[] {
  if (message.role !== 'assistant') return [];
  const byId = new Map<string, AnswerSource>();
  const record = (summary: DocumentSummary, paper: PaperScope | undefined) => {
    if (!paper || byId.has(summary.id)) return;
    byId.set(summary.id, {
      id: summary.id,
      paper: { ...paper },
      revision: { ...summary.revision },
      pages: summary.pages.map(page => ({ pageIndex: page.pageIndex, pageLabel: page.pageLabel })),
    });
  };
  for (const request of conversation.messages) {
    if (request.role !== 'user' || request.requestId !== message.requestId) continue;
    if (request.document) record(request.document, conversation.paper);
    for (const source of request.referenceDocuments ?? []) {
      record(source.document, request.references?.find(reference => reference.id === source.referenceId)?.paper);
    }
  }
  return [...byId.values()];
}

/** Neutralize one citation without touching the rest of the rendered answer. */
function degrade(anchor: HTMLAnchorElement): void {
  bindings.delete(anchor);
  anchor.removeAttribute('href');
  anchor.removeAttribute('data-zcr-source');
  anchor.removeAttribute('data-zcr-page');
  anchor.setAttribute('aria-disabled', 'true');
  try { setStatus(anchor, UNAVAILABLE_TEXT); } catch { /* the answer still renders without a status */ }
}

/**
 * Rewrites frozen answer citations into keyboard-operable anchors.
 *
 * Only `https://zcr.invalid/source/<id>/<page>` links whose source and page are present in
 * `sources` become live. Everything else keeps its original behaviour; unsupported internal
 * links are disabled with a constant explanation. Click authority is captured in a closure so
 * later DOM or caller mutations cannot retarget an already-linked citation.
 *
 * Each anchor is isolated: a malformed citation must never throw out of this function and blank
 * the whole answer, and a failure must never leave a reserved `zcr.invalid` link live.
 */
export function linkAnswerSources(
  fragment: DocumentFragment,
  sources: AnswerSource[],
  open: (source: AnswerSource, pageIndex: number, quote: string | null) => Promise<SourceOpenOutcome | void>,
): void {
  const byId = new Map(sources.map(source => [source.id, source]));
  for (const anchor of fragment.querySelectorAll('a')) {
    try {
      const reference = parseInternalReference(originalHref.get(anchor) ?? anchor.getAttribute('href'));
      if (!reference) {
        unbind(anchor);
        clearStatus(anchor);
        continue;
      }
      originalHref.set(anchor, originalHref.get(anchor) ?? anchor.getAttribute('href')!);
      wire(anchor);
      const pageIndex = reference.pageIndex;
      const source = reference.id === null || pageIndex === null ? undefined : byId.get(reference.id);
      const page = source?.pages.find(candidate => candidate.pageIndex === pageIndex);
      if (!source || !page || pageIndex === null) {
        degrade(anchor);
        continue;
      }
      anchor.removeAttribute('href');
      anchor.removeAttribute('aria-disabled');
      anchor.dataset.zcrSource = source.id;
      anchor.dataset.zcrPage = String(pageIndex);
      anchor.textContent = `p. ${page.pageLabel}`;
      clearStatus(anchor);
      // The link title is untrusted model text; it only ever becomes a literal search string.
      const quote = normalizeQuote(anchor.getAttribute('title'));
      bindings.set(anchor, { source: deepFreezeSource(source), pageIndex, quote, open });
    } catch {
      degrade(anchor);
    }
  }
}
