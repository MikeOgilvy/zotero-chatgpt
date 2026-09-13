/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { describe, expect, it, vi } from 'vitest';
import { ConversationPresenter, type PresenterState } from '../../packages/zotero/src/chat/presenter.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../packages/contracts/src/runtime.ts';
import { ReaderError, SHAREABLE_STORAGE_LOCATION, type Conversation, type ReaderEvent, type SendInput, type ShareableDiagnostics } from '../../packages/contracts/src/index.ts';
import { citationA, citationB, imageA, paperA, settings } from '../contracts/factories.ts';
import { documentA } from '../contracts/document-fixture.ts';
const model = { id: 'catalog-default', displayName: 'Catalog Default', isDefault: true, supportedReasoningEfforts: [{ id: 'medium', description: '' }, { id: 'high', description: '' }], defaultReasoningEffort: 'medium', serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }, { id: 'flex', name: 'Flex', description: '' }], defaultServiceTier: 'priority' };
const other = { id: 'other-model', displayName: 'Other Model', isDefault: false, supportedReasoningEfforts: [{ id: 'low', description: '' }], defaultReasoningEffort: 'low', serviceTiers: [] as Array<{ id: string; name: string; description: string }>, defaultServiceTier: null };
function fixture(options: { signedIn?: boolean } = {}) {
  let runtime: RuntimeSnapshot = { revision: 0, runtime: 'ready', account: { state: options.signedIn === false ? 'signedOut' : 'signedIn' }, login: null, models: options.signedIn === false ? [] : [model], error: null };
  const observers = new Set<(s: RuntimeSnapshot) => void>(); const listeners = new Set<(e: ReaderEvent) => void>();
  let conversation: Conversation = { id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings, activeRequestId: null, messages: [], lastSeq: 0, createdAt: 'now', updatedAt: 'now' };
  const conversations = [conversation];
  const sent: SendInput[] = []; const cancelled: string[] = []; let seq = 0;
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { observers.add(l); l(structuredClone(runtime)); return () => { observers.delete(l); }; },
    refreshAccount: async () => {}, startLogin: vi.fn(() => Promise.resolve({ loginId: 'login-1', authorizationUrl: 'https://auth.openai.com/authorize?x=1' })), cancelLogin: async () => {},
    current: vi.fn(() => Promise.resolve(structuredClone(conversation))), newConversation: vi.fn(() => {
      conversation = { ...conversation, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], lastSeq: 0 };
      conversations.push(conversation);
      return Promise.resolve(structuredClone(conversation));
    }),
    list: () => Promise.resolve(conversations.map(c => structuredClone(c))),
    select: vi.fn((_paper, id: string) => {
      const found = conversations.find(entry => entry.id === id);
      if (!found) return Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation'));
      conversation = found;
      return Promise.resolve(structuredClone(found));
    }),
    get: vi.fn(() => Promise.resolve(structuredClone(conversation))),
    send: vi.fn((input: SendInput) => { sent.push(input); conversation = { ...conversation, settings: input.settings, activeRequestId: input.requestId, messages: [...conversation.messages, { id: `u-${sent.length}`, requestId: input.requestId, role: 'user', phase: null, settings: input.settings, text: input.question, citations: input.citations, status: 'completed' }], lastSeq: ++seq }; return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false }); }),
    request: (_c, requestId) => {
      const message = conversation.messages.find(entry => entry.requestId === requestId);
      const state = message?.status === 'uncertain' ? 'uncertain' as const : message?.status === 'completed' ? 'completed' as const : 'running' as const;
      return Promise.resolve({ requestId, state, replay: false });
    }, cancel: vi.fn((_c: string, requestId: string) => { cancelled.push(requestId); return Promise.resolve({ requestId, state: 'running' as const, replay: false }); }),
    deleteConversation: vi.fn((_paper, id: string) => {
      const index = conversations.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new ReaderError('NOT_FOUND', 'Unknown conversation'));
      conversations.splice(index, 1);
      if (conversation.id === id) {
        conversation = conversations[0] ?? { ...conversation, id: 'bbbbbbbb-0000-4000-8000-000000000003', title: 'Synthetic Paper A', messages: [], lastSeq: 0, activeRequestId: null };
        if (!conversations.some(entry => entry.id === conversation.id)) conversations.push(conversation);
      }
      return Promise.resolve(structuredClone(conversation));
    }),
    diagnostics: vi.fn((): Promise<ShareableDiagnostics> => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: l => { listeners.add(l); return () => { listeners.delete(l); }; }, close: async () => {},
  };
  const states: PresenterState[] = [];
  const services = { ensureStarted: vi.fn(() => Promise.resolve(client)), openAuthorization: vi.fn(), uuid: (() => { let n = 0; return () => `9a1c3e5f-7b2d-4c6e-8f0a-${String(++n).padStart(12, '0')}`; })(), now: () => '2026-09-09T08:00:00.000Z' };
  const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', services);
  const unbind = presenter.bind(state => states.push(state));
  type Pending = ReaderEvent extends infer E ? E extends ReaderEvent ? Omit<E, 'seq' | 'conversationId' | 'at'> : never : never;
  const emit = (event: Pending) => { const full: ReaderEvent = { ...event, seq: ++seq, conversationId: conversation.id, at: 'now' }; conversation = { ...conversation, lastSeq: seq, ...(['completed', 'cancelled', 'failed', 'uncertain'].includes(event.type) ? { activeRequestId: null } : {}) }; for (const l of listeners) l(full); };
  const setRuntime = (patch: Partial<RuntimeSnapshot>) => { runtime = { ...runtime, ...patch, revision: runtime.revision + 1 }; for (const o of observers) o(structuredClone(runtime)); };
  return { presenter, states, sent, cancelled, client, services, emit, setRuntime, listeners, unbind, last: () => states.at(-1)!, conversation: () => conversation, setConversation: (c: Conversation) => {
    conversation = c;
    const index = conversations.findIndex(entry => entry.id === c.id);
    if (index >= 0) conversations[index] = c; else conversations.push(c);
  } };
}
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 5));
describe('conversation presenter', () => {
  it('keeps two views of the same attachment consistent when either view closes', async () => {
    const f = fixture(); await f.presenter.activate();
    let first = ''; let second = '';
    const unbindFirst = f.presenter.bind(s => { first = s.draft.question; });
    const unbindSecond = f.presenter.bind(s => { second = s.draft.question; });
    f.presenter.setQuestion('Both windows'); expect(first).toBe('Both windows'); expect(second).toBe('Both windows');
    unbindFirst(); f.presenter.setQuestion('Second window'); expect(second).toBe('Second window'); expect(first).toBe('Both windows'); unbindSecond();
  });
  it('freezes the question, settings and conversation while PDF preparation is pending, and keeps newer input', async () => {
    const f = fixture(); let resolve!: (value: typeof documentA) => void;
    const prepare = () => new Promise<typeof documentA>(r => { resolve = r; });
    const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', { ...f.services, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
    await presenter.activate(); presenter.setQuestion('Explain x');
    const pending = presenter.send(); await settle();
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().generating).toBe(true);
    presenter.setQuestion('Next question'); presenter.setSettings({ ...settings, effort: 'high' });
    resolve(documentA); await pending;
    expect(f.sent[0]).toMatchObject({ question: 'Explain x', settings, document: documentA });
    expect(presenter.snapshot().draft.question).toBe('Next question');
  });
  it('cancels PDF preparation without sending and preserves the question', async () => {
    const f = fixture();
    const presenter = new ConversationPresenter(paperA, 'A', { ...f.services, document: {
      prepare: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Preparation cancelled.')), { once: true })),
      validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate(); presenter.setQuestion('Keep this');
    const pending = presenter.send(); await settle(); await presenter.cancel(); await pending;
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().draft.question).toBe('Keep this');
    expect(presenter.snapshot().message).toMatch(/cancelled/iu);
  });
  it('prepares the current PDF locally on activation without creating a model request', async () => {
    const f = fixture();
    const prepare = vi.fn(() => Promise.resolve(documentA)); const validate = vi.fn(async () => {});
    const presenter = new ConversationPresenter(paperA, 'A', { ...f.services, document: { prepare, validate, readEnabled: () => true, writeEnabled: () => {} } });
    await presenter.activate();
    await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
    expect(prepare).toHaveBeenCalledTimes(1); expect(validate).toHaveBeenCalledTimes(1);
    expect(presenter.snapshot().document.prepared).toEqual(documentA);
    expect(f.sent).toHaveLength(0);
  });
  it('keeps PDF failures visible and never sends a bibliographic-only substitute', async () => {
    const f = fixture(); const presenter = new ConversationPresenter(paperA, 'A', { ...f.services, document: {
      prepare: () => Promise.reject(new Error('PDF unavailable.')), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {},
    } });
    await presenter.activate(); presenter.setQuestion('Keep this'); await presenter.send();
    expect(f.sent).toHaveLength(0); expect(presenter.snapshot().draft.question).toBe('Keep this'); expect(presenter.snapshot().message).toContain('PDF unavailable');
  });
  it('honors automatic-context opt-out changed by another view before sending', async () => {
    const f = fixture(); let enabled = true;
    const presenter = new ConversationPresenter(paperA, 'A', { ...f.services, document: {
      prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => enabled, writeEnabled: value => { enabled = value; },
    } });
    await presenter.activate(); enabled = false; presenter.setQuestion('Explicit selection only'); await presenter.send();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]?.document).toBeUndefined();
  });
  it('new conversation starts with an empty draft and restores the old draft when selected again', async () => {
    const f = fixture(); await f.presenter.activate();
    const original = f.conversation().id;
    f.presenter.setQuestion('Original draft'); f.presenter.addCitation(citationA);
    await f.presenter.newConversation();
    expect(f.last().draft.question).toBe('');
    expect(f.last().draft.citations).toEqual([]);
    await f.presenter.openConversation(original);
    expect(f.last().draft.question).toBe('Original draft');
    expect(f.last().draft.citations).toEqual([citationA]);
  });
  it('activates the attachment conversation and renders history without sending anything', async () => {
    const f = fixture(); f.setConversation({ ...f.conversation(), messages: [{ id: 'm1', requestId: 'r0', role: 'assistant', phase: 'final', settings, text: '旧回答', citations: [], status: 'completed' }], lastSeq: 4 });
    await f.presenter.activate();
    expect(f.last().conversation?.messages[0]?.text).toBe('旧回答'); expect(f.sent).toHaveLength(0); expect(f.client.current).toHaveBeenCalledTimes(1);
    expect(f.last().draft.settings).toEqual(settings);
  });
  it('Ask only adds a deduplicated removable citation to the draft; sending creates one ask request and clears the draft', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.addCitation(citationA); f.presenter.addCitation({ ...citationA }); f.presenter.addCitation({ ...citationA, id: '7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d99', text: '另一段' });
    expect(f.last().draft.citations).toHaveLength(2); expect(f.sent).toHaveLength(0);
    f.presenter.removeCitation('7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d99'); expect(f.last().draft.citations).toHaveLength(1);
    f.presenter.setQuestion('   '); await f.presenter.send(); expect(f.sent).toHaveLength(0); expect(f.last().message).toBeTruthy();
    f.presenter.setQuestion('这里的先验指什么？'); await f.presenter.send();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'ask', question: '这里的先验指什么？', citations: [citationA], settings, conversationId: f.conversation().id });
    expect(f.last().draft.question).toBe(''); expect(f.last().draft.citations).toHaveLength(0);
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ role: 'user', text: '这里的先验指什么？' });
  });
  it('keeps pending images on the draft and sends them as an ask image part', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.addImage(imageA);
    f.presenter.addImage({ ...imageA });
    expect(f.last().draft.images).toHaveLength(1);
    f.presenter.removeImage(imageA.id);
    expect(f.last().draft.images).toHaveLength(0);
    f.presenter.addImage(imageA);
    f.presenter.setQuestion('图里的符号是什么？');
    await f.presenter.send();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ action: 'ask', question: '图里的符号是什么？', images: [imageA] });
    expect(f.last().draft.images).toHaveLength(0);
    expect(f.last().draft.question).toBe('');
  });
  it('More details submits exactly one explain request with the default question and keeps the draft', async () => {
    const f = fixture(); await f.presenter.activate(); f.presenter.setQuestion('草稿中的问题'); f.presenter.addCitation(citationB);
    await Promise.all([f.presenter.explain(citationA), f.presenter.explain(citationA)]);
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'explain', citations: [citationA] });
    expect(f.sent[0]!.question).toBe('tell me more about this');
    expect(f.sent[0]!.question).not.toMatch(/请用中文解释/u);
    expect(f.last().draft.question).toBe('草稿中的问题'); expect(f.last().draft.citations).toEqual([citationB]);
  });
  it('attaches bibliographic paper identity on ask even without a citation', async () => {
    const f = fixture(); await f.presenter.activate();
    f.presenter.setQuestion('这篇在讲什么方向？');
    await f.presenter.send();
    expect(f.sent[0]).toMatchObject({
      action: 'ask', question: '这篇在讲什么方向？', citations: [],
      paper: { title: 'Synthetic Paper A' },
    });
    expect(f.sent[0]!.paper?.title).toBeTruthy();
  });
  it('deletes a completed conversation and falls back without issuing a cancellation', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    await f.presenter.newConversation();
    const secondId = f.last().conversation!.id;
    f.presenter.setQuestion('第二问'); await f.presenter.send();
    expect(f.last().generating).toBe(true);
    f.emit({ type: 'completed', requestId: f.sent[0]!.requestId, messageId: 'reply', finalText: 'done' });
    await f.presenter.deleteConversation(secondId);
    expect(f.client.deleteConversation).toHaveBeenCalledWith(paperA, secondId);
    expect(f.cancelled).toEqual([]);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().conversations.map(c => c.id)).not.toContain(secondId);
  });
  it('applies streamed events after the snapshot by seq, ignores other conversations and shows terminal states', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '先验' }); f.emit({ type: 'delta', requestId, messageId: 'a1', text: '是' });
    for (const l of f.listeners) l({ type: 'delta', requestId, messageId: 'zzz', text: 'B 的内容', seq: 99, conversationId: 'other-conversation', at: 'now' });
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ id: 'a1', role: 'assistant', text: '先验是', status: 'streaming' });
    expect(JSON.stringify(f.last().conversation)).not.toContain('B 的内容');
    f.emit({ type: 'messageCompleted', requestId, messageId: 'a1', finalText: '先验是初始信念。', phase: 'final' });
    f.emit({ type: 'completed', requestId, messageId: 'a1', finalText: '先验是初始信念。' });
    expect(f.last().conversation?.messages.at(-1)).toMatchObject({ text: '先验是初始信念。', status: 'completed', phase: 'final' }); expect(f.last().conversation?.activeRequestId).toBeNull(); expect(f.last().generating).toBe(false);
    await f.presenter.explain(citationA); const second = f.sent[1]!.requestId;
    f.emit({ type: 'failed', requestId: second, code: 'RATE_LIMITED', message: 'The ChatGPT usage limit for this account has been reached.' });
    expect(f.last().message).toContain('usage limit'); expect(f.last().generating).toBe(false);
  });
  it('rebinding a view replays from a fresh snapshot without duplicating increments', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '第一段' });
    f.unbind();
    // While no view is bound the service keeps generating and its snapshot advances.
    f.setConversation({ ...f.conversation(), messages: [...f.conversation().messages, { id: 'a1', requestId, role: 'assistant', phase: null, settings, text: '第一段第二段', citations: [], status: 'streaming' }] });
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s)); await settle();
    f.emit({ type: 'delta', requestId, messageId: 'a1', text: '第三段' });
    expect(states.at(-1)?.conversation?.messages.at(-1)?.text).toBe('第一段第二段第三段');
    expect(states.at(-1)?.draft).toBeTruthy();
  });
  it('while remount waits for get(), only events newer than that snapshot are applied', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); const requestId = f.sent[0]!.requestId;
    const snapshotLastSeq = 7;
    const snapshot = {
      ...f.conversation(), lastSeq: snapshotLastSeq,
      messages: [...f.conversation().messages, { id: 'a1', requestId, role: 'assistant' as const, phase: null, settings, text: '已在快照', citations: [], status: 'streaming' as const }],
    };
    let resolveGet!: (value: Conversation) => void;
    const pendingGet = new Promise<Conversation>(resolve => { resolveGet = resolve; });
    (f.client.get as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingGet);
    f.unbind();
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s));
    await Promise.resolve();
    for (const listener of f.listeners) {
      listener({ type: 'delta', requestId, messageId: 'a1', text: '重复', seq: snapshotLastSeq, conversationId: snapshot.id, at: 'now' });
      listener({ type: 'delta', requestId, messageId: 'a1', text: '新增量', seq: snapshotLastSeq + 1, conversationId: snapshot.id, at: 'now' });
    }
    resolveGet(structuredClone(snapshot));
    await settle();
    expect(states.at(-1)?.conversation?.messages.at(-1)?.text).toBe('已在快照新增量');
    expect(states.at(-1)?.conversation?.lastSeq).toBe(snapshotLastSeq + 1);
  });
  it('stop asks the service to cancel the active request and only the terminal event ends the generating state', async () => {
    const f = fixture(); await f.presenter.activate(); await f.presenter.explain(citationA); expect(f.last().generating).toBe(true);
    await f.presenter.cancel(); expect(f.cancelled).toEqual([f.sent[0]!.requestId]); expect(f.last().generating).toBe(true);
    f.emit({ type: 'cancelled', requestId: f.sent[0]!.requestId, messageId: null }); expect(f.last().generating).toBe(false);
  });
  it('when signed out, More details keeps the citation, opens the official login and resumes that single explain after login', async () => {
    const f = fixture({ signedIn: false }); await f.presenter.activate();
    expect(f.last().conversation).toBeNull(); expect(f.client.current).not.toHaveBeenCalled();
    await f.presenter.explain(citationA);
    expect(f.sent).toHaveLength(0); expect(f.services.openAuthorization).toHaveBeenCalledWith('https://auth.openai.com/authorize?x=1'); expect(f.last().pendingExplain?.id).toBe(citationA.id);
    f.setRuntime({ account: { state: 'signedIn', displayLabel: 'ChatGPT' }, models: [model] }); await settle();
    f.setRuntime({ revision: 99 }); await settle();
    expect(f.sent).toHaveLength(1); expect(f.sent[0]).toMatchObject({ action: 'explain', citations: [citationA] }); expect(f.last().pendingExplain).toBeNull();
  });
  it('Ask while signed out stores the citation and waits for the user even after login', async () => {
    const f = fixture({ signedIn: false }); await f.presenter.activate(); f.presenter.addCitation(citationA);
    f.setRuntime({ account: { state: 'signedIn', displayLabel: 'ChatGPT' }, models: [model] }); await settle();
    expect(f.sent).toHaveLength(0); expect(f.last().draft.citations).toEqual([citationA]); expect(f.last().conversation).not.toBeNull();
  });
  it('surfaces business errors from send without losing the draft and lets the user start a new conversation', async () => {
    const f = fixture(); await f.presenter.activate();
    (f.client.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ReaderError('BUSY', 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.'));
    f.presenter.addCitation(citationA); f.presenter.setQuestion('问题'); await f.presenter.send();
    expect(f.last().message).toContain('new conversation'); expect(f.last().draft.question).toBe('问题'); expect(f.last().draft.citations).toEqual([citationA]);
    const original = f.last().conversation!.id;
    await f.presenter.newConversation(); expect(f.client.newConversation).toHaveBeenCalledTimes(1); expect(f.last().conversation?.id).toBe('aaaaaaaa-0000-4000-8000-000000000002'); expect(f.last().draft.citations).toEqual([]);
    await f.presenter.openConversation(original); expect(f.last().draft.citations).toEqual([citationA]); expect(f.last().draft.question).toBe('问题');
  });
  it('reports a runtime start failure and allows a deliberate retry', async () => {
    const f = fixture(); f.services.ensureStarted.mockRejectedValueOnce(new Error('Unable to prepare the bundled Codex runtime'));
    await f.presenter.activate(); expect(f.last().connection).toBe('error'); expect(f.last().message).toContain('Unable to prepare');
    await f.presenter.retry(); expect(f.last().connection).toBe('ready'); expect(f.last().conversation).not.toBeNull();
  });
  it('unbinding stops rendering but the presenter keeps its draft for the next view', async () => {
    const f = fixture(); await f.presenter.activate(); f.presenter.addCitation(citationA); const count = f.states.length;
    f.unbind(); f.presenter.setQuestion('later'); expect(f.states).toHaveLength(count);
    const states: PresenterState[] = []; f.presenter.bind(s => states.push(s)); expect(states[0]?.draft.question).toBe('later'); expect(states[0]?.draft.citations).toEqual([citationA]);
  });
  it('setSettings only changes the unsent draft; More details and Ask send that combo, not conversation.settings', async () => {
    const f = fixture(); await f.presenter.activate();
    f.setRuntime({ models: [model, other] });
    f.presenter.setSettings({ model: 'other-model', serviceTier: 'priority', effort: 'medium' });
    expect(f.last().draft.settings).toEqual({ model: 'other-model', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.settings).toEqual(settings); expect(f.sent).toHaveLength(0);
    await f.presenter.explain(citationA);
    expect(f.sent[0]?.settings).toEqual({ model: 'other-model', serviceTier: null, effort: 'low' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual({ model: 'other-model', serviceTier: null, effort: 'low' });
  });
  it('changing controls while generating leaves the in-flight snapshot alone and applies only to the next send', async () => {
    const f = fixture(); await f.presenter.activate();
    f.setRuntime({ models: [model, other] });
    f.presenter.setQuestion('第一问'); await f.presenter.send();
    const frozen = f.last().conversation!.messages[0]!.settings;
    expect(frozen).toEqual(settings); expect(f.last().generating).toBe(true);
    f.presenter.setSettings({ model: 'catalog-default', serviceTier: 'flex', effort: 'high' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual(frozen);
    expect(f.last().draft.settings).toEqual({ model: 'catalog-default', serviceTier: 'flex', effort: 'high' });
    f.emit({ type: 'completed', requestId: f.sent[0]!.requestId, messageId: 'a1', finalText: '答' });
    f.presenter.setQuestion('追问'); await f.presenter.send();
    expect(f.sent[1]?.settings).toEqual({ model: 'catalog-default', serviceTier: 'flex', effort: 'high' });
    expect(f.last().conversation?.messages[0]?.settings).toEqual(frozen);
    expect(f.client.newConversation).not.toHaveBeenCalled();
  });
  it('shows that an unreconciled conversation stays isolated until the user starts a new one', async () => {
    const f = fixture();
    const originalId = f.conversation().id;
    f.setConversation({
      ...f.conversation(),
      messages: [
        { id: 'u1', requestId: 'r-old', role: 'user', phase: null, settings, text: '解释这段', citations: [citationA], status: 'completed' },
        { id: 'a1', requestId: 'r-old', role: 'assistant', phase: null, settings, text: '', citations: [], status: 'uncertain' },
      ],
    });
    await f.presenter.activate();
    expect(f.last().message).toContain('new conversation');
    expect(f.last().generating).toBe(false);
    expect(f.last().conversation?.id).toBe(originalId);
    await f.presenter.newConversation();
    expect(f.last().conversation?.id).not.toBe(originalId);
    expect(f.last().message).toBeNull();
    expect(f.client.newConversation).toHaveBeenCalledTimes(1);
    await f.presenter.openConversation(originalId);
    expect(f.last().conversation?.id).toBe(originalId);
    expect(f.last().message).toContain('new conversation');
  });
  it('lists this attachment’s conversations and restores an independent draft when switching', async () => {
    const f = fixture(); await f.presenter.activate();
    const firstId = f.last().conversation!.id;
    f.presenter.addCitation(citationA); f.presenter.setQuestion('关于先验');
    await f.presenter.newConversation();
    const secondId = f.last().conversation!.id;
    expect(secondId).not.toBe(firstId);
    expect(f.last().draft.question).toBe('');
    expect(f.last().conversations.map(c => c.id)).toEqual([firstId, secondId]);
    f.presenter.setQuestion('新对话的问题'); f.presenter.removeCitation(citationA.id);
    await f.presenter.openConversation(firstId);
    expect(f.last().conversation?.id).toBe(firstId);
    expect(f.last().draft.question).toBe('关于先验');
    expect(f.last().draft.citations).toEqual([citationA]);
    await f.presenter.openConversation(secondId);
    expect(f.last().conversation?.id).toBe(secondId);
    expect(f.last().draft.question).toBe('新对话的问题');
    expect(f.last().draft.citations).toEqual([]);
  });
  it('copyDiagnostics serializes whitelist fields and never includes citation text', async () => {
    const f = fixture();
    const report: ShareableDiagnostics = {
      pluginVersion: '0.3.0-alpha.1',
      runtimeVersion: '0.144.1',
      errorCode: 'RATE_LIMITED' as const,
      requestCount: 2,
      states: { completed: 1, uncertain: 1 },
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    };
    f.client.diagnostics = vi.fn(() => Promise.resolve(report));
    f.setConversation({
      ...f.conversation(),
      messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: citationA.text, citations: [citationA], status: 'completed' }],
    });
    await f.presenter.activate();
    const text = await f.presenter.copyDiagnostics();
    expect(JSON.parse(text!)).toEqual(report);
    expect(text).not.toContain(citationA.text);
    expect(text).not.toMatch(/\/Users|token|private@/i);
    expect(f.last().message).toContain('do not include paper text');
    expect(f.client.diagnostics).toHaveBeenCalledWith(f.conversation().id);
  });
});
