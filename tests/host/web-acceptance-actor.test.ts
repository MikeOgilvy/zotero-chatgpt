import { Window as HappyWindow } from 'happy-dom';
import { expect, it } from 'vitest';
import { summarizeOfficialPage } from './web-acceptance-actor.mjs';

it('returns only bounded official-page booleans and counts for web acceptance', () => {
  const token = 'RUN-0123456789abcdef01234567';
  const window = new HappyWindow({ url: 'https://chatgpt.com/c/synthetic?temporary=secret' });
  const document = window.document;
  document.body.innerHTML = `
    <form id="composer-form" data-testid="composer-form">
      <textarea id="mobile-composer-prompt"></textarea>
      <button type="submit" aria-label="Send message"></button>
      <button type="button" aria-label="Start voice mode"></button>
    </form>
    <button data-testid="stop-button"></button>
    <article data-message-author-role="user">Question [Zotero request marker-one]</article>
    <article data-message-author-role="assistant">The token is ${token}; hidden transcript text.</article>
  `;

  const result = summarizeOfficialPage(document, token);

  expect(result).toEqual({
    status: 'ok',
    officialURL: true,
    canonicalOrigin: 'https://chatgpt.com',
    inputReady: true,
    sendReady: true,
    userMessages: 1,
    assistantMessages: 1,
    userMarkerMessages: 1,
    latestAssistantContainsToken: true,
    streaming: true,
    observations: {
      editables: [{ tag: 'textarea', id: 'mobile-composer-prompt', role: null, contenteditable: null, parent: { tag: 'form', id: 'composer-form', role: null, dataTestid: 'composer-form' }, form: { tag: 'form', id: 'composer-form', role: null, dataTestid: 'composer-form' } }],
      buttons: [
        { tag: 'button', id: null, dataTestid: null, type: 'submit', disabled: false, ariaLabelCategory: 'send' },
        { tag: 'button', id: null, dataTestid: null, type: 'button', disabled: false, ariaLabelCategory: 'voice' },
      ],
    },
  });
  expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['transcript', 'text', 'formValue', 'cookie', 'href', 'pathname', 'search']));
  expect(JSON.stringify(result)).not.toMatch(/hidden transcript text|temporary=secret|Send message|Start voice mode/u);
});

it('rejects a lookalike origin and an invalid expected token without inspecting messages', () => {
  const lookalike = new HappyWindow({ url: 'https://chatgpt.com.example/c/fake' }).document;
  lookalike.body.innerHTML = '<article data-message-author-role="assistant">RUN-0123456789abcdef01234567</article>';
  expect(summarizeOfficialPage(lookalike, 'RUN-0123456789abcdef01234567')).toEqual({ status: 'blocked', reason: 'untrusted-origin' });
  const official = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  expect(summarizeOfficialPage(official, 'not-a-token')).toEqual({ status: 'blocked', reason: 'invalid-token' });
});
