import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import { ConversationPresenter } from '../../packages/zotero/src/chat/presenter.ts';
import { mountChatView, renderReaderShell } from '../../packages/zotero/src/chat/view.ts';
import { mountReaderDock, unmountReaderDock } from '../../packages/zotero/src/reader/dock.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Conversation } from '../../packages/contracts/src/index.ts';
import { citationA, paperA, settings } from '../contracts/factories.ts';

/**
 * Real Zotero 9.0.6 reader source: `resource/reader/reader.js:72538` (FocusManager._handleKeyDown)
 * is a CAPTURE-phase window keydown listener that default-prevents ArrowRight/ArrowLeft and jumps
 * panes unless this exact expression is non-null:
 *   e.target.closest('[contenteditable], input[type="text"], .preview-popup')
 * (:72541 is the ArrowLeft branch.) Our composer is a `<textarea>`, the history field an
 * `input[type="search"]` and the page field an `input[type="number"]`, so none of them is exempt
 * on its own; the dock's explicit non-editable `contenteditable="false"` ancestor is the lever.
 */
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
 * Mounts the real reader dock and the real chat view inside it, the way the sidebar tests do, so
 * the targets below are the actual controls a user focuses, not stand-ins.
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
    current: () => Promise.resolve(structuredClone(conversation)), newConversation: () => Promise.reject(new Error()),
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

it('exempts the reader composer, history search and splitter from Zotero FocusManager', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const { dock } = mounted;

  // The whole dock is explicitly marked non-editable; form controls inside keep native editing.
  expect(dock.getAttribute('contenteditable')).toBe('false');

  const composer = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]');
  const historySearch = root.querySelector<HTMLInputElement>('[data-zcr-history-search]');
  const resizer = dock.querySelector<HTMLElement>('[data-zcr-resizer]');
  expect(composer?.tagName).toBe('TEXTAREA');
  expect(historySearch?.type).toBe('search');
  expect(resizer).toBeTruthy();

  // Two different Zotero predicates, two different mechanisms, so the assertions split.
  // The fields the user types text into also carry their own `contenteditable="true"` because
  // Zotero's KeyboardManager predicate (reader.js:27222) reads the event TARGET and requires the
  // literal value `true`; the dock ancestor alone cannot satisfy it. The splitter is not a text
  // control, so it keeps relying on the dock ancestor and must carry nothing.
  for (const target of [composer, historySearch]) {
    expect(target!.getAttribute('contenteditable')).toBe('true');
    expect(target!.closest('[contenteditable]')).toBe(target);
    expect(zoteroFocusManagerExemptsArrowKeys(target!)).toBe(true);
  }
  expect(resizer!.getAttribute('contenteditable')).toBeNull();
  expect(resizer!.closest('[contenteditable]')).toBe(dock);
  expect(zoteroFocusManagerExemptsArrowKeys(resizer!)).toBe(true);

  // The reported symptom, reproduced: with no exemption anywhere the guard that default-prevents
  // the arrow key is null for the composer, so Zotero moves focus to another pane instead of the
  // caret. Restoring the dock ancestor alone already exempts the composer again, because this
  // guard is ancestor-aware — which is why the field's own attribute is only needed for the
  // KeyboardManager predicate.
  composer!.removeAttribute('contenteditable');
  dock.removeAttribute('contenteditable');
  expect(zoteroFocusManagerExemptsArrowKeys(composer!)).toBe(false);
  dock.setAttribute('contenteditable', 'false');
  expect(zoteroFocusManagerExemptsArrowKeys(composer!)).toBe(true);
  composer!.setAttribute('contenteditable', 'true');
  expect(zoteroFocusManagerExemptsArrowKeys(composer!)).toBe(true);

  // An identical control outside our dock is not exempt, proving the attribute on our subtree is
  // what makes the difference rather than the element type.
  const stray = doc.createElement('textarea');
  doc.getElementById('split-view')!.append(stray);
  expect(zoteroFocusManagerExemptsArrowKeys(stray)).toBe(false);

  teardown();
});

it('keeps the FocusManager exemption across dock reuse and drops the dock on unmount', async () => {
  const { doc, mounted, root, teardown } = await mountDockWithChat();
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;

  const reused = mountReaderDock(doc)!;
  expect(reused.dock).toBe(mounted.dock);
  expect(reused.body).toBe(mounted.body);
  expect(reused.dock.getAttribute('contenteditable')).toBe('false');
  expect(zoteroFocusManagerExemptsArrowKeys(composer)).toBe(true);

  unmountReaderDock(doc);
  expect(doc.querySelector('[data-zcr-dock]')).toBeNull();
  expect(doc.getElementById('split-view')?.contains(composer)).toBe(false);

  teardown();
});
