import type { Citation, Message } from '../../../contracts/src/index.ts';
import type { ConversationPresenter, PresenterState } from './presenter.ts';
import { applyComposerChoice, composerControls, settingsCaption, type ComposerField } from './generation-settings.ts';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from './render-answer.ts';
export interface AttachmentIdentity { title: string; key: string; libraryID: number }
export interface ChatViewHooks {
  openCitation?(citation: Citation): Promise<void>;
  copyText?(text: string): void;
  openLink?(url: string): void;
}
const HTML = 'http://www.w3.org/1999/xhtml';
const COPY = {
  paneLabel: 'Codex development preview',
  login: 'Sign in with ChatGPT',
  cancelLogin: 'Cancel sign-in',
  retry: 'Reconnect',
  newChat: 'New chat',
  untitled: 'Untitled',
  history: 'Chat history',
  newContent: 'New content',
  askPlaceholder: 'Ask a question…',
  question: 'Question',
  send: 'Send',
  stop: 'Stop',
  empty: 'Select text in the PDF or ask a question.',
  previewNote: 'Preview · selected text only',
  previewOffline: 'Preview · no model connected',
  returnToSource: 'Return to source',
  remove: 'Remove',
  you: 'You',
  assistant: 'Codex',
  copy: 'Copy',
  page: (label: string) => `p. ${label}`,
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
export function renderReaderShell(body: HTMLElement, identity: AttachmentIdentity, close: () => void): HTMLElement {
  const doc = body.ownerDocument;
  const element = (tag: string, text: string, className?: string) => {
    const node = doc.createElementNS(HTML, tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const root = element('section', '', 'zcr-sidebar');
  root.dataset.zcrSidebar = '';
  root.setAttribute('aria-label', COPY.paneLabel);
  root.dataset.attachmentKey = identity.key;
  root.dataset.libraryId = String(identity.libraryID);
  // Close stays on the reader toolbar toggle so this pane can sit flush under native section chrome.
  void close;
  body.replaceChildren(root);
  return root;
}
/** Retained as the transport-free fallback for reader adapter tests. */
export function renderPreview(body: HTMLElement, identity: AttachmentIdentity, close: () => void): void {
  const root = renderReaderShell(body, identity, close);
  const status = body.ownerDocument.createElementNS(HTML, 'p');
  status.textContent = COPY.previewOffline;
  root.append(status);
}
function conversationLabel(conversation: { messages: Message[] }): string {
  const first = conversation.messages.find(m => m.role === 'user' && m.text.trim())?.text.trim()
    ?? conversation.messages.find(m => m.role === 'assistant' && m.text.trim())?.text.trim();
  if (!first) return COPY.untitled;
  const chars = [...first];
  return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : first;
}
/** Conversation view: assistant Markdown is sanitized; user text stays textContent. */
export function mountChatView(root: HTMLElement, presenter: ConversationPresenter, hooks: ChatViewHooks = {}): () => void {
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] => { const node = doc.createElementNS(HTML, tag) as HTMLElementTagNameMap[K]; if (className) node.className = className; if (text) node.textContent = text; return node; };
  const button = (text: string, action: string, onClick: () => void) => { const node = el('button', 'zcr-button', text); node.type = 'button'; node.dataset.zcrAction = action; node.addEventListener('click', onClick); return node; };
  root.querySelector('[data-zcr-context]')?.remove();
  const chat = el('section', 'zcr-chat'); chat.dataset.zcrChat = '';
  const status = el('p', 'zcr-status-line'); status.setAttribute('role', 'status');
  const chrome = el('div', 'zcr-chrome');
  const login = button(COPY.login, 'login', () => { void presenter.login(); });
  const cancelLogin = button(COPY.cancelLogin, 'cancel-login', () => { void presenter.cancelLogin(); });
  const retry = button(COPY.retry, 'retry', () => { void presenter.retry(); });
  const fresh = button(COPY.newChat, 'new-conversation', () => { void presenter.newConversation(); });
  fresh.setAttribute('aria-label', COPY.newChat);
  const history = el('select', 'zcr-menu zcr-history'); history.setAttribute('aria-label', COPY.history); history.dataset.zcrHistory = '';
  history.addEventListener('change', () => { if (history.value) void presenter.openConversation(history.value); });
  const context = el('div', 'zcr-context');
  context.dataset.zcrContext = '';
  const contextTitle = el('p', '', 'zcr-context-title');
  contextTitle.dataset.zcrContextTitle = '';
  contextTitle.hidden = true;
  const contextSource = el('div', 'zcr-context-source');
  contextSource.dataset.zcrContextSource = '';
  context.append(contextTitle, contextSource);
  chrome.append(login, cancelLogin, retry, history, fresh, context);
  const alert = el('p', 'zcr-error'); alert.setAttribute('role', 'alert'); alert.hidden = true;
  const transcript = el('div', 'zcr-transcript');
  const empty = el('p', 'zcr-empty', COPY.empty); empty.dataset.zcrEmpty = ''; empty.hidden = true;
  const messages = el('div', 'zcr-messages'); messages.setAttribute('aria-live', 'polite'); messages.dataset.zcrMessages = '';
  const newContent = button(COPY.newContent, 'new-content', () => { messages.scrollTop = messages.scrollHeight; newContent.hidden = true; });
  newContent.hidden = true;
  transcript.append(empty, messages, newContent);
  const draft = el('div', 'zcr-draft');
  const draftCitations = el('div', 'zcr-draft-citations'); draftCitations.dataset.zcrDraftCitations = '';
  const input = el('textarea', 'zcr-input'); input.rows = 2; input.placeholder = COPY.askPlaceholder; input.setAttribute('aria-label', COPY.question); input.dataset.zcrInput = '';
  const composer = el('div', 'zcr-composer'); composer.dataset.zcrComposer = '';
  const settingsRow = el('div', 'zcr-settings');
  const setting = (field: ComposerField) => {
    const select = el('select', 'zcr-menu'); select.dataset.zcrSetting = field;
    select.addEventListener('change', () => {
      const latest = presenter.snapshot();
      const current = latest.draft.settings ?? latest.conversation?.settings; if (!current) return;
      presenter.setSettings(applyComposerChoice(latest.runtime?.models ?? [], current, field, select.value));
    });
    return { select };
  };
  const modelCtl = setting('model'); const speedCtl = setting('speed'); const effortCtl = setting('effort');
  settingsRow.append(modelCtl.select, speedCtl.select, effortCtl.select);
  const send = button(COPY.send, 'send', () => { void presenter.send(); });
  send.classList.add('zcr-send');
  const stop = button(COPY.stop, 'stop', () => { void presenter.cancel(); });
  const note = el('p', 'zcr-footnote', COPY.previewNote);
  composer.append(settingsRow, send, stop);
  draft.append(draftCitations, input, composer, note);
  chat.append(status, chrome, alert, transcript, draft); root.append(chat);
  let composing = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('input', () => { presenter.setQuestion(input.value); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || composing || event.isComposing) return;
    event.preventDefault(); void presenter.send();
  });
  const citationCard = (citation: Citation, removable: boolean) => {
    const card = el('div', 'zcr-citation'); card.dataset.zcrCitation = citation.id;
    const quote = el('blockquote', 'zcr-citation-text', citation.text.length > 240 ? `${[...citation.text].slice(0, 240).join('')}…` : citation.text);
    const meta = el('div', 'zcr-citation-meta');
    meta.append(el('span', '', COPY.page(pageLabel(citation))));
    if (hooks.openCitation) meta.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation); }));
    if (removable) meta.append(button(COPY.remove, 'remove-citation', () => { presenter.removeCitation(citation.id); }));
    card.append(quote, meta); return card;
  };
  const messageNode = (message: Message) => {
    const article = el('article', 'zcr-message'); article.dataset.zcrMessage = message.id; article.dataset.role = message.role;
    const header = el('div', 'zcr-message-header');
    header.append(el('div', 'zcr-message-author', message.role === 'user' ? COPY.you : COPY.assistant));
    if (message.role === 'assistant') {
      header.append(button(COPY.copy, 'copy-answer', () => {
        const latest = presenter.snapshot().conversation?.messages.find(entry => entry.id === message.id);
        const source = copyableAnswerText(latest?.text ?? message.text);
        if (hooks.copyText) hooks.copyText(source);
        else void doc.defaultView?.navigator.clipboard?.writeText(source);
      }));
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
  const updateContext = (state: PresenterState) => {
    const title = compactPaperTitle(state.conversation?.title ?? '');
    if (contextTitle.textContent !== title) contextTitle.textContent = title;
    contextTitle.hidden = !title;
    const citation = latestCitation(state);
    const sourceKey = citation ? `${citation.id}:${pageLabel(citation)}` : '';
    if (contextSource.dataset.rendered !== sourceKey) {
      contextSource.dataset.rendered = sourceKey;
      if (!citation) contextSource.replaceChildren();
      else {
        const line = el('div', 'zcr-context-citation');
        line.append(el('span', '', COPY.page(pageLabel(citation))));
        if (hooks.openCitation) line.append(button(COPY.returnToSource, 'open-citation', () => { void hooks.openCitation?.(citation); }));
        contextSource.replaceChildren(line);
      }
    }
    context.hidden = !title && !citation;
  };
  const update = (state: PresenterState) => {
    const list = state.conversation?.messages ?? [];
    const nextChrome = [
      state.connection, state.runtime?.revision ?? 0, state.runtime?.account.state ?? '', state.runtime?.login?.state ?? '',
      state.generating, state.message ?? '', state.conversation?.id ?? '', state.conversation?.lastSeq ?? 0,
      state.conversation?.activeRequestId ?? '', state.conversations.map(c => c.id).join('\n'),
      state.draft.citations.map(c => c.id).join('\n'), JSON.stringify(state.draft.settings), state.focusToken,
      list.map(m => `${m.id}:${m.status}:${m.text}`).join('\n'),
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
    retry.hidden = state.connection !== 'error'; fresh.hidden = !state.conversation || state.generating;
    history.hidden = state.conversations.length < 2 || state.connection !== 'ready';
    const historyKey = state.conversations.map(c => c.id).join('\n');
    if (history.dataset.options !== historyKey) {
      history.dataset.options = historyKey;
      history.replaceChildren(...state.conversations.map(c => {
        const node = el('option'); node.value = c.id; node.textContent = conversationLabel(c); return node;
      }));
    }
    if (state.conversation && history.value !== state.conversation.id) history.value = state.conversation.id;
    alert.textContent = state.message ?? ''; alert.hidden = !state.message;
    updateContext(state);
    empty.hidden = list.length > 0;
    transcript.dataset.empty = String(list.length === 0);
    const ids = list.map(m => m.id).join('\n');
    if (ids !== renderedIds) { renderedIds = ids; messages.replaceChildren(...list.map(messageNode)); }
    const nextKey = list.map(m => `${m.id}:${m.status}:${m.text}`).join('\n');
    const contentChanged = nextKey !== contentKey;
    const follow = followAnswerScroll(isNearBottom(), contentChanged && contentKey !== '');
    contentKey = nextKey;
    for (const message of list) {
      const node = messages.querySelector<HTMLElement>(`[data-zcr-message="${message.id}"]`); if (!node) continue;
      node.dataset.status = message.status;
      const text = node.querySelector<HTMLElement>('[data-zcr-text]')!;
      const rendered = `${message.status}:${message.text}`;
      if (text.dataset.rendered !== rendered) {
        text.dataset.rendered = rendered;
        if (message.role === 'assistant' && message.text) {
          text.classList.add('zcr-rendered');
          text.replaceChildren(renderAnswer(doc, message.text, { deferMath: message.status === 'streaming' || message.status === 'pending' }));
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
    if (input.value !== state.draft.question) input.value = state.draft.question;
    const controls = composerControls(state.runtime?.models ?? [], state.draft.settings ?? state.conversation?.settings ?? null);
    const widgets = { model: modelCtl, speed: speedCtl, effort: effortCtl };
    const signedIn = account === 'signedIn' && state.connection === 'ready';
    for (const control of controls) {
      const widget = widgets[control.field];
      widget.select.setAttribute('aria-label', control.label);
      widget.select.disabled = control.disabled || !signedIn;
      const key = control.options.map(option => `${option.value}:${option.label}`).join('\n');
      if (widget.select.dataset.options !== key) {
        widget.select.dataset.options = key;
        widget.select.replaceChildren(...control.options.map(option => { const node = el('option'); node.value = option.value; node.textContent = option.label; return node; }));
      }
      if (widget.select.value !== control.value) widget.select.value = control.value;
    }
    const canSend = state.connection === 'ready' && account === 'signedIn' && !state.generating;
    send.disabled = !canSend; send.hidden = state.generating; stop.hidden = !state.generating;
    input.disabled = state.connection === 'error';
    if (state.focusToken !== focusToken) { focusToken = state.focusToken; input.focus(); }
  };
  const unbind = presenter.bind(update);
  return () => { unbind(); chat.remove(); };
}
