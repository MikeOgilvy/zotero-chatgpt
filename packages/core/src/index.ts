import { RuntimeFailure, type ManagedProcess, type StoragePort, type S2Client, type S2Snapshot, type SyntheticRequest, type LoginFlow, type ModelOption } from '../../contracts/src/runtime.ts';
import { RpcTransport, record } from './codex/transport.ts';
import { parseModel, string } from './codex/models.ts';
import { SYNTHETIC_QUESTION, threadParams, validatePolicy, validateThread } from './codex/reader-policy.ts';
import { describeTurnError } from './codex/errors.ts';
import { RequestJournal, active } from './sessions/journal.ts';
/** `codexHome`, when known to the caller, must equal the account directory the runtime reports. */
export interface S2Options { codexVersion: string; cwd: string; uuid: () => string; loginTimeoutMs?: number; codexHome?: string }
export async function createS2Client(process: ManagedProcess, storage: StoragePort, options: S2Options): Promise<S2Client> {
  let rpc: RpcTransport | null = null;
  try {
    if (options.codexVersion !== '0.144.1' || !options.cwd) throw new RuntimeFailure('Unsupported runtime version or directory');
    const journal = await RequestJournal.open(storage);
    rpc = new RpcTransport(process);
    const response = record(await rpc.request('initialize', { clientInfo: { name: 'zotero_codex_reader', title: 'Zotero Codex Reader', version: '0.1.0' }, capabilities: { experimentalApi: false } }));
    if (typeof response.userAgent !== 'string' || !/^[^/]+\/0\.144\.1(?:\s|$)/u.test(response.userAgent)) throw new RuntimeFailure('Unsupported runtime version');
    const codexHome = typeof response.codexHome === 'string' ? response.codexHome : '';
    if (!codexHome.startsWith('/') || (options.codexHome !== undefined && options.codexHome !== codexHome)) throw new RuntimeFailure('Reader policy unavailable: the runtime is not using the dedicated account directory');
    await rpc.notify('initialized');
    // Effective configuration and its provenance gate every later account or model call.
    validatePolicy(await rpc.request('config/read', { includeLayers: true, cwd: options.cwd }), codexHome);
    return new ConnectionClient(rpc, journal, options);
  } catch (error) { if (rpc) await rpc.close().catch(() => undefined); else await process.terminate().catch(() => undefined); throw error; }
}
class ConnectionClient implements S2Client {
  private state: S2Snapshot;
  private listeners = new Set<(snapshot: S2Snapshot) => void>();
  private changes = Promise.resolve();
  private queued = 0;
  private failureStarted = false;
  private runs = new Map<string, Promise<void>>();
  private loginFlight: Promise<LoginFlow> | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private loginNotices = new Map<string, Record<string, unknown>>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private cancelWanted = false;
  private interrupted = false;
  private items = new Map<string, string>();
  private closing = false;
  private closeFlight: Promise<void> | null = null;
  constructor(private rpc: RpcTransport, private journal: RequestJournal, private options: S2Options) {
    this.state = { revision: 0, runtime: 'ready', account: { state: 'signedOut' }, login: null, models: [], request: journal.latest(), error: null };
    rpc.subscribe(message => {
      if (this.closing || this.failureStarted) return;
      if (this.queued >= 1024) { void this.transportFailed(); return; }
      this.queued++;
      void this.enqueue(async () => { try { if (!this.failureStarted && !this.closing) await this.notice(message); } finally { this.queued--; } });
    });
    rpc.onFailure(() => { if (!this.closing) void this.transportFailed(); });
  }
  snapshot(): S2Snapshot { return JSON.parse(JSON.stringify(this.state)) as S2Snapshot; }
  subscribe(listener: (snapshot: S2Snapshot) => void) { this.listeners.add(listener); listener(this.snapshot()); return () => { this.listeners.delete(listener); }; }
  private emit() {
    this.state.revision++;
    for (const listener of this.listeners) { try { listener(this.snapshot()); } catch { /* View failures do not stop the service. */ } }
  }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.changes.then(operation);
    this.changes = result.catch(async () => {
      this.state.runtime = 'error'; this.state.error = 'Unable to save or process this request safely.';
      if (active(this.state.request)) this.state.request = { ...this.state.request!, state: 'uncertain', error: 'Request state could not be saved; it will not be resent.' };
      this.emit(); await this.rpc.close().catch(() => undefined);
    });
    return this.changes;
  }
  private async save(request: SyntheticRequest) { await this.journal.save(request); this.state.request = { ...request }; this.emit(); }
  private async transportFailed() {
    if (this.failureStarted || this.closing) return;
    this.failureStarted = true;
    this.state.runtime = 'error'; this.state.error = 'Codex connection ended.'; this.emit();
    void this.rpc.close().catch(() => undefined);
    await this.enqueue(async () => {
      this.state.runtime = 'error'; this.state.error = 'Codex connection ended.';
      if (active(this.state.request)) await this.save({ ...this.state.request!, state: 'uncertain', error: 'Connection ended before confirmation; this request will not be resent.' });
      this.clearLoginTimer();
      if (this.state.login?.state === 'pending') { this.state.login = { ...this.state.login, state: 'failed', message: 'Codex connection ended during login.' }; this.state.account = { state: 'signedOut' }; this.loginFlight = null; }
      this.emit();
    });
  }
  async refreshAccount(): Promise<void> {
    if (this.closing) throw new Error('Runtime stopped');
    try {
      const response = record(await this.rpc.request('account/read', { refreshToken: false }));
      if (this.closing) return;
      if (typeof response.requiresOpenaiAuth !== 'boolean') throw new Error('Protocol account invalid');
      if (response.account === null) { this.state.account = { state: 'signedOut' }; this.state.models = []; this.state.error = null; this.emit(); return; }
      else {
        const account = record(response.account);
        if (account.type !== 'chatgpt') throw new Error('Official ChatGPT login required');
        this.state.account = { state: 'signedIn', displayLabel: 'ChatGPT' };
      }
      const models: ModelOption[] = []; const cursors = new Set<string>(); let cursor: string | null = null;
      do {
        const page = record(await this.rpc.request('model/list', { cursor, limit: 100, includeHidden: false }));
        if (this.closing) return;
        if (!Array.isArray(page.data) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('Protocol model list invalid');
        for (const data of page.data) { const model = parseModel(data); if (model) models.push(model); }
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new Error('Protocol pagination invalid');
        if (cursor) cursors.add(cursor);
        if (models.length > 1000) throw new Error('Protocol model list too large');
      } while (cursor);
      if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('Protocol duplicate model');
      this.state.models = models; this.state.error = null; this.emit();
    } catch { if (this.closing) return; this.state.models = []; this.state.error = 'Unable to read the official account or model catalog.'; this.emit(); throw new RuntimeFailure(this.state.error); }
  }
  startLogin(): Promise<LoginFlow> {
    if (this.closing || this.state.runtime !== 'ready') return Promise.reject(new Error('Runtime unavailable'));
    if (this.loginFlight) return this.loginFlight.then(flow => ({ ...flow }));
    this.state.login = null; this.loginNotices.clear();
    this.state.account = { state: 'signingIn' }; this.state.error = null; this.emit();
    const flight = this.beginLogin(); this.loginFlight = flight;
    void flight.catch(() => { this.loginFlight = null; });
    return flight.then(flow => ({ ...flow }));
  }
  private async beginLogin(): Promise<LoginFlow> {
    try {
      const response = record(await this.rpc.request('account/login/start', { type: 'chatgpt' }));
      if (this.closing) throw new Error('Runtime stopped');
      const loginId = string(response.loginId); const url = new URL(string(response.authUrl));
      if (response.type !== 'chatgpt' || !loginId || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password || (url.port && url.port !== '443')) {
        if (loginId) await this.rpc.request('account/login/cancel', { loginId }).catch(() => undefined);
        throw new Error('Invalid official login URL');
      }
      this.state.login = { loginId, state: 'pending' }; this.emit();
      this.loginTimer = setTimeout(() => { void this.finishLoginCancel(true); }, Math.min(Math.max(this.options.loginTimeoutMs ?? 300_000, 100), 300_000));
      const early = this.loginNotices.get(loginId); this.loginNotices.clear();
      if (early) await this.applyLoginNotice(early);
      return { loginId, authorizationUrl: url.href };
    } catch { if (this.closing) throw new Error('Runtime stopped'); this.state.account = { state: 'signedOut' }; this.state.error = 'Unable to start official ChatGPT login.'; this.emit(); throw new Error(this.state.error); }
  }
  async cancelLogin() {
    if (this.loginFlight && !this.state.login) await this.loginFlight.catch(() => undefined);
    await this.finishLoginCancel(false);
  }
  private clearLoginTimer() { if (this.loginTimer) clearTimeout(this.loginTimer); this.loginTimer = null; }
  private async finishLoginCancel(timeout: boolean) {
    const login = this.state.login;
    if (!login || login.state !== 'pending') return;
    this.clearLoginTimer(); this.state.login = { ...login, state: timeout ? 'failed' : 'cancelled', ...(timeout ? { message: 'Login timed out. Start a new login to continue.' } : {}) };
    this.state.account = { state: 'signedOut' }; this.loginFlight = null; this.emit();
    try { const result = record(await this.rpc.request('account/login/cancel', { loginId: login.loginId })); if (!['canceled', 'notFound'].includes(string(result.status))) throw new Error('Protocol cancel invalid'); }
    catch { this.state.error = 'Login cancellation could not be confirmed.'; this.emit(); }
  }
  private async applyLoginNotice(params: Record<string, unknown>) {
    const login = this.state.login;
    if (this.closing || !login || login.loginId !== params.loginId || login.state !== 'pending') return;
    if (typeof params.success !== 'boolean') throw new Error('Protocol login completion invalid');
    this.clearLoginTimer(); this.loginFlight = null;
    this.state.login = { loginId: login.loginId, state: params.success ? 'succeeded' : 'failed', ...(!params.success ? { message: 'Official login did not complete.' } : {}) };
    this.state.account = { state: 'signedOut' }; this.emit();
    if (params.success) await this.refreshAccount().catch(() => undefined);
  }
  runSynthetic(requestId: string): Promise<void> {
    if (!requestId || requestId.length > 128) return Promise.reject(new Error('Invalid request ID'));
    const existing = this.runs.get(requestId); if (existing) return existing;
    if (this.journal.get(requestId)) return Promise.resolve();
    if (this.journal.hasUncertain()) return Promise.reject(new Error('An uncertain request must be reconciled before another submission'));
    if (this.runs.size || active(this.state.request)) return Promise.reject(new Error('Request busy'));
    this.cancelWanted = false;
    const run = this.dispatch(requestId); this.runs.set(requestId, run);
    void run.finally(() => { this.runs.delete(requestId); }).catch(() => undefined);
    return run;
  }
  private async dispatch(requestId: string) {
    if (this.state.runtime !== 'ready' || this.closing) throw new Error('Runtime unavailable');
    if (this.state.account.state !== 'signedIn') throw new Error('Official ChatGPT login required');
    const defaults = this.state.models.filter(m => m.isDefault);
    if (defaults.length !== 1) throw new Error('Default model unavailable');
    const model = defaults[0]!;
    const request: SyntheticRequest = { requestId, state: 'accepted', question: SYNTHETIC_QUESTION, model: model.id, output: '', error: null };
    if (!await this.journal.accept(request)) return;
    this.state.request = request; this.interrupted = false; this.threadId = null; this.turnId = null; this.items.clear(); this.emit();
    let submitted = false;
    try {
      await this.enqueue(async () => { await this.save({ ...request, state: 'dispatching' }); });
      if (this.state.runtime !== 'ready') return;
      const response = await this.rpc.request('thread/start', threadParams(this.options.cwd, model));
      this.threadId = validateThread(response, this.options.cwd, model);
      if (this.cancelWanted) { await this.enqueue(async () => { if (active(this.state.request)) await this.save({ ...this.state.request!, state: 'cancelled' }); }); return; }
      if (!active(this.state.request) || this.state.runtime !== 'ready') return;
      submitted = true;
      const result = record(await this.rpc.request('turn/start', { threadId: this.threadId, clientUserMessageId: requestId, input: [{ type: 'text', text: SYNTHETIC_QUESTION, text_elements: [] }], cwd: this.options.cwd, approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false }, model: model.id, serviceTier: model.defaultServiceTier, effort: model.defaultReasoningEffort }));
      await this.enqueue(async () => { await this.applyTurn(record(result.turn)); });
      await this.maybeInterrupt();
    } catch (error) {
      // Deliberate policy failures carry constant text naming the mismatch; other errors stay generic.
      const reason = error instanceof RuntimeFailure ? `${error.message}; no turn was submitted.` : 'Reader policy or connection unavailable; no turn was submitted.';
      await this.enqueue(async () => {
        if (active(this.state.request)) await this.save({ ...this.state.request!, state: submitted || this.closing ? 'uncertain' : 'failed', error: submitted || this.closing ? 'Submission could not be confirmed; this request will not be resent.' : reason });
      });
    }
  }
  async cancelRequest() { this.cancelWanted = true; await this.maybeInterrupt(); }
  private async maybeInterrupt() {
    if (!this.cancelWanted || this.interrupted || !this.threadId || !this.turnId || !active(this.state.request)) return;
    this.interrupted = true;
    try { await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }); }
    catch { await this.transportFailed(); }
  }
  private async applyTurn(turn: Record<string, unknown>) {
    if (!active(this.state.request)) return;
    const id = string(turn.id);
    if (this.turnId && this.turnId !== id) throw new Error('Protocol turn mismatch');
    this.turnId = id;
    if (!Array.isArray(turn.items)) throw new Error('Protocol turn items invalid');
    for (const item of turn.items) this.applyItem(record(item));
    const status = string(turn.status);
    let state: SyntheticRequest['state'] | null = status === 'completed' ? 'completed' : status === 'interrupted' ? 'cancelled' : status === 'failed' ? 'failed' : status === 'inProgress' ? 'running' : null;
    if (!state) throw new Error('Protocol turn status invalid');
    const output = this.output();
    const emptyCompletion = state === 'completed' && !output.trim();
    if (emptyCompletion) state = 'failed';
    await this.save({ ...this.state.request!, state, output, error: emptyCompletion ? 'The model completed without an answer.' : state === 'failed' ? describeTurnError(turn.error) : null });
    if (state === 'running') void this.maybeInterrupt();
  }
  private output() { const output = [...this.items.values()].join('\n\n'); if (output.length > 1024 * 1024) throw new Error('Protocol output too large'); return output; }
  private applyItem(item: Record<string, unknown>) {
    if (item.type === 'agentMessage') this.items.set(string(item.id), string(item.text));
    else if (!['userMessage', 'reasoning', 'plan'].includes(string(item.type))) throw new Error('Unsupported interaction');
  }
  private async notice(message: Record<string, unknown>) {
    if ('id' in message) {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(string(message.method))) await this.rpc.respond(message.id, { decision: 'decline' });
      else await this.rpc.rejectRequest(message.id);
      if (active(this.state.request)) await this.save({ ...this.state.request!, state: 'failed', error: 'Unsupported tool or approval interaction was rejected.' });
      this.state.runtime = 'error'; this.state.error = 'Reader policy rejected an unsupported interaction.'; this.emit();
      await this.rpc.close().catch(() => undefined); return;
    }
    const params = record(message.params ?? {});
    if (message.method === 'account/login/completed') {
      if (typeof params.loginId !== 'string') return;
      if (!this.state.login) { if (this.loginNotices.size >= 16) this.loginNotices.clear(); this.loginNotices.set(params.loginId, params); }
      else await this.applyLoginNotice(params);
      return;
    }
    if (message.method === 'account/updated') { void this.refreshAccount().catch(() => undefined); return; }
    if (!active(this.state.request) || params.threadId !== this.threadId) return;
    if (params.turnId !== undefined) { if (this.turnId && params.turnId !== this.turnId) return; this.turnId = string(params.turnId); }
    if (message.method === 'turn/started' || message.method === 'turn/completed') { await this.applyTurn(record(params.turn)); return; }
    if (message.method === 'error') {
      if (params.willRetry === true) return;
      await this.save({ ...this.state.request!, state: 'failed', error: describeTurnError(params.error) }); return;
    }
    if (message.method === 'item/agentMessage/delta') {
      const id = string(params.itemId); this.items.set(id, (this.items.get(id) ?? '') + string(params.delta));
      await this.save({ ...this.state.request!, output: this.output() });
    } else if (message.method === 'item/completed' || message.method === 'item/started') {
      try { this.applyItem(record(params.item)); }
      catch { await this.save({ ...this.state.request!, state: 'failed', error: 'Unexpected tool activity; the reader connection has been stopped.' }); await this.rpc.close().catch(() => undefined); return; }
      await this.save({ ...this.state.request!, output: this.output() });
    }
  }
  close(): Promise<void> {
    if (this.closeFlight) return this.closeFlight;
    this.closing = true; this.clearLoginTimer();
    if (this.state.login?.state === 'pending') this.state.login = { ...this.state.login, state: 'cancelled' };
    if (this.state.account.state === 'signingIn') this.state.account = { state: 'signedOut' };
    this.loginFlight = null;
    this.closeFlight = this.stop(); return this.closeFlight;
  }
  private async stop() {
    // Fail the transport first so pending RPC calls cannot hold shutdown open. The
    // durable state settles regardless of whether the owned process could be stopped;
    // that termination result is reported to the caller afterwards.
    const termination = this.rpc.close(); termination.catch(() => undefined);
    await Promise.allSettled([...this.runs.values()]);
    await this.enqueue(async () => {
      if (active(this.state.request)) await this.save({ ...this.state.request!, state: 'uncertain', error: 'Plugin stopped before confirmation; this request will not be resent.' });
      this.state.runtime = 'stopped'; this.emit();
    });
    this.listeners.clear();
    await termination;
  }
}
