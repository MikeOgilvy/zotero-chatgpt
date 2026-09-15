import { requestProgress, type Citation, type ContextReport, type Conversation, type ImageAttachment, type Message, type RequestTiming } from '../../../contracts/src/index.ts';
import type { HistoryEntry } from '../../../contracts/src/workspace.ts';
import { currentContextUsage, mountContextRing } from './context-view.ts';
import { mountWorkspaceView } from './workspace-view.ts';
import { mountTaskView } from './task-view.ts';
import { mountUILocale } from './ui-locale.ts';
import { previewChatId, readableColumnCount } from './pane-layout.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import {
  applyComposerChoice, composerControls, effortLabel, modelChipLabel, resolveFastTier, settingsCaption,
} from './generation-settings.ts';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from './render-answer.ts';
import { messageTimeLabel } from './message-time.ts';
import { answerSources, linkAnswerSources, type AnswerSource, type DocumentPageTarget } from './source-links.ts';
import type { SourceOpenOutcome } from '../reader/source-highlight.ts';
import { applyChatTextScale, bindUnifiedReaderZoom, type ReaderZoomHost } from './text-scale.ts';
import { attachmentsFromClipboard, clipboardHasImage, clipboardHasText, readGeckoClipboardImage, resolveGeckoClipboardAccess, type ClipboardImageRead, type ClipboardImageRefusal, type ClipboardLike, type GeckoClipboardAccess } from './pick-images.ts';
export interface AttachmentIdentity { title: string; key: string; libraryID: number }
export interface ChatViewHooks {
  openCitation?(citation: Citation): Promise<void>;
  openDocumentPage?(document: DocumentPageTarget, pageIndex: number, quote?: string | null): Promise<SourceOpenOutcome | void>;
  copyText?(text: string): void;
  exportImage?(image: ImageAttachment): Promise<void>;
  openLink?(url: string): void;
  readTextScale?(): number;
  writeTextScale?(scale: number): void;
  zoomTargets?: Array<Document | HTMLElement>;
  pasteTargets?: Array<Document | HTMLElement>;
  readerZoom?: ReaderZoomHost;
  /**
   * Collapse the reader dock through the reader's own close path (the same one the toolbar toggle
   * and native pane action use). The view calls it only when closing the last chat for this
   * attachment leaves nothing to display; without it — as in a bare view test — the pane just stays
   * open in its new-chat state.
   */
  closeDock?(): void;
  uuid?(): string;
}
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
let viewSerial = 0;
const COPY = {
  paneLabel: 'Codex',
  login: 'Sign in with ChatGPT',
  cancelLogin: 'Cancel sign-in',
  retry: 'Reconnect',
  newChat: 'New chat',
  openChats: 'Open chats',
  untitled: 'Untitled',
  history: 'Chat history',
  searchChats: 'Search chats…',
  closeChat: 'Close chat',
  deleteChat: 'Delete chat',
  // The second column beside the chat being edited: a note that it holds no composer, and the one
  // control that makes the chat it shows the editable one. The note is an element node (`CONTENT`
  // match) like the other button labels, so the localization pass rewrites it in place.
  readOnly: 'Read-only',
  editChat: 'Edit this chat',
  newContent: 'New content',
  askPlaceholder: 'Ask a question…',
  question: 'Question',
  send: 'Send',
  stop: 'Stop',
  renameChat: 'Rename chat',
  saveName: 'Save name',
  chatName: 'Chat name',
  accountUsage: 'Account usage',
  returnToSource: 'Return to source',
  remove: 'Remove',
  you: 'You',
  assistant: 'Codex',
  copy: 'Copy',
  settings: 'Model and generation settings',
  effort: 'Effort',
  options: 'Options',
  fast: 'Fast',
  model: 'Model',
  today: 'Today',
  yesterday: 'Yesterday',
  previous7Days: 'Previous 7 days',
  older: 'Older',
  noSavedChats: 'No saved chats match this search.',
  page: (label: string) => `p. ${label}`,
  copied: 'Copied',
  copyFailed: 'The answer could not be copied.',
  actionFailed: 'This action could not be completed.',
  sourceOpenFailed: 'The source could not be opened.',
  attach: 'Add images or context',
  // One or more local files the owner picks explicitly. Text files arrive as text context for the
  // model and image files as image input; the copy says so instead of promising a general file upload.
  attachFile: 'Attach file…',
  attachFileHint: 'Text or image from your computer',
  addReference: 'Add references',
  addSkill: 'Add a skill',
  attachHeading: 'Attach',
  referenceHeading: 'Reference',
  skillHeading: 'Skill',
  addReferenceHint: 'Saved chats and articles',
  addSkillHint: 'Installed skills for this chat',
  // Local reading status. The sidebar used to render preparation state in a panel that was removed,
  // which made a successful whole-PDF read invisible: nothing on screen changed, so an owner could
  // not tell that their article had been read. These lines report the read that actually happened,
  // including the honest case where only some pages carried text.
  documentReading: 'Reading this PDF…',
  documentReadingPages: (done: number, total: number) => `Reading this PDF… ${done} of ${total} pages`,
  documentReadAll: (total: number) => `Read all ${total} pages locally`,
  documentReadSome: (read: number, total: number) => `Read ${read} of ${total} pages locally`,
  documentReadNone: 'No text could be read from this PDF locally',
  imageSaveFailed: 'The image could not be saved.',
  imageClipboardFailed: 'The clipboard image could not be attached.',
  // An image really was on the pasteboard or in the drop; these name why it was refused. They are
  // deliberately about the image, not about the gesture, so the paste and drop routes share them.
  imageTooLarge: 'That image is larger than the 2 MB limit, so it was not attached.',
  imageUnsupported: 'That image format cannot be attached. Use PNG, JPEG, GIF or WebP.',
  imageDropFailed: 'The dropped image could not be attached.',
  collectionsFailed: 'Collections could not be loaded.',
  /** Shown when a live request has no readable timing: an honest unknown, never an invented duration. */
  elapsedUnknown: 'Elapsed time unavailable',
  /** First outbound scope notice. It describes the request scope, never a claim about what was read locally. */
  sendScope: 'When you send, extracted text from this PDF, your selected text and attached images go to Codex through your ChatGPT account. Opening this sidebar only prepares local text. You can turn automatic PDF text off in Zotero\'s Preferences window.',
  continueWithPdf: 'Continue with current PDF',
  // Context coverage disclosure on the composer ring. Every string here is user-facing copy awaiting
  // unification into `ui-locale.ts`; the static ones carry `data-zcr-ui="true"` so `mountUILocale`
  // picks them up the moment the keys exist. The dynamic ones are listed for the coordinator too.
  contextDetail: 'Context supplied to the last request',
  contextDetailMode: 'Mode',
  contextDetailModeFull: 'Whole source',
  contextDetailModeFocused: 'Question-focused selection',
  contextDetailModeMultiPass: 'Multi-pass reading',
  contextDetailPages: 'Pages supplied',
  contextDetailPageSet: 'Page numbers',
  contextDetailWindow: 'Model window',
  contextDetailWindowUnknown: 'unknown',
  contextDetailAllowance: 'Text allowance',
  contextDetailAllowanceUnknown: 'not asserted',
  contextDetailNoFit: 'Fit was not asserted: model capacity or retained history is unknown.',
  contextDetailCoverage: 'What was supplied and what was not',
  contextDetailPagesValue: (supplied: number, total: number) => `${supplied} of ${total} pages`,
  contextDetailWindowValue: (tokens: number, provenance: 'runtime-reported' | 'pinned-catalog') => `${tokens.toLocaleString('en-US')} tokens (${provenance === 'runtime-reported' ? 'runtime reported' : 'bundled catalog estimate'})`,
  contextDetailAllowanceValue: (tokens: number) => `${tokens.toLocaleString('en-US')} tokens`,
  contextDetailMore: (count: number) => `and ${count} more`,
} as const;
const VIEW_ACTION_FAILED = COPY.actionFailed;
/** Stable English section labels; `mountUILocale` translates the rendered heading text. */
const HISTORY_BUCKET_LABELS: Record<HistoryBucket, string> = { Today: COPY.today, Yesterday: COPY.yesterday, 'Previous 7 days': COPY.previous7Days, Older: COPY.older };
const ICONS = {
  send: 'M8 13V3M4.5 6.5 8 3l3.5 3.5',
  stop: 'M5 5h6v6H5z',
  plus: 'M8 3v10M3 8h10',
  more: 'M3.25 8a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Z',
  clock: 'M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5ZM8 5.25V8.2l2.15 1.25',
  copy: 'M6 6h7v7H6zM3 3h7v2',
  source: 'M8 3v8M5 8l3 3 3-3',
  remove: 'M4 4l8 8M12 4l-8 8',
  check: 'M3.5 8.25 6.5 11.25 12.5 4.75',
  historyDone: 'M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5ZM5.5 8.35 7.15 10l3.5-3.9',
  historyDraft: 'M3.5 12.5 4 10.1 10.8 3.3a1.15 1.15 0 0 1 1.62 0l.28.28a1.15 1.15 0 0 1 0 1.62L6 12l-2.5.5ZM9.9 4.2l1.9 1.9',
} as const;
/** The unbound composer tab. It is not a stored conversation id; the first send creates the record. */
const NEW_CHAT_TAB_ID = 'new-chat';
const STATUS_LINE = {
  idle: 'Open the Codex sidebar to connect.',
  starting: 'Starting Codex…',
  error: 'Codex is unavailable',
  pendingLogin: 'Finish signing in to ChatGPT in your browser.',
  signedOut: 'Sign in with ChatGPT to ask a question.',
  generating: 'Responding…',
} as const;
const STATUS_LABEL: Record<Message['status'], string> = {
  pending: 'Recorded',
  streaming: 'Responding…',
  completed: '',
  cancelled: 'Stopped',
  failed: 'Failed',
  uncertain: 'Unconfirmed: the connection was interrupted. The request was not sent again.',
};
function pageLabel(citation: Citation): string {
  return citation.pageLabel || String(citation.positions[0]!.pageIndex + 1);
}
/** Keep source titles intact; the compact header truncates only their visual presentation. */
export function compactPaperTitle(title: string): string {
  return title.trim();
}
function latestCitation(state: PresenterState): Citation | undefined {
  const draft = state.draft.citations.at(-1);
  if (draft) return draft;
  const messages = state.conversation?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const citation = messages[i]?.citations.at(-1);
    if (citation) return citation;
  }
  return undefined;
}
function conversationTitle(conversation: Pick<Conversation, 'title'>): string {
  return compactPaperTitle(conversation.title) || COPY.untitled;
}
/** Paper title first; same-name chats get a short sequence. Default stored title remains the paper name. */
export function conversationLabel(conversation: Pick<Conversation, 'id' | 'title' | 'createdAt'>, siblings: ReadonlyArray<Pick<Conversation, 'id' | 'title' | 'createdAt'>>): string {
  const title = conversationTitle(conversation);
  const same = siblings.filter(entry => conversationTitle(entry) === title).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (same.length < 2) return title;
  const index = same.findIndex(entry => entry.id === conversation.id) + 1;
  return index > 1 ? `${title} · ${index}` : title;
}
export type HistoryBucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
/** Render order for the time-grouped history sections. */
export const HISTORY_BUCKETS: readonly HistoryBucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];
/**
 * Calendar bucketing that keeps the reference's Today / Yesterday / Previous 7 days shape without
 * silently hiding older chats: everything past the seven days before yesterday lands in `Older`.
 * An unparseable timestamp is shown under Today rather than dropped. All arithmetic is on local
 * midnight, matching how a reader reads "yesterday".
 */
export function historyGroup(iso: string, now = Date.now()): HistoryBucket {
  const date = Date.parse(iso);
  if (!Number.isFinite(date)) return 'Today';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (date >= today) return 'Today';
  if (date >= today - 86_400_000) return 'Yesterday';
  if (date >= today - 7 * 86_400_000) return 'Previous 7 days';
  return 'Older';
}
/**
 * Assign every item to exactly one bucket, in render order, dropping empty sections only. Callers
 * can flatten the result to prove that no item was lost.
 */
export function groupHistory<T>(items: readonly T[], updatedAt: (item: T) => string, now = Date.now()): Array<{ bucket: HistoryBucket; items: T[] }> {
  const buckets = new Map<HistoryBucket, T[]>(HISTORY_BUCKETS.map(bucket => [bucket, []]));
  for (const item of items) buckets.get(historyGroup(updatedAt(item), now))!.push(item);
  return HISTORY_BUCKETS.flatMap(bucket => { const group = buckets.get(bucket)!; return group.length ? [{ bucket, items: group }] : []; });
}
/** How far the dropped preview line is echoed into `aria-label`/`title` before it is truncated. */
const HISTORY_DESCRIPTION_LIMIT = 240;
/**
 * The single visible line is the chat title. The paper title and the old second-line preview move
 * into the accessible name and hover tooltip so they are not silently lost.
 */
export function historyRowDescription(row: { title: string; paperTitle?: string; preview?: string }): string {
  const parts = [row.title.trim() || row.title];
  const paper = row.paperTitle?.trim();
  if (paper && paper !== row.title) parts.push(paper);
  const preview = row.preview?.trim();
  if (preview && preview !== row.title) parts.push([...preview].slice(0, HISTORY_DESCRIPTION_LIMIT).join(''));
  return parts.join(' · ');
}
/** Newest first, then by id, so rebuilt lists keep a stable order inside every bucket. */
function newestFirst<T extends { id: string; updatedAt: string; createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id));
}
function hiddenExplainText(message: Message): boolean {
  return message.role === 'user' && (message.action === 'explain' || message.text === EXPLAIN_QUESTION);
}
export type HistoryStatus = 'draft' | 'active' | 'done';
/**
 * Works for both a full Conversation (`messages`) and a workspace HistoryEntry (`messageCount`).
 * A live request reads as in progress even before its first answer; an empty chat is a draft.
 */
export function historyStatus(entry: { activeRequestId: string | null; messages?: readonly unknown[]; messageCount?: number }): HistoryStatus {
  if (entry.activeRequestId) return 'active';
  const count = entry.messageCount ?? entry.messages?.length ?? 0;
  return count === 0 ? 'draft' : 'done';
}
/**
 * Page indexes are 0-based in the contract and 1-based in front of a reader, so each supplied index
 * is shown as `index + 1`. Contiguous runs collapse into ranges and a long set is truncated with its
 * remainder counted, so nothing is silently dropped without saying so.
 */
function pageSetLabel(indexes: number[]): string {
  const numbers = [...new Set(indexes.map(index => index + 1))].sort((a, b) => a - b);
  if (!numbers.length) return '—';
  const parts: string[] = [];
  let start = numbers[0]!; let end = start;
  for (const value of numbers.slice(1)) {
    if (value === end + 1) { end = value; continue; }
    parts.push(start === end ? String(start) : `${start}–${end}`); start = value; end = value;
  }
  parts.push(start === end ? String(start) : `${start}–${end}`);
  return parts.length <= 12 ? parts.join(', ') : `${parts.slice(0, 12).join(', ')}, ${COPY.contextDetailMore(parts.length - 12)}`;
}
/**
 * The last request's concrete context report, rendered for the ring's hover/focus disclosure. Every
 * field comes from {@link ContextReport} exactly as the planner recorded it: nothing is re-derived,
 * and a field the report leaves unknown is shown as unknown rather than guessed. Every label and
 * value carries `data-zcr-ui="true"` so `mountUILocale` translates the phrasing: the labels have
 * `ui-locale.ts` keys, and the value templates that embed counts have `progress()` patterns that
 * carry the numbers through verbatim. The reason line is deliberately unmarked — it is the planner's
 * recorded explanation, i.e. data, and is never rewritten on screen.
 */
function contextDetailNodes(doc: Document, report: ContextReport): HTMLElement {
  const node = (tag: string, className: string, text = ''): HTMLElement => {
    const element = doc.createElementNS(HTML, tag);
    element.className = className; if (text) element.textContent = text;
    return element;
  };
  const line = (label: string, value: string) => {
    const row = node('p', 'zcr-context-detail');
    const name = node('span', 'zcr-context-detail-label', label); name.setAttribute('data-zcr-ui', 'true');
    const text = node('span', 'zcr-context-detail-value', value); text.setAttribute('data-zcr-ui', 'true');
    row.append(name, doc.createTextNode(' '), text);
    return row;
  };
  const body = node('div', 'zcr-context-details-body');
  const title = node('p', 'zcr-context-details-title', COPY.contextDetail); title.setAttribute('data-zcr-ui', 'true');
  const mode = report.mode === 'full' ? COPY.contextDetailModeFull : report.mode === 'focused' ? COPY.contextDetailModeFocused : COPY.contextDetailModeMultiPass;
  const windowKnown = report.capacity !== null;
  const allowanceKnown = report.textBudgetTokens !== null;
  body.append(title, line(COPY.contextDetailMode, mode));
  body.append(line(COPY.contextDetailPages, COPY.contextDetailPagesValue(report.selectedPages.length, report.totalPages)));
  if (report.selectedPages.length < report.totalPages) body.append(line(COPY.contextDetailPageSet, pageSetLabel(report.selectedPages)));
  body.append(line(COPY.contextDetailWindow, windowKnown ? COPY.contextDetailWindowValue(report.capacity!, report.provenance === 'pinned-catalog' ? 'pinned-catalog' : 'runtime-reported') : COPY.contextDetailWindowUnknown));
  body.append(line(COPY.contextDetailAllowance, allowanceKnown ? COPY.contextDetailAllowanceValue(report.textBudgetTokens!) : COPY.contextDetailAllowanceUnknown));
  if (!allowanceKnown || report.provenance === 'unknown') { const noFit = node('p', 'zcr-context-detail zcr-context-detail-nofit', COPY.contextDetailNoFit); noFit.setAttribute('data-zcr-ui', 'true'); body.append(noFit); }
  const coverage = node('p', 'zcr-context-detail-label', COPY.contextDetailCoverage); coverage.setAttribute('data-zcr-ui', 'true');
  body.append(coverage, node('p', 'zcr-context-detail-reason', report.reason));
  return body;
}
interface HistoryRowSource {
  id: string;
  /** The one visible line. */
  title: string;
  paperTitle: string;
  preview: string;
  status: HistoryStatus;
  updatedAt: string;
  current: boolean;
  open(): void;
  /** Present only where the row can be deleted; the workspace history port owns no delete today. */
  remove?: () => void;
}
export function renderReaderShell(body: HTMLElement, identity: AttachmentIdentity, close: () => void): HTMLElement {
  const doc = body.ownerDocument;
  const element = (tag: string, text: string, className?: string) => {
    const node = doc.createElementNS(HTML, tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = element('section', '', 'zcr-sidebar zcr-paper');
  root.dataset.zcrSidebar = '';
  root.setAttribute('aria-label', COPY.paneLabel);
  root.dataset.attachmentKey = identity.key;
  root.dataset.libraryId = String(identity.libraryID);
  // Close stays on the reader toolbar toggle. Plugin chrome belongs in the in-reader dock.
  void close;
  body.replaceChildren(root);
  return root;
}
/** Conversation view: assistant Markdown is sanitized; user text stays textContent. */
export function mountChatView(root: HTMLElement, presenter: ConversationPresenter, hooks: ChatViewHooks = {}): () => void {
  const doc = root.ownerDocument;
  let latestViewState = presenter.snapshot();
  // View actions own a slot separate from `state.message`: a presenter update must not erase a
  // view failure, and a view failure must never be reported as conversation state.
  const reportViewMessage = (message: string) => {
    const status = root.querySelector<HTMLElement>('[data-zcr-view-error]');
    if (status) { status.textContent = message; status.hidden = false; }
  };
  /**
   * A failed view action shows the presenter's own sentence when it carries a coded error, because
   * those messages are written for this UI (for example 'Saved chats could not be searched.').
   * Anything else stays the constant, so host paths and raw internal text never reach the pane.
   */
  const actionFailure = (error: unknown): string => {
    if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
      const message = (error as { message: string }).message.trim();
      if (message) return message;
    }
    return VIEW_ACTION_FAILED;
  };
  const reportViewError = (error?: unknown) => reportViewMessage(actionFailure(error));
  const viewId = `zcr-chat-${++viewSerial}`;
  // A cited page re-opens through the same frozen-revision navigation as the PDF context panel.
  // Without an opener, bound citations stay inert (no external launch) and surface a constant status.
  const openAnswerSource = async (source: AnswerSource, pageIndex: number, quote: string | null): Promise<SourceOpenOutcome> => {
    if (!hooks.openDocumentPage) throw new Error('The source could not be opened.');
    return (await hooks.openDocumentPage({ paper: source.paper, revision: source.revision }, pageIndex, quote)) ?? 'opened';
  };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const node = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K]; if (className) node.className = className; if (text) node.textContent = text; return node; };
  const icon = (name: keyof typeof ICONS) => {
    const svg = doc.createElementNS(SVG, 'svg');
    svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', ICONS[name]);
    path.setAttribute('fill', name === 'stop' || name === 'more' ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.25');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  };
  const button = (label: string, action: string, onClick: () => void, glyph?: keyof typeof ICONS, className = 'zcr-icon-button') => {
    const node = el('button', glyph ? className : 'zcr-button', glyph ? '' : label);
    node.type = 'button'; node.dataset.zcrAction = action;
    node.setAttribute('aria-label', label); node.title = label;
    if (glyph) node.append(icon(glyph));
    node.addEventListener('click', onClick);
    return node;
  };
  // Clipboard writes go through the host hook when provided; a copy must always confirm visibly.
  const copyTimers = new WeakMap<HTMLButtonElement, number>();
  const confirmCopy = (trigger: HTMLButtonElement) => {
    const view = doc.defaultView;
    const previous = copyTimers.get(trigger);
    if (previous !== undefined) view?.clearTimeout(previous);
    trigger.dataset.zcrCopied = 'true';
    trigger.setAttribute('aria-label', COPY.copied); trigger.title = COPY.copied;
    const label = trigger.querySelector<HTMLElement>('[data-zcr-copy-label]');
    if (label) label.textContent = COPY.copied;
    if (!view) return;
    copyTimers.set(trigger, view.setTimeout(() => {
      copyTimers.delete(trigger);
      delete trigger.dataset.zcrCopied;
      trigger.setAttribute('aria-label', COPY.copy); trigger.title = COPY.copy;
      if (label) label.textContent = COPY.copy;
    }, 1600));
  };
  const copyText = (source: string, trigger: HTMLButtonElement) => {
    if (hooks.copyText) hooks.copyText(source);
    else void doc.defaultView?.navigator.clipboard?.writeText(source).catch(() => reportViewMessage(COPY.copyFailed));
    confirmCopy(trigger);
  };
  // Each fenced block and table gets its own wrapper so wide content scrolls locally and the
  // copy affordance never scrolls away with the code.
  const enhanceCodeBlocks = (host: HTMLElement, readOnly = false) => {
    for (const pre of [...host.querySelectorAll('pre')]) {
      const wrapper = el('div', 'zcr-code-block');
      pre.replaceWith(wrapper); wrapper.append(pre);
      // The wrapper is structural, so a read-only transcript still gets it; the copy button is an
      // action, so it is not created at all there rather than being created and then hidden.
      if (readOnly) continue;
      const source = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
      const copy = button(COPY.copy, 'copy-code', () => copyText(source, copy));
      copy.classList.add('zcr-code-copy');
      wrapper.prepend(copy);
    }
    for (const table of [...host.querySelectorAll('table')]) {
      if (table.parentElement?.classList.contains('zcr-table-block')) continue;
      const wrapper = el('div', 'zcr-table-block');
      table.replaceWith(wrapper); wrapper.append(table);
    }
  };
  root.querySelector('[data-zcr-chat]')?.remove();
  const chat = el('section', 'zcr-chat'); chat.dataset.zcrChat = '';
  const chrome = el('div', 'zcr-chrome');
  /**
   * Cursor-style agent tabs live in the chrome: every open chat is a named tab, the unbound composer
   * is the New chat tab, and the selected tab carries the close cross. `+` and history stay on the
   * trailing edge. Closing leaves the chat on disk and in history and asks no confirmation; the
   * destructive remove lives on the history rows. When the close leaves no chat at all for this
   * attachment, the reader collapses its whole dock through the reader's own close path.
   */
  const panes = el('div', 'zcr-panes');
  panes.dataset.zcrPanes = '';
  panes.setAttribute('role', 'tablist');
  panes.setAttribute('aria-label', COPY.openChats);
  const paneNodes = new Map<string, HTMLElement>();
  /** The selected tab's title control; the rename popover hangs off it. */
  let renameTrigger: HTMLElement | null = null;
  const contextSource = el('div', 'zcr-chrome-source');
  contextSource.dataset.zcrContextSource = '';
  // The paper's declared metadata is still read in the background and frozen into every request
  // (`presenter.paperIdentity()`), but it is deliberately not written out on screen: the owner asked
  // for a silent read, not a card above the transcript.
  // The local read of this PDF is the only on-screen evidence that the article was read at all, so it
  // reports counts from the prepared document rather than a spinner.
  const documentStatus = el('p', 'zcr-document-status');
  documentStatus.dataset.zcrDocumentStatus = '';
  documentStatus.hidden = true;
  // The first outbound scope notice stays even though the PDF coverage panel is gone: it is the only
  // way to acknowledge the disclosure, and without it an explain that needs consent can never send.
  const scopeNotice = el('div', 'zcr-context-disclosure');
  scopeNotice.dataset.zcrContextDisclosure = '';
  const scopeNoticeCopy = el('p', '', COPY.sendScope);
  const acknowledgeScope = button(COPY.continueWithPdf, 'acknowledge-context', () => { presenter.acknowledgeContext(); });
  scopeNotice.append(scopeNoticeCopy, acknowledgeScope);
  scopeNotice.hidden = true; acknowledgeScope.hidden = true;
  const actions = el('div', 'zcr-chrome-actions');
  const fresh = button(COPY.newChat, 'new-conversation', () => { void presenter.newConversation(); }, 'plus');
  const historyBtn = button(COPY.history, 'history', () => { toggleHistory(); }, 'clock');
  historyBtn.setAttribute('aria-haspopup', 'dialog');
  historyBtn.setAttribute('aria-expanded', 'false');
  historyBtn.setAttribute('aria-controls', `${viewId}-history`);
  actions.append(fresh, historyBtn);
  chrome.append(panes, actions);
  // Renaming hangs off the selected tab's title, the same place the owner already looks for the
  // chat's name. The form is a small popover under the chrome.
  const renameForm = el('div', 'zcr-rename-form'); renameForm.dataset.zcrRenameForm = ''; renameForm.hidden = true;
  renameForm.id = `${viewId}-rename`;
  renameForm.setAttribute('role', 'dialog');
  renameForm.setAttribute('aria-label', COPY.renameChat);
  const renameInput = el('input'); renameInput.type = 'text'; renameInput.maxLength = 1024;
  renameInput.setAttribute('aria-label', COPY.chatName);
  const saveName = button(COPY.saveName, 'save-conversation-name', () => {
    const id = presenter.snapshot().conversation?.id;
    if (!id) return;
    void presenter.renameConversation(id, renameInput.value).then(() => { toggleRename(false); renameTrigger?.focus(); }).catch(reportViewError);
  });
  renameForm.append(renameInput, saveName);
  renameForm.append(renameInput, saveName);
  const historyPanel = el('div', 'zcr-history-panel');
  historyPanel.id = `${viewId}-history`;
  historyPanel.dataset.zcrHistory = '';
  historyPanel.hidden = true;
  historyPanel.setAttribute('role', 'dialog');
  historyPanel.setAttribute('aria-label', COPY.history);
  const historySearch = el('input', 'zcr-history-search');
  historySearch.type = 'search';
  historySearch.dataset.zcrHistorySearch = '';
  historySearch.placeholder = COPY.searchChats;
  historySearch.setAttribute('aria-label', COPY.history);
  const historyList = el('div', 'zcr-history-list');
  historyList.setAttribute('role', 'list');
  historyPanel.append(historySearch, historyList);
  const status = el('p', 'zcr-status-line'); status.setAttribute('role', 'status');
  // Honest elapsed time. The counter ticks only while a request is unsettled, freezes at the first
  // delivered text, and stops at the settle stamp. Missing timing shows an explicit unknown rather
  // than an invented duration: an idle local counter would wrongly imply this app is the wait when
  // the real delay can be upstream quota or queueing.
  const requestTiming = el('p', 'zcr-request-timing'); requestTiming.dataset.zcrRequestTiming = ''; requestTiming.setAttribute('role', 'status'); requestTiming.hidden = true;
  const requestTimingGlyph = el('span', 'zcr-request-timing-glyph'); requestTimingGlyph.setAttribute('aria-hidden', 'true'); requestTimingGlyph.append(icon('clock'));
  const requestTimingText = el('span', 'zcr-request-timing-text'); requestTimingText.dataset.zcrRequestTimingText = '';
  requestTiming.append(requestTimingGlyph, requestTimingText);
  let timingInterval: number | null = null;
  let paintedTiming = '';
  const clearTimingInterval = () => { const id = timingInterval; timingInterval = null; if (id !== null) doc.defaultView?.clearInterval(id); };
  const describeTiming = (state: PresenterState, now: number): { text: string; ticking: boolean } | null => {
    const conversation = state.conversation;
    const timings = conversation?.requestTiming ?? [];
    const activeId = conversation?.activeRequestId ?? null;
    let timing: RequestTiming | null;
    if (activeId) {
      timing = timings.find(entry => entry.requestId === activeId) ?? null;
      if (!timing) return { text: COPY.elapsedUnknown, ticking: false };
    } else {
      const last = timings.at(-1);
      if (!last || last.settledAt === null) return null;
      timing = last;
    }
    const progress = requestProgress(timing, now);
    if (progress.settled) return { text: progress.elapsedSeconds === null ? COPY.elapsedUnknown : `Answered in ${progress.elapsedSeconds}s`, ticking: false };
    const seconds = progress.firstTextSeconds ?? progress.elapsedSeconds;
    if (seconds === null) return { text: COPY.elapsedUnknown, ticking: false };
    // Before the first text the count is live; after it, the value freezes at the first-text mark.
    return { text: `Waiting ${seconds}s`, ticking: true };
  };
  const paintTiming = (state: PresenterState) => {
    const described = describeTiming(state, Date.now());
    if (!described) { requestTiming.hidden = true; if (paintedTiming) { paintedTiming = ''; requestTimingText.textContent = ''; } clearTimingInterval(); return; }
    requestTiming.hidden = false;
    if (paintedTiming !== described.text) { paintedTiming = described.text; requestTimingText.textContent = described.text; }
    if (described.ticking) { if (timingInterval === null) timingInterval = doc.defaultView?.setInterval(() => paintTiming(latestViewState), 1000) ?? null; }
    else clearTimingInterval();
  };
  const auth = el('div', 'zcr-auth');
  const login = button(COPY.login, 'login', () => { void presenter.login(); });
  const cancelLogin = button(COPY.cancelLogin, 'cancel-login', () => { void presenter.cancelLogin(); });
  const retry = button(COPY.retry, 'retry', () => { void presenter.retry(); });
  auth.append(login, cancelLogin, retry);
  const alert = el('p', 'zcr-error'); alert.setAttribute('role', 'alert'); alert.hidden = true;
  const viewError = el('p', 'zcr-error zcr-view-error'); viewError.dataset.zcrViewError = ''; viewError.setAttribute('role', 'alert'); viewError.hidden = true;
  const transcript = el('div', 'zcr-transcript');
  transcript.dataset.zcrTranscript = '';
  const messages = el('div', 'zcr-messages'); messages.dataset.zcrMessages = '';
  const taskPanel = el('div', 'zcr-tasks'); taskPanel.dataset.zcrTasks = '';
  const taskView = mountTaskView(taskPanel, {
    approveSelected: (id, selected, choices) => presenter.approveTask(id, selected, choices),
    cancel: id => presenter.cancelTask(id), reconcile: id => presenter.reconcileTask(id), undo: id => presenter.undoTask(id),
    openSource: (id, itemId) => presenter.openTaskSource(id, itemId), openOutput: (id, itemId) => presenter.openTaskOutput(id, itemId),
    cancelReading: id => presenter.cancelReading(id), reconcileReading: id => presenter.reconcileReading(id), openReadingOutput: (id, step) => presenter.openReadingOutput(id, step),
    describeReading: id => presenter.describeReading(id),
    collectionLabel: target => latestViewState.collectionOptions.find(item => item.clientId === target.clientId && item.libraryId === target.libraryId && item.collectionKey === target.collectionKey)?.name ?? `Library ${target.libraryId} · ${target.collectionKey}`,
  });
  const isNearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
  let hasNewContent = false;
  /** Whether the transcript was pinned to the newest answer at the last render. */
  let sticking = true;
  const newContent = button(COPY.newContent, 'new-content', () => { hasNewContent = false; messages.scrollTop = messages.scrollHeight; newContent.hidden = true; });
  newContent.hidden = true;
  newContent.classList.add('zcr-new-content');
  messages.addEventListener('scroll', () => {
    if (isNearBottom()) { hasNewContent = false; newContent.hidden = true; }
    presenter.setScrollTop(messages.scrollTop);
  });
  transcript.append(messages, newContent);
  const draft = el('div', 'zcr-draft');
  const draftCitations = el('div', 'zcr-draft-citations'); draftCitations.dataset.zcrDraftCitations = '';
  const draftImages = el('div', 'zcr-draft-images'); draftImages.dataset.zcrDraftImages = '';
  const composer = el('div', 'zcr-composer'); composer.dataset.zcrComposer = '';
  const composerContext = el('div', 'zcr-composer-context'); composerContext.dataset.zcrComposerContext = '';
  composerContext.append(draftCitations, draftImages);
  const input = el('textarea', 'zcr-input'); input.rows = 2; input.placeholder = COPY.askPlaceholder; input.setAttribute('aria-label', COPY.question); input.dataset.zcrInput = '';
  const bar = el('div', 'zcr-composer-bar');
  const leading = el('div', 'zcr-composer-leading'); leading.dataset.zcrComposerLeading = '';
  const trailing = el('div', 'zcr-composer-trailing');
  const picker = el('button', 'zcr-picker');
  picker.type = 'button';
  picker.dataset.zcrAction = 'picker';
  picker.dataset.zcrPicker = '';
  picker.setAttribute('aria-label', COPY.settings);
  picker.title = COPY.settings;
  picker.setAttribute('aria-haspopup', 'menu');
  picker.setAttribute('aria-expanded', 'false');
  picker.setAttribute('aria-controls', `${viewId}-models`);
  picker.addEventListener('click', () => { togglePicker(); });
  const send = button(COPY.send, 'send', () => { void presenter.send(); }, 'send', 'zcr-icon-button zcr-send');
  const stop = button(COPY.stop, 'stop', () => { void presenter.cancel(); }, 'stop', 'zcr-icon-button zcr-send');
  const queue = button('Queue question', 'queue', () => { void presenter.queueDraft(); }, 'plus'); queue.hidden = true;
  const contextRing = mountContextRing(trailing);
  trailing.append(picker, queue, send, stop);
  bar.append(leading, trailing);
  const menu = el('div', 'zcr-picker-menu'); menu.dataset.zcrPickerMenu = ''; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', COPY.settings);
  menu.id = `${viewId}-models`;
  // The ring's coverage disclosure sits with the other composer popovers: anchored above the card,
  // hidden until hover or focus, and carrying no interactive content.
  composer.append(composerContext, input, bar, menu, contextRing.details);
  draft.append(composer);
  const main = el('div', 'zcr-chat-main');
  main.append(historyPanel, status, requestTiming, auth, alert, viewError, transcript, draft);
  /**
   * The two chat columns. The editable pane is always the first child, so the one composer never
   * moves and the keyboard order stays stable; the second column is a read-only transcript of another
   * open chat. It is only laid out when the measured container really has room for two readable
   * columns (`pane-layout.ts`), and it has no composer of its own: clicking a message or pressing
   * Enter on the column makes its chat the editable one, and the strip above stays the switcher.
   */
  const columns = el('div', 'zcr-columns');
  columns.dataset.zcrColumns = 'one';
  const previewPane = el('section', 'zcr-pane-preview');
  previewPane.dataset.zcrPanePreview = '';
  previewPane.hidden = true;
  previewPane.setAttribute('role', 'region');
  previewPane.tabIndex = -1;
  const previewTitle = el('span', 'zcr-pane-preview-title');
  previewTitle.id = `${viewId}-preview-title`;
  const previewNote = el('span', 'zcr-pane-preview-note', COPY.readOnly);
  previewNote.id = `${viewId}-preview-note`;
  // The column is announced by its own note and by the chat it shows; the note is copy that the
  // localization pass may rewrite, the title is the reader's own chat name.
  previewPane.setAttribute('aria-labelledby', `${previewTitle.id} ${previewNote.id}`);
  const previewOpen = button(COPY.editChat, 'activate-pane', () => { activatePreview(); }, 'historyDraft', 'zcr-icon-button zcr-pane-preview-open');
  const previewHeader = el('div', 'zcr-pane-preview-header');
  previewHeader.append(previewTitle, previewNote, previewOpen);
  const previewMessages = el('div', 'zcr-messages zcr-pane-preview-messages');
  previewMessages.dataset.zcrPreviewMessages = '';
  previewPane.append(previewHeader, previewMessages);
  /** The chat painted in the read-only column, or null when nothing is painted there. */
  let previewPaneId: string | null = null;
  /**
   * The chat that was being edited at the previous render. Activation swaps the two roles, so this is
   * what decides which chat the second column shows; it is deliberately outside `PresenterState`
   * (the presenter owns the canonical `current` pointer, this is only how the previous role is shown).
   */
  let renderedActiveId: string | null = null;
  /** The width the split is measured against: the columns' own content box, never the whole dock. */
  const measureColumns = (): number => {
    const rect = columns.getBoundingClientRect?.();
    if (rect && rect.width > 0) return rect.width;
    return columns.clientWidth || 0;
  };
  const activatePreview = () => {
    const id = previewPaneId;
    if (!id) return;
    // The previously active chat becomes the read-only one. Focus goes back into the one composer
    // rather than staying on a control this activation replaces, which would drop the reader onto
    // the page body mid-keyboard.
    void presenter.openConversation(id).then(() => presenter.focusInput()).catch(reportViewError);
  };
  previewPane.addEventListener('click', event => {
    // A selection inside the column is the owner reading or copying a passage, not asking for that
    // chat to become editable: doing so would also take the selection away from them.
    const selection = doc.defaultView?.getSelection?.() ?? null;
    const anchorNode = selection?.anchorNode ?? null;
    if (selection && !selection.isCollapsed && anchorNode && previewPane.contains(anchorNode)) return;
    // Following a link in the answer is reading too, and the answer's own handler already opened it;
    // swapping the panes under the click would move the answer the owner is looking at.
    const target = event.target as Element | null;
    if (target?.closest?.('a[href]')) return;
    event.preventDefault();
    activatePreview();
  });
  previewPane.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (isComposing(event)) return;
    // Enter activates once: the column's own control must not also fire a click that activates twice.
    event.preventDefault();
    activatePreview();
  });
  previewMessages.addEventListener('scroll', () => {
    // Recorded per chat in the presenter's own position map, never written into the chat being edited.
    if (previewPaneId) presenter.setPaneScrollTop(previewPaneId, previewMessages.scrollTop);
  });
  columns.append(main, previewPane);
  chat.append(chrome, renameForm, contextSource, documentStatus, scopeNotice, columns); root.append(chat);
  const localizer = mountUILocale(root);
  let lastLanguage: 'en' | 'zh' | null = null;
  /** JSON key of the rendered context report, so the ring's details rebuild only when it changes. */
  let contextReportKey: string | null = null;
  let workspaceView: ReturnType<typeof mountWorkspaceView> | null = null;
  let lastWorkspace: PresenterState['workspace'] = null; let workspaceDraftKey = ''; let tasksKey = '';
  // Codex keeps exactly one plus button at the composer's bottom-left. Every attachment route
  // lives behind it; the reference/skill chooser stays reachable by typing '@' or '/'.
  const plus = button(COPY.attach, 'composer-plus', () => { togglePlus(); }, 'plus', 'zcr-icon-button zcr-plus');
  plus.dataset.zcrPlus = '';
  plus.setAttribute('aria-haspopup', 'dialog'); plus.setAttribute('aria-expanded', 'false'); plus.setAttribute('aria-controls', `${viewId}-plus`);
  // A labelled, non-modal dialog rather than `role="menu"`: the popover holds plain action rows, and
  // neither plain buttons nor an `<input>` are valid children of a menu.
  const plusMenu = el('div', 'zcr-plus-menu'); plusMenu.dataset.zcrPlusMenu = ''; plusMenu.id = `${viewId}-plus`; plusMenu.hidden = true; plusMenu.setAttribute('role', 'dialog'); plusMenu.setAttribute('aria-label', COPY.attach);
  // Codex-style grouped rows: a small heading, a title and a supporting description. The accessible
  // name stays the title, never the description.
  const plusRow = (title: string, description: string, action: string, onClick: () => void) => {
    const row = el('button', 'zcr-plus-row');
    row.type = 'button'; row.dataset.zcrAction = action;
    row.append(el('span', 'zcr-plus-row-title', title), el('span', 'zcr-plus-row-description', description));
    row.setAttribute('aria-label', title); row.title = title;
    row.addEventListener('click', onClick);
    return row;
  };
  // The dialog holds plain action rows only: a page-number field would be an invalid child, and the
  // owner removed the one-page capture route that needed it.
  const attachGroup = el('div', 'zcr-plus-group');
  attachGroup.append(
    el('div', 'zcr-plus-heading', COPY.attachHeading),
    plusRow(COPY.attachFile, COPY.attachFileHint, 'pick-file', () => { togglePlus(false); void presenter.pickFile().catch(reportViewError); }),
  );
  const referenceGroup = el('div', 'zcr-plus-group');
  referenceGroup.append(
    el('div', 'zcr-plus-heading', COPY.referenceHeading),
    plusRow(COPY.addReference, COPY.addReferenceHint, 'composer-references', () => { togglePlus(false); workspaceView?.openCommands(); }),
  );
  // References and skills are two different affordances, so they get two headings and two rows: the
  // reference row opens the '@' chooser and the skill row opens the '/' chooser.
  const skillGroup = el('div', 'zcr-plus-group');
  skillGroup.append(
    el('div', 'zcr-plus-heading', COPY.skillHeading),
    plusRow(COPY.addSkill, COPY.addSkillHint, 'composer-skill', () => { togglePlus(false); workspaceView?.openSkills(); }),
  );
  plusMenu.append(attachGroup, referenceGroup, skillGroup);
  composer.append(plusMenu);
  leading.append(plus);
  const acquisition = el('label', 'zcr-acquisition-target', 'Save literature to'); acquisition.hidden = true;
  const collection = el('select'); collection.dataset.zcrCollectionTarget = ''; collection.setAttribute('aria-label', 'Target collection'); acquisition.append(collection); composerContext.append(acquisition);
  collection.addEventListener('change', () => { const selected = presenter.snapshot().collectionOptions.find(item => `${item.libraryId}:${item.collectionKey}` === collection.value); if (selected) presenter.setAcquisitionTarget({ clientId: selected.clientId, libraryId: selected.libraryId, collectionKey: selected.collectionKey }); else presenter.setAcquisitionTarget(null); });
  let requestedCollections = false;
  const imagePreview = el('div', 'zcr-image-preview'); imagePreview.dataset.zcrImagePreview = ''; imagePreview.hidden = true;
  imagePreview.setAttribute('role', 'dialog'); imagePreview.setAttribute('aria-modal', 'true'); imagePreview.setAttribute('aria-label', 'Image preview');
  chat.append(imagePreview);
  let imageTrigger: HTMLElement | null = null;
  const closeImage = () => { imagePreview.hidden = true; imagePreview.replaceChildren(); imageTrigger?.focus(); };
  const previewImage = (image: ImageAttachment, trigger?: HTMLElement) => {
    imageTrigger = trigger ?? doc.activeElement as HTMLElement | null;
    const header = el('div', 'zcr-image-preview-header');
    const caption = image.origin?.kind === 'generated' ? `Generated image${image.origin.model ? ` · requested with ${image.origin.model}` : ''}` : image.name;
    const close = button('Close image preview', 'close-image-preview', closeImage, 'remove');
    header.append(el('span', '', caption), close);
    const full = el('img'); full.src = image.dataUrl; full.alt = caption;
    const exportButton = button('Save image…', 'export-image', () => {
      if (hooks.exportImage) void hooks.exportImage(image).catch(() => reportViewMessage(COPY.imageSaveFailed));
    });
    exportButton.hidden = !hooks.exportImage;
    imagePreview.replaceChildren(header, full, exportButton); imagePreview.hidden = false; close.focus();
  };
  imagePreview.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeImage(); }
    if (event.key === 'Tab') {
      const buttons = [...imagePreview.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
      if (!buttons.length) return;
      const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  });
  const imageCard = (image: ImageAttachment, readOnly = false) => {
    const card = el('figure', 'zcr-image-card'); card.dataset.zcrImage = image.id;
    const thumbnail = el('img'); thumbnail.src = image.dataUrl; thumbnail.alt = image.name; thumbnail.loading = 'lazy';
    if (readOnly) {
      // The picture is the message; only the preview affordance is an action. A read-only figure shows
      // the image in place rather than offering a dialog it must not open.
      card.append(thumbnail);
    } else {
      const open = button('Preview image', 'preview-image', () => previewImage(image, open));
      // An image grows the transcript after the last render already scrolled: re-pin only if it was pinned.
      thumbnail.addEventListener('load', () => { if (sticking) messages.scrollTop = messages.scrollHeight; });
      open.replaceChildren(thumbnail); card.append(open);
    }
    card.append(el('figcaption', '', image.origin?.kind === 'generated' ? 'Generated image' : image.name));
    return card;
  };
  applyChatTextScale(root, hooks.readTextScale?.());
  const unbindZoom = hooks.readerZoom
    ? bindUnifiedReaderZoom(root, hooks.readerZoom, hooks.zoomTargets ?? [doc, root])
    : (() => {
      applyChatTextScale(root);
      return () => undefined;
    })();
  const togglePicker = (open?: boolean) => {
    const next = open ?? menu.hidden;
    menu.hidden = !next;
    picker.setAttribute('aria-expanded', String(next));
    if (next) { historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false'); toggleRename(false); togglePlus(false); }
  };
  /**
   * The rename popover hangs off the selected tab's title. Opening it fills the field from the live
   * conversation and selects the text; closing it returns focus to that title, so the affordance is
   * keyboard-reachable without a menu trigger.
   */
  const toggleRename = (open?: boolean) => {
    if ((open ?? renameForm.hidden) && !presenter.snapshot().conversation) return;
    const next = open ?? renameForm.hidden;
    renameForm.hidden = !next;
    renameTrigger?.setAttribute('aria-expanded', String(next));
    if (next) {
      historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false');
      menu.hidden = true; picker.setAttribute('aria-expanded', 'false'); togglePlus(false);
      renameInput.value = presenter.snapshot().conversation?.title ?? '';
      renameInput.focus(); renameInput.select();
    }
  };
  const toggleHistory = (open?: boolean) => {
    const next = open ?? historyPanel.hidden;
    historyPanel.hidden = !next;
    historyBtn.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
      toggleRename(false);
      togglePlus(false);
      historySearch.focus();
    }
  };
  /** The composer plus menu; only the picker button, an outside click or Escape closes it. */
  const togglePlus = (open?: boolean) => {
    const next = open ?? plusMenu.hidden;
    plusMenu.hidden = !next;
    plus.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = true; picker.setAttribute('aria-expanded', 'false');
      toggleRename(false);
      historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false');
    }
  };
  const nextImageId = () => hooks.uuid?.() ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const geckoAccess = (): GeckoClipboardAccess | null => resolveGeckoClipboardAccess(doc.defaultView);
  /**
   * One paste gesture can reach the composer through more than one route: the DOM paste event, the
   * reader window's own clipboard service (this chat is mounted into the reader window, not an
   * iframe), and the plugin realm that owns the privileged pasteboard. Identical bytes already in
   * the draft are skipped so a single Cmd+V can never attach the same image twice.
   */
  const attachClipboardImages = (images: ImageAttachment[]) => {
    const present = new Set(presenter.snapshot().draft.images.map(image => image.dataUrl));
    for (const image of images) { if (present.has(image.dataUrl)) continue; present.add(image.dataUrl); presenter.addImage(image); }
  };
  /** The two refusals are named, so a paste or drop that carried an image is never a silent no-op. */
  const IMAGE_REFUSAL: Record<ClipboardImageRefusal, string> = { 'too-large': COPY.imageTooLarge, unsupported: COPY.imageUnsupported };
  /**
   * Reads one route and moves on when it produced nothing. A route that throws (the reader window's
   * nsIClipboard can claim an image family it cannot hand over) must not consume the paste: later
   * routes, including the privileged plugin realm, still run. A route that really found bytes it had
   * to refuse is remembered, but a later route that attaches those bytes wins and the refusal is not
   * shown. Routes are tried in order of fidelity.
   */
  const readClipboardRoutes = async (clipboard: ClipboardLike | null | undefined, routes: Array<() => Promise<ClipboardImageRead>>): Promise<void> => {
    let refusal: ClipboardImageRefusal | undefined;
    let attached = false;
    let throws = 0;
    for (const route of routes) {
      let read: ClipboardImageRead;
      try { read = await route(); } catch { throws += 1; continue; }
      attachClipboardImages(read.images);
      if (read.images.length) { attached = true; break; }
      refusal ??= read.refused;
    }
    if (attached) return;
    if (refusal) reportViewMessage(IMAGE_REFUSAL[refusal]);
    else if (routes.length > 0 && throws === routes.length) reportViewMessage(COPY.imageClipboardFailed);
  };
  const pluginClipboardRead = async (): Promise<ClipboardImageRead> => await presenter.clipboardImage();
  /** The routes the current paste gesture can reach, most faithful first. */
  const pasteRoutes = (clipboard: ClipboardLike | null | undefined): Array<() => Promise<ClipboardImageRead>> => {
    const host = geckoAccess();
    const geckoRead = (): Promise<ClipboardImageRead> => {
      try { return Promise.resolve(readGeckoClipboardImage(host, nextImageId)); }
      catch { return Promise.resolve({ images: [] }); }
    };
    return [
      ...(clipboardHasImage(clipboard) ? [() => attachmentsFromClipboard(clipboard, nextImageId)] : []),
      ...(host ? [geckoRead] : []),
      pluginClipboardRead,
    ];
  };
  const seenPaste = new WeakSet<Event>();
  /**
   * True once this paste gesture produced a paste event anywhere in this window. The keydown
   * fallback below only exists for the case where the reader routes Cmd+V to its own chrome and no
   * paste event reaches this document at all; when one did, that event already tried every route
   * (including the plugin realm), so reading the pasteboard a second time would be redundant.
   */
  let pasteEventSeen = false;
  const onPaste = (event: Event) => {
    const target = event.target as Node | null;
    const inComposer = !!target && 'nodeType' in target && composer.contains(target);
    // Gecko can dispatch paste at the chrome document. Accept that route only
    // while this composer owns focus; another editor's event stays untouched.
    const documentTarget = !target || !('nodeType' in target) || target.nodeType === 9;
    if (!inComposer && !(documentTarget && doc.hasFocus() && composer.contains(doc.activeElement))) return;
    if (seenPaste.has(event)) return;
    seenPaste.add(event);
    pasteEventSeen = true;
    const clipboard = (event as ClipboardEvent).clipboardData;
    // A paste that carries text is left entirely to the textarea; only a gesture with no text and
    // no image data of its own falls through to the privileged pasteboard.
    if (!clipboardHasImage(clipboard) && clipboardHasText(clipboard)) return;
    event.preventDefault();
    void readClipboardRoutes(clipboard, pasteRoutes(clipboard));
  };
  composer.addEventListener('dragover', event => { if (clipboardHasImage(event.dataTransfer)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
  composer.addEventListener('drop', event => {
    if (!clipboardHasImage(event.dataTransfer)) return;
    event.preventDefault();
    // A drop is the same validated route as a paste: the dropped bytes are attached, and a drop
    // that could not be attached names its reason (size or format) instead of doing nothing.
    void attachmentsFromClipboard(event.dataTransfer, nextImageId).then(read => {
      for (const image of read.images) presenter.addImage(image);
      if (read.refused) reportViewMessage(IMAGE_REFUSAL[read.refused]);
    }).catch(() => reportViewMessage(COPY.imageDropFailed));
  });
  composer.addEventListener('paste', onPaste);
  input.addEventListener('paste', onPaste);
  chat.addEventListener('paste', onPaste);
  const pasteDocuments = new Set<Document>([doc]);
  for (const target of hooks.pasteTargets ?? hooks.zoomTargets ?? []) {
    const next = 'nodeType' in target && target.nodeType === 9 ? target as Document : target.ownerDocument;
    if (next) pasteDocuments.add(next);
  }
  for (const target of pasteDocuments) target.addEventListener('paste', onPaste, true);
  const pasteWindow = doc.defaultView;
  pasteWindow?.addEventListener('paste', onPaste, true);
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  const resizeInput = () => {
    input.style.height = 'auto';
    if (input.scrollHeight > 0) input.style.height = `${input.scrollHeight}px`;
  };
  input.addEventListener('input', () => { presenter.setQuestion(input.value); resizeInput(); });
  const isComposing = (event: KeyboardEvent) => composing || event.isComposing || event.keyCode === 229;
  input.addEventListener('keydown', event => {
    // Cmd/Ctrl+V: Zotero's reader may route the pasteboard to its own chrome, and a macOS
    // screenshot is TIFF there, which this realm cannot read. The privileged plugin clipboard is
    // read only as a fallback for a keypress whose paste event never arrives here; a paste event
    // that does arrive already tries every route itself, and identical bytes never attach twice.
    // Text pastes are untouched because nothing is prevented here.
    if (!isComposing(event) && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'v') {
      pasteEventSeen = false;
      // The keypress default action and its paste event run before timers, so a real paste wins.
      setTimeout(() => { if (!pasteEventSeen) void readClipboardRoutes(null, pasteRoutes(null)); }, 0);
    }
  });
  input.addEventListener('keydown', event => {
    if (isComposing(event)) return;
    if (event.key === 'Escape' && !renameForm.hidden) { event.preventDefault(); toggleRename(false); renameTrigger?.focus(); return; }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); togglePicker(false); return; }
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An open chooser owns Enter. Closing it must never submit the draft.
    if (!menu.hidden || !renameForm.hidden || !historyPanel.hidden) {
      event.preventDefault(); togglePicker(false); toggleRename(false); toggleHistory(false); return;
    }
    event.preventDefault(); void presenter.send();
  });
  const menuItems = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden])')]
    .filter(node => !node.closest('[hidden]'));
  const focusMenu = (panel: HTMLElement, last = false) => {
    const items = menuItems(panel);
    (last ? items.at(-1) : items[0])?.focus();
  };
  const bindMenuKeys = (panel: HTMLElement, trigger: { focus(): void }, close: () => void) => {
    panel.addEventListener('keydown', event => {
      if (isComposing(event)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close(); trigger.focus(); return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      // Home/End continue editing text in the history search field.
      if (event.target === historySearch && (event.key === 'Home' || event.key === 'End')) return;
      const target = event.target as Element | null;
      if (target !== historySearch && target?.matches('input, textarea, select')) return;
      const items = menuItems(panel); if (!items.length) return;
      const current = items.indexOf(doc.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
    });
  };
  bindMenuKeys(menu, picker, () => togglePicker(false));
  bindMenuKeys(renameForm, { focus() { renameTrigger?.focus(); } }, () => toggleRename(false));
  bindMenuKeys(historyPanel, historyBtn, () => toggleHistory(false));
  bindMenuKeys(plusMenu, plus, () => togglePlus(false));
  for (const [trigger, panel, open] of [
    [picker, menu, () => togglePicker(true)],
    [historyBtn, historyPanel, () => toggleHistory(true)],
    [plus, plusMenu, () => togglePlus(true)],
  ] as const) trigger.addEventListener('keydown', event => {
    if (isComposing(event) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault(); open(); focusMenu(panel, event.key === 'ArrowUp');
  });
  // The open-chat strip is a tablist with one tab stop, so the arrows and Home/End move the focus
  // between the open chats without activating one: browsing the strip must never change what the
  // composer is editing. Enter or Space activates the focused chip through the same path as a click.
  panes.addEventListener('keydown', event => {
    if (isComposing(event)) return;
    const items = [...panes.querySelectorAll<HTMLElement>('[data-zcr-pane-tab]')];
    if (!items.length) return;
    const current = items.findIndex(tab => tab === doc.activeElement || tab.contains(doc.activeElement));
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (Math.max(current, 0) + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      event.preventDefault(); items[next]?.focus();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if ((event.target as Element | null)?.closest?.('[data-zcr-pane-close]')) return;
    const tab = items[Math.max(current, 0)];
    if (!tab) return;
    event.preventDefault();
    tab.click();
  });
  historySearch.addEventListener('input', () => {
    if (presenter.snapshot().workspace) void presenter.searchHistory(historySearch.value).catch(reportViewError); else applyHistoryFilter();
  });
  const onDocumentClick = (event: Event) => {
    const target = event.target as Node | null;
    // A menu row can re-render its own menu, detaching the clicked node before this document
    // listener runs; a detached target was inside the pane, so it is never an outside click.
    if (!target || !target.isConnected) return;
    if (!menu.hidden && !menu.contains(target) && !picker.contains(target)) togglePicker(false);
    if (!historyPanel.hidden && !historyPanel.contains(target) && !historyBtn.contains(target)) toggleHistory(false);
    if (!renameForm.hidden && !renameForm.contains(target) && !renameTrigger?.contains(target)) toggleRename(false);
    if (!plusMenu.hidden && !plusMenu.contains(target) && !plus.contains(target)) togglePlus(false);
  };
  const onDocumentKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isComposing(event) || !root.contains(event.target as Node | null)) return;
    if (!plusMenu.hidden) { event.preventDefault(); togglePlus(false); plus.focus(); }
    else if (!menu.hidden) { event.preventDefault(); togglePicker(false); picker.focus(); }
    else if (!renameForm.hidden) { event.preventDefault(); toggleRename(false); renameTrigger?.focus(); }
    else if (!historyPanel.hidden) { event.preventDefault(); toggleHistory(false); historyBtn.focus(); }
  };
  doc.addEventListener('click', onDocumentClick);
  doc.addEventListener('keydown', onDocumentKey);
  const applyHistoryFilter = () => {
    const query = historySearch.value.trim().toLowerCase();
    const filterRows = (rows: Iterable<HTMLElement>) => {
      let visible = 0;
      for (const row of rows) {
        const hay = row.dataset.zcrHistoryLabel ?? '';
        const show = !query || hay.toLowerCase().includes(query);
        row.hidden = !show;
        if (show) visible++;
      }
      return visible;
    };
    for (const group of historyList.querySelectorAll<HTMLElement>('[data-zcr-history-group]')) {
      group.hidden = filterRows(group.querySelectorAll<HTMLElement>('.zcr-history-row')) === 0;
    }
  };
  const citationCard = (citation: Citation, removable: boolean, readOnly = false) => {
    const card = el('div', 'zcr-citation'); card.dataset.zcrCitation = citation.id;
    const quote = el('blockquote', 'zcr-citation-text', citation.text.length > 240 ? `${[...citation.text].slice(0, 240).join('')}…` : citation.text);
    const meta = el('div', 'zcr-citation-meta');
    meta.append(el('span', '', COPY.page(pageLabel(citation))));
    // Jumping back into the PDF is an action, so a read-only transcript shows the page marker without
    // offering the jump.
    if (hooks.openCitation && !readOnly) meta.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation).catch(() => reportViewMessage(COPY.sourceOpenFailed)); }, 'source'));
    if (removable) meta.append(button(COPY.remove, 'remove-citation', () => { presenter.removeCitation(citation.id); }, 'remove'));
    card.append(quote, meta); return card;
  };
  /**
   * One transcript message. `readOnly` is the second column's mode: the same node shape and the same
   * painters, but the mutation actions — copy answer, branch, retry, cancel-queued, source jump,
   * annotation review — and the meta caption are never created, so there is nothing in the column to
   * tab to or activate. This is a genuine mode, not a CSS hiding pass.
   */
  const messageNode = (message: Message, readOnly = false) => {
    const article = el('article', 'zcr-message'); article.dataset.zcrMessage = message.id; article.dataset.role = message.role;
    if (message.action) article.dataset.action = message.action;
    // Codex-like shape: the body holds the text bubble, the attachments and the hover/focus actions;
    // the author is implied by alignment, so there is no labelled header row.
    const body = el('div', 'zcr-message-body');
    const text = el('div', 'zcr-message-text'); text.dataset.zcrText = '';
    text.addEventListener('click', event => {
      const target = event.target as Element | null;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href'); if (href) hooks.openLink?.(href);
    });
    const attachments = el('div', 'zcr-message-attachments'); attachments.dataset.zcrMessageAttachments = '';
    if (readOnly) {
      // Text and attachments only: the author still aligns the message, and the paper's own title,
      // pages and images stay legible without a single control.
      body.append(text, attachments);
      article.append(body);
      return article;
    }
    const taskSummary = button('Review annotation suggestions', 'review-annotations', () => {
      const task = latestViewState.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId);
      const card = task && [...taskPanel.querySelectorAll<HTMLDetailsElement>('[data-zcr-task-id]')].find(card => card.dataset.zcrTaskId === task.id);
      if (card) { card.open = true; card.scrollIntoView?.({ block: 'nearest' }); }
    }); taskSummary.hidden = true;
    const actions = el('div', 'zcr-message-actions');
    if (message.role === 'assistant') {
      const copyAnswer = button(COPY.copy, 'copy-answer', () => {
        const latest = presenter.snapshot().conversation?.messages.find(entry => entry.id === message.id);
        copyText(copyableAnswerText(latest?.text ?? message.text), copyAnswer);
      });
      copyAnswer.classList.add('zcr-copy-answer');
      const copyLabel = el('span', 'zcr-copy-label', COPY.copy);
      copyLabel.dataset.zcrCopyLabel = '';
      copyAnswer.replaceChildren(icon('copy'), copyLabel);
      actions.append(copyAnswer);
    }
    const branch = button(message.role === 'assistant' ? 'Regenerate in new chat' : 'Edit in new chat', 'branch-message', () => {
      const previous = presenter.snapshot().conversation?.id;
      void presenter.branchConversation(message.id).then(async () => {
        if (message.role === 'assistant' && presenter.snapshot().conversation?.id !== previous) await presenter.send();
      }).catch(reportViewError);
    });
    branch.classList.add('zcr-message-action'); actions.append(branch);
    if (message.role === 'user') { const cancelQueued = button('Cancel queued question', 'cancel-queued', () => { void presenter.cancelQueuedRequest(message.requestId).catch(reportViewError); }); cancelQueued.hidden = true; actions.append(cancelQueued); }
    body.append(text, taskSummary, attachments, actions);
    const meta = el('div', 'zcr-message-meta'); meta.dataset.zcrMeta = '';
    article.append(body, meta); return article;
  };
  let renderedConversationId: string | null = null;
  const messageNodes = new Map<string, HTMLElement>();
  const renderedMessages = new Map<string, { text: string; status: Message['status']; action: Message['action'] }>();
  /** One message node's painted state, so a streamed delta repaints only the node it belongs to. */
  type RenderRecord = Map<string, { text: string; status: Message['status']; action: Message['action'] }>;
  interface RenderView {
    /** The read-only column's mode: no actions are queried and no live sources are wired. */
    readOnly: boolean;
    /** The chat that owns the message, which is what answer citations resolve against. */
    conversation: Conversation | null;
    models: NonNullable<PresenterState['runtime']>['models'];
    tasks: PresenterState['tasks'];
    /** Request ids a queued send covers, or null for a transcript that cannot queue. */
    queued: ReadonlySet<string> | null;
  }
  /**
   * The text and attachments of one message, shared by the editable pane and the read-only column so
   * both render an answer the same way. Only the actions differ, and they are never created for a
   * read-only node: no citation jump, no code copy button, no preview dialog.
   */
  const paintBody = (node: HTMLElement, message: Message, rendered: RenderRecord, view: RenderView) => {
    const annotationTask = message.role === 'assistant' ? view.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId) : undefined;
    const text = node.querySelector<HTMLElement>('[data-zcr-text]')!;
    const previous = rendered.get(message.id);
    if (!previous || previous.text !== message.text || previous.status !== message.status || previous.action !== message.action) {
      rendered.set(message.id, { text: message.text, status: message.status, action: message.action });
      if (message.role === 'assistant' && message.text) {
        text.classList.add('zcr-rendered');
        const fragment = renderAnswer(doc, message.text, { deferMath: message.status === 'streaming' || message.status === 'pending' });
        // Always run the pass, even with no sources: reserved citation links must be neutralized
        // rather than left as external `zcr.invalid` URLs for the generic link handler to launch.
        linkAnswerSources(fragment, view.conversation ? answerSources(view.conversation, message) : [], openAnswerSource, view.readOnly);
        text.replaceChildren(fragment);
        enhanceCodeBlocks(text, view.readOnly);
      } else if (hiddenExplainText(message)) {
        text.classList.remove('zcr-rendered');
        text.textContent = '';
      } else {
        text.classList.remove('zcr-rendered');
        text.textContent = message.text;
      }
    }
    text.hidden = hiddenExplainText(message) || !!annotationTask;
    const attachments = node.querySelector<HTMLElement>('[data-zcr-message-attachments]')!;
    const attachmentKey = [...message.citations.map(citation => citation.id), ...(message.images ?? []).map(image => image.id), ...(message.generatedImages ?? []).map(image => image.id), message.workflow?.skill?.revision ?? '', ...(message.references ?? []).map(reference => reference.id)].join(':');
    if (attachments.dataset.rendered !== attachmentKey) {
      attachments.dataset.rendered = attachmentKey;
      attachments.replaceChildren(...message.citations.map(citation => citationCard(citation, false, view.readOnly)), ...[...(message.images ?? []), ...(message.generatedImages ?? [])].map(image => imageCard(image, view.readOnly)));
      if (message.workflow?.skill) attachments.append(el('span', 'zcr-message-reference', `/${message.workflow.skill.name} · v${message.workflow.skill.version}`));
      for (const reference of message.references ?? []) attachments.append(el('span', 'zcr-message-reference', `${reference.kind === 'chat' ? '@chat' : reference.kind === 'file' ? '@file' : '@article'} · ${reference.label}`));
    }
  };
  /**
   * The parts of a node that only exist in the chat being edited: the queued-send cancel, the
   * annotation review and the status caption. It is only ever called for the editable pane, where
   * those nodes really are present.
   */
  const paintActions = (node: HTMLElement, message: Message, view: RenderView) => {
    const queued = view.queued?.has(message.requestId) === true;
    const cancelQueued = node.querySelector<HTMLButtonElement>('[data-zcr-action="cancel-queued"]'); if (cancelQueued) cancelQueued.hidden = !queued;
    const annotationTask = message.role === 'assistant' ? view.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId) : undefined;
    const taskSummary = node.querySelector<HTMLButtonElement>('[data-zcr-action="review-annotations"]');
    if (taskSummary) {
      taskSummary.hidden = !annotationTask;
      if (annotationTask) taskSummary.textContent = `Review ${annotationTask.items.length} annotation suggestions`;
    }
    const meta = node.querySelector<HTMLElement>('[data-zcr-meta]'); if (!meta) return;
    const statusLabel = queued ? 'Queued' : message.role === 'assistant' ? STATUS_LABEL[message.status] : message.status === 'cancelled' ? 'Cancelled before sending' : '';
    const caption = settingsCaption(message.settings, view.models);
    const label = [statusLabel, caption].filter(Boolean).join(' · ');
    if (meta.textContent !== label) meta.textContent = label;
  };
  /**
   * The messages a transcript shows. The map phase of one request is not a conversation turn: its
   * intermediate user messages stay out of both columns unless one is explicitly focused.
   */
  const transcriptOf = (conversation: Conversation | null, keep: string | null): Message[] => {
    const all = conversation?.messages ?? [];
    const intermediate = new Set(all.filter(message => message.role === 'user' && message.batch?.phase === 'map').map(message => message.requestId));
    return all.filter(message => !intermediate.has(message.requestId) || message.id === keep);
  };
  let focusToken = 0; let contentKey = ''; let chromeKey = ''; let messageTimeKey = '';
  /**
   * The local reading status. Counts come from the prepared pages, so "read all N pages" is only said
   * when every page really carried text: a scanned page reported as empty still counts against the
   * total. A failed read stays silent here because the composer already announces the coded error,
   * and a read the owner switched off is not reported as a reading at all.
   */
  let documentStatusKey: string | null = null;
  const renderDocumentStatus = (state: PresenterState) => {
    const { enabled, phase, prepared, progress } = state.document;
    const pages = prepared?.pages ?? [];
    const read = pages.filter(page => page.status === 'text' && page.text.length > 0).length;
    const text = !enabled || phase === 'error' ? ''
      : phase === 'preparing' ? (progress.total > 0 ? COPY.documentReadingPages(progress.done, progress.total) : COPY.documentReading)
      : phase === 'ready' && prepared ? (read === 0 ? COPY.documentReadNone : read >= prepared.totalPages ? COPY.documentReadAll(prepared.totalPages) : COPY.documentReadSome(read, prepared.totalPages))
      : '';
    const key = `${phase}:${text}`;
    if (key === documentStatusKey) return;
    documentStatusKey = key;
    documentStatus.hidden = text === '';
    if (text) documentStatus.textContent = text; else documentStatus.replaceChildren();
  };
  const updateContext = (state: PresenterState) => {
    if (!state.conversation && !renameForm.hidden) toggleRename(false);
    const citation = latestCitation(state);
    const sourceKey = citation ? `${citation.id}:${pageLabel(citation)}` : '';
    if (contextSource.dataset.rendered !== sourceKey) {
      contextSource.dataset.rendered = sourceKey;
      if (!citation) contextSource.replaceChildren();
      else {
        const line = el('div', 'zcr-context-citation');
        line.append(el('span', '', COPY.page(pageLabel(citation))));
        if (hooks.openCitation) line.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation).catch(() => reportViewMessage(COPY.sourceOpenFailed)); }, 'source'));
        contextSource.replaceChildren(line);
      }
    }
    contextSource.hidden = !citation;
    renderDocumentStatus(state);
  };
  /**
   * Reconcile the Cursor-style tab strip. A chip is kept by id instead of rebuilt, so a click or an
   * arrow key lands on a node that is still in the document: switching chats never steals the focus
   * the reader put on the strip. The strip is always visible: a single open chat is still a tab, and
   * the unbound composer is the New chat tab.
   */
  const renderPanes = (state: PresenterState) => {
    panes.hidden = false;
    const models: Array<{ id: string; label: string; title: string; conversation: Conversation | null }> = state.openConversations.map(conversation => ({
      id: conversation.id,
      label: conversationLabel(conversation, state.conversations),
      title: conversation.title || conversationLabel(conversation, state.conversations),
      conversation,
    }));
    if (state.newChatOpen || !state.conversation) models.push({ id: NEW_CHAT_TAB_ID, label: COPY.newChat, title: COPY.newChat, conversation: null });
    const ids = new Set(models.map(entry => entry.id));
    for (const [id, node] of paneNodes) if (!ids.has(id)) { node.remove(); paneNodes.delete(id); }
    let cursor = panes.firstElementChild;
    let selected: HTMLElement | null = null;
    for (const model of models) {
      let tab = paneNodes.get(model.id);
      if (!tab) {
        tab = el('div', 'zcr-pane-tab');
        tab.setAttribute('role', 'tab');
        tab.dataset.zcrPaneTab = '';
        tab.dataset.zcrConversationId = model.id;
        tab.id = `${viewId}-pane-${model.id}`;
        const label = el('span', model.id === NEW_CHAT_TAB_ID ? 'zcr-pane-tab-new' : 'zcr-pane-tab-label');
        label.dataset.zcrPaneLabel = '';
        const close = button(COPY.closeChat, 'close-conversation', () => {
          if (presenter.closeConversation()) hooks.closeDock?.();
        }, 'remove', 'zcr-current-close');
        close.dataset.zcrPaneClose = '';
        tab.append(label, close);
        tab.addEventListener('click', event => {
          if ((event.target as Element | null)?.closest?.('[data-zcr-pane-close]')) return;
          const id = tab!.dataset.zcrConversationId ?? '';
          const active = tab!.getAttribute('aria-selected') === 'true';
          if (id === NEW_CHAT_TAB_ID) {
            if (!active) void presenter.newConversation();
            return;
          }
          if (active) toggleRename();
          else void presenter.openConversation(id).catch(reportViewError);
        });
        paneNodes.set(model.id, tab);
      }
      const active = model.id === (state.conversation?.id ?? NEW_CHAT_TAB_ID);
      const label = tab.querySelector<HTMLElement>('[data-zcr-pane-label]')!;
      const close = tab.querySelector<HTMLButtonElement>('[data-zcr-pane-close]')!;
      if (model.id === NEW_CHAT_TAB_ID) {
        if (!label.dataset.zcrUiCopy) { label.dataset.zcrUiCopy = COPY.newChat; label.textContent = COPY.newChat; }
      } else if (label.textContent !== model.label) label.textContent = model.label;
      if (tab.title !== model.title) tab.title = model.title;
      const selectedAttr = String(active);
      if (tab.getAttribute('aria-selected') !== selectedAttr) tab.setAttribute('aria-selected', selectedAttr);
      const stop = active ? 0 : -1;
      if (tab.tabIndex !== stop) tab.tabIndex = stop;
      close.hidden = !active;
      if (active) {
        tab.dataset.zcrCurrentTitle = '';
        if (model.conversation) {
          tab.dataset.zcrAction = 'rename-conversation';
          tab.setAttribute('aria-haspopup', 'dialog');
          tab.setAttribute('aria-expanded', renameForm.hidden ? 'false' : 'true');
          tab.setAttribute('aria-controls', `${viewId}-rename`);
          tab.setAttribute('aria-label', `${COPY.renameChat}: ${model.label}`);
          selected = tab;
        } else {
          delete tab.dataset.zcrAction;
          tab.removeAttribute('aria-haspopup');
          tab.removeAttribute('aria-expanded');
          tab.removeAttribute('aria-controls');
          tab.setAttribute('aria-label', COPY.newChat);
          selected = tab;
        }
      } else {
        delete tab.dataset.zcrCurrentTitle;
        tab.dataset.zcrAction = 'select-pane';
        tab.removeAttribute('aria-haspopup');
        tab.removeAttribute('aria-expanded');
        tab.removeAttribute('aria-controls');
        tab.setAttribute('aria-label', model.label);
      }
      if (tab !== cursor) panes.insertBefore(tab, cursor);
      cursor = tab.nextElementSibling;
    }
    renameTrigger = selected;
    const activeTab = paneNodes.get(state.conversation?.id ?? NEW_CHAT_TAB_ID);
    if (activeTab) { transcript.setAttribute('role', 'tabpanel'); transcript.setAttribute('aria-labelledby', activeTab.id); }
    else { transcript.removeAttribute('role'); transcript.removeAttribute('aria-labelledby'); }
  };
  /**
   * The read-only column: one other open chat, rendered by the same message painter with the
   * read-only flag on. It keeps its own node map, so a streamed delta in the chat beside it never
   * touches a node of the transcript being edited, and each column scrolls on its own anchor.
   */
  const previewNodes = new Map<string, HTMLElement>();
  const previewRendered: RenderRecord = new Map();
  let renderedPreviewId: string | null = null;
  let previewContentKey = '';
  const renderPreview = (state: PresenterState, conversation: Conversation | null, twoColumns: boolean) => {
    columns.dataset.zcrColumns = twoColumns ? 'two' : 'one';
    previewPane.hidden = !twoColumns;
    if (!conversation || !twoColumns) {
      // A hidden column holds no anchor and reports none: when it comes back it is re-read from the
      // presenter, so a clamped box cannot record a position that was never read.
      previewPaneId = null;
      renderedPreviewId = null;
      return;
    }
    previewPaneId = conversation.id;
    // Same-name chats are told apart as the strip and the history list tell them apart; the title is
    // the reader's own chat name and is never translated.
    const label = conversationLabel(conversation, state.conversations);
    if (previewTitle.textContent !== label) previewTitle.textContent = label;
    if (previewTitle.title !== label) previewTitle.title = label;
    const switched = renderedPreviewId !== conversation.id;
    if (switched) {
      renderedPreviewId = conversation.id;
      previewNodes.clear(); previewRendered.clear(); previewContentKey = '';
      previewMessages.replaceChildren();
    }
    const list = transcriptOf(conversation, null);
    const ids = new Set(list.map(message => message.id));
    for (const [id, node] of previewNodes) if (!ids.has(id)) { node.remove(); previewNodes.delete(id); previewRendered.delete(id); }
    let cursor = previewMessages.firstElementChild;
    for (const message of list) {
      let node = previewNodes.get(message.id);
      if (!node) { node = messageNode(message, true); previewNodes.set(message.id, node); }
      if (node !== cursor) previewMessages.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
    }
    // The column follows its chat's newest answer only while it is parked at the bottom, so reading
    // back through it is never yanked away by a message that arrives meanwhile.
    const pinned = previewMessages.scrollHeight - previewMessages.scrollTop - previewMessages.clientHeight < 48;
    const contentKey = list.map(message => `${message.id}:${message.status}:${message.text.length}`).join('\n');
    const contentChanged = contentKey !== previewContentKey;
    previewContentKey = contentKey;
    for (const message of list) {
      const node = previewNodes.get(message.id); if (!node) continue;
      paintBody(node, message, previewRendered, { readOnly: true, conversation, models: state.runtime?.models ?? [], tasks: [], queued: null });
    }
    // The anchor the owner left this chat at lives in the presenter's per-chat position map; falling
    // back to the bottom is the same choice as a chat whose position was never measured.
    if (switched) previewMessages.scrollTop = presenter.paneScrollTop(conversation.id) ?? previewMessages.scrollHeight;
    else if (contentChanged && pinned) previewMessages.scrollTop = previewMessages.scrollHeight;
  };
  const historyRow = (source: HistoryRowSource) => {
    const row = el('div', 'zcr-history-row');
    row.setAttribute('role', 'listitem');
    // The local search fallback hides rows by this label, so it keeps title + paper + preview.
    row.dataset.zcrHistoryLabel = [source.title, source.paperTitle, source.preview].filter(Boolean).join(' ');
    if (source.current) row.dataset.current = '';
    const choice = el('button', 'zcr-history-item');
    choice.type = 'button';
    choice.dataset.zcrConversationId = source.id;
    const mark = el('span', `zcr-history-status zcr-history-status-${source.status}`);
    mark.dataset.zcrHistoryStatus = source.status;
    mark.setAttribute('aria-hidden', 'true');
    // A calm glyph, not an animation: done is a checked ring, a draft is a pencil, a live request
    // is the same clock the timing line uses.
    mark.append(icon(source.status === 'done' ? 'historyDone' : source.status === 'draft' ? 'historyDraft' : 'clock'));
    const title = el('span', 'zcr-history-title', source.title);
    choice.append(mark, title);
    const description = historyRowDescription({ title: source.title, paperTitle: source.paperTitle, preview: source.preview });
    choice.setAttribute('aria-label', description);
    choice.title = description;
    choice.addEventListener('click', () => { source.open(); toggleHistory(false); });
    row.append(choice);
    if (source.remove) {
      const drop = button(`${COPY.deleteChat}: ${source.title}`, 'delete-conversation', source.remove, 'remove');
      drop.dataset.zcrConversationId = source.id;
      row.append(drop);
    }
    return row;
  };
  const workspaceHistoryRow = (entry: HistoryEntry, state: PresenterState): HistoryRowSource => ({
    id: entry.id,
    title: entry.title || COPY.untitled,
    paperTitle: entry.identity.title,
    preview: entry.preview,
    status: historyStatus(entry),
    updatedAt: entry.updatedAt || entry.createdAt,
    current: entry.id === state.conversation?.id,
    open: () => { void presenter.openHistoryEntry(entry.id); },
    remove: () => { void presenter.deleteConversation(entry.id); },
  });
  const conversationHistoryRow = (conversation: Conversation, state: PresenterState): HistoryRowSource => ({
    id: conversation.id,
    title: conversationLabel(conversation, state.conversations),
    paperTitle: conversation.paperIdentity?.title ?? '',
    preview: conversation.messages.at(-1)?.text ?? '',
    status: historyStatus(conversation),
    updatedAt: conversation.updatedAt || conversation.createdAt,
    current: conversation.id === state.conversation?.id,
    open: () => { void presenter.openConversation(conversation.id); },
    remove: () => { void presenter.deleteConversation(conversation.id); },
  });
  /**
   * Both history paths render through the same row shape and differ only in their source. Neither
   * partitions any more: a stored `archivedAt` is not a scope, so every chat is an ordinary row.
   */
  /**
   * History rows are rebuilt wholesale, so removing the row that holds focus would otherwise drop
   * the owner's keyboard position to the page body. Snapshot the focused row (and which control on
   * it) before the rebuild, restore the scroll offset, then put focus on the same control of the row
   * that now occupies its slot — or on the search field when the list is empty.
   */
  const historyFocusSnapshot = (): { index: number; action: string | null } | null => {
    const active = doc.activeElement as HTMLElement | null;
    if (!active || !historyList.contains(active)) return null;
    const index = [...historyList.querySelectorAll<HTMLElement>('.zcr-history-row')].findIndex(row => row.contains(active));
    return index < 0 ? null : { index, action: active.dataset.zcrAction ?? null };
  };
  const restoreHistoryFocus = (snapshot: { index: number; action: string | null }) => {
    const rows = [...historyList.querySelectorAll<HTMLElement>('.zcr-history-row')];
    const row = rows[Math.min(snapshot.index, rows.length - 1)];
    const control = snapshot.action
      ? row?.querySelector<HTMLElement>(`[data-zcr-action="${snapshot.action}"]`)
      : row?.querySelector<HTMLElement>('.zcr-history-item');
    (control ?? row ?? historySearch).focus();
  };
  const renderHistory = (state: PresenterState) => {
    const scrollTop = historyList.scrollTop;
    const focus = historyFocusSnapshot();
    const rows = state.workspace
      ? newestFirst(state.history).map(entry => workspaceHistoryRow(entry, state))
      : newestFirst(state.conversations).map(conversation => conversationHistoryRow(conversation, state));
    const sections = groupHistory(rows, row => row.updatedAt);
    const nodes: HTMLElement[] = [];
    for (const { bucket, items } of sections) {
      const group = el('div', 'zcr-history-group');
      group.dataset.zcrHistoryGroup = bucket;
      group.append(el('div', 'zcr-history-heading', HISTORY_BUCKET_LABELS[bucket]));
      for (const row of items) group.append(historyRow(row));
      nodes.push(group);
    }
    historyList.replaceChildren(...(nodes.length ? nodes : [el('p', 'zcr-history-empty', COPY.noSavedChats)]));
    // The presenter already filtered a workspace search (it also matches message text), so the
    // local row-label filter only runs for the host-list fallback.
    if (!state.workspace) applyHistoryFilter();
    historyList.scrollTop = scrollTop;
    if (focus) restoreHistoryFocus(focus);
  };
  const renderPicker = (state: PresenterState, signedIn: boolean) => {
    const models = state.runtime?.models ?? [];
    const current = state.draft.settings ?? state.conversation?.settings ?? null;
    const controls = composerControls(models, current);
    const selected = current ? models.find(entry => entry.id === current.model) : undefined;
    const fast = resolveFastTier(selected);
    /**
     * Codex keeps this menu open so effort, speed and model are configured in one visit; only the
     * picker button, an outside click or Escape closes it. The re-render replaces the rows, so the
     * chosen row is focused again to keep keyboard navigation where the owner left it.
     */
    const keepPicker = (field: string, value: string) => {
      const rows = [...menu.querySelectorAll<HTMLButtonElement>(`[data-zcr-setting="${field}"]`)];
      rows.find(row => row.dataset.zcrValue === value)?.focus();
    };
    const effortCtl = controls.find(entry => entry.field === 'effort');
    const modelCtl = controls.find(entry => entry.field === 'model');
    const effortValue = current?.effort || selected?.defaultReasoningEffort || '';
    const sections: HTMLElement[] = [];
    const effortSection = el('div', 'zcr-picker-section');
    effortSection.dataset.zcrPickerSection = 'effort';
    effortSection.append(el('div', 'zcr-picker-heading', COPY.effort));
    for (const option of effortCtl?.options.filter(entry => entry.value) ?? []) {
      const row = el('button', 'zcr-picker-option');
      row.type = 'button';
      row.dataset.zcrSetting = 'effort';
      row.dataset.zcrValue = option.value;
      row.setAttribute('role', 'menuitemradio');
      const checked = option.value === effortValue;
      row.setAttribute('aria-checked', String(checked));
      row.append(el('span', 'zcr-picker-option-label', effortLabel(option.value)));
      if (checked) row.append(icon('check'));
      row.disabled = !signedIn || !!effortCtl?.disabled;
      row.addEventListener('click', () => {
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'effort', option.value));
        keepPicker('effort', option.value);
      });
      effortSection.append(row);
    }
    sections.push(effortSection);
    if (fast) {
      const optionsSection = el('div', 'zcr-picker-section');
      optionsSection.dataset.zcrPickerSection = 'options';
      optionsSection.append(el('div', 'zcr-picker-heading', COPY.options));
      const row = el('div', 'zcr-picker-toggle-row');
      row.append(el('span', 'zcr-picker-option-label', COPY.fast));
      const toggle = el('button', 'zcr-switch');
      toggle.type = 'button';
      toggle.dataset.zcrSetting = 'speed';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', COPY.fast);
      const on = current?.serviceTier === fast.id;
      toggle.setAttribute('aria-checked', String(on));
      toggle.disabled = !signedIn;
      toggle.addEventListener('click', event => {
        event.stopPropagation();
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'speed', on ? '' : fast.id));
        menu.querySelector<HTMLButtonElement>('[data-zcr-setting="speed"]')?.focus();
      });
      row.append(toggle);
      optionsSection.append(row);
      sections.push(optionsSection);
    }
    const modelSection = el('div', 'zcr-picker-section');
    modelSection.dataset.zcrPickerSection = 'model';
    modelSection.append(el('div', 'zcr-picker-heading', COPY.model));
    for (const option of modelCtl?.options ?? []) {
      const row = el('button', 'zcr-picker-option');
      row.type = 'button';
      row.dataset.zcrSetting = 'model';
      row.dataset.zcrValue = option.value;
      row.setAttribute('role', 'menuitemradio');
      const checked = option.value === (current?.model ?? '');
      row.setAttribute('aria-checked', String(checked));
      row.append(el('span', 'zcr-picker-option-label', option.label));
      if (checked) row.append(icon('check'));
      row.disabled = !signedIn || !!modelCtl?.disabled;
      row.addEventListener('click', () => {
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'model', option.value));
        keepPicker('model', option.value);
      });
      modelSection.append(row);
    }
    sections.push(modelSection);
    // Account usage moved here when the More menu went away: the model picker already reports the
    // account's own allowances, and rate limits are account data, not a chat setting. It renders as
    // its own section so it stays readable and is announced as text, never as a menu row.
    const quotas = state.runtime?.rateLimits;
    const accountSection = el('div', 'zcr-picker-section');
    accountSection.dataset.zcrPickerSection = 'account';
    accountSection.append(el('div', 'zcr-picker-heading', COPY.accountUsage));
    const usage = el('p', 'zcr-account-usage');
    usage.dataset.zcrAccountUsage = '';
    usage.textContent = quotas ? quotas.map(quota => `${quota.label}: ${quota.usedPercent === null ? 'usage unknown' : `${quota.usedPercent}% used`}${quota.resetsAt === null ? '' : ` · resets ${new Date(quota.resetsAt * 1000).toLocaleString()}`}`).join('\n') || 'Account usage: no limits reported.' : 'Account usage: unavailable.';
    accountSection.append(usage);
    sections.push(accountSection);
    menu.replaceChildren(...sections);
  };
  const update = (state: PresenterState) => {
    latestViewState = state;
    paintTiming(state);
    const uiLanguage = state.workspace?.uiLanguage ?? 'en';
    if (lastLanguage !== uiLanguage) { lastLanguage = uiLanguage; localizer.update(uiLanguage); }
    // The consent prompt is a state, not a banner: it appears only when a request actually needs it.
    scopeNotice.hidden = !state.pendingExplain;
    acknowledgeScope.hidden = !state.pendingExplain;
    if (state.workspace) {
      if (!workspaceView) workspaceView = mountWorkspaceView({ input, context: composerContext, leading }, {
        searchReferences: (query, kind, signal) => presenter.searchReferences(query, kind, signal), previewReference: (reference, signal) => presenter.previewReference(reference, signal),
        addReference: async reference => { await presenter.addReference(reference); }, removeReference: async id => { await presenter.removeReference(id); },
        selectSkill: id => presenter.selectSkill(id), selectProfile: id => presenter.selectProfile(id),
        setReferenceRange: (id, range) => presenter.setReferenceRange(id, range),
      });
      const nextDraftKey = `${state.draft.references.map(reference => `${reference.id}:${reference.range?.join('-') ?? ''}:${reference.capturedAt}`).join(',')}:${state.draft.skillId}:${state.draft.profileId}`;
      if (lastWorkspace !== state.workspace || nextDraftKey !== workspaceDraftKey) {
        lastWorkspace = state.workspace; workspaceDraftKey = nextDraftKey;
        workspaceView.update({ settings: state.workspace, draft: { references: state.draft.references, skillId: state.draft.skillId, profileId: state.draft.profileId } });
      }
      applyChatTextScale(root, state.workspace.textScale);
      const acquire = state.workspace.skills.find(skill => skill.id === state.draft.skillId)?.workflow === 'acquire'; acquisition.hidden = !acquire;
      if (acquire && !requestedCollections) { requestedCollections = true; void presenter.collections().catch(() => { requestedCollections = false; reportViewMessage(COPY.collectionsFailed); }); }
      const collectionKey = JSON.stringify(state.collectionOptions);
      if (collection.dataset.options !== collectionKey) {
        collection.dataset.options = collectionKey; const empty = el('option', '', 'Choose a collection…'); empty.value = '';
        collection.replaceChildren(empty, ...state.collectionOptions.map(item => { const option = el('option', '', item.name); option.value = `${item.libraryId}:${item.collectionKey}`; return option; }));
      }
      collection.value = state.acquisitionTarget ? `${state.acquisitionTarget.libraryId}:${state.acquisitionTarget.collectionKey}` : '';
    }
    const nextTasks = `${state.tasks.map(task => `${task.id}:${task.revision}`).join(',')}/${state.readingJobs.map(job => `${job.id}:${job.revision}`).join(',')}`;
    if (nextTasks !== tasksKey) { tasksKey = nextTasks; taskView.update({ tasks: state.tasks, readingJobs: state.readingJobs }); }
    // Which chat the read-only column shows, and whether the dock has room for it at all. The
    // decision is measured before the render gate so a resize (and a chat scale change) can open or
    // close the second column even when no state changed.
    const previewFor = previewChatId(state.conversation?.id ?? null, renderedActiveId, state.openConversations.map(entry => entry.id));
    renderedActiveId = state.conversation?.id ?? null;
    const previewConversation = previewFor === null ? null : state.openConversations.find(entry => entry.id === previewFor) ?? null;
    const twoColumns = !!previewConversation && readableColumnCount(measureColumns(), state.workspace?.textScale ?? hooks.readTextScale?.() ?? 1) === 2;
    const list = transcriptOf(state.conversation, state.messageFocus?.messageId ?? null);
    const nextChrome = [
      state.connection, state.runtime?.revision ?? 0, state.runtime?.account.state ?? '', state.runtime?.login?.state ?? '',
      state.generating, state.message ?? '', state.conversation?.id ?? '', state.conversation?.lastSeq ?? 0,
      state.conversation?.activeRequestId ?? '', state.conversations.map(c => `${c.id}:${c.title}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}`).join('\n'),
      state.openConversations.map(c => `${c.id}:${c.title}:${c.lastSeq}:${c.activeRequestId ?? ''}`).join('\n'),
      // The column shows another chat's transcript, so its own content has to be able to open the
      // second column; the layout flag re-renders when the dock is measured or resized.
      previewConversation ? previewConversation.messages.map(message => `${message.id}:${message.status}:${message.text.length}`).join('\n') : '',
      twoColumns ? 'two' : 'one',
      state.draft.citations.map(c => c.id).join('\n'), state.draft.images.map(image => image.id).join('\n'), JSON.stringify(state.draft.settings), state.focusToken,
      state.draft.question.trim().length > 0,
      state.history.map(item => `${item.id}:${item.title}:${item.updatedAt}:${item.preview}`).join('\n'), state.tasks.map(task => `${task.id}:${task.revision}`).join(','), state.readingJobs.map(job => `${job.id}:${job.revision}`).join(','), state.queueing, state.conversation?.queuedRequestIds?.join(','), state.messageFocus?.token,
      list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.images?.map(image => image.id).join(',') ?? ''}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n'),
      (state.conversation?.requestTiming ?? []).map(timing => `${timing.requestId}:${timing.acceptedAt}`).join(','),
      state.workspace?.uiLanguage ?? 'en',
    ].join('\0');
    if (nextChrome === chromeKey) {
      if (!composing && input.value !== state.draft.question) { input.value = state.draft.question; resizeInput(); }
      return;
    }
    chromeKey = nextChrome;
    const account = state.runtime?.account.state ?? 'signedOut';
    const pendingLogin = state.runtime?.login?.state === 'pending';
    chat.dataset.zcrRuntime = state.connection; chat.dataset.zcrAuth = account; chat.dataset.zcrGenerating = String(state.generating);
    chat.dataset.zcrConversation = state.conversation?.id ?? ''; chat.dataset.zcrActiveRequest = state.conversation?.activeRequestId ?? '';
    status.textContent = state.connection === 'idle' ? STATUS_LINE.idle : state.connection === 'starting' ? STATUS_LINE.starting : state.connection === 'error' ? STATUS_LINE.error
      : pendingLogin ? STATUS_LINE.pendingLogin : account === 'signedIn' ? (state.generating ? STATUS_LINE.generating : '') : STATUS_LINE.signedOut;
    status.hidden = !status.textContent;
    login.hidden = account === 'signedIn' || pendingLogin || state.connection !== 'ready'; cancelLogin.hidden = !pendingLogin;
    retry.hidden = state.connection !== 'error';
    auth.hidden = login.hidden && cancelLogin.hidden && retry.hidden;
    // The `+` starts a chat and stays available in every state, including right after a close:
    // tying it to having a current conversation is the regression that hid it with the chat.
    fresh.hidden = false;
    historyBtn.hidden = false;
    alert.textContent = state.message ?? ''; alert.hidden = !state.message;
    updateContext(state);
    renderPanes(state);
    renderPreview(state, previewConversation, twoColumns);
    const historyKey = state.workspace ? JSON.stringify([state.history, state.historyQuery]) : state.conversations.map(c => `${c.id}:${c.title}:${c.createdAt}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}:${c.id === state.conversation?.id ? '1' : '0'}`).join('\n');
    if (historyList.dataset.options !== historyKey) {
      historyList.dataset.options = historyKey;
      renderHistory(state);
    }
    const nearBottom = isNearBottom();
    const conversationChanged = renderedConversationId !== (state.conversation?.id ?? null);
    if (conversationChanged) {
      renderedConversationId = state.conversation?.id ?? null;
      messageNodes.clear(); renderedMessages.clear(); messages.replaceChildren(); contentKey = ''; hasNewContent = false;
    }
    const ids = new Set(list.map(message => message.id));
    for (const [id, node] of messageNodes) {
      if (!ids.has(id)) { node.remove(); messageNodes.delete(id); renderedMessages.delete(id); }
    }
    let cursor = messages.firstElementChild;
    for (const message of list) {
      let node = messageNodes.get(message.id);
      if (!node) { node = messageNode(message); messageNodes.set(message.id, node); }
      if (node !== cursor) messages.insertBefore(node, cursor);
      cursor = node.nextElementSibling;
    }
    // Centered timestamp dividers, one per calendar-day group. The transcript persists no per-message
    // clock, so the only honest source is the request's recorded `acceptedAt`; a message whose request
    // has no readable timing gets no divider rather than an invented time.
    const timings = new Map((state.conversation?.requestTiming ?? []).map(timing => [timing.requestId, timing.acceptedAt]));
    const timeLocale = state.workspace?.uiLanguage ?? 'en';
    const now = Date.now();
    const dividers: Array<{ before: string; label: string }> = [];
    let lastDay = '';
    for (const message of list) {
      const acceptedAt = timings.get(message.requestId);
      if (!acceptedAt) continue;
      const parsed = Date.parse(acceptedAt);
      if (!Number.isFinite(parsed)) continue;
      const day = new Date(parsed).toDateString();
      if (day === lastDay) continue;
      lastDay = day;
      const label = messageTimeLabel(acceptedAt, now, timeLocale);
      if (label) dividers.push({ before: message.id, label });
    }
    const dividerKey = `${timeLocale}\n${dividers.map(entry => `${entry.before}:${entry.label}`).join('\n')}`;
    if (conversationChanged || dividerKey !== messageTimeKey) {
      messageTimeKey = dividerKey;
      for (const node of [...messages.querySelectorAll<HTMLElement>('[data-zcr-message-time]')]) node.remove();
      for (const divider of dividers) {
        const target = messageNodes.get(divider.before);
        if (!target) continue;
        const node = el('div', 'zcr-message-time', divider.label);
        node.dataset.zcrMessageTime = '';
        messages.insertBefore(node, target);
      }
    }
    if (messages.lastElementChild !== taskPanel) messages.append(taskPanel);
    taskPanel.hidden = !state.tasks.length && !state.readingJobs.length;
    const nextKey = list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n');
    const contentChanged = nextKey !== contentKey;
    const follow = followAnswerScroll(nearBottom, contentChanged && contentKey !== '');
    contentKey = nextKey;
    const editableView: RenderView = {
      readOnly: false,
      conversation: state.conversation,
      models: state.runtime?.models ?? [],
      tasks: state.tasks,
      queued: state.conversation?.queuedRequestIds ? new Set(state.conversation.queuedRequestIds) : null,
    };
    for (const message of list) {
      const node = messageNodes.get(message.id); if (!node) continue;
      node.dataset.status = message.status;
      paintBody(node, message, renderedMessages, editableView);
      paintActions(node, message, editableView);
    }
    if (conversationChanged) { messages.scrollTop = state.scrollTop || messages.scrollHeight; hasNewContent = false; }
    else if (contentChanged && follow.stick) {
      messages.scrollTop = messages.scrollHeight; hasNewContent = false;
    } else if (follow.showNewContent) hasNewContent = true;
    sticking = conversationChanged ? isNearBottom() : follow.stick;
    newContent.hidden = !hasNewContent;
    const draftIds = state.draft.citations.map(c => c.id).join('\n');
    if (draftCitations.dataset.rendered !== draftIds) { draftCitations.dataset.rendered = draftIds; draftCitations.replaceChildren(...state.draft.citations.map(c => citationCard(c, true))); }
    const imageIds = state.draft.images.map(image => image.id).join('\n');
    if (draftImages.dataset.rendered !== imageIds) {
      draftImages.dataset.rendered = imageIds;
      draftImages.replaceChildren(...state.draft.images.map(image => {
        const chip = el('div', 'zcr-draft-image');
        chip.dataset.zcrDraftImage = image.id;
        const thumb = el('img', 'zcr-draft-thumb');
        thumb.setAttribute('src', image.dataUrl);
        thumb.setAttribute('alt', image.name);
        const open = button('Preview image', 'preview-image', () => previewImage(image, open)); open.replaceChildren(thumb);
        chip.append(open, button('Move image earlier', 'move-image-earlier', () => { presenter.moveImage(image.id, -1); }, 'source'), button(COPY.remove, 'remove-image', () => { presenter.removeImage(image.id); }, 'remove'));
        return chip;
      }));
    }
    if (!composing && input.value !== state.draft.question) { input.value = state.draft.question; resizeInput(); }
    const signedIn = account === 'signedIn' && state.connection === 'ready';
    const pickerKey = `${JSON.stringify(state.draft.settings ?? state.conversation?.settings ?? null)}\n${state.runtime?.models.map(entry => entry.id).join(',')}\n${signedIn}\n${JSON.stringify(state.runtime?.rateLimits ?? null)}`;
    if (menu.dataset.rendered !== pickerKey) {
      menu.dataset.rendered = pickerKey;
      renderPicker(state, signedIn);
    }
    const summary = modelChipLabel(state.draft.settings ?? state.conversation?.settings ?? null, state.runtime?.models ?? []);
    if (picker.dataset.summary !== summary) {
      picker.dataset.summary = summary;
      picker.replaceChildren(doc.createTextNode(summary));
    }
    picker.disabled = !signedIn;
    const usage = currentContextUsage(state.draft.settings?.model ?? state.conversation?.settings.model, state.conversation?.usage);
    contextRing.update(usage);
    // The ring's details are the only renderer of `state.contextReport`; they are rebuilt only when
    // the report changes, and cleared to null on a new chat so nothing is invented before a request.
    const reportKey = state.contextReport ? JSON.stringify(state.contextReport) : null;
    if (reportKey !== contextReportKey) { contextReportKey = reportKey; contextRing.report(state.contextReport ? contextDetailNodes(doc, state.contextReport) : null); }
    const hasInput = state.draft.question.trim().length > 0;
    const canSend = state.connection === 'ready' && account === 'signedIn' && !state.generating && hasInput;
    send.disabled = !canSend; send.hidden = state.generating; stop.hidden = !state.generating;
    queue.hidden = !state.generating; queue.disabled = !signedIn || state.queueing || !hasInput;
    input.disabled = false;
    if (state.focusToken !== focusToken) { focusToken = state.focusToken; input.focus(); }
    if (state.messageFocus && messages.dataset.focusToken !== String(state.messageFocus.token)) { messages.dataset.focusToken = String(state.messageFocus.token); messageNodes.get(state.messageFocus.messageId)?.scrollIntoView?.({ block: 'center' }); }
  };
  const unbind = presenter.bind(update);
  /**
   * The dock is resizable and the reader's dock width is what decides whether two chats fit. The
   * observer only re-runs the same render, which is gated on its own key, so a resize costs nothing
   * when the layout does not actually change. `columns` is the measured element, not the dock: the
   * threshold is about the space the two columns really get.
   */
  const resizeObserver = doc.defaultView && 'ResizeObserver' in doc.defaultView
    ? new (doc.defaultView as unknown as { ResizeObserver: new (callback: () => void) => { observe(node: Element): void; disconnect(): void } }).ResizeObserver(() => update(latestViewState))
    : null;
  try { resizeObserver?.observe(columns); } catch { /* an unmeasurable dock keeps the strip as the UI */ }
  return () => {
    presenter.setScrollTop(messages.scrollTop); unbindZoom(); unbind(); resizeObserver?.disconnect(); workspaceView?.dispose(); taskView.dispose(); localizer.dispose(); clearTimingInterval();
    doc.removeEventListener('click', onDocumentClick);
    doc.removeEventListener('keydown', onDocumentKey);
    for (const target of pasteDocuments) target.removeEventListener('paste', onPaste, true);
    pasteWindow?.removeEventListener('paste', onPaste, true);
    chat.remove();
  };
}
