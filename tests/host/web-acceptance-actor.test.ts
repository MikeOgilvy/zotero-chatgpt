import { Window as HappyWindow } from 'happy-dom';
import { expect, it } from 'vitest';
import { summarizeOfficialPage, ZoteroChatGPTWebAcceptanceChild } from './web-acceptance-actor.mjs';

it('returns only bounded official-page booleans and counts for web acceptance', () => {
  const token = 'RUN-0123456789abcdef01234567';
  const harnessQuestion = 'Read the Zotero-provided PDF context and answer with only the hidden verification token from the second physical page.';
  const window = new HappyWindow({ url: 'https://chatgpt.com/c/synthetic?temporary=secret' });
  const document = window.document;
  document.body.innerHTML = `
    <form id="composer-form" data-testid="composer-form">
      <textarea id="mobile-composer-prompt">${harnessQuestion}</textarea>
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
    canonicalURL: 'https://chatgpt.com/c/synthetic',
    documentReadyState: 'interactive',
    challenge: { running: false, stage: false, iframe: false },
    loginEntryPresent: false,
    errorSurfaceVisible: false,
    inputReady: true,
    sendReady: true,
    draftMatchesExactTestQuestion: true,
    draftMatchesKnownSyntheticHarness: true,
    draftLength: harnessQuestion.length,
    draftHasZoteroRequestMarker: false,
    userMessages: 1,
    assistantMessages: 1,
    userMarkerMessages: 1,
    latestAssistantContainsToken: true,
    streaming: true,
    roleStructure: null,
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

it('reports only fixed challenge and login structure booleans', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  document.body.innerHTML = '<div id="challenge-running"></div><iframe src="https://challenges.cloudflare.com/widget"></iframe><a href="/auth/login">private label</a>';
  const result = summarizeOfficialPage(document, 'RUN-0123456789abcdef01234567');
  expect(result.challenge).toEqual({ running: true, stage: false, iframe: true }); expect(result.loginEntryPresent).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private label');
});

it('reports an error surface as a bounded boolean without returning its text', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  document.body.innerHTML = '<div role="alert">You have reached a private limit message</div>';
  const result = summarizeOfficialPage(document, 'RUN-0123456789abcdef01234567');
  expect(result.errorSurfaceVisible).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private limit message');
});

it('reports only false for an unrelated existing draft and never returns its text', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  document.body.innerHTML = '<form><textarea id="mobile-composer-prompt">private owner draft</textarea><button type="submit" aria-label="Send message"></button></form>';
  const result = summarizeOfficialPage(document, 'RUN-0123456789abcdef01234567');
  expect(result.draftMatchesExactTestQuestion).toBe(false);
  expect(result.draftMatchesKnownSyntheticHarness).toBe(false);
  expect(result.draftLength).toBe('private owner draft'.length);
  expect(JSON.stringify(result)).not.toContain('private owner draft');
});

it('clears only the exact known harness question through the native textarea editing path', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  const question = 'Read the Zotero-provided PDF context and answer with only the hidden verification token from the second physical page.';
  document.body.innerHTML = `<form><textarea id="mobile-composer-prompt">${question}\n\n${question}</textarea></form>`;
  const actor = new ZoteroChatGPTWebAcceptanceChild() as ZoteroChatGPTWebAcceptanceChild & { document: Document };
  actor.document = document as unknown as Document;
  expect(actor.receiveMessage({ name: 'clearKnownHarnessDraft' })).toEqual({ status: 'cleared', reason: null, discardedKnownSyntheticDraft: true, empty: true });
  const textarea = document.querySelector('textarea'); if (!textarea) throw new Error('textarea fixture missing');
  expect(textarea.value).toBe('');
  textarea.value = `${question} extra private words`;
  expect(actor.receiveMessage({ name: 'clearKnownHarnessDraft' })).toMatchObject({ status: 'blocked', reason: 'unrelated-draft', discardedKnownSyntheticDraft: false });
  expect(textarea.value).toContain('extra private words');
});

it('clicks only one exact enabled official stop control', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/c/synthetic' }).document; let clicks = 0;
  document.body.innerHTML = '<button data-testid="stop-button"></button>';
  document.querySelector('button')?.addEventListener('click', () => { clicks += 1; });
  const actor = new ZoteroChatGPTWebAcceptanceChild() as ZoteroChatGPTWebAcceptanceChild & { document: Document }; actor.document = document as unknown as Document;
  expect(actor.receiveMessage({ name: 'stopKnownGeneration' })).toEqual({ status: 'clicked', reason: null, knownStop: true }); expect(clicks).toBe(1);
  document.body.insertAdjacentHTML('beforeend', '<button data-testid="stop-button"></button>');
  expect(actor.receiveMessage({ name: 'stopKnownGeneration' })).toMatchObject({ status: 'blocked', reason: 'ambiguous-stop', knownStop: false });
});

it('returns only bounded transcript structure when official role markers are absent', () => {
  const document = new HappyWindow({ url: 'https://chatgpt.com/c/synthetic' }).document;
  document.body.innerHTML = '<main role="main"><section data-testid="conversation-turn"><div role="log">private answer</div></section></main>';
  const result = summarizeOfficialPage(document, 'RUN-0123456789abcdef01234567');
  expect(result.roleStructure).toEqual([
    { tag: 'main', dataTestid: null, dataMessageAuthorRole: null, role: 'main' },
    { tag: 'section', dataTestid: 'conversation-turn', dataMessageAuthorRole: null, role: null },
    { tag: 'div', dataTestid: null, dataMessageAuthorRole: null, role: 'log' },
  ]);
  expect(JSON.stringify(result)).not.toContain('private answer');
});

it('rejects a lookalike origin and an invalid expected token without inspecting messages', () => {
  const lookalike = new HappyWindow({ url: 'https://chatgpt.com.example/c/fake' }).document;
  lookalike.body.innerHTML = '<article data-message-author-role="assistant">RUN-0123456789abcdef01234567</article>';
  expect(summarizeOfficialPage(lookalike, 'RUN-0123456789abcdef01234567')).toEqual({ status: 'blocked', reason: 'untrusted-origin' });
  const official = new HappyWindow({ url: 'https://chatgpt.com/' }).document;
  expect(summarizeOfficialPage(official, 'not-a-token')).toEqual({ status: 'blocked', reason: 'invalid-token' });
});
