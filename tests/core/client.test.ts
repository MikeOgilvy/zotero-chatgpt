import { afterEach, it, expect, vi } from 'vitest';
import { createS2Client } from '../../packages/core/src/index.ts';
import type { S2Client } from '../../packages/contracts/src/runtime.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, model, methods, threadResponse, turn, configResponse } from './fixtures.ts';
const clients: S2Client[] = [];
afterEach(async () => { for (const c of clients.splice(0)) await c.close(); vi.useRealTimers(); });
async function setup(configure?: (s: ReturnType<typeof server>) => void) {
  const s = server(); configure?.(s); const storage = new MemoryStorage();
  const c = await createS2Client(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid', loginTimeoutMs: 1000 }); clients.push(c); return { ...s, storage, c };
}
it('handshakes, loads paginated model defaults, and snapshots cannot mutate service state', async () => {
  const { c, p } = await setup(s => s.handlers.set('model/list', params => params.cursor ? { data: [{ ...model, model: 'second', isDefault: false }], nextCursor: null } : { data: [model], nextCursor: 'page2' }));
  await c.refreshAccount(); expect(methods(p).slice(0, 2)).toEqual(['initialize', 'initialized']);
  expect(c.snapshot().models.map(m => m.id)).toEqual(['catalog-default', 'second']);
  expect(c.snapshot().models[0]).toMatchObject({ defaultServiceTier: 'priority', defaultReasoningEffort: 'medium' });
  const snapshot = c.snapshot(); snapshot.models.length = 0; expect(c.snapshot().models).toHaveLength(2);
  let notified = false; c.subscribe(() => { notified = true; })(); expect(notified).toBe(true);
});
it('writes accepted and dispatching before network submission and dedupes while globally busy', async () => {
  const { c, p, handlers, storage } = await setup(); await c.refreshAccount();
  handlers.set('turn/start', () => { expect(storage.writes.at(-1)).toContain('dispatching'); return { turn }; });
  await Promise.all([c.runSynthetic('r1'), c.runSynthetic('r1')]);
  expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1); expect(c.snapshot().request?.state).toBe('running');
  await expect(c.runSynthetic('r2')).rejects.toThrow('busy');
  expect(storage.writes.join('')).not.toMatch(/private@example|authUrl|secret/);
});
it('corrects completed item text and distinguishes interrupted from completed, ignoring retry notices', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'i1', delta: 'partial' } });
  p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', error: { message: 'private-error', codexErrorInfo: null, additionalDetails: null }, willRetry: true } });
  p.emit({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', id: 'i1', text: 'corrected', phase: 'final_answer', memoryCitation: null } } });
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'interrupted' } } });
  await flush(); expect(c.snapshot().request).toMatchObject({ output: 'corrected', state: 'cancelled' });
});
it('keeps early notices before turn/start response and cancellation before turn ID', async () => {
  const { c, p, handlers } = await setup(); await c.refreshAccount(); let id: unknown;
  handlers.set('turn/start', (_params, requestId) => { id = requestId; });
  const run = c.runSynthetic('r1'); await flush(); const cancellation = c.cancelRequest();
  p.emit({ method: 'turn/started', params: { threadId: 'thread-1', turn } });
  p.emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'i1', delta: 'early' } });
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed' } } });
  p.emit({ id, result: { turn } }); await run; await cancellation; await flush();
  expect(c.snapshot().request).toMatchObject({ state: 'completed', output: 'early' });
});
it('fails closed on policy mismatch and storage write errors without submitting a turn', async () => {
  const { c, p, handlers, storage } = await setup(); await c.refreshAccount();
  storage.fail = true; await expect(c.runSynthetic('storage-failed')).rejects.toThrow('Storage'); expect(methods(p)).not.toContain('thread/start');
  storage.fail = false; handlers.set('thread/start', () => ({ ...threadResponse, approvalPolicy: 'on-request' }));
  await c.runSynthetic('r1'); expect(c.snapshot().request).toMatchObject({ state: 'failed', error: expect.stringContaining('approval policy') as string }); expect(methods(p)).not.toContain('turn/start');
});
it('submits a turn when the runtime echoes the default tier as "default" for a model without a default tier', async () => {
  const { c, p } = await setup(s => {
    s.handlers.set('model/list', () => ({ data: [{ ...model, defaultServiceTier: null }], nextCursor: null }));
    s.handlers.set('thread/start', () => ({ ...threadResponse, serviceTier: 'default', runtimeWorkspaceRoots: ['/isolated'], activePermissionProfile: null, multiAgentMode: 'explicitRequestOnly' }));
  });
  await c.refreshAccount(); await c.runSynthetic('r1');
  expect(methods(p)).toContain('turn/start'); expect(c.snapshot().request?.state).toBe('running');
  const start = p.writes.map(line => JSON.parse(line) as { method?: string; params?: { serviceTier?: unknown } }).find(m => m.method === 'turn/start');
  expect(start?.params?.serviceTier).toBeNull();
});
it('marks connection failure uncertain and reopening never resends', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1'); p.end(); await flush();
  expect(c.snapshot().request?.state).toBe('uncertain');
  const s = server(); const reopened = await createS2Client(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid' }); clients.push(reopened);
  expect(reopened.snapshot().request?.state).toBe('uncertain'); expect(methods(s.p)).not.toContain('turn/start');
});
it('single-flights official login, accepts early completion and never persists URLs', async () => {
  const { c, p, handlers, storage } = await setup();
  handlers.set('account/login/start', () => { p.emit({ method: 'account/login/completed', params: { loginId: 'login-1', success: true, error: null } }); return { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=secret' }; });
  const [a,b] = await Promise.all([c.startLogin(), c.startLogin()]); expect(a).toEqual(b); await flush();
  expect(methods(p).filter(m => m === 'account/login/start')).toHaveLength(1); expect(c.snapshot().login?.state).toBe('succeeded'); expect(storage.writes.join('')).not.toContain('secret');
});
it('rejects nonofficial login URL and bounds timeout with official cancel', async () => {
  const { c, handlers } = await setup(); handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'bad', authUrl: 'https://auth.openai.com.evil.test/' }));
  await expect(c.startLogin()).rejects.toThrow('official');
  handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'good', authUrl: 'https://auth.openai.com/oauth/authorize' }));
  vi.useFakeTimers(); await c.startLogin(); await vi.advanceTimersByTimeAsync(1001); expect(c.snapshot().login?.state).toBe('failed');
});
it('rejects unsupported server interactions and never grants tool approval', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1' } }); await flush();
  expect(c.snapshot().request?.state).toBe('failed');
  expect(p.writes.map(line => JSON.parse(line) as unknown)).toContainEqual({ id: 'approval-1', result: { decision: 'decline' } });
});
it('dedupes an existing running request after dispatch acknowledgement and keeps cancellation during acceptance', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('same');
  await c.runSynthetic('same'); expect(methods(p).filter(m => m === 'turn/start')).toHaveLength(1);
});
it('honors cancel immediately after click before journal acceptance completes', async () => {
  const { c, p } = await setup(); await c.refreshAccount();
  const run = c.runSynthetic('r1'); await c.cancelRequest(); await run;
  expect(methods(p)).not.toContain('turn/start'); expect(c.snapshot().request?.state).toBe('cancelled');
});
it('handles a second login with completion before its response and explicit cancel without logout', async () => {
  const { c, p, handlers } = await setup(); await c.startLogin(); await c.cancelLogin();
  handlers.set('account/login/start', () => { p.emit({ method: 'account/login/completed', params: { loginId: 'login-2', success: true, error: null } }); return { type: 'chatgpt', loginId: 'login-2', authUrl: 'https://auth.openai.com/oauth/authorize' }; });
  await c.startLogin(); await flush(); expect(c.snapshot().login).toMatchObject({ loginId: 'login-2', state: 'succeeded' });
  await c.close(); expect(methods(p)).not.toContain('account/logout');
});
it('permits harmless planning items while rejecting external tools and stopping their runtime', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'plan', id: 'plan-1', text: 'Explain the terms' } } }); await flush();
  expect(c.snapshot().request?.state).toBe('running');
  p.emit({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'imageView', id: 'tool-1', path: '/private' } } }); await flush();
  expect(c.snapshot().request?.state).toBe('failed'); expect(p.terminated).toBe(true);
});
it('signed-out refresh stays usable for login without requiring an authenticated model catalog', async () => {
  const { c, p } = await setup(s => { s.handlers.set('account/read', () => ({ account: null, requiresOpenaiAuth: true })); s.handlers.set('model/list', () => { throw new Error('must not query'); }); });
  await c.refreshAccount(); expect(c.snapshot().account.state).toBe('signedOut'); expect(c.snapshot().models).toEqual([]); expect(methods(p)).not.toContain('model/list'); await c.startLogin();
});
it('rejects unknown server tools and terminates instead of leaving an unsafe run alive', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ id: 500, method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', tool: 'unknown' } }); await flush();
  expect(p.terminated).toBe(true); expect(c.snapshot().runtime).toBe('error'); expect(c.snapshot().request?.state).toBe('failed');
});
it('reliably fails pending login after process loss without exposing raw upstream state', async () => {
  const { c, p } = await setup(); await c.startLogin(); p.end(); await flush();
  expect(c.snapshot().login?.state).toBe('failed'); expect(c.snapshot().account.state).toBe('signedOut');
});
it('closing during acceptance settles the durable intent without sending and leaves no active request', async () => {
  const { c, p } = await setup(); await c.refreshAccount();
  const run = c.runSynthetic('r1'); await c.close(); await run;
  expect(c.snapshot().runtime).toBe('stopped'); expect(c.snapshot().request?.state).toBe('uncertain'); expect(methods(p)).not.toContain('turn/start');
});
it('does not accept the expected version only inside a client-supplied user-agent suffix', async () => {
  const s = server(); s.handlers.set('initialize', () => ({ userAgent: 'codex/9.0.0 (zcr; 0.144.1)', codexHome: '/isolated', platformFamily: 'unix', platformOs: 'macos' }));
  await expect(createS2Client(s.p, new MemoryStorage(), { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid' })).rejects.toThrow('version');
  expect(s.p.terminated).toBe(true);
});
it('dispatching journal failure prevents even thread creation', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); const write = storage.writeAtomic.bind(storage); let count = 0;
  storage.writeAtomic = (path, bytes) => { if (++count === 2) return Promise.reject(new Error('private-path')); return write(path, bytes); };
  await c.runSynthetic('r1'); expect(methods(p)).not.toContain('thread/start'); expect(c.snapshot().request?.state).toBe('uncertain'); expect(c.snapshot().runtime).toBe('error');
});
it('terminal persistence failure stops the process and preserves restart uncertainty', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1'); storage.fail = true;
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed' } } }); await flush();
  expect(c.snapshot().request?.state).toBe('uncertain'); expect(p.terminated).toBe(true); storage.fail = false;
  const s = server(); const reopened = await createS2Client(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid' }); clients.push(reopened);
  await reopened.runSynthetic('r1'); expect(methods(s.p)).not.toContain('turn/start'); expect(reopened.snapshot().request?.state).toBe('uncertain');
});
it('latches overflow once and stops transport even while the first durable notice is blocked', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  let release!: () => void; const write = storage.writeAtomic.bind(storage); let held = true;
  storage.writeAtomic = (path, bytes) => held ? new Promise<void>(resolve => { release = () => { held = false; void write(path, bytes).then(resolve); }; }) : write(path, bytes);
  let terminations = 0; const terminate = p.terminate.bind(p); p.terminate = () => { terminations++; return terminate(); };
  p.emit({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'i1', delta: 'partial' } }); await flush();
  p.push(Array.from({ length: 10000 }, () => JSON.stringify({ method: 'thread/status/changed', params: { threadId: 'thread-1' } }) + '\n').join(''));
  await flush(); expect(terminations).toBe(1); release(); await flush();
  await vi.waitFor(() => expect(c.snapshot().request?.state).toBe('uncertain')); expect(terminations).toBe(1);
});
it('close settles a blocked server-response write without the process releasing its stdin promise', async () => {
  const { c, p } = await setup();
  p.writeStdin = () => new Promise<void>(() => undefined);
  p.emit({ id: 900, method: 'item/tool/call', params: {} }); await flush();
  let closed = false; const closing = c.close().then(() => { closed = true; }); await flush();
  expect(closed).toBe(true); await closing;
});
it('close settles a pending login and ignores late auth/account continuation without logout', async () => {
  const { c, p } = await setup(); await c.startLogin(); await c.close();
  expect(c.snapshot()).toMatchObject({ runtime: 'stopped', account: { state: 'signedOut' }, login: { state: 'cancelled' } });
  await expect(c.startLogin()).rejects.toThrow('Runtime'); expect(methods(p)).not.toContain('account/logout');
});
it('uncertain restored submission blocks a new request ID in the service itself', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1'); p.end(); await flush();
  const s = server(); const reopened = await createS2Client(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid' }); clients.push(reopened); await reopened.refreshAccount();
  await expect(reopened.runSynthetic('new-id')).rejects.toThrow('uncertain'); expect(methods(s.p)).not.toContain('turn/start');
});
it('keeps the typed reason of an upstream refusal without copying its free-text message', async () => {
  const { c, p, storage } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  // Observed on the dedicated host: an exhausted ChatGPT usage limit ends the turn with a typed error.
  p.emit({ method: 'error', params: { threadId: 'thread-1', turnId: 'turn-1', willRetry: false, error: { message: "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage or try again at Sep 15th", codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } });
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'failed', error: { message: 'private', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null } } } });
  await flush();
  expect(c.snapshot().request).toMatchObject({ state: 'failed', error: expect.stringContaining('usage limit') as string });
  expect(storage.writes.join('')).not.toMatch(/chatgpt\.com|Sep 15th|private/);
});
it('describes a failed turn from its typed error when no error notification preceded it', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'failed', error: { message: 'raw upstream text', codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 502 } }, additionalDetails: null } } } });
  await flush();
  expect(c.snapshot().request).toMatchObject({ state: 'failed', error: expect.stringMatching(/connection.*HTTP 502/u) as string });
  expect(c.snapshot().request?.error).not.toContain('raw upstream text');
});
it('completed turn with no agent text is a failed response, not a completed answer', async () => {
  const { c, p } = await setup(); await c.refreshAccount(); await c.runSynthetic('r1');
  p.emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { ...turn, status: 'completed' } } }); await flush();
  expect(c.snapshot().request).toMatchObject({ state: 'failed', output: '' });
});
it('validates effective policy and provenance immediately after initialized before ready', async () => {
  const { p } = await setup(); expect(methods(p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
  expect(p.writes.map(line => JSON.parse(line) as unknown)).toContainEqual({ id: 2, method: 'config/read', params: { includeLayers: true, cwd: '/isolated' } });
});
it.each(['external-mcp', 'wrong-feature', 'unknown-feature-enabled', 'managed-layer', 'foreign-user-layer', 'user-layer-content', 'unknown-origin', 'missing-layers', 'thread-endpoint', 'auth-endpoint', 'home-mismatch'])('fails closed on effective policy violation: %s', async violation => {
  const s = server(); const fixture = configResponse();
  if (violation === 'external-mcp') fixture.config.mcp_servers = { remote: { url: 'https://example.test' } };
  if (violation === 'wrong-feature') fixture.config.features.shell_tool = true;
  if (violation === 'unknown-feature-enabled') (fixture.config.features as Record<string, unknown>).future_capability = true;
  if (violation === 'managed-layer') fixture.layers.push({ name: { type: 'system', file: '/etc/codex/extra.toml' }, config: { approval_policy: 'never' }, version: 'sha256:managed' });
  if (violation === 'foreign-user-layer') fixture.layers[1]!.name.file = '/outside/config.toml';
  if (violation === 'user-layer-content') fixture.layers[1]!.config = { model: 'gpt-5' };
  if (violation === 'unknown-origin') fixture.origins.approval_policy!.name.type = 'enterpriseManaged';
  if (violation === 'auth-endpoint') fixture.config.chatgpt_base_url = 'https://chatgpt.example.test' as never;
  s.handlers.set('config/read', () => violation === 'missing-layers' ? { ...fixture, layers: null } : violation === 'thread-endpoint' ? { ...fixture, config: { ...fixture.config, experimental_thread_config_endpoint: 'https://example.test' } } : fixture);
  const options = { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid', ...(violation === 'home-mismatch' ? { codexHome: '/isolated/other-account' } : {}) };
  await expect(createS2Client(s.p, new MemoryStorage(), options)).rejects.toThrow('policy');
  expect(s.p.terminated).toBe(true); expect(methods(s.p)).not.toContain('account/read');
});
it('accepts the dedicated account home reported by the runtime and reads policy from the reader directory', async () => {
  const s = server(); const c = await createS2Client(s.p, new MemoryStorage(), { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid', codexHome: '/isolated/auth' }); clients.push(c);
  expect(c.snapshot().runtime).toBe('ready');
});
it('close settles durable state and reports failure when the owned process cannot be stopped', async () => {
  const s = server(); const storage = new MemoryStorage();
  const c = await createS2Client(s.p, storage, { codexVersion: '0.144.1', cwd: '/isolated', uuid: () => 'uuid' });
  await c.refreshAccount(); await c.runSynthetic('r1');
  s.p.terminate = () => Promise.reject(new Error('raw kill failure'));
  await expect(c.close()).rejects.toThrow();
  expect(c.snapshot()).toMatchObject({ runtime: 'stopped', request: { state: 'uncertain' } });
  expect(storage.writes.at(-1)).toContain('uncertain');
});
