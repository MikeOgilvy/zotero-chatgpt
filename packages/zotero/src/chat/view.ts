import type { Citation, Conversation, DocumentContext, Message } from '../../../contracts/src/index.ts';
import { mountDocumentContext } from './context-view.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import {
  applyComposerChoice, composerControls, effortLabel, modelChipLabel, resolveFastTier, settingsCaption,
} from './generation-settings.ts';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from './render-answer.ts';
import { applyChatTextScale, bindUnifiedReaderZoom, type ReaderZoomHost } from './text-scale.ts';
import { clipboardHasImage, geckoClipboardHasImage, imagesFromClipboard, imagesFromGeckoClipboard, resolveGeckoClipboardAccess, type GeckoClipboardAccess } from './pick-images.ts';
export interface AttachmentIdentity { title: string; key: string; libraryID: number }
export interface ChatViewHooks {
  openCitation?(citation: Citation): Promise<void>;
  openDocumentPage?(document: DocumentContext, pageIndex: number): Promise<void>;
  copyText?(text: string): void;
  openLink?(url: string): void;
  confirm?(message: string): boolean;
  readTextScale?(): number;
  writeTextScale?(scale: number): void;
  zoomTargets?: Array<Document | HTMLElement>;
  pasteTargets?: Array<Document | HTMLElement>;
  readerZoom?: ReaderZoomHost;
  uuid?(): string;
}
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const COPY = {
  paneLabel: 'Codex',
  login: 'Sign in with ChatGPT',
  cancelLogin: 'Cancel sign-in',
  retry: 'Reconnect',
  newChat: 'New chat',
  untitled: 'Untitled',
  history: 'Chat history',
  searchChats: 'Search chats…',
  deleteChat: 'Delete chat',
  deleteConfirm: 'Delete this chat? This only removes the local history for this PDF.',
  newContent: 'New content',
  askPlaceholder: 'Ask a question…',
  question: 'Question',
  send: 'Send',
  stop: 'Stop',
  chromeSettings: 'Settings',
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
  older: 'Older',
  page: (label: string) => `p. ${label}`,
} as const;
const ICONS = {
  send: 'M8 13V3M4.5 6.5 8 3l3.5 3.5',
  stop: 'M5 5h6v6H5z',
  plus: 'M8 3v10M3 8h10',
  more: 'M3.25 8a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Zm3.9 0a.85.85 0 1 1 1.7 0 .85.85 0 0 1-1.7 0Z',
  clock: 'M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5ZM8 5.25V8.2l2.15 1.25',
  copy: 'M6 6h7v7H6zM3 3h7v2',
  source: 'M8 3v8M5 8l3 3 3-3',
  remove: 'M4 4l8 8M12 4l-8 8',
  trash: 'M3 5h10M6 5V3h4v2M5 5l.5 8h5L11 5',
  check: 'M3.5 8.25 6.5 11.25 12.5 4.75',
} as const;
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
/** Filenames and generic attachment labels stay off the chrome; real paper titles stay muted. */
export function compactPaperTitle(title: string): string {
  const text = title.trim();
  if (!text) return '';
  if (/^(pdf|pdf attachment|untitled|attachment)$/iu.test(text)) return '';
  if (/\.pdf$/iu.test(text) && !/\s/u.test(text)) return '';
  return text;
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
export function historyGroup(iso: string, now = Date.now()): 'Today' | 'Yesterday' | 'Older' {
  const date = Date.parse(iso);
  if (!Number.isFinite(date)) return 'Today';
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (date >= today) return 'Today';
  if (date >= today - 86_400_000) return 'Yesterday';
  return 'Older';
}
function hiddenExplainText(message: Message): boolean {
  return message.role === 'user' && (message.action === 'explain' || message.text === EXPLAIN_QUESTION);
}
function historyStatus(conversation: Conversation): 'draft' | 'active' | 'done' {
  if (conversation.activeRequestId) return 'active';
  return conversation.messages.length === 0 ? 'draft' : 'done';
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
  const confirmDelete = () => (hooks.confirm ?? ((message: string) => doc.defaultView?.confirm(message) ?? false))(COPY.deleteConfirm);
  root.querySelector('[data-zcr-chat]')?.remove();
  const chat = el('section', 'zcr-chat'); chat.dataset.zcrChat = '';
  const chrome = el('div', 'zcr-chrome');
  const context = el('div', 'zcr-chrome-main');
  context.dataset.zcrContext = '';
  const pills = el('div', 'zcr-chat-pills');
  pills.dataset.zcrPills = '';
  pills.setAttribute('role', 'tablist');
  pills.setAttribute('aria-label', COPY.history);
  const contextSource = el('div', 'zcr-chrome-source');
  contextSource.dataset.zcrContextSource = '';
  context.append(pills, contextSource);
  const actions = el('div', 'zcr-chrome-actions');
  const fresh = button(COPY.newChat, 'new-conversation', () => { void presenter.newConversation(); }, 'plus');
  const historyBtn = button(COPY.history, 'history', () => { toggleHistory(); }, 'clock');
  historyBtn.setAttribute('aria-haspopup', 'true');
  historyBtn.setAttribute('aria-expanded', 'false');
  const overflow = button(COPY.chromeSettings, 'settings', () => { toggleSettings(); }, 'more');
  overflow.setAttribute('aria-haspopup', 'true');
  overflow.setAttribute('aria-expanded', 'false');
  actions.append(fresh, historyBtn, overflow);
  chrome.append(context, actions);
  const settingsMenu = el('div', 'zcr-settings-menu');
  settingsMenu.dataset.zcrSettingsMenu = '';
  settingsMenu.hidden = true;
  settingsMenu.setAttribute('role', 'menu');
  settingsMenu.setAttribute('aria-label', COPY.chromeSettings);
  const documentPanel = el('div', 'zcr-document-panel');
  const documentView = mountDocumentContext(documentPanel, settingsMenu, presenter, hooks.openDocumentPage ? (document, pageIndex) => hooks.openDocumentPage!(document, pageIndex) : undefined);
  const historyPanel = el('div', 'zcr-history-panel');
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
  const auth = el('div', 'zcr-auth');
  const login = button(COPY.login, 'login', () => { void presenter.login(); });
  const cancelLogin = button(COPY.cancelLogin, 'cancel-login', () => { void presenter.cancelLogin(); });
  const retry = button(COPY.retry, 'retry', () => { void presenter.retry(); });
  auth.append(login, cancelLogin, retry);
  const alert = el('p', 'zcr-error'); alert.setAttribute('role', 'alert'); alert.hidden = true;
  const transcript = el('div', 'zcr-transcript');
  const messages = el('div', 'zcr-messages'); messages.setAttribute('aria-live', 'polite'); messages.dataset.zcrMessages = '';
  const newContent = button(COPY.newContent, 'new-content', () => { messages.scrollTop = messages.scrollHeight; newContent.hidden = true; });
  newContent.hidden = true;
  newContent.classList.add('zcr-new-content');
  const emptyMark = el('div', 'zcr-empty-mark');
  emptyMark.dataset.zcrEmpty = '';
  emptyMark.setAttribute('aria-hidden', 'true');
  const mark = doc.createElementNS(SVG, 'svg');
  mark.setAttribute('viewBox', '0 0 72 56');
  mark.setAttribute('width', '56');
  mark.setAttribute('height', '44');
  mark.setAttribute('aria-hidden', 'true');
  const cloud = doc.createElementNS(SVG, 'path');
  cloud.setAttribute('d', 'M20 42c-8 0-14-6-14-13 0-6 4-11 10-12 2-8 9-14 18-14 10 0 18 7 19 16h1c7 0 13 5 13 12 0 7-6 11-13 11H20z');
  cloud.setAttribute('fill', 'none');
  cloud.setAttribute('stroke', 'currentColor');
  cloud.setAttribute('stroke-width', '2');
  cloud.setAttribute('stroke-linejoin', 'round');
  const prompt = doc.createElementNS(SVG, 'path');
  prompt.setAttribute('d', 'M26 26l7 6-7 6M38 38h10');
  prompt.setAttribute('fill', 'none');
  prompt.setAttribute('stroke', 'currentColor');
  prompt.setAttribute('stroke-width', '2');
  prompt.setAttribute('stroke-linecap', 'round');
  prompt.setAttribute('stroke-linejoin', 'round');
  mark.append(cloud, prompt);
  emptyMark.append(mark);
  transcript.append(emptyMark, messages, newContent);
  const draft = el('div', 'zcr-draft zcr-draft-float');
  const draftCitations = el('div', 'zcr-draft-citations'); draftCitations.dataset.zcrDraftCitations = '';
  const draftImages = el('div', 'zcr-draft-images'); draftImages.dataset.zcrDraftImages = '';
  const composer = el('div', 'zcr-composer'); composer.dataset.zcrComposer = '';
  const input = el('textarea', 'zcr-input'); input.rows = 3; input.placeholder = COPY.askPlaceholder; input.setAttribute('aria-label', COPY.question); input.dataset.zcrInput = '';
  const bar = el('div', 'zcr-composer-bar');
  const trailing = el('div', 'zcr-composer-trailing');
  const picker = el('button', 'zcr-picker');
  picker.type = 'button';
  picker.dataset.zcrAction = 'picker';
  picker.dataset.zcrPicker = '';
  picker.setAttribute('aria-label', COPY.settings);
  picker.title = COPY.settings;
  picker.setAttribute('aria-haspopup', 'true');
  picker.setAttribute('aria-expanded', 'false');
  picker.addEventListener('click', () => { togglePicker(); });
  const send = button(COPY.send, 'send', () => { void presenter.send(); }, 'send', 'zcr-icon-button zcr-send');
  const stop = button(COPY.stop, 'stop', () => { void presenter.cancel(); }, 'stop', 'zcr-icon-button zcr-send');
  trailing.append(picker, send, stop);
  bar.append(trailing);
  const menu = el('div', 'zcr-picker-menu'); menu.dataset.zcrPickerMenu = ''; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', COPY.settings);
  composer.append(draftCitations, draftImages, input, bar, menu);
  draft.append(composer);
  const main = el('div', 'zcr-chat-main');
  main.append(historyPanel, status, auth, alert, transcript, draft);
  chat.append(chrome, settingsMenu, documentPanel, main); root.append(chat);
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
    if (next) { historyPanel.hidden = true; historyBtn.setAttribute('aria-expanded', 'false'); settingsMenu.hidden = true; overflow.setAttribute('aria-expanded', 'false'); }
  };
  const toggleSettings = (open?: boolean) => {
    const next = open ?? settingsMenu.hidden;
    settingsMenu.hidden = !next;
    overflow.setAttribute('aria-expanded', String(next));
    if (next) {
      historyPanel.hidden = true;
      historyBtn.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
    }
  };
  const toggleHistory = (open?: boolean) => {
    const next = open ?? historyPanel.hidden;
    historyPanel.hidden = !next;
    historyBtn.setAttribute('aria-expanded', String(next));
    if (next) {
      menu.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
      settingsMenu.hidden = true;
      overflow.setAttribute('aria-expanded', 'false');
      historySearch.focus();
    }
  };
  const nextImageId = () => hooks.uuid?.() ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`);
  const geckoAccess = (): GeckoClipboardAccess | null => resolveGeckoClipboardAccess(doc.defaultView);
  const seenPaste = new WeakSet<Event>();
  const onPaste = (event: Event) => {
    if (seenPaste.has(event)) return;
    seenPaste.add(event);
    const clipboard = (event as ClipboardEvent).clipboardData;
    const host = geckoAccess();
    const hasDom = clipboardHasImage(clipboard);
    const hasGecko = !hasDom && geckoClipboardHasImage(host);
    if (!hasDom && !hasGecko) return;
    event.preventDefault();
    void (hasDom ? imagesFromClipboard(clipboard, nextImageId) : imagesFromGeckoClipboard(host, nextImageId)).then(images => {
      for (const image of images) presenter.addImage(image);
    });
  };
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
  input.addEventListener('input', () => { presenter.setQuestion(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !settingsMenu.hidden) { event.preventDefault(); toggleSettings(false); return; }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); togglePicker(false); return; }
    if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing) return;
    event.preventDefault(); void presenter.send();
  });
  historySearch.addEventListener('input', () => { applyHistoryFilter(); });
  historySearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); toggleHistory(false); historyBtn.focus(); }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); togglePicker(false); picker.focus(); }
  });
  const onDocumentClick = (event: Event) => {
    const target = event.target as Node | null;
    if (!menu.hidden && target && !menu.contains(target) && !picker.contains(target)) togglePicker(false);
    if (!historyPanel.hidden && target && !historyPanel.contains(target) && !historyBtn.contains(target)) toggleHistory(false);
    if (!settingsMenu.hidden && target && !settingsMenu.contains(target) && !overflow.contains(target)) toggleSettings(false);
  };
  const onDocumentKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (!menu.hidden) { event.preventDefault(); togglePicker(false); }
    else if (!settingsMenu.hidden) { event.preventDefault(); toggleSettings(false); }
    else if (!historyPanel.hidden) { event.preventDefault(); toggleHistory(false); }
  };
  doc.addEventListener('click', onDocumentClick);
  doc.addEventListener('keydown', onDocumentKey);
  const applyHistoryFilter = () => {
    const query = historySearch.value.trim().toLowerCase();
    for (const group of historyList.querySelectorAll<HTMLElement>('[data-zcr-history-group]')) {
      let visible = 0;
      for (const row of group.querySelectorAll<HTMLElement>('.zcr-history-row')) {
        const hay = row.dataset.zcrHistoryLabel ?? '';
        const show = !query || hay.toLowerCase().includes(query);
        row.hidden = !show;
        if (show) visible++;
      }
      group.hidden = visible === 0;
    }
  };
  const citationCard = (citation: Citation, removable: boolean) => {
    const card = el('div', 'zcr-citation'); card.dataset.zcrCitation = citation.id;
    const quote = el('blockquote', 'zcr-citation-text', citation.text.length > 240 ? `${[...citation.text].slice(0, 240).join('')}…` : citation.text);
    const meta = el('div', 'zcr-citation-meta');
    meta.append(el('span', '', COPY.page(pageLabel(citation))));
    if (hooks.openCitation) meta.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation); }, 'source'));
    if (removable) meta.append(button(COPY.remove, 'remove-citation', () => { presenter.removeCitation(citation.id); }, 'remove'));
    card.append(quote, meta); return card;
  };
  const messageNode = (message: Message) => {
    const article = el('article', 'zcr-message'); article.dataset.zcrMessage = message.id; article.dataset.role = message.role;
    if (message.action) article.dataset.action = message.action;
    const header = el('div', 'zcr-message-header');
    header.append(el('div', 'zcr-message-author', message.role === 'user' ? COPY.you : COPY.assistant));
    if (message.role === 'assistant') {
      header.append(button(COPY.copy, 'copy-answer', () => {
        const latest = presenter.snapshot().conversation?.messages.find(entry => entry.id === message.id);
        const source = copyableAnswerText(latest?.text ?? message.text);
        if (hooks.copyText) hooks.copyText(source);
        else void doc.defaultView?.navigator.clipboard?.writeText(source);
      }, 'copy'));
    }
    const text = el('div', 'zcr-message-text'); text.dataset.zcrText = '';
    text.addEventListener('click', event => {
      const target = event.target as Element | null;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href'); if (href) hooks.openLink?.(href);
    });
    const meta = el('div', 'zcr-message-meta'); meta.dataset.zcrMeta = '';
    article.append(header, text, meta); return article;
  };
  const isNearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
  let renderedIds = ''; let focusToken = 0; let contentKey = ''; let chromeKey = '';
  const renderPills = (state: PresenterState) => {
    const nodes = state.conversations.map(conversation => {
      const pill = el('div', 'zcr-chat-pill');
      pill.dataset.zcrChatPill = '';
      pill.dataset.zcrConversationId = conversation.id;
      if (conversation.id === state.conversation?.id) pill.dataset.current = '';
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', String(conversation.id === state.conversation?.id));
      const label = el('button', 'zcr-chat-pill-label', conversationLabel(conversation, state.conversations));
      label.type = 'button';
      label.dataset.zcrAction = 'open-conversation';
      label.dataset.zcrConversationId = conversation.id;
      label.setAttribute('aria-label', conversation.title || label.textContent || COPY.untitled);
      label.title = conversation.title;
      label.addEventListener('click', () => { void presenter.openConversation(conversation.id); });
      const close = button(COPY.deleteChat, 'delete-conversation', () => {
        if (confirmDelete()) void presenter.deleteConversation(conversation.id);
      }, 'remove');
      close.dataset.zcrConversationId = conversation.id;
      pill.append(label, close);
      return pill;
    });
    pills.replaceChildren(...nodes);
    if (!nodes.length) { const title = el('span', 'zcr-initial-title', state.paperTitle); title.title = state.paperTitle; pills.append(title); }
    pills.hidden = false;
  };
  const updateContext = (state: PresenterState) => {
    const pillKey = state.conversations.map(c => `${c.id}:${c.title}:${c.id === state.conversation?.id ? '1' : '0'}`).join('\n');
    if (pills.dataset.options !== pillKey) {
      pills.dataset.options = pillKey;
      renderPills(state);
    }
    const citation = latestCitation(state);
    const sourceKey = citation ? `${citation.id}:${pageLabel(citation)}` : '';
    if (contextSource.dataset.rendered !== sourceKey) {
      contextSource.dataset.rendered = sourceKey;
      if (!citation) contextSource.replaceChildren();
      else {
        const line = el('div', 'zcr-context-citation');
        line.append(el('span', '', COPY.page(pageLabel(citation))));
        if (hooks.openCitation) line.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation); }, 'source'));
        contextSource.replaceChildren(line);
      }
    }
    context.hidden = pills.hidden && !citation;
  };
  const renderHistory = (state: PresenterState) => {
    const groups: Record<'Today' | 'Yesterday' | 'Older', Conversation[]> = { Today: [], Yesterday: [], Older: [] };
    const ordered = [...state.conversations].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt) || a.id.localeCompare(b.id));
    for (const conversation of ordered) groups[historyGroup(conversation.updatedAt || conversation.createdAt)].push(conversation);
    const nodes: HTMLElement[] = [];
    for (const name of [COPY.today, COPY.yesterday, COPY.older] as const) {
      const items = groups[name];
      if (!items.length) continue;
      const group = el('div', 'zcr-history-group');
      group.dataset.zcrHistoryGroup = name;
      group.append(el('div', 'zcr-history-heading', name));
      for (const conversation of items) {
        const label = conversationLabel(conversation, state.conversations);
        const row = el('div', 'zcr-history-row');
        row.setAttribute('role', 'listitem');
        row.dataset.zcrHistoryLabel = label;
        if (conversation.id === state.conversation?.id) row.dataset.current = '';
        const statusMark = el('span', `zcr-history-status zcr-history-status-${historyStatus(conversation)}`);
        statusMark.setAttribute('aria-hidden', 'true');
        const choice = el('button', 'zcr-history-item', label);
        choice.type = 'button'; choice.dataset.zcrConversationId = conversation.id;
        choice.setAttribute('aria-label', conversation.title || label);
        choice.addEventListener('click', () => { void presenter.openConversation(conversation.id); toggleHistory(false); });
        const drop = button(COPY.deleteChat, 'delete-conversation', () => {
          if (confirmDelete()) void presenter.deleteConversation(conversation.id);
        }, 'trash');
        drop.dataset.zcrConversationId = conversation.id;
        row.append(statusMark, choice, drop);
        group.append(row);
      }
      nodes.push(group);
    }
    historyList.replaceChildren(...nodes);
    applyHistoryFilter();
  };
  const renderPicker = (state: PresenterState, signedIn: boolean) => {
    const models = state.runtime?.models ?? [];
    const current = state.draft.settings ?? state.conversation?.settings ?? null;
    const controls = composerControls(models, current);
    const selected = current ? models.find(entry => entry.id === current.model) : undefined;
    const fast = resolveFastTier(selected);
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
      toggle.addEventListener('click', () => {
        const latest = presenter.snapshot();
        const settings = latest.draft.settings ?? latest.conversation?.settings;
        if (!settings) return;
        presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], settings, 'speed', on ? '' : fast.id));
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
      });
      modelSection.append(row);
    }
    sections.push(modelSection);
    menu.replaceChildren(...sections);
  };
  const update = (state: PresenterState) => {
    documentView.update(state);
    const list = state.conversation?.messages ?? [];
    const nextChrome = [
      state.connection, state.runtime?.revision ?? 0, state.runtime?.account.state ?? '', state.runtime?.login?.state ?? '',
      state.generating, state.message ?? '', state.conversation?.id ?? '', state.conversation?.lastSeq ?? 0,
      state.conversation?.activeRequestId ?? '', state.conversations.map(c => `${c.id}:${c.title}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}`).join('\n'),
      state.draft.citations.map(c => c.id).join('\n'), state.draft.images.map(image => image.id).join('\n'), JSON.stringify(state.draft.settings), state.focusToken,
      list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text}`).join('\n'),
    ].join('\0');
    if (nextChrome === chromeKey) {
      if (input.value !== state.draft.question) input.value = state.draft.question;
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
    const ready = state.connection === 'ready' && account === 'signedIn';
    fresh.hidden = !state.conversation || state.generating;
    historyBtn.hidden = !ready;
    alert.textContent = state.message ?? ''; alert.hidden = !state.message;
    updateContext(state);
    const historyKey = state.conversations.map(c => `${c.id}:${c.title}:${c.createdAt}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}:${c.id === state.conversation?.id ? '1' : '0'}`).join('\n');
    if (historyList.dataset.options !== historyKey) {
      historyList.dataset.options = historyKey;
      renderHistory(state);
    }
    transcript.dataset.empty = String(list.length === 0);
    if (list.length === 0) {
      if (!emptyMark.isConnected) transcript.prepend(emptyMark);
    } else emptyMark.remove();
    const ids = list.map(m => m.id).join('\n');
    if (ids !== renderedIds) { renderedIds = ids; messages.replaceChildren(...list.map(messageNode)); }
    const nextKey = list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text}`).join('\n');
    const contentChanged = nextKey !== contentKey;
    const follow = followAnswerScroll(isNearBottom(), contentChanged && contentKey !== '');
    contentKey = nextKey;
    for (const message of list) {
      const node = messages.querySelector<HTMLElement>(`[data-zcr-message="${message.id}"]`); if (!node) continue;
      node.dataset.status = message.status;
      const text = node.querySelector<HTMLElement>('[data-zcr-text]')!;
      const rendered = `${message.status}:${message.action ?? ''}:${message.text}`;
      if (text.dataset.rendered !== rendered) {
        text.dataset.rendered = rendered;
        if (message.role === 'assistant' && message.text) {
          text.classList.add('zcr-rendered');
          text.replaceChildren(renderAnswer(doc, message.text, { deferMath: message.status === 'streaming' || message.status === 'pending' }));
        } else if (hiddenExplainText(message)) {
          text.classList.remove('zcr-rendered');
          text.textContent = '';
        } else {
          text.classList.remove('zcr-rendered');
          text.textContent = message.text;
        }
      }
      const meta = node.querySelector<HTMLElement>('[data-zcr-meta]')!;
      const statusLabel = message.role === 'assistant' ? STATUS_LABEL[message.status] : '';
      const caption = settingsCaption(message.settings, state.runtime?.models ?? []);
      const label = [statusLabel, caption].filter(Boolean).join(' · ');
      if (meta.textContent !== label) meta.textContent = label;
    }
    if (follow.stick) messages.scrollTop = messages.scrollHeight;
    newContent.hidden = !follow.showNewContent;
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
        chip.append(thumb, button(COPY.remove, 'remove-image', () => { presenter.removeImage(image.id); }, 'remove'));
        return chip;
      }));
    }
    if (input.value !== state.draft.question) input.value = state.draft.question;
    const signedIn = account === 'signedIn' && state.connection === 'ready';
    const pickerKey = `${JSON.stringify(state.draft.settings ?? state.conversation?.settings ?? null)}\n${state.runtime?.models.map(entry => entry.id).join(',')}\n${signedIn}`;
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
    const canSend = state.connection === 'ready' && account === 'signedIn' && !state.generating;
    send.disabled = !canSend; send.hidden = state.generating; stop.hidden = !state.generating;
    input.disabled = state.connection === 'error';
    if (state.focusToken !== focusToken) { focusToken = state.focusToken; input.focus(); }
  };
  const unbind = presenter.bind(update);
  return () => {
    unbindZoom(); unbind();
    doc.removeEventListener('click', onDocumentClick);
    doc.removeEventListener('keydown', onDocumentKey);
    for (const target of pasteDocuments) target.removeEventListener('paste', onPaste, true);
    pasteWindow?.removeEventListener('paste', onPaste, true);
    chat.remove();
  };
}
