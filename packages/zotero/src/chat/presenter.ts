import type { ReaderClient, RuntimeSnapshot } from '../../../contracts/src/runtime.ts';
import { clone } from '../../../contracts/src/clone.ts';
import type { Citation, Conversation, DocumentContext, Draft, GenerationSettings, ImageAttachment, Message, PaperIdentity, PaperScope, ReaderEvent } from '../../../contracts/src/index.ts';
import { addCitation, addImage, makeAsk, makeExplain, removeCitation, removeImage } from './draft.ts';
import { alignSettings, catalogDefaultSettings } from './generation-settings.ts';
export interface DocumentServices {
  prepare(signal: AbortSignal, progress: (p: { done: number; total: number }) => void, range?: readonly [number, number]): Promise<DocumentContext>;
  validate(document: DocumentContext): Promise<void>;
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
  needsDisclosure?(): boolean;
  acknowledge?(): void;
}
export interface PresenterServices { ensureStarted(): Promise<ReaderClient>; openAuthorization(url: string): void; uuid(): string; now(): string; document?: DocumentServices }
export interface PresenterState {
  connection: 'idle' | 'starting' | 'ready' | 'error';
  runtime: RuntimeSnapshot | null;
  conversation: Conversation | null;
  conversations: Conversation[];
  draft: Draft;
  pendingExplain: Citation | null;
  message: string | null;
  generating: boolean;
  /** Incremented when the view should move focus into the question input. */
  focusToken: number;
  paperTitle: string;
  document: { enabled: boolean; disclosure: boolean; phase: 'idle' | 'preparing' | 'ready' | 'error'; prepared: DocumentContext | null; progress: { done: number; total: number }; range: [number, number] | null; error: string | null };
}
const LOGIN_HOSTS = ['auth.openai.com', 'chatgpt.com'];
const UNCERTAIN_ISOLATION = 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.';
/**
 * One presenter per attachment for the plugin lifetime. It owns the unsent draft and the view's copy
 * of the conversation; the runtime keeps generating whether or not a view is bound.
 */
export class ConversationPresenter {
  private state: PresenterState;
  private renders = new Set<(state: PresenterState) => void>();
  private client: ReaderClient | null = null;
  private connecting: Promise<ReaderClient> | null = null;
  private unobserve: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private buffered: ReaderEvent[] = [];
  private syncing = false;
  private syncGeneration = 0;
  private submitting = false;
  private explainFlights = new Map<string, Promise<void>>();
  private continuing = false;
  private drafts = new Map<string, Draft>();
  private sendFlight: Promise<void> | null = null;
  private draftVersion = 0;
  private documentJob: { controller: AbortController; range: string; promise: Promise<DocumentContext> } | null = null;
  constructor(readonly paper: PaperScope, private title: string, private services: PresenterServices, private identity: PaperIdentity = { title, authors: [] }) {
    this.state = { connection: 'idle', runtime: null, conversation: null, conversations: [], draft: { settings: null, paper, question: '', citations: [], images: [] }, pendingExplain: null, message: null, generating: false, focusToken: 0, paperTitle: title,
      document: { enabled: services.document?.readEnabled() ?? false, disclosure: services.document?.needsDisclosure?.() ?? false, phase: 'idle', prepared: null, progress: { done: 0, total: 0 }, range: null, error: null } };
  }
  private paperIdentity(): PaperIdentity {
    const title = this.identity.title.trim() || this.title.trim() || this.state.conversation?.title || '';
    return { title, authors: this.identity.authors, ...(this.identity.year ? { year: this.identity.year } : {}), ...(this.identity.doi ? { doi: this.identity.doi } : {}) };
  }
  /** Ask in sidechat: the citation is already in the draft; the view should focus the question input. */
  focusInput(): void { this.update({ focusToken: this.state.focusToken + 1 }); }
  snapshot(): PresenterState { return clone(this.state); }
  /** Views are read-only; they must not mutate this object. External callers still use snapshot(). */
  private notify(): void { for (const render of this.renders) render(this.state); }
  /** A view binds to receive state; unbinding releases only the view, never the runtime or the draft. */
  bind(render: (state: PresenterState) => void): () => void {
    this.renders.add(render); render(this.state);
    if (this.client && this.state.conversation) void this.sync();
    return () => { this.renders.delete(render); if (!this.renders.size) { this.unsubscribe?.(); this.unsubscribe = null; } };
  }
  private update(patch: Partial<PresenterState>): void {
    this.state = { ...this.state, ...patch };
    this.state.generating = this.submitting || !!this.state.conversation?.activeRequestId;
    this.notify();
  }
  private errorText(error: unknown): string { return error instanceof Error && error.message ? error.message : 'Codex could not complete this action.'; }
  private signedIn(): boolean { return this.state.runtime?.account.state === 'signedIn' && (this.state.runtime?.models.length ?? 0) > 0; }
  private currentSettings(): GenerationSettings | null {
    const models = this.state.runtime?.models ?? [];
    const current = this.state.draft.settings ?? this.state.conversation?.settings ?? catalogDefaultSettings(models);
    if (!current) return null;
    return models.length ? alignSettings(models, current) : current;
  }
  private contextOptions(): { enabled: boolean; range: [number, number] | null } {
    // Recheck the shared opt-out at the request boundary, including an already-open second view.
    const enabled = this.state.document.enabled && (this.services.document?.readEnabled() ?? false);
    if (enabled !== this.state.document.enabled) this.update({ document: { ...this.state.document, enabled } });
    return { enabled, range: clone(this.state.document.range) };
  }
  /** Draft only: never edits an in-flight or already-submitted message snapshot. */
  setSettings(settings: GenerationSettings): void {
    const models = this.state.runtime?.models ?? [];
    const next = models.length ? alignSettings(models, settings) : { model: settings.model, serviceTier: settings.serviceTier, effort: settings.effort };
    this.update({ draft: { ...this.state.draft, settings: next }, message: null });
  }
  // ---- runtime ----------------------------------------------------------------------------------
  async activate(): Promise<void> {
    if (this.state.document.enabled && this.state.document.phase === 'idle') void this.prepareContext().catch(() => {});
    try { await this.connect(); if (this.state.runtime?.models.length) await this.ensureConversation(); }
    catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); }
  }
  setDocumentEnabled(enabled: boolean): void {
    this.services.document?.writeEnabled(enabled);
    this.update({ document: { ...this.state.document, enabled } });
    if (!enabled && !this.submitting) this.documentJob?.controller.abort();
    if (enabled && !this.submitting) void this.prepareContext().catch(() => {});
  }
  setDocumentRange(first: number | null, last: number | null): void {
    const range: [number, number] | null = first === null && last === null ? null : [first ?? 1, last ?? first ?? 1];
    this.update({ document: { ...this.state.document, range, prepared: null, phase: 'idle', error: null } });
    if (!this.submitting) { this.documentJob?.controller.abort(); if (this.state.document.enabled) void this.prepareContext().catch(() => {}); }
  }
  acknowledgeContext(): void {
    this.services.document?.acknowledge?.();
    this.update({ document: { ...this.state.document, disclosure: false } });
    const pending = this.state.pendingExplain;
    if (pending) { this.update({ pendingExplain: null }); void this.explain(pending); }
  }
  prepareContext(): Promise<DocumentContext> { return this.prepareDocument(this.state.document.range); }
  private prepareDocument(range: readonly [number, number] | null): Promise<DocumentContext> {
    const key = JSON.stringify(range);
    if (this.documentJob?.range === key && !this.documentJob.controller.signal.aborted) return this.documentJob.promise;
    const controller = new AbortController();
    const job = { controller, range: key, promise: Promise.resolve(null as unknown as DocumentContext) };
    this.documentJob = job;
    this.update({ document: { ...this.state.document, phase: 'preparing', error: null, progress: { done: 0, total: 0 } } });
    job.promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      const service = this.services.document;
      if (!service) throw new Error('Current PDF context is unavailable.');
      const document = await service.prepare(controller.signal, progress => {
        if (this.documentJob === job) this.update({ document: { ...this.state.document, progress } });
      }, range ?? undefined);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      await service.validate(document);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      if (this.documentJob === job) this.update({ document: { ...this.state.document, prepared: document, phase: 'ready', error: null } });
      if (!document.pages.some(p => p.status === 'text')) throw new Error('No extractable text was found in this range. Nothing was sent. Use a readable PDF or attach the relevant page image.');
      return document;
    }).catch(error => {
      if (this.documentJob === job) this.update({ document: { ...this.state.document, phase: 'error', error: this.errorText(error) } });
      throw error;
    }).finally(() => { if (this.documentJob === job) this.documentJob = null; });
    return job.promise;
  }
  async retry(): Promise<void> { this.client = null; await this.activate(); }
  private connect(): Promise<ReaderClient> {
    if (this.client && this.client.snapshot().runtime === 'ready') return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.update({ connection: 'starting', message: null });
    this.connecting = this.services.ensureStarted().then(client => {
      this.client = client;
      this.unobserve?.(); this.unobserve = client.observe(snapshot => this.onRuntime(snapshot));
      return client;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private onRuntime(snapshot: RuntimeSnapshot): void {
    let draft = this.state.draft;
    if (snapshot.models.length && draft.settings) {
      const aligned = alignSettings(snapshot.models, draft.settings);
      if (aligned.model !== draft.settings.model || aligned.serviceTier !== draft.settings.serviceTier || aligned.effort !== draft.settings.effort) {
        draft = { ...draft, settings: aligned };
      }
    }
    this.update({ runtime: snapshot, draft, connection: snapshot.runtime === 'ready' ? 'ready' : 'error', message: snapshot.error ?? this.state.message });
    if (this.signedIn() && !this.continuing) { this.continuing = true; void this.continueAfterLogin().finally(() => { this.continuing = false; }); }
  }
  /** After a login the conversation is loaded; a single pending More details resumes exactly once. */
  private async continueAfterLogin(): Promise<void> {
    try {
      await this.ensureConversation();
      const pending = this.state.pendingExplain;
      if (pending && !this.state.document.disclosure) { this.update({ pendingExplain: null }); await this.submit(c => makeExplain(pending, c.id, this.services.uuid(), this.currentSettings() ?? c.settings, this.paperIdentity())); }
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private async ensureConversation(): Promise<Conversation> {
    const client = await this.connect();
    if (this.state.conversation) return this.state.conversation;
    const conversation = await client.current(this.paper, this.title, this.currentSettings() ?? undefined);
    this.update({ conversation, draft: { ...this.state.draft, settings: this.state.draft.settings ?? conversation.settings }, connection: 'ready', message: await this.isolationNote(client, conversation) });
    await this.sync();
    await this.refreshList();
    return conversation;
  }
  private async isolationNote(client: ReaderClient, conversation: Conversation): Promise<string | null> {
    if (conversation.messages.some(entry => entry.status === 'uncertain')) return UNCERTAIN_ISOLATION;
    const ids = new Set<string>();
    for (const entry of conversation.messages) {
      if (entry.status === 'pending' || entry.status === 'streaming') ids.add(entry.requestId);
      else if (entry.role === 'user' && !conversation.messages.some(message => message.requestId === entry.requestId && message.role === 'assistant' && (message.status === 'completed' || message.status === 'cancelled' || message.status === 'failed'))) {
        ids.add(entry.requestId);
      }
    }
    if (conversation.activeRequestId) ids.add(conversation.activeRequestId);
    for (const requestId of ids) {
      try { if ((await client.request(conversation.id, requestId)).state === 'uncertain') return UNCERTAIN_ISOLATION; }
      catch { /* missing request ids are ignored */ }
    }
    return null;
  }
  private stashDraft(): void {
    const id = this.state.conversation?.id;
    if (id) this.drafts.set(id, clone(this.state.draft));
  }
  private async refreshList(): Promise<void> {
    if (!this.client) return;
    this.update({ conversations: await this.client.list(this.paper) });
  }
  // ---- events -----------------------------------------------------------------------------------
  private listen(client: ReaderClient): void {
    if (this.unsubscribe) return;
    this.unsubscribe = client.subscribe(event => {
      if (!this.state.conversation || event.conversationId !== this.state.conversation.id) return;
      if (this.syncing) { this.buffered.push(event); return; }
      this.apply(event);
    });
  }
  /** Subscribe first, then read a consistent snapshot, then apply only newer buffered events. */
  private async sync(): Promise<void> {
    const client = this.client; const id = this.state.conversation?.id;
    if (!client || !id) return;
    const generation = ++this.syncGeneration;
    this.listen(client);
    this.syncing = true; this.buffered = [];
    try {
      const conversation = await client.get(id);
      if (generation !== this.syncGeneration) return;
      if (this.state.conversation?.id !== id) { this.syncing = false; this.buffered = []; return; }
      const buffered = this.buffered; this.buffered = []; this.syncing = false;
      this.update({ conversation });
      for (const event of buffered) if (event.seq > conversation.lastSeq) this.apply(event);
    } catch (error) { if (generation !== this.syncGeneration) return; this.syncing = false; this.buffered = []; this.update({ message: this.errorText(error) }); }
  }
  private apply(event: ReaderEvent): void {
    const conversation = this.state.conversation;
    if (!conversation || event.seq <= conversation.lastSeq) return;
    const next: Conversation = { ...conversation, messages: conversation.messages.map(m => ({ ...m })), lastSeq: event.seq };
    const settleMessages = (status: Message['status']) => { for (const m of next.messages) if (m.requestId === event.requestId && m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending')) m.status = status; };
    let message = this.state.message;
    switch (event.type) {
      case 'accepted': next.activeRequestId = event.requestId; break;
      case 'delta': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text += event.text; break;
      }
      case 'messageCompleted': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text = event.finalText; target.phase = event.phase; target.status = 'completed'; break;
      }
      case 'completed': settleMessages('completed'); next.activeRequestId = null; break;
      case 'cancelled': settleMessages('cancelled'); next.activeRequestId = null; break;
      case 'failed': settleMessages('failed'); next.activeRequestId = null; message = event.message; break;
      case 'uncertain': settleMessages('uncertain'); next.activeRequestId = null; message = event.message; break;
    }
    this.update({ conversation: next, message });
  }
  // ---- draft ------------------------------------------------------------------------------------
  addCitation(citation: Citation): void { this.draftVersion++; this.update({ draft: addCitation(this.state.draft, citation), message: null }); }
  removeCitation(citationId: string): void { this.draftVersion++; this.update({ draft: removeCitation(this.state.draft, citationId) }); }
  addImage(image: ImageAttachment): void { this.draftVersion++; this.update({ draft: addImage(this.state.draft, image), message: null }); }
  removeImage(imageId: string): void { this.draftVersion++; this.update({ draft: removeImage(this.state.draft, imageId) }); }
  setQuestion(question: string): void {
    if (this.state.draft.question === question) return;
    this.draftVersion++;
    this.state = { ...this.state, draft: { ...this.state.draft, question } };
    this.notify();
  }
  // ---- requests ---------------------------------------------------------------------------------
  /** More details: one explain request per click; when signed out the citation waits for the official login. */
  explain(citation: Citation): Promise<void> {
    const existing = this.explainFlights.get(citation.id); if (existing) return existing;
    const context = this.contextOptions(); const frozenSettings = this.currentSettings();
    if (context.enabled && this.state.document.disclosure) { this.update({ pendingExplain: clone(citation) }); return Promise.resolve(); }
    const flight = (async () => {
      const kept = clone(citation);
      try {
        await this.connect();
        if (!this.signedIn()) { this.update({ pendingExplain: kept, message: null }); await this.login(); return; }
        await this.ensureConversation();
        await this.submit(c => makeExplain(kept, c.id, this.services.uuid(), frozenSettings ?? c.settings, this.paperIdentity()), context);
      } catch (error) { this.update({ message: this.errorText(error) }); }
    })().finally(() => { this.explainFlights.delete(citation.id); });
    this.explainFlights.set(citation.id, flight);
    return flight;
  }
  send(): Promise<void> {
    if (this.sendFlight) return this.sendFlight;
    if (!this.state.draft.question.trim()) { this.update({ message: 'Enter a question first.' }); return Promise.resolve(); }
    const draft = clone(this.state.draft); const version = this.draftVersion;
    const settings = this.currentSettings(); const document = this.contextOptions();
    if (document.enabled) { this.services.document?.acknowledge?.(); this.update({ document: { ...this.state.document, disclosure: false } }); }
    this.sendFlight = this.sendDraft(draft, version, settings, document).finally(() => { this.sendFlight = null; });
    return this.sendFlight;
  }
  private async sendDraft(draft: Draft, version: number, settings: GenerationSettings | null, document: { enabled: boolean; range: [number, number] | null }): Promise<void> {
    try {
      await this.connect();
      if (!this.signedIn()) { this.update({ message: 'Sign in with ChatGPT first.' }); await this.login(); return; }
      await this.ensureConversation();
      const id = await this.submit(c => makeAsk(draft, c.id, this.services.uuid(), settings ?? c.settings, this.paperIdentity()), document);
      if (this.state.conversation?.id === id && this.draftVersion === version) this.update({ draft: { ...this.state.draft, question: '', citations: [], images: [] } });
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private async submit(build: (conversation: Conversation) => ReturnType<typeof makeAsk>, context = this.contextOptions()): Promise<string> {
    const conversation = this.state.conversation!;
    if (this.submitting || conversation.activeRequestId) throw new Error('This conversation is still answering; wait for it or stop it first.');
    this.submitting = true; this.update({ message: null });
    const input = build(conversation);
    try {
      const client = await this.connect();
      if (context.enabled) input.document = await this.prepareDocument(context.range);
      await client.send(input); await this.sync(); return conversation.id;
    }
    finally { this.submitting = false; this.update({}); }
  }
  async cancel(): Promise<void> {
    if (this.submitting && this.documentJob) { this.documentJob.controller.abort(); return; }
    const client = this.client; const conversation = this.state.conversation;
    if (!client || !conversation?.activeRequestId) return;
    try { await client.cancel(conversation.id, conversation.activeRequestId); } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async newConversation(): Promise<void> {
    try {
      const client = await this.connect();
      this.stashDraft();
      const conversation = await client.newConversation(this.paper, this.title, this.currentSettings() ?? undefined);
      this.update({ conversation, draft: { settings: this.state.draft.settings, paper: this.paper, question: '', citations: [], images: [] }, message: null }); await this.sync(); await this.refreshList();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async deleteConversation(id: string): Promise<void> {
    try {
      const client = await this.connect();
      this.stashDraft();
      const conversation = await client.deleteConversation(this.paper, id);
      this.drafts.delete(id);
      const empty: Draft = { settings: this.state.draft.settings, paper: this.paper, question: '', citations: [], images: [] };
      const stored = this.drafts.get(conversation.id) ?? empty;
      this.update({
        conversation,
        draft: { ...clone(stored), images: stored.images ?? [] },
        message: await this.isolationNote(client, conversation),
      });
      await this.sync();
      await this.refreshList();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async openConversation(id: string): Promise<void> {
    if (this.state.conversation?.id === id) return;
    try {
      const client = await this.connect();
      this.stashDraft();
      const conversation = await client.select(this.paper, id);
      const empty: Draft = { settings: this.state.draft.settings, paper: this.paper, question: '', citations: [], images: [] };
      const stored = this.drafts.get(id) ?? empty;
      this.update({ conversation, draft: { ...clone(stored), images: stored.images ?? [] }, message: await this.isolationNote(client, conversation) });
      await this.sync(); await this.refreshList();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  // ---- account ----------------------------------------------------------------------------------
  async login(): Promise<void> {
    try {
      const client = await this.connect();
      if (client.snapshot().account.state === 'signedIn') return;
      const flow = await client.startLogin();
      const url = new URL(flow.authorizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !LOGIN_HOSTS.includes(url.hostname)) throw new Error('Codex returned an unsupported login address.');
      this.services.openAuthorization(url.href);
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async cancelLogin(): Promise<void> { try { await this.client?.cancelLogin(); } catch (error) { this.update({ message: this.errorText(error) }); } }
  /** Copies whitelist JSON only. The view uses the host clipboard hook; this method never reads files. */
  async copyDiagnostics(): Promise<string | null> {
    try {
      const client = await this.connect();
      const id = this.state.conversation?.id;
      if (!id) { this.update({ message: 'There is no shareable conversation diagnostic.' }); return null; }
      const text = JSON.stringify(await client.diagnostics(id));
      this.update({ message: 'Copied shareable diagnostics. They do not include paper text, account details, or paths.' });
      return text;
    } catch (error) { this.update({ message: this.errorText(error) }); return null; }
  }
  dispose(): void { this.documentJob?.controller.abort(); this.renders.clear(); this.unsubscribe?.(); this.unsubscribe = null; this.unobserve?.(); this.unobserve = null; }
}
