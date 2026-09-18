import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter } from '../../../packages/zotero/src/chat/presenter.ts';
import { mountChatView } from '../../../packages/zotero/src/chat/view.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Conversation, type ShareableDiagnostics } from '../../../packages/contracts/src/index.ts';
import { citationA, paperA, settings } from '../../contracts/factories.ts';
import { presenterContext } from '../presenter-context.ts';

it('keeps shareable diagnostics off the default sidebar; presenter still copies whitelist JSON', async () => {
  const report: ShareableDiagnostics = {
    pluginVersion: '0.3.0-alpha.1',
    runtimeVersion: '0.144.1',
    errorCode: 'RATE_LIMITED' as const,
    requestCount: 1,
    states: { failed: 1 },
    storageLocation: SHAREABLE_STORAGE_LOCATION,
  };
  const conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: citationA.text, citations: [citationA], status: 'completed' }],
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
    diagnostics: vi.fn(() => Promise.resolve(report)),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const doc = new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
  const root = doc.createElement('div');
  mountChatView(root, presenter);
  expect(root.querySelector('[data-zchatgpt-action="copy-diagnostics"]')).toBeNull();
  const text = await presenter.copyDiagnostics();
  expect(JSON.parse(text!)).toEqual(report);
  expect(text).not.toContain(citationA.text);
  expect(presenter.snapshot().message).toContain('do not include paper text');
});
