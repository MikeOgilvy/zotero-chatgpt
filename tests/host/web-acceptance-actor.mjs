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
