/** DOM-only helpers used by the child actor and exercised without a privileged Gecko runtime. */

export const CHATGPT_ORIGIN = 'https://chatgpt.com';
const DESKTOP_COMPOSER_SELECTOR = '#prompt-textarea';
const MOBILE_COMPOSER_SELECTOR = 'textarea#mobile-composer-prompt';
const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';

export function isChatGPTDocument(document) {
  try {
    const url = new URL(document.location.href);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com'
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

/** The named ChatGPT composer only. Generic form fields and login inputs never qualify. */
export function findChatGPTComposer(document) {
  if (!isChatGPTDocument(document)) return null;
  const element = document.querySelector(DESKTOP_COMPOSER_SELECTOR) ?? document.querySelector(MOBILE_COMPOSER_SELECTOR);
  if (!element) return null;
  const tag = String(element.localName || '').toLowerCase();
  if (tag === 'textarea') return String(element.getAttribute('type') || '').toLowerCase() !== 'password' ? element : null;
  return element.getAttribute('contenteditable') === 'true' ? element : null;
}

export function readChatGPTComposer(composer) {
  const tag = String(composer?.localName || '').toLowerCase();
  if (tag === 'textarea') return String(composer.value || '');
  return String(composer?.innerText ?? composer?.textContent ?? '');
}

/** Replace the one identified composer and dispatch the ordinary event the page observes. */
export function replaceChatGPTComposer(composer, text) {
  if (!composer || typeof text !== 'string') return false;
  const tag = String(composer.localName || '').toLowerCase();
  if (tag === 'textarea') {
    // React-controlled textareas observe the platform setter plus the normal input event. Assigning
    // an own `value` can leave the official UI's state behind the visible DOM value.
    const prototype = composer.ownerDocument?.defaultView?.HTMLTextAreaElement?.prototype;
    const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;
    if (setter) setter.call(composer, text); else composer.value = text;
    const EventCtor = composer.ownerDocument?.defaultView?.InputEvent ?? composer.ownerDocument?.defaultView?.Event;
    if (!EventCtor) return false;
    composer.dispatchEvent(new EventCtor('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    return true;
  }
  if (composer.getAttribute('contenteditable') !== 'true') return false;
  const document = composer.ownerDocument;
  const view = document?.defaultView;
  const selection = view?.getSelection?.();
  if (!document || !selection || typeof document.createRange !== 'function' || typeof document.execCommand !== 'function') return false;
  try {
    composer.focus?.();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges(); selection.addRange(range);
    // Gecko's native editing command produces the trusted beforeinput/input sequence ProseMirror uses
    // to update its state. Direct textContent plus a synthetic InputEvent only changes visible DOM.
    return document.execCommand('insertText', false, text) === true;
  } catch {
    return false;
  }
}

/** Boolean-only acknowledgement: no page transcript or account data crosses into the parent. */
export function hasAcceptedRequestMarker(document, marker) {
  if (!isChatGPTDocument(document) || typeof marker !== 'string' || !marker) return false;
  return [...document.querySelectorAll(USER_MESSAGE_SELECTOR)]
    .some(element => String(element.textContent || '').includes(`[Zotero request ${marker}]`));
}
