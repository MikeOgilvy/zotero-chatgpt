import type { Citation, Conversation, ImageAttachment, Message } from '../../../contracts/src/index.ts';
import { contextUsageLabel, contextUsageTitle, currentContextUsage, mountDocumentContext } from './context-view.ts';
import { mountWorkspaceView } from './workspace-view.ts';
import { mountTaskView } from './task-view.ts';
import { mountUILocale } from './ui-locale.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import {
  applyComposerChoice, composerControls, effortLabel, modelChipLabel, resolveFastTier, settingsCaption,
} from './generation-settings.ts';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from './render-answer.ts';
import { answerSources, linkAnswerSources, type AnswerSource, type DocumentPageTarget } from './source-links.ts';
import { applyChatTextScale, bindUnifiedReaderZoom, type ReaderZoomHost } from './text-scale.ts';
import { clipboardHasImage, geckoClipboardHasImage, imagesFromClipboard, imagesFromGeckoClipboard, resolveGeckoClipboardAccess, type GeckoClipboardAccess } from './pick-images.ts';
export interface AttachmentIdentity { title: string; key: string; libraryID: number }
export interface ChatViewHooks {
  openCitation?(citation: Citation): Promise<void>;
  openDocumentPage?(document: DocumentPageTarget, pageIndex: number): Promise<void>;
  copyText?(text: string): void;
  exportImage?(image: ImageAttachment): Promise<void>;
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
let viewSerial = 0;
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
  chromeSettings: 'More',
  chatOptions: 'Chat options',
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
  copied: 'Copied',
  copyFailed: 'The answer could not be copied.',
  actionFailed: 'This action could not be completed.',
  sourceOpenFailed: 'The source could not be opened.',
  imageSaveFailed: 'The image could not be saved.',
  imageClipboardFailed: 'The clipboard image could not be attached.',
  imageDropFailed: 'The dropped image could not be attached.',
  collectionsFailed: 'Collections could not be loaded.',
} as const;
const VIEW_ACTION_FAILED = COPY.actionFailed;
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
  let latestViewState = presenter.snapshot();
  // View actions own a slot separate from `state.message`: a presenter update must not erase a
  // view failure, and a view failure must never be reported as conversation state. The raw error
  // is deliberately discarded so host paths or internal text cannot reach the UI.
  const reportViewMessage = (message: string) => {
    const status = root.querySelector<HTMLElement>('[data-zcr-view-error]');
    if (status) { status.textContent = message; status.hidden = false; }
  };
  const reportViewError = () => reportViewMessage(VIEW_ACTION_FAILED);
  const viewId = `zcr-chat-${++viewSerial}`;
  // A cited page re-opens through the same frozen-revision navigation as the PDF context panel.
  // Without an opener, bound citations stay inert (no external launch) and surface a constant status.
  const openAnswerSource = async (source: AnswerSource, pageIndex: number): Promise<void> => {
    if (!hooks.openDocumentPage) throw new Error('The source could not be opened.');
    await hooks.openDocumentPage({ paper: source.paper, revision: source.revision }, pageIndex);
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
  const confirmDelete = () => (hooks.confirm ?? ((message: string) => doc.defaultView?.confirm(message) ?? false))(COPY.deleteConfirm);
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
  const enhanceCodeBlocks = (host: HTMLElement) => {
    for (const pre of [...host.querySelectorAll('pre')]) {
      const wrapper = el('div', 'zcr-code-block');
      pre.replaceWith(wrapper); wrapper.append(pre);
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
  const context = el('div', 'zcr-chrome-main');
  context.dataset.zcrContext = '';
  const currentTitle = el('span', 'zcr-current-title');
  currentTitle.dataset.zcrCurrentTitle = '';
  const contextSource = el('div', 'zcr-chrome-source');
  contextSource.dataset.zcrContextSource = '';
  context.append(currentTitle);
  const actions = el('div', 'zcr-chrome-actions');
  const fresh = button(COPY.newChat, 'new-conversation', () => { void presenter.newConversation(); }, 'plus');
  const historyBtn = button(COPY.history, 'history', () => { toggleHistory(); }, 'clock');
  historyBtn.setAttribute('aria-haspopup', 'dialog');
  historyBtn.setAttribute('aria-expanded', 'false');
  historyBtn.setAttribute('aria-controls', `${viewId}-history`);
  const overflow = button(COPY.chromeSettings, 'settings', () => { toggleSettings(); }, 'more');
  overflow.setAttribute('aria-haspopup', 'dialog');
  overflow.setAttribute('aria-expanded', 'false');
  overflow.setAttribute('aria-controls', `${viewId}-options`);
  actions.append(fresh, historyBtn, overflow);
  chrome.append(context, actions);
  const settingsMenu = el('div', 'zcr-settings-menu');
  settingsMenu.id = `${viewId}-options`;
  settingsMenu.dataset.zcrSettingsMenu = '';
  settingsMenu.hidden = true;
  settingsMenu.setAttribute('role', 'dialog');
  settingsMenu.setAttribute('aria-label', COPY.chatOptions);
  const conversationActions = el('div', 'zcr-conversation-actions');
  conversationActions.dataset.zcrConversationActions = '';
  const deleteCurrent = button(COPY.deleteChat, 'delete-conversation', () => {
    const id = presenter.snapshot().conversation?.id;
    if (!id || !confirmDelete()) return;
    toggleSettings(false);
    void presenter.deleteConversation(id);
  });
  conversationActions.append(deleteCurrent);
  const renameForm = el('div', 'zcr-rename-form'); renameForm.hidden = true;
  const renameInput = el('input'); renameInput.type = 'text'; renameInput.maxLength = 1024; renameInput.setAttribute('aria-label', 'Chat name');
  const rename = button('Rename chat', 'rename-conversation', () => { renameForm.hidden = !renameForm.hidden; renameInput.value = presenter.snapshot().conversation?.title ?? ''; if (!renameForm.hidden) { renameInput.focus(); renameInput.select(); } });
  renameForm.append(renameInput, button('Save name', 'save-conversation-name', () => { const id = presenter.snapshot().conversation?.id; if (id) void presenter.renameConversation(id, renameInput.value).then(() => { renameForm.hidden = true; }).catch(reportViewError); }));
  conversationActions.prepend(rename); conversationActions.append(renameForm);
  const settingsContent = el('div', 'zcr-settings-content');
  settingsContent.dataset.zcrSettingsContent = '';
  settingsMenu.append(conversationActions, settingsContent);
  const accountUsage = el('p', 'zcr-account-usage'); accountUsage.dataset.zcrAccountUsage = ''; settingsContent.append(accountUsage);
  const documentPanel = el('div', 'zcr-document-panel');
  documentPanel.dataset.zcrContextSummary = '';
  const documentView = mountDocumentContext(documentPanel, settingsContent, presenter, hooks.openDocumentPage ? (document, pageIndex) => hooks.openDocumentPage!(document, pageIndex) : undefined);
  documentPanel.append(contextSource);
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
  const newContent = button(COPY.newContent, 'new-content', () => { hasNewContent = false; messages.scrollTop = messages.scrollHeight; newContent.hidden = true; });
  newContent.hidden = true;
  newContent.classList.add('zcr-new-content');
  messages.addEventListener('scroll', () => {
    if (isNearBottom()) { hasNewContent = false; newContent.hidden = true; }
    presenter.setScrollTop(messages.scrollTop);
  });
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
  const contextUsage = el('span', 'zcr-context-usage'); contextUsage.dataset.zcrContextUsage = ''; contextUsage.setAttribute('role', 'status');
  trailing.append(contextUsage, picker, queue, send, stop);
  bar.append(leading, trailing);
  const menu = el('div', 'zcr-picker-menu'); menu.dataset.zcrPickerMenu = ''; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', COPY.settings);
  menu.id = `${viewId}-models`;
  composer.append(composerContext, input, bar, menu);
  draft.append(composer);
  const main = el('div', 'zcr-chat-main');
  main.append(historyPanel, status, auth, alert, viewError, transcript, draft);
  chat.append(chrome, settingsMenu, documentPanel, main); root.append(chat);
  const localizer = mountUILocale(root);
  let lastLanguage: 'en' | 'zh' | null = null;
  let workspaceView: ReturnType<typeof mountWorkspaceView> | null = null;
  let lastWorkspace: PresenterState['workspace'] = null; let workspaceDraftKey = ''; let tasksKey = '';
  const appearance = el('details', 'zcr-appearance'); appearance.hidden = true; appearance.append(el('summary', '', 'Appearance'));
  const scaleLabel = el('label', '', 'Chat text size'); const scaleInput = el('input'); scaleInput.type = 'range'; scaleInput.min = '50'; scaleInput.max = '300'; scaleInput.step = '5'; scaleInput.setAttribute('aria-label', 'Chat text size');
  const scaleValue = el('output', '', '100%'); scaleLabel.append(scaleInput, scaleValue);
  scaleInput.addEventListener('input', () => { const scale = applyChatTextScale(root, Number(scaleInput.value) / 100); scaleValue.textContent = `${Math.round(scale * 100)}%`; });
  scaleInput.addEventListener('change', () => { hooks.writeTextScale?.(Number(scaleInput.value) / 100); void presenter.saveAppearance({ textScale: Number(scaleInput.value) / 100 }).catch(reportViewError); });
  const languageLabel = el('label', '', 'Interface language'); const language = el('select'); language.setAttribute('aria-label', 'Interface language');
  for (const [value, label] of [['en', 'English'], ['zh', '简体中文']] as const) { const option = el('option', '', label); option.value = value; language.append(option); }
  languageLabel.append(language); language.addEventListener('change', () => { void presenter.saveAppearance({ uiLanguage: language.value === 'zh' ? 'zh' : 'en' }).catch(reportViewError); });
  appearance.append(scaleLabel, languageLabel); settingsContent.append(appearance);
  const inputActions = el('div', 'zcr-input-actions'); inputActions.hidden = true;
  const attachmentMenu = el('details', 'zcr-attachment-menu'); attachmentMenu.append(el('summary', '', 'Attach'));
  attachmentMenu.append(button('Choose images…', 'pick-images', () => { void presenter.pickImages().catch(reportViewError); attachmentMenu.open = false; }), button('Capture selected region', 'capture-region', () => { void presenter.captureRegion().catch(reportViewError); attachmentMenu.open = false; }));
  const pageNumber = el('input'); pageNumber.type = 'number'; pageNumber.min = '1'; pageNumber.value = '1'; pageNumber.setAttribute('aria-label', 'PDF page to capture');
  attachmentMenu.append(pageNumber, button('Capture page', 'capture-page', () => { void presenter.capturePage(Number(pageNumber.value) - 1).catch(reportViewError); attachmentMenu.open = false; })); inputActions.append(attachmentMenu); leading.append(inputActions);
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
  const imageCard = (image: ImageAttachment) => {
    const card = el('figure', 'zcr-image-card'); card.dataset.zcrImage = image.id;
    const open = button('Preview image', 'preview-image', () => previewImage(image, open));
    const thumbnail = el('img'); thumbnail.src = image.dataUrl; thumbnail.alt = image.name; thumbnail.loading = 'lazy';
    open.replaceChildren(thumbnail); card.append(open);
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
    const target = event.target as Node | null;
    const inComposer = !!target && 'nodeType' in target && composer.contains(target);
    // Gecko can dispatch paste at the chrome document. Accept that route only
    // while this composer owns focus; another editor's event stays untouched.
    const documentTarget = !target || !('nodeType' in target) || target.nodeType === 9;
    if (!inComposer && !(documentTarget && doc.hasFocus() && composer.contains(doc.activeElement))) return;
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
    }).catch(() => reportViewMessage(COPY.imageClipboardFailed));
  };
  composer.addEventListener('dragover', event => { if (clipboardHasImage(event.dataTransfer)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; } });
  composer.addEventListener('drop', event => {
    if (!clipboardHasImage(event.dataTransfer)) return;
    event.preventDefault();
    void imagesFromClipboard(event.dataTransfer, nextImageId).then(images => { for (const image of images) presenter.addImage(image); }).catch(() => reportViewMessage(COPY.imageDropFailed));
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
    if (isComposing(event)) return;
    if (event.key === 'Escape' && !settingsMenu.hidden) { event.preventDefault(); toggleSettings(false); return; }
    if (event.key === 'Escape' && !menu.hidden) { event.preventDefault(); togglePicker(false); return; }
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An open chooser owns Enter. Closing it must never submit the draft.
    if (!menu.hidden || !settingsMenu.hidden || !historyPanel.hidden) {
      event.preventDefault(); togglePicker(false); toggleSettings(false); toggleHistory(false); return;
    }
    event.preventDefault(); void presenter.send();
  });
  const menuItems = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden])')]
    .filter(node => !node.closest('[hidden]'));
  const focusMenu = (panel: HTMLElement, last = false) => {
    const items = menuItems(panel);
    (last ? items.at(-1) : items[0])?.focus();
  };
  const bindMenuKeys = (panel: HTMLElement, trigger: HTMLElement, close: () => void) => {
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
  bindMenuKeys(settingsMenu, overflow, () => toggleSettings(false));
  bindMenuKeys(historyPanel, historyBtn, () => toggleHistory(false));
  for (const [trigger, panel, open] of [
    [picker, menu, () => togglePicker(true)],
    [overflow, settingsMenu, () => toggleSettings(true)],
    [historyBtn, historyPanel, () => toggleHistory(true)],
  ] as const) trigger.addEventListener('keydown', event => {
    if (isComposing(event) || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault(); open(); focusMenu(panel, event.key === 'ArrowUp');
  });
  historySearch.addEventListener('input', () => { if (presenter.snapshot().workspace) void presenter.searchHistory(historySearch.value).catch(reportViewError); else applyHistoryFilter(); });
  const onDocumentClick = (event: Event) => {
    const target = event.target as Node | null;
    if (!menu.hidden && target && !menu.contains(target) && !picker.contains(target)) togglePicker(false);
    if (!historyPanel.hidden && target && !historyPanel.contains(target) && !historyBtn.contains(target)) toggleHistory(false);
    if (!settingsMenu.hidden && target && !settingsMenu.contains(target) && !overflow.contains(target)) toggleSettings(false);
  };
  const onDocumentKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isComposing(event) || !root.contains(event.target as Node | null)) return;
    if (!menu.hidden) { event.preventDefault(); togglePicker(false); picker.focus(); }
    else if (!settingsMenu.hidden) { event.preventDefault(); toggleSettings(false); overflow.focus(); }
    else if (!historyPanel.hidden) { event.preventDefault(); toggleHistory(false); historyBtn.focus(); }
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
    if (hooks.openCitation) meta.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation).catch(() => reportViewMessage(COPY.sourceOpenFailed)); }, 'source'));
    if (removable) meta.append(button(COPY.remove, 'remove-citation', () => { presenter.removeCitation(citation.id); }, 'remove'));
    card.append(quote, meta); return card;
  };
  const messageNode = (message: Message) => {
    const article = el('article', 'zcr-message'); article.dataset.zcrMessage = message.id; article.dataset.role = message.role;
    if (message.action) article.dataset.action = message.action;
    const header = el('div', 'zcr-message-header');
    header.append(el('div', 'zcr-message-author', message.role === 'user' ? COPY.you : COPY.assistant));
    if (message.role === 'assistant') {
      const copyAnswer = button(COPY.copy, 'copy-answer', () => {
        const latest = presenter.snapshot().conversation?.messages.find(entry => entry.id === message.id);
        copyText(copyableAnswerText(latest?.text ?? message.text), copyAnswer);
      });
      copyAnswer.classList.add('zcr-copy-answer');
      const copyLabel = el('span', 'zcr-copy-label', COPY.copy);
      copyLabel.dataset.zcrCopyLabel = '';
      copyAnswer.replaceChildren(icon('copy'), copyLabel);
      header.append(copyAnswer);
    }
    const branch = button(message.role === 'assistant' ? 'Regenerate in new chat' : 'Edit in new chat', 'branch-message', () => {
      const previous = presenter.snapshot().conversation?.id;
      void presenter.branchConversation(message.id).then(async () => {
        if (message.role === 'assistant' && presenter.snapshot().conversation?.id !== previous) await presenter.send();
      }).catch(reportViewError);
    });
    branch.classList.add('zcr-message-action'); header.append(branch);
    if (message.role === 'user') { const cancelQueued = button('Cancel queued question', 'cancel-queued', () => { void presenter.cancelQueuedRequest(message.requestId).catch(reportViewError); }); cancelQueued.hidden = true; header.append(cancelQueued); }
    const text = el('div', 'zcr-message-text'); text.dataset.zcrText = '';
    text.addEventListener('click', event => {
      const target = event.target as Element | null;
      const link = target?.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href'); if (href) hooks.openLink?.(href);
    });
    const meta = el('div', 'zcr-message-meta'); meta.dataset.zcrMeta = '';
    const attachments = el('div', 'zcr-message-attachments'); attachments.dataset.zcrMessageAttachments = '';
    const taskSummary = button('Review annotation suggestions', 'review-annotations', () => {
      const task = latestViewState.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId);
      const card = task && [...taskPanel.querySelectorAll<HTMLDetailsElement>('[data-zcr-task-id]')].find(card => card.dataset.zcrTaskId === task.id);
      if (card) { card.open = true; card.scrollIntoView?.({ block: 'nearest' }); }
    }); taskSummary.hidden = true;
    article.append(header, text, taskSummary, attachments, meta); return article;
  };
  let renderedConversationId: string | null = null;
  const messageNodes = new Map<string, HTMLElement>();
  const renderedMessages = new Map<string, { text: string; status: Message['status']; action: Message['action'] }>();
  let focusToken = 0; let contentKey = ''; let chromeKey = '';
  const updateContext = (state: PresenterState) => {
    const title = state.conversation ? conversationLabel(state.conversation, state.conversations) : state.paperTitle || COPY.untitled;
    if (currentTitle.textContent !== title) currentTitle.textContent = title;
    currentTitle.title = state.conversation?.title || state.paperTitle || COPY.untitled;
    conversationActions.hidden = !state.conversation;
    deleteCurrent.disabled = !state.conversation;
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
  };
  const renderHistory = (state: PresenterState) => {
    if (state.workspace) {
      const nodes: HTMLElement[] = [];
      for (const entry of state.history) {
        const row = el('div', 'zcr-history-row'); row.setAttribute('role', 'listitem'); row.dataset.zcrHistoryLabel = `${entry.title} ${entry.identity.title} ${entry.preview}`;
        const choice = el('button', 'zcr-history-item'); choice.type = 'button'; choice.dataset.zcrConversationId = entry.id;
        choice.append(el('span', '', entry.title), el('small', 'zcr-history-preview', entry.preview || entry.identity.title));
        choice.setAttribute('aria-label', entry.title); choice.addEventListener('click', () => { void presenter.openHistoryEntry(entry.id); toggleHistory(false); });
        row.append(choice); if (entry.id === state.conversation?.id) row.dataset.current = '';
        nodes.push(row);
      }
      if (!nodes.length) nodes.push(el('p', 'zcr-history-empty', 'No saved chats match this search.'));
      historyList.replaceChildren(...nodes); return;
    }
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
        togglePicker(false); picker.focus();
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
        togglePicker(false); picker.focus();
      });
      modelSection.append(row);
    }
    sections.push(modelSection);
    menu.replaceChildren(...sections);
  };
  const update = (state: PresenterState) => {
    latestViewState = state;
    const uiLanguage = state.workspace?.uiLanguage ?? 'en';
    if (lastLanguage !== uiLanguage) { lastLanguage = uiLanguage; localizer.update(uiLanguage); }
    documentView.update(state);
    const quotas = state.runtime?.rateLimits;
    accountUsage.textContent = quotas ? quotas.map(quota => `${quota.label}: ${quota.usedPercent === null ? 'usage unknown' : `${quota.usedPercent}% used`}${quota.resetsAt === null ? '' : ` · resets ${new Date(quota.resetsAt * 1000).toLocaleString()}`}`).join('\n') || 'Account usage: no limits reported.' : 'Account usage: unavailable.';
    if (state.workspace) {
      if (!workspaceView) workspaceView = mountWorkspaceView({ input, context: composerContext, leading, settings: settingsContent }, {
        searchReferences: (query, kind, signal) => presenter.searchReferences(query, kind, signal), previewReference: (reference, signal) => presenter.previewReference(reference, signal),
        addReference: async reference => { await presenter.addReference(reference); }, removeReference: async id => { await presenter.removeReference(id); },
        selectSkill: id => presenter.selectSkill(id), selectProfile: id => presenter.selectProfile(id), savePreferences: value => presenter.savePreferences(value),
        saveSkill: edit => presenter.saveSkill(edit), duplicateSkill: id => presenter.duplicateSkill(id), setSkillEnabled: (id, enabled) => presenter.setSkillEnabled(id, enabled),
        deleteSkill: id => presenter.deleteSkill(id), importSkill: () => presenter.importSkill(), exportSkill: id => presenter.exportSkill(id),
        saveProfile: value => presenter.saveProfile(value), deleteProfile: id => presenter.deleteProfile(id), setOverrides: value => presenter.setOverrides(value),
        setReferenceRange: (id, range) => presenter.setReferenceRange(id, range), exportPreferences: () => presenter.exportPreferences(),
      });
      const nextDraftKey = `${state.draft.references.map(reference => `${reference.id}:${reference.range?.join('-') ?? ''}:${reference.capturedAt}`).join(',')}:${state.draft.skillId}:${state.draft.profileId}:${JSON.stringify(state.draft.overrides)}`;
      if (lastWorkspace !== state.workspace || nextDraftKey !== workspaceDraftKey) {
        lastWorkspace = state.workspace; workspaceDraftKey = nextDraftKey;
        workspaceView.update({ settings: state.workspace, draft: { references: state.draft.references, skillId: state.draft.skillId, profileId: state.draft.profileId, overrides: state.draft.overrides } });
      }
      appearance.hidden = false; inputActions.hidden = false;
      if (doc.activeElement !== scaleInput) { scaleInput.value = String(Math.round(state.workspace.textScale * 100)); scaleValue.textContent = `${scaleInput.value}%`; applyChatTextScale(root, state.workspace.textScale); }
      language.value = state.workspace.uiLanguage;
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
    const allMessages = state.conversation?.messages ?? [];
    const intermediateRequests = new Set(allMessages.filter(message => message.role === 'user' && message.batch?.phase === 'map').map(message => message.requestId));
    const list = allMessages.filter(message => !intermediateRequests.has(message.requestId) || state.messageFocus?.messageId === message.id);
    const nextChrome = [
      state.connection, state.runtime?.revision ?? 0, state.runtime?.account.state ?? '', state.runtime?.login?.state ?? '',
      state.generating, state.message ?? '', state.conversation?.id ?? '', state.conversation?.lastSeq ?? 0,
      state.conversation?.activeRequestId ?? '', state.conversations.map(c => `${c.id}:${c.title}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}`).join('\n'),
      state.draft.citations.map(c => c.id).join('\n'), state.draft.images.map(image => image.id).join('\n'), JSON.stringify(state.draft.settings), state.focusToken,
      state.draft.question.trim().length > 0,
      state.history.map(item => `${item.id}:${item.title}:${item.updatedAt}:${item.preview}`).join('\n'), state.tasks.map(task => `${task.id}:${task.revision}`).join(','), state.readingJobs.map(job => `${job.id}:${job.revision}`).join(','), state.queueing, state.conversation?.queuedRequestIds?.join(','), state.messageFocus?.token,
      list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.images?.map(image => image.id).join(',') ?? ''}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n'),
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
    fresh.hidden = !state.conversation;
    historyBtn.hidden = false;
    alert.textContent = state.message ?? ''; alert.hidden = !state.message;
    updateContext(state);
    const historyKey = state.workspace ? JSON.stringify(state.history) : state.conversations.map(c => `${c.id}:${c.title}:${c.createdAt}:${c.updatedAt}:${c.messages.length}:${c.activeRequestId ?? ''}:${c.id === state.conversation?.id ? '1' : '0'}`).join('\n');
    if (historyList.dataset.options !== historyKey) {
      historyList.dataset.options = historyKey;
      renderHistory(state);
    }
    const empty = list.length === 0 && state.tasks.length === 0 && state.readingJobs.length === 0;
    transcript.dataset.empty = String(empty);
    if (empty) {
      if (!emptyMark.isConnected) transcript.prepend(emptyMark);
    } else emptyMark.remove();
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
    if (messages.lastElementChild !== taskPanel) messages.append(taskPanel);
    taskPanel.hidden = !state.tasks.length && !state.readingJobs.length;
    const nextKey = list.map(m => `${m.id}:${m.status}:${m.action ?? ''}:${m.text.length}:${m.generatedImages?.map(image => image.id).join(',') ?? ''}`).join('\n');
    const contentChanged = nextKey !== contentKey;
    const follow = followAnswerScroll(nearBottom, contentChanged && contentKey !== '');
    contentKey = nextKey;
    for (const message of list) {
      const node = messageNodes.get(message.id); if (!node) continue;
      node.dataset.status = message.status;
      const queued = state.conversation?.queuedRequestIds?.includes(message.requestId) === true;
      const cancelQueued = node.querySelector<HTMLButtonElement>('[data-zcr-action="cancel-queued"]'); if (cancelQueued) cancelQueued.hidden = !queued;
      const text = node.querySelector<HTMLElement>('[data-zcr-text]')!;
      const annotationTask = message.role === 'assistant' ? state.tasks.find(task => task.kind === 'annotations' && task.modelRequestId === message.requestId) : undefined;
      const taskSummary = node.querySelector<HTMLButtonElement>('[data-zcr-action="review-annotations"]')!;
      taskSummary.hidden = !annotationTask;
      if (annotationTask) taskSummary.textContent = `Review ${annotationTask.items.length} annotation suggestions`;
      const previous = renderedMessages.get(message.id);
      if (!previous || previous.text !== message.text || previous.status !== message.status || previous.action !== message.action) {
        renderedMessages.set(message.id, { text: message.text, status: message.status, action: message.action });
        if (message.role === 'assistant' && message.text) {
          text.classList.add('zcr-rendered');
          const fragment = renderAnswer(doc, message.text, { deferMath: message.status === 'streaming' || message.status === 'pending' });
          // Always run the pass, even with no sources: reserved citation links must be neutralized
          // rather than left as external `zcr.invalid` URLs for the generic link handler to launch.
          linkAnswerSources(fragment, state.conversation ? answerSources(state.conversation, message) : [], openAnswerSource);
          text.replaceChildren(fragment);
          enhanceCodeBlocks(text);
        } else if (hiddenExplainText(message)) {
          text.classList.remove('zcr-rendered');
          text.textContent = '';
        } else {
          text.classList.remove('zcr-rendered');
          text.textContent = message.text;
        }
      }
      text.hidden = hiddenExplainText(message) || !!annotationTask;
      const meta = node.querySelector<HTMLElement>('[data-zcr-meta]')!;
      const attachments = node.querySelector<HTMLElement>('[data-zcr-message-attachments]')!;
      const attachmentKey = [...message.citations.map(citation => citation.id), ...(message.images ?? []).map(image => image.id), ...(message.generatedImages ?? []).map(image => image.id), message.workflow?.skill?.revision ?? '', ...(message.references ?? []).map(reference => reference.id)].join(':');
      if (attachments.dataset.rendered !== attachmentKey) {
        attachments.dataset.rendered = attachmentKey;
        attachments.replaceChildren(...message.citations.map(citation => citationCard(citation, false)), ...[...(message.images ?? []), ...(message.generatedImages ?? [])].map(imageCard));
        if (message.workflow?.skill) attachments.append(el('span', 'zcr-message-reference', `/${message.workflow.skill.name} · v${message.workflow.skill.version}`));
        for (const reference of message.references ?? []) attachments.append(el('span', 'zcr-message-reference', `${reference.kind === 'chat' ? '@chat' : '@article'} · ${reference.label}`));
      }
      const statusLabel = queued ? 'Queued' : message.role === 'assistant' ? STATUS_LABEL[message.status] : message.status === 'cancelled' ? 'Cancelled before sending' : '';
      const caption = settingsCaption(message.settings, state.runtime?.models ?? []);
      const label = [statusLabel, caption].filter(Boolean).join(' · ');
      if (meta.textContent !== label) meta.textContent = label;
    }
    if (conversationChanged) { messages.scrollTop = state.scrollTop || messages.scrollHeight; hasNewContent = false; }
    else if (contentChanged && follow.stick) {
      messages.scrollTop = messages.scrollHeight; hasNewContent = false;
    } else if (follow.showNewContent) hasNewContent = true;
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
    const usage = currentContextUsage(state.draft.settings?.model ?? state.conversation?.settings.model, state.conversation?.usage);
    const usageLabel = contextUsageLabel(usage); const usageTitle = contextUsageTitle(usage);
    if (contextUsage.textContent !== usageLabel) contextUsage.textContent = usageLabel;
    contextUsage.title = usageTitle;
    if (contextUsage.getAttribute('aria-label') !== usageTitle) contextUsage.setAttribute('aria-label', usageTitle);
    contextUsage.dataset.zcrContextState = usage ? usage.provenance : 'unknown';
    const hasInput = state.draft.question.trim().length > 0;
    const canSend = state.connection === 'ready' && account === 'signedIn' && !state.generating && hasInput;
    send.disabled = !canSend; send.hidden = state.generating; stop.hidden = !state.generating;
    queue.hidden = !state.generating; queue.disabled = !signedIn || state.queueing || !hasInput;
    input.disabled = false;
    if (state.focusToken !== focusToken) { focusToken = state.focusToken; input.focus(); }
    if (state.messageFocus && messages.dataset.focusToken !== String(state.messageFocus.token)) { messages.dataset.focusToken = String(state.messageFocus.token); messageNodes.get(state.messageFocus.messageId)?.scrollIntoView?.({ block: 'center' }); }
  };
  const unbind = presenter.bind(update);
  return () => {
    presenter.setScrollTop(messages.scrollTop); unbindZoom(); unbind(); workspaceView?.dispose(); taskView.dispose(); localizer.dispose();
    doc.removeEventListener('click', onDocumentClick);
    doc.removeEventListener('keydown', onDocumentKey);
    for (const target of pasteDocuments) target.removeEventListener('paste', onPaste, true);
    pasteWindow?.removeEventListener('paste', onPaste, true);
    chat.remove();
  };
}
