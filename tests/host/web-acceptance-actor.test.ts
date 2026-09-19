import { Window as HappyWindow } from 'happy-dom';
import { expect, it } from 'vitest';
import { summarizeOfficialPage } from './web-acceptance-actor.mjs';

it('returns only bounded official-page booleans and counts for web acceptance', () => {
  const token = 'RUN-0123456789abcdef01234567';
  const window = new HappyWindow({ url: 'https://chatgpt.com/c/synthetic?temporary=secret' });
  const document = window.document;
  document.body.innerHTML = `
    <div id="prompt-textarea" contenteditable="true"></div>
    <button data-testid="send-button"></button>
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
      editables: [{ tag: 'div', id: 'prompt-textarea', role: null, contenteditable: 'true', parent: { tag: 'body', id: null, role: null, dataTestid: null }, form: null }],
      buttons: [
        { tag: 'button', dataTestid: 'send-button', type: null, disabled: false },
        { tag: 'button', dataTestid: 'stop-button', type: null, disabled: false },
      ],
    },
  });
  expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['transcript', 'text', 'formValue', 'cookie', 'href', 'pathname', 'search']));
});

it('rejects a lookalike origin and an invalid expected token without inspecting messages', () => {
  const lookalike = new HappyWindow({ url: 'https://chatgpt.com.example/c/fake' }).document;
  lookalike.body.innerHTML = '<article data-message-author-role="assistant">RUN-0123456789abcdef01234567</article>';
  expect(summarizeOfficialPage(lookalike, 'RUN-0123456789abcdef01234567')).toEqual({ status: 'blocked', reason: 'untrusted-origin' });
  const official = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  expect(summarizeOfficialPage(official, 'not-a-token')).toEqual({ status: 'blocked', reason: 'invalid-token' });
});
