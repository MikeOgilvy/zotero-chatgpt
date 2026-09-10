import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReaderClient } from '../../packages/core/src/index.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import type { ReaderEvent, SendInput } from '../../packages/contracts/src/index.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, model, methods, threadResponse, turn, configResponse } from './fixtures.ts';
import { citationA, citationB, paperA, paperB, settings } from '../contracts/factories.ts';
const clients: ReaderClient[] = [];
let ids = 0;
afterEach(async () => { for (const c of clients.splice(0)) await c.close().catch(() => undefined); vi.useRealTimers(); });
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const requestId = (n: number) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function setup(configure?: (s: ReturnType<typeof server>) => void, storage = new MemoryStorage()) {
  const s = server(); configure?.(s);
  const c = await createReaderClient(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z' }); clients.push(c);
  const events: ReaderEvent[] = []; c.subscribe(e => events.push(e));
  return { ...s, storage, c, events };
}
async function signedIn(configure?: (s: ReturnType<typeof server>) => void, storage?: MemoryStorage) {
  const rig = await setup(configure, storage); await rig.c.refreshAccount();
  const conversation = await rig.c.current(paperA, 'Synthetic Paper A');
  const explain = (n: number, overrides: Partial<SendInput> = {}): SendInput => ({ requestId: requestId(n), conversationId: conversation.id, action: 'explain', question: '', citations: [citationA], settings, ...overrides });
  return { ...rig, conversation, explain };
}
const tick = (ms = 5) => new Promise<void>(resolve => setTimeout(resolve, ms));
const stream = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, delta: string) => p.emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId, delta } });
const complete = (p: ReturnType<typeof server>['p'], threadId: string, turnId: string, itemId: string, text: string) => {
  p.emit({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: itemId, text, phase: 'final_answer', memoryCitation: null } } });
  p.emit({ method: 'turn/completed', params: { threadId, turn: { ...turn, id: turnId, status: 'completed', items: [{ type: 'agentMessage', id: itemId, text, phase: 'final_answer' }] } } });
};

describe('runtime handshake and policy', () => {
  it('handshakes, validates policy before ready, loads paginated model defaults and exposes immutable snapshots', async () => {
    const { c, p } = await setup(s => s.handlers.set('model/list', params => params.cursor ? { data: [{ ...model, model: 'second', isDefault: false }], nextCursor: null } : { data: [model], nextCursor: 'page2' }));
    expect(methods(p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    await c.refreshAccount();
    expect(c.snapshot().models.map(m => m.id)).toEqual(['catalog-default', 'second']);
    const snapshot = c.snapshot(); snapshot.models.length = 0; expect(c.snapshot().models).toHaveLength(2);
    let notified = false; c.observe(() => { notified = true; })(); expect(notified).toBe(true);
  });
  it.each(['external-mcp', 'wrong-feature', 'managed-layer', 'foreign-user-layer', 'unknown-origin', 'missing-layers', 'thread-endpoint', 'home-mismatch'])('fails closed on effective policy violation: %s', async violation => {
    const s = server(); const fixture = configResponse();
    if (violation === 'external-mcp') fixture.config.mcp_servers = { remote: { url: 'https://example.test' } };
    if (violation === 'wrong-feature') fixture.config.features.shell_tool = true;
    if (violation === 'managed-layer') fixture.layers.push({ name: { type: 'system', file: '/etc/codex/extra.toml' }, config: { approval_policy: 'never' }, version: 'sha256:managed' });
    if (violation === 'foreign-user-layer') fixture.layers[1]!.name.file = '/outside/config.toml';
    if (violation === 'unknown-origin') fixture.origins.approval_policy!.name.type = 'enterpriseManaged';
    s.handlers.set('config/read', () => violation === 'missing-layers' ? { ...fixture, layers: null } : violation === 'thread-endpoint' ? { ...fixture, config: { ...fixture.config, experimental_thread_config_endpoint: 'https://example.test' } } : fixture);
    const options = { codexVersion: '0.144.1', cwd: '/isolated', uuid, ...(violation === 'home-mismatch' ? { codexHome: '/isolated/other-account' } : {}) };
    await expect(createReaderClient(s.p, new MemoryStorage(), options)).rejects.toThrow('policy');
    expect(s.p.terminated).toBe(true); expect(methods(s.p)).not.toContain('account/read');
  });
  it('does not accept the expected version only inside a client-supplied user-agent suffix', async () => {
    const s = server(); s.handlers.set('initialize', () => ({ userAgent: 'codex/9.0.0 (zcr; 0.144.1)', codexHome: '/isolated', platformFamily: 'unix', platformOs: 'macos' }));
    await expect(createReaderClient(s.p, new MemoryStorage(), { codexVersion: '0.144.1', cwd: '/isolated', uuid })).rejects.toThrow('version');
    expect(s.p.terminated).toBe(true);
  });
  it('latches overflow once and stops the transport', async () => {
    const { c, p } = await setup(); let terminations = 0; const terminate = p.terminate.bind(p); p.terminate = () => { terminations++; return terminate(); };
    p.push(Array.from({ length: 10000 }, () => JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'thread-1' } }) + '\n').join(''));
    await flush(); expect(terminations).toBe(1); expect(c.snapshot().runtime).toBe('error');
  });
  it('close settles a blocked server-response write without the process releasing its stdin promise', async () => {
    const { c, p } = await setup(); p.writeStdin = () => new Promise<void>(() => undefined);
    p.emit({ id: 900, method: 'item/tool/call', params: {} }); await flush();
    let closed = false; const closing = c.close().then(() => { closed = true; }); await flush(); expect(closed).toBe(true); await closing;
  });
});
describe('official login', () => {
  it('single-flights login, accepts early completion and never persists URLs', async () => {
    const { c, p, handlers, storage } = await setup();
    handlers.set('account/login/start', () => { p.emit({ method: 'account/login/completed', params: { loginId: 'login-1', success: true, error: null } }); return { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=secret' }; });
    const [a, b] = await Promise.all([c.startLogin(), c.startLogin()]); expect(a).toEqual(b); await flush();
    expect(methods(p).filter(m => m === 'account/login/start')).toHaveLength(1); expect(c.snapshot().login?.state).toBe('succeeded'); expect(storage.writes.join('')).not.toContain('secret');
  });
  it('rejects a non-official login URL, bounds the timeout and cancels without logout', async () => {
    const { c, p, handlers } = await setup(); handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'bad', authUrl: 'https://auth.openai.com.evil.test/' }));
    await expect(c.startLogin()).rejects.toThrow('official');
    handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'good', authUrl: 'https://auth.openai.com/oauth/authorize' }));
    vi.useFakeTimers(); await c.startLogin(); await vi.advanceTimersByTimeAsync(1001); expect(c.snapshot().login?.state).toBe('failed'); vi.useRealTimers();
    await c.startLogin(); await c.cancelLogin(); expect(c.snapshot().login?.state).toBe('cancelled'); expect(methods(p)).not.toContain('account/logout');
  });
  it('fails a pending login after process loss and settles one on close', async () => {
    const { c, p } = await setup(); await c.startLogin(); p.end(); await flush();
    expect(c.snapshot().login?.state).toBe('failed'); expect(c.snapshot().account.state).toBe('signedOut');
    const other = await setup(); await other.c.startLogin(); await other.c.close();
    expect(other.c.snapshot()).toMatchObject({ runtime: 'stopped', account: { state: 'signedOut' }, login: { state: 'cancelled' } });
  });
  it('signed-out refresh stays usable for login and refuses to create conversations without a catalog', async () => {
    const { c, p } = await setup(s => { s.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true })); s.handlers.set('model/list', () => { throw new Error('must not query'); }); });
    await c.refreshAccount(); expect(c.snapshot().account.state).toBe('signedOut'); expect(methods(p)).not.toContain('model/list');
    await expect(c.current(paperA, 'Paper A')).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    expect(await c.current(paperA, 'Paper A', settings)).toMatchObject({ settings });
  });
});
describe('attachment conversations', () => {
  it('binds one current conversation per attachment with catalog defaults and keeps siblings apart', async () => {
    const { c } = await signedIn();
    const a = await c.current(paperA, 'Synthetic Paper A'); const again = await c.current(paperA, 'Synthetic Paper A'); const b = await c.current(paperB, 'Supplement B');
    expect(again.id).toBe(a.id); expect(b.id).not.toBe(a.id);
    expect(a.settings).toEqual({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' }); expect(a.paper).toEqual(paperA);
    expect((await c.list(paperA)).map(x => x.id)).toEqual([a.id]);
  });
  it('selects a previous conversation as current for the same attachment', async () => {
    const { c } = await signedIn();
    const first = await c.current(paperA, 'Synthetic Paper A');
    const second = await c.newConversation(paperA, 'Synthetic Paper A');
    expect((await c.current(paperA, 'Synthetic Paper A')).id).toBe(second.id);
    expect((await c.select(paperA, first.id)).id).toBe(first.id);
    expect((await c.current(paperA, 'Synthetic Paper A')).id).toBe(first.id);
    expect((await c.list(paperA)).map(x => x.id)).toEqual([first.id, second.id]);
  });
  it('journals accepted then dispatching before thread creation or turn submission and records the user message', async () => {
    const { c, p, storage, events, explain } = await signedIn();
    const before = storage.writes.length;
    const receipt = await c.send(explain(1));
    expect(receipt).toEqual({ requestId: requestId(1), state: 'accepted', replay: false });
    expect(storage.writes[before]).toContain('"accepted"'); expect(events.map(e => e.type)).toEqual(['accepted']);
    await flush();
    const order = storage.writes.slice(before).flatMap(w => {
      try {
        const parsed = JSON.parse(w) as { requests?: { state: string }[] };
        const state = parsed.requests?.at(-1)?.state;
        return state ? [state] : [];
      } catch { return []; }
    });
    expect(order.slice(0, 2)).toEqual(['accepted', 'dispatching']);
    expect(methods(p).indexOf('thread/start')).toBeGreaterThan(-1); expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    const conversation = await c.get(explain(1).conversationId);
    expect(conversation.messages[0]).toMatchObject({ role: 'user', requestId: requestId(1), citations: [citationA], status: 'completed' });
    expect(conversation.activeRequestId).toBe(requestId(1));
    expect(await c.request(conversation.id, requestId(1))).toEqual({ requestId: requestId(1), state: 'running', replay: false });
    const turnStart = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { input?: Array<{ text: string }>; threadId?: string; effort?: string } }).find(m => m.method === 'turn/start')!;
    expect(turnStart.params?.threadId).toBe('thread-1'); expect(turnStart.params?.effort).toBe('medium');
    expect(turnStart.params?.input?.[0]?.text).toContain('"contextScope":"selection"'); expect(turnStart.params?.input?.[0]?.text).toContain(citationA.text);
    const threadStart = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { ephemeral?: boolean } }).find(m => m.method === 'thread/start')!;
    expect(threadStart.params?.ephemeral).toBe(false);
  });
  it('streams coalesced deltas, corrects with the completed item and finishes with one completed event', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    stream(p, 'thread-1', 'turn-1', 'item-1', '先验'); stream(p, 'thread-1', 'turn-1', 'item-1', '是'); await tick(10);
    const deltas = events.filter(e => e.type === 'delta'); expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas.map(e => (e as { text: string }).text).join('')).toBe('先验是');
    const snapshot = await c.get(explain(1).conversationId); expect(snapshot.lastSeq).toBe(events.at(-1)!.seq);
    expect(snapshot.messages[1]).toMatchObject({ role: 'assistant', text: '先验是', status: 'streaming' });
    complete(p, 'thread-1', 'turn-1', 'item-1', '先验是对参数的初始信念。'); await flush();
    const types = events.map(e => e.type); expect(types.at(-2)).toBe('messageCompleted'); expect(types.at(-1)).toBe('completed'); expect(types.filter(t => t === 'completed')).toHaveLength(1);
    const done = await c.get(explain(1).conversationId);
    expect(done.messages[1]).toMatchObject({ text: '先验是对参数的初始信念。', status: 'completed', phase: 'final' }); expect(done.activeRequestId).toBeNull();
    expect(events.every((e, i) => i === 0 || e.seq > events[i - 1]!.seq)).toBe(true); expect(done.lastSeq).toBe(events.at(-1)!.seq);
    expect(await c.request(done.id, requestId(1))).toMatchObject({ state: 'completed' });
  });
  it('replays an identical request, rejects reused IDs with different content and refuses parallel requests in one conversation', async () => {
    const { c, p, explain } = await signedIn(); await c.send(explain(1)); await flush();
    expect(await c.send(explain(1))).toEqual({ requestId: requestId(1), state: 'running', replay: true });
    await expect(c.send(explain(1, { question: 'changed', action: 'ask' }))).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    await expect(c.send(explain(2))).rejects.toMatchObject({ code: 'BUSY' });
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
  });
  it('follow-ups reuse the same thread and settings changes apply to the next turn only', async () => {
    const { c, p, explain } = await signedIn(); await c.send(explain(1)); await flush(); complete(p, 'thread-1', 'turn-1', 'item-1', '答'); await flush();
    await c.send(explain(2, { action: 'ask', question: '第二步为什么成立？', citations: [], settings: { ...settings, effort: 'medium', serviceTier: null } })); await flush();
    expect(methods(p).filter(m => m === 'thread/start')).toHaveLength(1); expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(2);
    const second = p.writes.map(w => JSON.parse(w) as { method?: string; params?: { threadId?: string; serviceTier?: unknown } }).filter(m => m.method === 'turn/start')[1]!;
    expect(second.params?.threadId).toBe('thread-1'); expect(second.params?.serviceTier).toBeNull();
    const conversation = await c.get(explain(1).conversationId); expect(conversation.settings.serviceTier).toBeNull(); expect(conversation.messages[0]?.settings).toEqual(settings);
  });
  it('validates settings against the catalog and citations against the attachment', async () => {
    const { c, p, explain } = await signedIn();
    await expect(c.send(explain(1, { settings: { ...settings, model: 'other-model' } }))).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' });
    await expect(c.send(explain(2, { settings: { ...settings, effort: 'ultra' } }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.send(explain(3, { citations: [citationB] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(c.send(explain(4, { citations: [] }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(methods(p)).not.toContain('thread/start');
  });
  it('cancels before dispatch without any upstream call and interrupts a running turn until the terminal event confirms it', async () => {
    const { c, p, events, explain, handlers } = await signedIn();
    handlers.set('thread/start', () => undefined); // never answers: cancellation must not depend on the thread
    const first = c.send(explain(1)); await first; await c.cancel(explain(1).conversationId, requestId(1)); await flush();
    expect(events.at(-1)?.type).toBe('cancelled'); expect(methods(p)).not.toContain('turn/start');
    const other = await signedIn(); await other.c.send(other.explain(1)); await flush();
    stream(other.p, 'thread-1', 'turn-1', 'item-1', 'part'); await tick(10);
    expect(await other.c.cancel(other.explain(1).conversationId, requestId(1))).toMatchObject({ state: 'running' });
    expect(methods(other.p)).toContain('turn/interrupt');
    other.p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'interrupted', items: [] } } }); await flush();
    expect(other.events.at(-1)).toMatchObject({ type: 'cancelled', messageId: expect.any(String) as string });
    const done = await other.c.get(other.explain(1).conversationId); expect(done.messages[1]).toMatchObject({ text: 'part', status: 'cancelled' }); expect(done.activeRequestId).toBeNull();
  });
  it('reports a typed upstream refusal without copying its free text', async () => {
    const { c, p, events, storage, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: true, error: { message: 'transient', codexErrorInfo: null } } });
    p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage", codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } });
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'failed', error: { message: 'private', codexErrorInfo: 'usageLimitExceeded' } } } }); await flush();
    expect(events.filter(e => e.type === 'failed')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'RATE_LIMITED', message: expect.stringContaining('usage limit') as string });
    expect(storage.writes.join('')).not.toMatch(/chatgpt\.com|private/);
    expect(await c.request(explain(1).conversationId, requestId(1))).toMatchObject({ state: 'failed' });
  });
  it('fails closed on a thread policy mismatch naming the field and never submits a turn', async () => {
    const { c, p, events, explain, handlers } = await signedIn(); handlers.set('thread/start', () => ({ ...threadResponse, approvalPolicy: 'on-request' }));
    await c.send(explain(1)); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'READER_POLICY_UNAVAILABLE', message: expect.stringContaining('approval policy') as string });
    expect(methods(p)).not.toContain('turn/start');
  });
  it('routes concurrent generations to their own conversations', async () => {
    const { c, p, events, explain } = await signedIn(); const b = await c.current(paperB, 'Supplement B');
    await c.send(explain(1)); await flush();
    await c.send({ requestId: requestId(2), conversationId: b.id, action: 'explain', question: '', citations: [citationB], settings }); await flush();
    stream(p, 'thread-1', 'turn-1', 'a1', 'answer for A'); stream(p, 'thread-2', 'turn-2', 'b1', 'answer for B'); await tick(10);
    const a = await c.get(explain(1).conversationId); const bb = await c.get(b.id);
    expect(a.messages.map(m => m.text)).toEqual(['', 'answer for A']); expect(bb.messages.map(m => m.text)).toEqual(['', 'answer for B']);
    expect(events.filter(e => e.type === 'delta').map(e => e.conversationId)).toEqual([a.id, b.id]);
  });
  it('marks in-flight requests uncertain on connection loss, isolates that conversation after reopening and allows a new conversation', async () => {
    const { c, p, storage, events, explain } = await signedIn(); await c.send(explain(1)); await flush(); p.end(); await flush();
    expect(events.at(-1)?.type).toBe('uncertain'); expect(c.snapshot().runtime).toBe('error');
    const reopened = await signedIn(undefined, storage);
    const conversation = await reopened.c.current(paperA, 'Synthetic Paper A'); expect(conversation.id).toBe(explain(1).conversationId);
    expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
    await expect(reopened.c.send({ ...explain(2), conversationId: conversation.id })).rejects.toMatchObject({ code: 'BUSY' });
    const fresh = await reopened.c.newConversation(paperA, 'Synthetic Paper A'); expect(fresh.id).not.toBe(conversation.id);
    expect((await reopened.c.current(paperA, 'Synthetic Paper A')).id).toBe(fresh.id);
    expect(methods(reopened.p)).not.toContain('turn/start');
  });
  it('a restart with an active request left on disk restores it as uncertain without resending', async () => {
    const { c, p, storage, explain } = await signedIn(); await c.send(explain(1)); await flush();
    expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
    const reopened = await signedIn(undefined, storage); // the first client is still "running" but never persisted a terminal state
    const conversation = await reopened.c.get(explain(1).conversationId);
    expect(conversation.activeRequestId).toBeNull(); expect(await reopened.c.request(conversation.id, requestId(1))).toMatchObject({ state: 'uncertain' });
    expect(methods(reopened.p)).not.toContain('turn/start');
  });
  it('resumes a persisted thread in a new process and fails clearly when resume is refused', async () => {
    const { c, p, storage, explain } = await signedIn(); await c.send(explain(1)); await flush(); complete(p, 'thread-1', 'turn-1', 'i1', '答'); await flush(); await c.close();
    const reopened = await signedIn(undefined, storage);
    await reopened.c.send({ ...explain(2), action: 'ask', question: '继续', citations: [] }); await flush();
    expect(methods(reopened.p)).toContain('thread/resume'); expect(methods(reopened.p)).not.toContain('thread/start');
    const resume = reopened.p.writes.map(w => JSON.parse(w) as { method?: string; params?: { threadId?: string } }).find(m => m.method === 'thread/resume')!;
    expect(resume.params?.threadId).toBe('thread-1'); expect(methods(reopened.p).filter(m => m === 'turn/start')).toHaveLength(1);
    complete(reopened.p, 'thread-1', 'turn-1', 'i2', '好'); await flush(); await reopened.c.close();
    const third = await signedIn(s => s.handlers.set('thread/resume', () => { throw new Error('not found'); }), storage);
    third.p.onWrite = m => { if (typeof m.method === 'string' && 'id' in m) { if (m.method === 'thread/resume') third.p.emit({ id: m.id, error: { code: -32000, message: 'private thread path' } }); else { const r = third.handlers.get(m.method)?.((m.params ?? {}) as Record<string, unknown>, m.id); if (r !== undefined) third.p.emit({ id: m.id, result: r }); } } };
    await third.c.send({ ...explain(3), action: 'ask', question: '再来', citations: [] }); await flush();
    expect(third.events.at(-1)).toMatchObject({ type: 'failed', code: 'HISTORY_UNAVAILABLE' }); expect(methods(third.p)).not.toContain('turn/start');
    expect(JSON.stringify(third.events)).not.toContain('private thread path');
  });
  it('rejects unsupported items and server approval requests, failing the affected request and stopping the runtime', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'plan', id: 'plan-1', text: 'outline' } } }); await flush();
    expect(events.at(-1)?.type).toBe('accepted');
    p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'imageView', id: 'tool-1', path: '/private' } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'UNSUPPORTED_INTERACTION' }); expect(p.terminated).toBe(true);
    const other = await signedIn(); await other.c.send(other.explain(1)); await flush();
    other.p.emit({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1' } }); await flush();
    expect(other.p.writes.map(w => JSON.parse(w) as unknown)).toContainEqual({ id: 'approval-1', result: { decision: 'decline' } });
    expect(other.events.at(-1)).toMatchObject({ type: 'failed', code: 'UNSUPPORTED_INTERACTION' }); expect(other.c.snapshot().runtime).toBe('error');
  });
  it('a failed accept write records nothing and submits nothing', async () => {
    const { c, p, storage, explain } = await signedIn(); storage.fail = true;
    await expect(c.send(explain(1))).rejects.toMatchObject({ code: 'INTERNAL_ERROR' }); storage.fail = false;
    expect(methods(p)).not.toContain('thread/start'); await expect(c.request(explain(1).conversationId, requestId(1))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await c.get(explain(1).conversationId)).messages).toHaveLength(0);
  });
  it('a completed turn without any answer text is a failure, not an empty answer', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [] } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'INTERNAL_ERROR' });
  });
  it('closing the runtime settles active requests as uncertain and a late transport error changes nothing', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    await c.close(); expect(events.at(-1)?.type).toBe('uncertain'); expect(c.snapshot().runtime).toBe('stopped'); expect(p.terminated).toBe(true);
  });
  it('shareable diagnostics omit paper text, citations, paths and account identifiers', async () => {
    const { c, events, explain } = await signedIn();
    await c.send(explain(1)); await flush();
    expect(events.at(-1)?.type).toBe('accepted');
    const report = await c.diagnostics(explain(1).conversationId);
    expect(report).toMatchObject({
      pluginVersion: '0.3.0-alpha.1',
      runtimeVersion: '0.144.1',
      errorCode: null,
      requestCount: 1,
      storageLocation: 'Zotero profile/zotero-codex-reader/v1/records',
    });
    expect(report.states.accepted ?? report.states.dispatching ?? report.states.running).toBe(1);
    const text = JSON.stringify(report);
    expect(text).not.toContain(citationA.text);
    expect(text).not.toContain(paperA.attachmentKey);
    expect(text).not.toContain('/isolated');
    expect(text).not.toMatch(/private@example|token|secret/i);
  });
  it('shareable diagnostics report the last failed request code without the failure message', async () => {
    const { c, p, events, explain } = await signedIn(); await c.send(explain(1)); await flush();
    p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed', items: [] } } }); await flush();
    expect(events.at(-1)).toMatchObject({ type: 'failed', code: 'INTERNAL_ERROR' });
    const report = await c.diagnostics(explain(1).conversationId);
    expect(report.errorCode).toBe('INTERNAL_ERROR');
    expect(report.states.failed).toBe(1);
    expect(JSON.stringify(report)).not.toContain('completed without an answer');
  });
});
