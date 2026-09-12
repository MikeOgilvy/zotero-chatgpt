import { RuntimeFailure, type LoginFlow, type ManagedProcess, type ModelOption, type ReaderClient, type RuntimeSnapshot, type StoragePort } from '../../contracts/src/runtime.ts';
import { clone } from '../../contracts/src/clone.ts';
import type { Conversation, ErrorCode, GenerationSettings, PaperScope, ReaderEvent, SendInput, SendReceipt, ShareableDiagnostics } from '../../contracts/src/index.ts';
import { RpcTransport, record } from './codex/transport.ts';
import { parseModel, string } from './codex/models.ts';
import { validatePolicy } from './codex/reader-policy.ts';
import { ConversationStore } from './sessions/store.ts';
import { ReaderService } from './sessions/service.ts';
export { shareableDiagnostics } from './sessions/diagnostics.ts';
export type { ShareableDiagnostics } from './sessions/diagnostics.ts';
/** `codexHome`, when known to the caller, must equal the account directory the runtime reports. */
export interface ReaderOptions { codexVersion: string; cwd: string; uuid: () => string; pluginVersion?: string; loginTimeoutMs?: number; codexHome?: string; deltaFlushMs?: number; now?: () => string }
export async function createReaderClient(process: ManagedProcess, storage: StoragePort, options: ReaderOptions): Promise<ReaderClient> {
  let rpc: RpcTransport | null = null;
  try {
    if (options.codexVersion !== '0.144.1' || !options.cwd) throw new RuntimeFailure('Unsupported runtime version or directory');
    rpc = new RpcTransport(process);
    const response = record(await rpc.request('initialize', { clientInfo: { name: 'zotero_codex_reader', title: 'Zotero Codex Reader', version: '0.2.0' }, capabilities: { experimentalApi: false } }));
    if (typeof response.userAgent !== 'string' || !/^[^/]+\/0\.144\.1(?:\s|$)/u.test(response.userAgent)) throw new RuntimeFailure('Unsupported runtime version');
    const codexHome = typeof response.codexHome === 'string' ? response.codexHome : '';
    if (!codexHome.startsWith('/') || (options.codexHome !== undefined && options.codexHome !== codexHome)) throw new RuntimeFailure('Reader policy unavailable: the runtime is not using the dedicated account directory');
    await rpc.notify('initialized');
    // Effective configuration and its provenance gate every later account or model call.
    validatePolicy(await rpc.request('config/read', { includeLayers: true, cwd: options.cwd }), codexHome);
    return new RuntimeSession(rpc, storage, options);
  } catch (error) { if (rpc) await rpc.close().catch(() => undefined); else await process.terminate().catch(() => undefined); throw error; }
}
/** Owns the transport, account/login/model state and routes thread notifications to the conversation service. */
class RuntimeSession implements ReaderClient {
  private state: RuntimeSnapshot;
  private observers = new Set<(snapshot: RuntimeSnapshot) => void>();
  private changes = Promise.resolve();
  private queued = 0;
  private failureStarted = false;
  private loginFlight: Promise<LoginFlow> | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private loginNotices = new Map<string, Record<string, unknown>>();
  private closing = false;
  private closeFlight: Promise<void> | null = null;
  private service: ReaderService;
  constructor(private rpc: RpcTransport, storage: StoragePort, private options: ReaderOptions) {
    const now = options.now ?? (() => new Date().toISOString());
    this.state = { revision: 0, runtime: 'ready', account: { state: 'signedOut' }, login: null, models: [], error: null };
    this.service = new ReaderService(new ConversationStore(storage, { uuid: options.uuid, now }), {
      request: (method, params) => this.rpc.request(method, params),
      models: () => this.state.models,
      ready: () => this.state.runtime === 'ready' && !this.closing,
      signedIn: () => this.state.account.state === 'signedIn',
      breach: () => { this.state.runtime = 'error'; this.state.error = 'Reader policy rejected an unsupported interaction.'; this.emit(); void this.rpc.close().catch(() => undefined); },
    }, { cwd: options.cwd, uuid: options.uuid, now, ...(options.deltaFlushMs !== undefined ? { deltaFlushMs: options.deltaFlushMs } : {}) });
    rpc.subscribe(message => {
      if (this.closing || this.failureStarted) return;
      if (this.queued >= 1024) { void this.transportFailed(); return; }
      this.queued++;
      void this.enqueue(async () => { try { if (!this.failureStarted && !this.closing) await this.notice(message); } finally { this.queued--; } });
    });
    rpc.onFailure(() => { if (!this.closing) void this.transportFailed(); });
  }
  // ---- reactive runtime state -----------------------------------------------------------------
  snapshot(): RuntimeSnapshot { return clone(this.state); }
  observe(listener: (snapshot: RuntimeSnapshot) => void) { this.observers.add(listener); listener(this.snapshot()); return () => { this.observers.delete(listener); }; }
  private emit() {
    this.state.revision++;
    for (const listener of this.observers) { try { listener(this.snapshot()); } catch { /* View failures do not stop the service. */ } }
  }
  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.changes.then(operation);
    this.changes = result.catch(async () => {
      this.state.runtime = 'error'; this.state.error = 'Unable to process a runtime notification safely.'; this.emit();
      await this.rpc.close().catch(() => undefined);
    });
    return this.changes;
  }
  private async transportFailed() {
    if (this.failureStarted || this.closing) return;
    this.failureStarted = true;
    this.state.runtime = 'error'; this.state.error = 'Codex connection ended.'; this.emit();
    void this.rpc.close().catch(() => undefined);
    await this.service.settleAll('The Codex connection ended before confirmation; this request will not be resent.');
    await this.enqueue(() => {
      this.clearLoginTimer();
      if (this.state.login?.state === 'pending') { this.state.login = { ...this.state.login, state: 'failed', message: 'Codex connection ended during login.' }; this.state.account = { state: 'signedOut' }; this.loginFlight = null; }
      this.emit(); return Promise.resolve();
    });
  }
  async refreshAccount(): Promise<void> {
    if (this.closing) throw new Error('Runtime stopped');
    let accountVerified = false;
    try {
      const response = record(await this.rpc.request('account/read', { refreshToken: false }));
      if (this.closing) return;
      if (typeof response.requiresOpenaiAuth !== 'boolean') throw new Error('Protocol account invalid');
      if (response.account === null) this.state.account = { state: 'signedOut' };
      else {
        const account = record(response.account);
        if (account.type !== 'chatgpt') throw new Error('Official ChatGPT login required');
        this.state.account = { state: 'signedIn', displayLabel: 'ChatGPT' };
      }
      accountVerified = true;
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
    } catch { if (this.closing) return; this.state.models = []; this.state.error = 'Unable to read the official account or model catalog.'; this.emit(); if (accountVerified && this.state.account.state === 'signedOut') return; throw new RuntimeFailure(this.state.error); }
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
  // ---- notifications --------------------------------------------------------------------------
  private async notice(message: Record<string, unknown>) {
    const params = record(message.params ?? {});
    if ('id' in message) {
      // Server-initiated requests (approvals, tools) are never granted; the affected request fails closed.
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(string(message.method))) await this.rpc.respond(message.id, { decision: 'decline' });
      else await this.rpc.rejectRequest(message.id);
      if (typeof params.threadId === 'string') await this.service.failThread(params.threadId, 'UNSUPPORTED_INTERACTION', 'Unsupported tool or approval interaction was rejected.');
      this.state.runtime = 'error'; this.state.error = 'Reader policy rejected an unsupported interaction.'; this.emit();
      await this.rpc.close().catch(() => undefined); return;
    }
    const method = string(message.method);
    if (method === 'account/login/completed') {
      if (typeof params.loginId !== 'string') return;
      if (!this.state.login) { if (this.loginNotices.size >= 16) this.loginNotices.clear(); this.loginNotices.set(params.loginId, params); }
      else await this.applyLoginNotice(params);
      return;
    }
    if (method === 'account/updated') { void this.refreshAccount().catch(() => undefined); return; }
    this.service.handleNotice(method, params);
  }
  // ---- conversations (delegated) --------------------------------------------------------------
  current(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> { return this.service.current(paper, title, settings); }
  newConversation(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> { return this.service.newConversation(paper, title, settings); }
  list(paper: PaperScope): Promise<Conversation[]> { return this.service.list(paper); }
  get(conversationId: string): Promise<Conversation> { return this.service.get(conversationId); }
  select(paper: PaperScope, conversationId: string): Promise<Conversation> { return this.service.select(paper, conversationId); }
  deleteConversation(paper: PaperScope, conversationId: string): Promise<Conversation> { return this.service.deleteConversation(paper, conversationId); }
  send(input: SendInput): Promise<SendReceipt> { return this.service.send(input); }
  request(conversationId: string, requestId: string): Promise<SendReceipt> { return this.service.request(conversationId, requestId); }
  cancel(conversationId: string, requestId: string): Promise<SendReceipt> { return this.service.cancel(conversationId, requestId); }
  diagnostics(conversationId: string): Promise<ShareableDiagnostics> {
    return this.service.diagnostics(conversationId, {
      pluginVersion: this.options.pluginVersion ?? '0.3.0-alpha.1',
      runtimeVersion: this.options.codexVersion,
      errorCode: this.runtimeErrorCode(),
    });
  }
  subscribe(listener: (event: ReaderEvent) => void): () => void { return this.service.subscribe(listener); }
  private runtimeErrorCode(): ErrorCode | null {
    if (this.state.runtime !== 'error') return null;
    if (this.state.error === 'Codex connection ended.') return 'CODEX_EXITED';
    if (this.state.error === 'Reader policy rejected an unsupported interaction.') return 'READER_POLICY_UNAVAILABLE';
    return 'RUNTIME_UNAVAILABLE';
  }
  // ---- shutdown -------------------------------------------------------------------------------
  close(): Promise<void> {
    if (this.closeFlight) return this.closeFlight;
    this.closing = true; this.clearLoginTimer();
    if (this.state.login?.state === 'pending') this.state.login = { ...this.state.login, state: 'cancelled' };
    if (this.state.account.state === 'signingIn') this.state.account = { state: 'signedOut' };
    this.loginFlight = null;
    this.closeFlight = this.stop(); return this.closeFlight;
  }
  private async stop() {
    // Fail the transport first so pending RPC calls cannot hold shutdown open. Durable state settles
    // regardless of whether the owned process could be stopped; that result is reported afterwards.
    const termination = this.rpc.close(); termination.catch(() => undefined);
    await this.service.close();
    this.state.runtime = 'stopped'; this.emit();
    this.observers.clear();
    await termination;
  }
}
