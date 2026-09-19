/* global JSWindowActorParent, JSWindowActorChild */

const OFFICIAL_ORIGIN = 'https://chatgpt.com';
const TOKEN = /^RUN-[a-f0-9]{24}$/u;
const REQUEST_MARKER = /\[Zotero request [0-9a-z-]{1,80}\]/iu;

function trustedOfficialDocument(document) {
  try {
    const url = new URL(String(document?.location?.href ?? ''));
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com'
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

function attribute(node, name, max = 128) {
  const value = node?.getAttribute?.(name);
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function structuralNode(node) {
  if (!node) return null;
  return {
    tag: String(node.localName ?? '').slice(0, 40) || null,
    id: attribute(node, 'id'),
    role: attribute(node, 'role'),
    dataTestid: attribute(node, 'data-testid'),
  };
}

function structuralObservations(document) {
  const editables = [...document.querySelectorAll('textarea, [contenteditable]')].slice(0, 10).map(node => ({
    tag: String(node.localName ?? '').slice(0, 40) || null,
    id: attribute(node, 'id'), role: attribute(node, 'role'), contenteditable: attribute(node, 'contenteditable'),
    parent: structuralNode(node.parentElement), form: structuralNode(node.closest('form')),
  }));
  const buttons = [...document.querySelectorAll('button[data-testid], button[type]')].slice(0, 20).map(node => ({
    tag: String(node.localName ?? '').slice(0, 40) || null,
    dataTestid: attribute(node, 'data-testid'), type: attribute(node, 'type'), disabled: node.disabled === true,
  }));
  return { editables, buttons };
}

/** Return only bounded booleans and counts; no page text, field value, path, query, cookie or identity. */
export function summarizeOfficialPage(document, verificationToken) {
  if (!trustedOfficialDocument(document)) return { status: 'blocked', reason: 'untrusted-origin' };
  if (typeof verificationToken !== 'string' || !TOKEN.test(verificationToken)) return { status: 'blocked', reason: 'invalid-token' };
  const composer = document.querySelector('#prompt-textarea, textarea[name="prompt"], [contenteditable="true"][data-testid*="composer"]');
  const send = document.querySelector('button[data-testid="send-button"]');
  const users = [...document.querySelectorAll('[data-message-author-role="user"]')];
  const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  const latestAssistant = assistants.at(-1);
  return {
    status: 'ok',
    officialURL: true,
    canonicalOrigin: OFFICIAL_ORIGIN,
    inputReady: Boolean(composer),
    sendReady: Boolean(send && !send.disabled),
    userMessages: users.length,
    assistantMessages: assistants.length,
    userMarkerMessages: users.filter(node => REQUEST_MARKER.test(String(node.textContent ?? ''))).length,
    latestAssistantContainsToken: Boolean(latestAssistant && String(latestAssistant.textContent ?? '').includes(verificationToken)),
    streaming: Boolean(document.querySelector('button[data-testid="stop-button"]')),
    observations: structuralObservations(document),
  };
}

const ParentBase = typeof JSWindowActorParent === 'undefined' ? class {} : JSWindowActorParent;
const ChildBase = typeof JSWindowActorChild === 'undefined' ? class {} : JSWindowActorChild;

export class ZoteroChatGPTWebAcceptanceParent extends ParentBase {}

export class ZoteroChatGPTWebAcceptanceChild extends ChildBase {
  receiveMessage(message) {
    if (message?.name !== 'probe') return { status: 'blocked', reason: 'invalid-request' };
    return summarizeOfficialPage(this.document, message.data?.verificationToken);
  }
}
