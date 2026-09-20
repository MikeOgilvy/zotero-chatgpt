import { expect, it, vi } from 'vitest';
import type { ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, paperId, type Conversation, type PaperScope } from '../../../packages/contracts/src/index.ts';
import type { ReaderWorkspace } from '../../../packages/contracts/src/workspace.ts';
import { ConversationStore } from '../../../packages/core/src/sessions/store.ts';
import { HistoryManager } from '../../../packages/core/src/workspace/history.ts';
import { WorkspaceStore } from '../../../packages/core/src/workspace/store.ts';
import { ConversationPresenter } from '../../../packages/zotero/src/chat/presenter.ts';
import { paperA, settings } from '../../contracts/factories.ts';
import { MemoryStorage } from '../../core/doubles.ts';
import { presenterContext } from '../presenter-context.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const model = { id: 'catalog-default', displayName: 'Catalog Default', isDefault: true, supportedReasoningEfforts: [{ id: 'medium', description: '' }], defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }], defaultServiceTier: 'priority' };
const runtime: RuntimeSnapshot = { revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null };

function uniqueClock() {
  let id = 0;
  return { now: () => NOW, uuid: () => `12345678-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}` };
}

/**
 * One real local store, read by both views through the same interface the plugin uses: the
 * Preferences pane deletes through `HistoryManager(workspace)` and the sidebar through the
 * presenter, which is subscribed to the store's own removal notification. Nothing here shares a
 * hand-built array between two mocks.
 */
async function fixture() {
  const storage = new MemoryStorage();
  const clock = uniqueClock();
  const conversations = new ConversationStore(storage, clock);
  const store = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  const seed = async (paper: PaperScope, title: string, text: string): Promise<Conversation> => {
    const created = await conversations.create(paper, title, settings);
    created.messages.push({ id: `${created.id}-m1`, requestId: `${created.id}-r1`, role: 'user', phase: null, settings, text, citations: [], status: 'completed' });
    await conversations.save(created);
    return created;
  };
  const first = await seed(paperA, 'First chat', 'first question');
  const second = await seed(paperA, 'Second chat', 'second question');

  // A resolved gate the test controls, used to hold one history read open across a removal.
  let releaseHold: (() => void) | null = null;
  let delayNext = false;
  const workspace: ReaderWorkspace = Object.create(store) as ReaderWorkspace;
  workspace.history = (query = '', scope) => {
    if (delayNext) {
      delayNext = false;
      const gate = new Promise<void>(resolve => { releaseHold = resolve; });
      return gate.then(() => store.history(query, scope));
    }
    return store.history(query, scope);
  };

  let storeReads = 0;
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime),
    observe: listener => { listener(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error('no')), cancelLogin: async () => {},
    current: () => Promise.reject(new Error('unused')),
    peekCurrent: async paper => await store.currentConversation(paper),
    newConversation: () => Promise.reject(new Error('unused')),
    list: async paper => {
      storeReads += 1;
      const entries = (await store.history()).filter(entry => paperId(entry.paper) === paperId(paper));
      return Promise.all(entries.map(entry => store.readConversation(entry.id)));
    },
    get: id => store.readConversation(id),
    select: (_paper, id) => store.readConversation(id),
    send: () => Promise.reject(new Error('unused')),
    request: () => Promise.reject(new Error('unused')),
    cancel: () => Promise.reject(new Error('unused')),
    deleteConversation: async (paper, id) => { await store.removeConversation(paper, id); return store.currentConversation(paper); },
    diagnostics: () => Promise.resolve({ pluginVersion: 'test', runtimeVersion: 'test', errorCode: null, requestCount: 0, states: {}, storageLocation: SHAREABLE_STORAGE_LOCATION }),
    subscribe: () => () => undefined,
    close: async () => {},
  };

  let ids = 0;
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Synthetic Paper A'), {
    client: () => Promise.resolve(client), ensureAgent: () => Promise.resolve(), chatUnavailableReason: () => null,
    openAuthorization: () => undefined, uuid: () => `9a1c3e5f-7b2d-4c6e-8f0a-${String(++ids).padStart(12, '0')}`,
    now: () => NOW, getWorkspace: () => Promise.resolve(workspace),
  });
  return {
    storage, store, workspace, presenter, client, first, second,
    delayNextHistory: () => { delayNext = true; },
    releaseStale: () => { releaseHold?.(); releaseHold = null; },
    storeReads: () => storeReads,
  };
}

const historyIds = (presenter: ConversationPresenter) => presenter.snapshot().history.map(entry => entry.id);

it('drops a chat deleted from the Preferences pane without a refresh, a mode switch or a restart', async () => {
  const { presenter, store, first, second } = await fixture();
  await presenter.activate();
  expect(historyIds(presenter).sort()).toEqual([first.id, second.id].sort());
  // The Preferences pane goes through its own manager over the same store, exactly like production.
  const report = await new HistoryManager(store).removeByIds([second.id]);
  expect(report.changed).toEqual([second.id]);
  await vi.waitFor(() => expect(historyIds(presenter)).toEqual([first.id]));
  // The presenter never issued a manual refresh; the store's committed change is what updated it.
  expect((await store.history()).map(entry => entry.id)).toEqual([first.id]);
});

it('keeps a removed row out even when an older list read lands after the removal', async () => {
  const { presenter, store, first, second, delayNextHistory, releaseStale } = await fixture();
  await presenter.activate();
  await vi.waitFor(() => expect(historyIds(presenter).sort()).toEqual([first.id, second.id].sort()));
  // A slow read that started before the removal is still in flight when the delete commits.
  delayNextHistory();
  const inFlight = presenter.searchHistory('');
  await new HistoryManager(store).removeByIds([second.id]);
  await vi.waitFor(() => expect(historyIds(presenter)).not.toContain(second.id));
  // The stale answer carries the removed row; the presenter's generation check must discard it.
  releaseStale();
  await inFlight;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(historyIds(presenter)).toEqual([first.id]);
  expect(historyIds(presenter)).not.toContain(second.id);
});

it('enters the unbound session and drops the draft when the active chat is deleted elsewhere', async () => {
  const { presenter, store, storage, second } = await fixture();
  await presenter.activate();
  // The current chat is the last created one; the owner has an unsent question in it.
  expect(presenter.snapshot().conversation?.id).toBe(second.id);
  presenter.setQuestion('an unsent question for the deleted chat');
  expect(presenter.snapshot().draft.question).toBe('an unsent question for the deleted chat');
  await new HistoryManager(store).removeByIds([second.id]);
  await vi.waitFor(() => expect(presenter.snapshot().conversation).toBeNull());
  // Deleting the last chat leaves the reader in its new-chat state, not in a recreated record.
  expect(presenter.snapshot().draft.question).toBe('');
  await presenter.flushDraft();
  const draftForRemoved = [...storage.files.keys()].filter(path => path.startsWith('workspace/drafts/') && path.includes(second.id));
  expect(draftForRemoved).toEqual([]);
  expect((await store.history()).map(entry => entry.id)).not.toContain(second.id);
});

it('leaves the open chat, its mode and its draft alone when another chat is deleted', async () => {
  const { presenter, store, first, second } = await fixture();
  await presenter.activate();
  presenter.setQuestion('draft for the open chat');
  presenter.setMode('agent');
  const openBefore = presenter.snapshot().conversation?.id;
  await new HistoryManager(store).removeByIds([first.id]);
  await vi.waitFor(() => expect(historyIds(presenter)).not.toContain(first.id));
  expect(presenter.snapshot().conversation?.id).toBe(openBefore);
  expect(openBefore).toBe(second.id);
  expect(presenter.snapshot().mode).toBe('agent');
  expect(presenter.snapshot().draft.question).toBe('draft for the open chat');
});

it('refuses a stale save of the chat the Preferences pane removed, so it cannot come back', async () => {
  const { presenter, store, storage, second } = await fixture();
  await presenter.activate();
  // A store copy the sidebar still holds, exactly like the running service's in-memory record.
  const stale = await store.readConversation(second.id);
  await new HistoryManager(store).removeByIds([second.id]);
  await vi.waitFor(() => expect(historyIds(presenter)).not.toContain(second.id));
  const store2 = new ConversationStore(storage, uniqueClock());
  // Reading through a fresh store never resurrects the file, and history stays without the row.
  await expect(store2.get(second.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(stale.id).toBe(second.id);
  expect((await store.history()).map(entry => entry.id)).not.toContain(second.id);
});

it('unsubscribes on dispose so a later removal cannot touch a destroyed view', async () => {
  const { presenter, store, first, second } = await fixture();
  await presenter.activate();
  presenter.dispose();
  const before = historyIds(presenter);
  // The removal still commits; the disposed presenter simply is not its consumer any more.
  await new HistoryManager(store).removeByIds([second.id]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(historyIds(presenter)).toEqual(before);
  expect((await store.history()).map(entry => entry.id)).toEqual([first.id]);
});

it('reports a failed removal without pretending the row is gone', async () => {
  const { presenter, store, storage, second } = await fixture();
  await presenter.activate();
  storage.fail = true;
  const report = await new HistoryManager(store).removeByIds([second.id]);
  expect(report.changed).toEqual([]);
  storage.fail = false;
  // Nothing was published, so the row the owner is still looking at is still real.
  expect(historyIds(presenter)).toContain(second.id);
  expect((await store.history()).map(entry => entry.id)).toContain(second.id);
});
