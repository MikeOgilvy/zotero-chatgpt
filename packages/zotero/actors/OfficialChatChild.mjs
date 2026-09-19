/* global JSWindowActorChild */

import {
  findChatGPTComposer,
  hasAcceptedRequestMarker,
  isChatGPTDocument,
  readChatGPTComposer,
  replaceChatGPTComposer,
} from './chatgpt-dom.mjs';

const SEND_SELECTOR = 'button[data-testid="send-button"]';
const MAX_TEXT = 512_000;
const ACCEPT_TIMEOUT_MS = 20_000;
const POLL_MS = 100;
const SEND_READY_TIMEOUT_MS = 5_000;

function inside(node, container) {
  return node === container || Boolean(node && container?.contains?.(node));
}

function sendButton(document, composer = findChatGPTComposer(document)) {
  const button = composer?.closest?.('form')?.querySelector?.(SEND_SELECTOR) ?? null;
  return button?.localName === 'button' ? button : null;
}

function safeStructure(document) {
  const editors = [...document.querySelectorAll('textarea, [contenteditable="true"]')].slice(0, 8).map(element => ({
    tag: String(element.localName || '').slice(0, 24),
    id: String(element.id || '').slice(0, 80),
    role: String(element.getAttribute('role') || '').slice(0, 40),
    contenteditable: String(element.getAttribute('contenteditable') || '').slice(0, 16),
    formButtons: element.closest?.('form')?.querySelectorAll?.('button').length ?? 0,
  }));
  return { editors, knownSendButtons: document.querySelectorAll(SEND_SELECTOR).length };
}

function isSubmission(event, composer) {
  if (!event.isTrusted || event.isComposing) return false;
  if (event.type === 'keydown') {
    return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      && inside(event.target, composer);
  }
  if (event.type === 'click') return Boolean(event.target?.closest?.(SEND_SELECTOR));
  if (event.type === 'submit') return inside(composer, event.target);
  return false;
}

export class ZoteroChatGPTOfficialChatChild extends JSWindowActorChild {
  replaying = false;
  inFlight = false;

  handleEvent(event) {
    if (this.replaying || !isChatGPTDocument(this.document)) return;
    const composer = findChatGPTComposer(this.document);
    if (!composer) {
      const unknown = this.document.querySelector('textarea, [contenteditable="true"]');
      if (!unknown) return;
      const form = unknown.closest?.('form');
      const unknownSubmit = event.isTrusted && (
        (event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && inside(event.target, unknown))
        || (event.type === 'click' && Boolean(event.target?.closest?.('button')) && Boolean(form?.contains(event.target?.closest?.('button'))))
        || (event.type === 'submit' && inside(unknown, event.target))
      );
      if (event.type === 'input' && inside(event.target, unknown)) this.sendAsyncMessage('readiness', { status: 'unsupported-send' });
      if (unknownSubmit) { event.preventDefault(); event.stopImmediatePropagation(); this.sendAsyncMessage('readiness', { status: 'unsupported-send' }); }
      return;
    }
    if (event.type === 'input' && composer && inside(event.target, composer)) {
      const document = this.document;
      this.contentWindow.setTimeout(() => {
        if (this.document !== document) return;
        this.sendAsyncMessage('readiness', { status: readChatGPTComposer(composer).trim() ? 'draft' : sendButton(document) ? 'ready' : 'composer-ready' });
      }, 0);
      return;
    }
    // A changed/unknown button inside the composer form is blocked rather than allowed to submit the
    // raw question. Non-submit controls outside that form (including login) are untouched.
    if (event.isTrusted && event.type === 'click' && readChatGPTComposer(composer).trim()) {
      const button = event.target?.closest?.('button');
      const form = composer.closest?.('form');
      if (button && form?.contains(button) && !button.matches(SEND_SELECTOR)) {
        event.preventDefault(); event.stopImmediatePropagation();
        this.sendAsyncMessage('readiness', { status: 'unsupported-send' });
        return;
      }
    }
    if (!isSubmission(event, composer)) return;
    // A second Enter/click while PDF preparation awaits is consumed, never queued as a duplicate.
    if (this.inFlight) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const question = readChatGPTComposer(composer);
    if (!question.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void this.submitQuestion(question);
  }

  async receiveMessage(message) {
    if (!isChatGPTDocument(this.document)) return { status: 'blocked', reason: 'context-changed' };
    if (message.name === 'stage') {
      const text = message.data?.text;
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { status: 'blocked', reason: 'invalid-response' };
      const composer = findChatGPTComposer(this.document);
      if (!composer) return { status: 'blocked', reason: 'composer-missing' };
      const current = readChatGPTComposer(composer).trim();
      if (!replaceChatGPTComposer(composer, current ? `${current}\n\n${text}` : text)) return { status: 'blocked', reason: 'composer-missing' };
      composer.focus?.();
      return { status: 'staged' };
    }
    if (message.name === 'submitQuestion') {
      const question = message.data?.question;
      if (typeof question !== 'string' || !question.trim() || question.length > MAX_TEXT) return { status: 'blocked', reason: 'invalid-response' };
      return this.submitQuestion(question);
    }
    if (message.name === 'probe') {
      if (this.inFlight) return { status: 'busy' };
      if (this.document.querySelector('button[data-testid="stop-button"]')) return { status: 'generating' };
      const composer = findChatGPTComposer(this.document);
      if (composer) {
        if (readChatGPTComposer(composer).trim()) return { status: 'draft' };
        return { status: sendButton(this.document) ? 'ready' : 'composer-ready', structure: safeStructure(this.document) };
      }
      // Boolean structure only: values are never read. A generic editor with no named ChatGPT
      // composer means selector drift, and the parent must gate the surface instead of failing open.
      return this.document.querySelector('textarea, [contenteditable="true"]')
        ? { status: 'unsupported-composer', structure: safeStructure(this.document) }
        : { status: 'composer-missing', structure: safeStructure(this.document) };
    }
    return { status: 'blocked', reason: 'invalid-response' };
  }

  async submitQuestion(question) {
    if (this.inFlight) return { status: 'blocked', reason: 'busy' };
    this.inFlight = true;
    const originalDocument = this.document;
    const originalWindow = this.contentWindow;
    const originalComposer = findChatGPTComposer(originalDocument);
    const originalDraft = originalComposer ? readChatGPTComposer(originalComposer) : '';
    const transaction = originalWindow.crypto.randomUUID();
    try {
      // An explicit More-details action may start with an empty official composer. It must never
      // overwrite a draft the owner already typed there.
      if (originalDraft.trim() && originalDraft !== question) return { status: 'blocked', reason: 'draft-changed' };
      let prepared;
      try { prepared = await this.sendQuery('prepare', { question, transaction }); }
      catch {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: transaction, reason: 'context-changed' });
        return { status: 'blocked', reason: 'context-changed' };
      }
      if (!prepared || !['prepared', 'allow'].includes(prepared.status)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared?.marker ?? null, reason: prepared?.reason ?? 'invalid-response' });
        return prepared ?? { status: 'blocked', reason: 'invalid-response' };
      }
      if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'context-changed' });
        return { status: 'blocked', reason: 'context-changed' };
      }
      const composer = findChatGPTComposer(originalDocument);
      if (!composer || composer !== originalComposer) { this.sendAsyncMessage('status', { status: 'composer-missing', marker: prepared.marker ?? null }); return { status: 'blocked', reason: 'composer-missing' }; }
      // The owner may keep typing while local PDF extraction runs. Preserve those edits and require
      // another deliberate send instead of replacing them with the older frozen question.
      if (readChatGPTComposer(composer) !== originalDraft) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'draft-changed' });
        return { status: 'blocked', reason: 'draft-changed' };
      }
      const text = prepared.status === 'prepared' ? prepared.text : `${question}\n\n[Zotero request ${prepared.marker}]`;
      if (typeof text !== 'string' || text.length > MAX_TEXT || !replaceChatGPTComposer(composer, text)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker ?? null, reason: 'invalid-response' });
        return { status: 'blocked', reason: 'invalid-response' };
      }
      const insertedText = readChatGPTComposer(composer);
      if (!insertedText.includes(`[Zotero request ${prepared.marker}]`)) {
        this.sendAsyncMessage('status', { status: 'context-blocked', marker: prepared.marker, reason: 'invalid-response' });
        return { status: 'blocked', reason: 'invalid-response' };
      }
      const button = await this.waitForSend(originalDocument, originalWindow, composer, insertedText);
      if (!button) {
        const reason = readChatGPTComposer(composer) === text ? 'submit-missing' : 'draft-changed';
        this.sendAsyncMessage('status', { status: reason === 'submit-missing' ? 'submit-missing' : 'context-blocked', marker: prepared.marker ?? null, reason });
        return { status: 'blocked', reason };
      }
      this.replaying = true;
      try { button.click(); }
      finally { originalWindow.setTimeout(() => { this.replaying = false; }, 0); }
      const accepted = await this.waitForMarker(prepared.marker, originalDocument, originalWindow);
      const acceptedStatus = prepared.status === 'prepared' ? 'accepted' : 'accepted-without-context';
      this.sendAsyncMessage('status', { status: accepted ? acceptedStatus : 'not-accepted', marker: prepared.marker });
      return { status: accepted ? 'accepted' : 'not-accepted' };
    } finally {
      this.inFlight = false;
    }
  }

  waitForMarker(marker, originalDocument, originalWindow) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) { resolve(false); return; }
        if (hasAcceptedRequestMarker(originalDocument, marker)) { resolve(true); return; }
        if (Date.now() - started >= ACCEPT_TIMEOUT_MS) { resolve(false); return; }
        originalWindow.setTimeout(check, POLL_MS);
      };
      check();
    });
  }

  waitForSend(originalDocument, originalWindow, composer, expectedText) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (this.document !== originalDocument || this.contentWindow !== originalWindow || !isChatGPTDocument(originalDocument)) { resolve(null); return; }
        if (readChatGPTComposer(composer) !== expectedText) { resolve(null); return; }
        const button = sendButton(originalDocument, composer);
        if (button && !button.disabled) { resolve(button); return; }
        if (Date.now() - started >= SEND_READY_TIMEOUT_MS) { resolve(null); return; }
        originalWindow.setTimeout(check, 50);
      };
      check();
    });
  }
}
