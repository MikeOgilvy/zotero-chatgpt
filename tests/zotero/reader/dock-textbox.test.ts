import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter } from '../../../packages/zotero/src/chat/presenter.ts';
import { mountChatView, renderReaderShell } from '../../../packages/zotero/src/chat/view.ts';
import { bindDockResize, mountReaderDock, unmountReaderDock } from '../../../packages/zotero/src/reader/dock.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Conversation } from '../../../packages/contracts/src/index.ts';
import { citationA, paperA, settings } from '../../contracts/factories.ts';

/**
 * Zotero 9.0.6 reader source `resource/reader/reader.js:27222`:
 *
 *   function isTextBox(node) {
 *     return ['INPUT'].includes(node.nodeName) && node.type === 'text'
 *       || node.getAttribute('contenteditable') === 'true';
 *   }
 *
 * Zotero's reader KeyboardManager binds a CAPTURE-phase `keydown` on the reader window
 * (`resource/reader/reader.js:72687`) and only skips its reader shortcuts when this returns true
 * for `event.target`. Unlike the ancestor-based FocusManager guard at reader.js:72538 that the
 * dock's `contenteditable="false"` satisfies, this predicate reads the target itself and requires
 * the literal value `true`. The regression below therefore encodes Zotero's exact predicate, not
 * just the presence of an attribute.
 *
 * Selector-to-predicate mapping under test: `<textarea>` (composer), `<input type="search">`
 * (history search) and `<input type="number">` (capture page / reference page ranges) all fail
 * the first clause (`type === 'text'`), so each must carry `contenteditable="true"` to satisfy the
 * second clause; every other dock control must NOT carry it and stays covered by the dock ancestor
 * for the ancestor-based guard. The sibling Delete/Backspace branch (reader.js:72950) is a
 * different, `closest('input, .label-popup')` guard, not this predicate.
 */
const zoteroIsTextBox = (node: Element): boolean =>
  (node.nodeName === 'INPUT' && (node as HTMLInputElement).type === 'text') || node.getAttribute('contenteditable') === 'true';

/** Same FocusManager expression commit 92814e1 fixed; must stay true for our controls. */
const zoteroFocusManagerExemptsArrowKeys = (target: Element): boolean =>
  target.closest('[contenteditable], input[type="text"], .preview-popup') !== null;

function readerDocument(): Document {
  const win = new Window({ url: 'https://reader.test/' });
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = [
    '<div id="reader-ui"><div class="toolbar"><button class="find">Find</button></div></div>',
    '<div id="split-view"><div id="primary-view" class="primary-view"></div></div>',
  ].join('');
  return doc;
}

/**
 * Mounts the real reader dock and the real chat view inside it, matching the sibling focus test,
 * so the controls under test are the actual composer/history elements a user focuses.
 */
async function mountDockWithChat() {
  const doc = readerDocument();
  const mounted = mountReaderDock(doc)!;
  const conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null,
    messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: citationA.text, citations: [citationA], status: 'completed' }],
    lastSeq: 0, createdAt: 'now', updatedAt: 'now',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null,
    models: [{ id: 'catalog-default', displayName: 'Catalog Default', isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null, serviceTiers: [], defaultServiceTier: null }],
    error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)), peekCurrent: () => Promise.resolve(structuredClone(conversation)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(conversation)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(conversation)), send: () => Promise.reject(new Error()),
    request: () => Promise.reject(new Error()), cancel: () => Promise.reject(new Error()),
    deleteConversation: () => Promise.reject(new Error()),
    diagnostics: () => Promise.resolve({ pluginVersion: '0.4.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {}, storageLocation: SHAREABLE_STORAGE_LOCATION }),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const root = renderReaderShell(mounted.body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  const teardown = mountChatView(root, presenter);
  await Promise.resolve();
  return { doc, mounted, root, teardown };
}

it('satisfies Zotero isTextBox for every text-entry control in the dock', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]');
  const historySearch = root.querySelector<HTMLInputElement>('[data-zchatgpt-history-search]');
  const resizer = mounted.dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]');
  expect(composer?.tagName).toBe('TEXTAREA');
  expect(historySearch?.type).toBe('search');
  expect(resizer).toBeTruthy();

  // None matches isTextBox's first clause (`type === 'text'`), so the dock-scoped observer must
  // add the second clause asynchronously after the view mounts each control.
  await vi.waitFor(() => expect(zoteroIsTextBox(composer!)).toBe(true));
  await vi.waitFor(() => expect(zoteroIsTextBox(historySearch!)).toBe(true));
  expect(composer!.getAttribute('contenteditable')).toBe('true');
  expect(historySearch!.getAttribute('contenteditable')).toBe('true');

  // Controls the user does not type text into must stay untouched: no own attribute, dock ancestor.
  expect(zoteroIsTextBox(resizer!)).toBe(false);
  expect(resizer!.getAttribute('contenteditable')).toBeNull();

  // Commit 92814e1's ancestor-based FocusManager exemption is untouched: for EVERY control the
  // arrow guard's `closest(...)` is non-null, so arrow keys still reach the caret instead of
  // switching reader panes.
  expect(mounted.dock.getAttribute('contenteditable')).toBe('false');
  expect(zoteroFocusManagerExemptsArrowKeys(composer!)).toBe(true);
  expect(zoteroFocusManagerExemptsArrowKeys(historySearch!)).toBe(true);
  expect(zoteroFocusManagerExemptsArrowKeys(resizer!)).toBe(true);

  unmountReaderDock(doc);
  teardown();
});

it('marks matching controls appended later and leaves unrelated dynamic controls alone', async () => {
  const doc = readerDocument();
  const { body } = mountReaderDock(doc)!;
  const lateTextarea = doc.createElement('textarea');
  const lateSearch = doc.createElement('input');
  lateSearch.type = 'search';
  const lateNumber = doc.createElement('input');
  lateNumber.type = 'number';
  const lateSelect = doc.createElement('select');
  body.append(lateTextarea, lateSearch, lateNumber, lateSelect);

  await vi.waitFor(() => expect(zoteroIsTextBox(lateTextarea)).toBe(true));
  await vi.waitFor(() => expect(zoteroIsTextBox(lateSearch)).toBe(true));
  await vi.waitFor(() => expect(zoteroIsTextBox(lateNumber)).toBe(true));
  expect(lateNumber.getAttribute('contenteditable')).toBe('true');
  expect(lateSelect.getAttribute('contenteditable')).toBeNull();
  expect(zoteroFocusManagerExemptsArrowKeys(lateSelect)).toBe(true);

  unmountReaderDock(doc);
});

it('keeps the exemption across dock reuse and never overwrites the view’s own value', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  await vi.waitFor(() => expect(zoteroIsTextBox(composer)).toBe(true));

  const reused = mountReaderDock(doc)!;
  expect(reused.dock).toBe(mounted.dock);
  expect(reused.body).toBe(mounted.body);
  expect(reused.dock.getAttribute('contenteditable')).toBe('false');
  expect(zoteroIsTextBox(composer)).toBe(true);

  // The adapter only fills in a missing value: it must not fight the chat view's own DOM writes.
  const owned = doc.createElement('textarea');
  owned.setAttribute('contenteditable', 'false');
  mounted.body.append(owned);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(owned.getAttribute('contenteditable')).toBe('false');

  unmountReaderDock(doc);
  teardown();
});

it('stops marking after unmount and disconnects the scoped observer', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  await vi.waitFor(() => expect(zoteroIsTextBox(composer)).toBe(true));

  unmountReaderDock(doc);
  expect(doc.querySelector('[data-zchatgpt-dock]')).toBeNull();

  const stray = doc.createElement('textarea');
  mounted.body.append(stray);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(stray.getAttribute('contenteditable')).toBeNull();

  teardown();
});

it('keeps the splitter resizing while arrow keys reach the composer', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const resizer = mounted.dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]')!;
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  await vi.waitFor(() => expect(zoteroIsTextBox(composer)).toBe(true));

  let width = 400;
  const applied: number[] = [];
  const unbind = bindDockResize(resizer, {
    currentWidth: () => width,
    setWidth: next => { applied.push(next); width = next; },
    measureAvailableWidth: () => 1440,
  });
  const view = doc.defaultView!;
  const key = (name: string, target: EventTarget) =>
    target.dispatchEvent(new view.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

  // The separator is not a text control, so ArrowLeft still resizes the dock.
  expect(key('ArrowLeft', resizer)).toBe(false);
  await vi.waitFor(() => expect(applied).toEqual([416]));

  // A text control nested in the separator owns its arrow keys; the dock must not resize.
  const nested = doc.createElement('textarea');
  resizer.append(nested);
  expect(key('ArrowLeft', nested)).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(applied).toEqual([416]);

  // The composer keeps both exemptions: the target-based isTextBox and 92814e1's ancestor guard.
  expect(zoteroIsTextBox(composer)).toBe(true);
  expect(zoteroFocusManagerExemptsArrowKeys(composer)).toBe(true);

  unbind();
  unmountReaderDock(doc);
  teardown();
});
