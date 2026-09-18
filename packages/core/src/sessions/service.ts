import { ReaderError, paperId, type Conversation, type ErrorCode, type GenerationSettings, type ImageAttachment, type Message, type PaperScope, type ReaderEvent, type RequestState, type SendInput, type SendReceipt, type ShareableDiagnostics, type UUID } from '../../../contracts/src/index.ts';
import { shareableDiagnostics } from './diagnostics.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { documentSummary } from '../../../contracts/src/document.ts';
import { RuntimeFailure, type ModelOption } from '../../../contracts/src/runtime.ts';
import { validatePaperScope, validateSendInput, validateSettings } from '../../../contracts/src/validation.ts';
import { record } from '../codex/transport.ts';
import { string } from '../codex/models.ts';
import { parseThreadUsage } from '../codex/model-capabilities.ts';
import { describeTurnError, type TurnFailure } from '../codex/errors.ts';
import { parseThreadHistory, type HistoryTurn } from '../codex/history.ts';
import { readingInput, resolveSettings, resumeParams, threadParams, turnParams, validateThread, type ResolvedSettings } from '../codex/reader-policy.ts';
import type { ConversationStore, RequestRecord, StoredConversation } from './store.ts';

/** What the conversation service needs from the runtime session; no pipes or credentials. */
export interface ServiceUpstream {
  request(method: string, params: unknown): Promise<unknown>;
  models(): ModelOption[];
  ready(): boolean;
  signedIn(): boolean;
  /** Reader policy breach: the runtime must stop; the service has already marked the request. */
  breach(): void;
}
export interface ServiceOptions { cwd: string; uuid: () => string; now: () => string; deltaFlushMs?: number; generatedImage?: (item: unknown, model: string) => Promise<ImageAttachment> }
interface Run {
  conversationId: UUID; requestId: UUID; input: SendInput; resolved: ResolvedSettings;
  threadId: string | null; turnId: string | null; cancelWanted: boolean; interrupted: boolean; submitted: boolean; settled: boolean;
  items: Map<string, UUID>; pending: Map<UUID, string>; flushTimer: ReturnType<typeof setTimeout> | null;
  /** In-memory liveness: last time any notification for this turn reached the service. */
  lastEventAt: string | null;
  /** Epoch ms of the last published `progress` ping; 0 before the first. See `takeProgress`. */
  progressAt: number;
}
type Outcome = { kind: 'completed' } | { kind: 'cancelled' } | { kind: 'failed'; failure: TurnFailure } | { kind: 'uncertain'; message: string };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = DistributiveOmit<ReaderEvent, 'seq' | 'conversationId' | 'at'>;
type Change = (conversation: StoredConversation, emit: (event: Pending) => void) => void;
const ACTIVE: RequestState[] = ['accepted', 'dispatching', 'running'];
const HARMLESS_ITEMS = ['userMessage', 'reasoning', 'plan', 'contextCompaction'];
const ANSWER_LIMIT = 1024 * 1024;
/** At most one liveness `progress` event per run per second; reasoning deltas arrive far faster. */
const PROGRESS_INTERVAL_MS = 1000;
async function hashInput(input: SendInput, version: 1 | 2 = 2): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ conversationId: input.conversationId, action: input.action, question: input.question, citations: input.citations, settings: input.settings, images: input.images ?? [], ...(input.document ? { document: input.document, paper: input.paper } : {}), ...(version === 2 && !input.document && input.paper ? { paper: input.paper } : {}), ...(input.workflow ? { workflow: input.workflow } : {}), ...(input.references ? { references: input.references } : {}), ...(input.batch ? { batch: input.batch } : {}), ...(input.contextReport ? { contextReport: input.contextReport } : {}) }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
const TERMINAL_STATES: RequestState[] = ['completed', 'cancelled', 'failed', 'uncertain'];
/** Longest chat name derived from a question; longer questions are cut at a word edge with an ellipsis. */
export const DERIVED_TITLE_LIMIT = 60;
/**
 * The chat name a first question yields: its first non-empty line, whitespace collapsed, cut to
 * `DERIVED_TITLE_LIMIT` characters. An empty question (a selection-only explain) yields null so the
 * chat keeps the name it was created with.
 */
export function titleFromQuestion(question: string): string | null {
  const line = question.split(/\r?\n/u).map(part => part.replace(/\s+/gu, ' ').trim()).find(part => part.length > 0);
  if (!line) return null;
  const characters = Array.from(line);
  if (characters.length <= DERIVED_TITLE_LIMIT) return line;
  const cut = characters.slice(0, DERIVED_TITLE_LIMIT).join('');
  const edge = cut.lastIndexOf(' ');
  return `${(edge > DERIVED_TITLE_LIMIT / 2 ? cut.slice(0, edge) : cut).trimEnd()}…`;
}
function toPublic(conversation: StoredConversation): Conversation {
  const requestTiming = conversation.requests.map(request => ({
    requestId: request.requestId,
    acceptedAt: request.createdAt,
    firstTextAt: request.firstTokenAt ?? null,
    settledAt: TERMINAL_STATES.includes(request.state) ? request.updatedAt : null,
    // Omitted until something was actually heard: an absent mark means "no activity observed", never a
    // fabricated zero, and pre-existing records without it stay valid.
    ...(request.lastEventAt !== undefined ? { lastActivityAt: request.lastEventAt } : {}),
  }));
  return {
    id: conversation.id,
    requestTiming,
    paper: clone(conversation.paper),
    title: conversation.title,
    ...(conversation.paperIdentity ? { paperIdentity: clone(conversation.paperIdentity) } : {}),
    ...(conversation.titleCustomized ? { titleCustomized: true } : {}),
    ...(conversation.parentConversationId ? { parentConversationId: conversation.parentConversationId, forkMessageId: conversation.forkMessageId } : {}),
    ...(conversation.archivedAt ? { archivedAt: conversation.archivedAt } : {}),
    ...(conversation.usage ? { usage: clone(conversation.usage) } : {}),
    settings: clone(conversation.settings),
    activeRequestId: conversation.activeRequestId,
    queuedRequestIds: conversation.requests.filter(request => request.state === 'accepted' && request.requestId !== conversation.activeRequestId).map(request => request.requestId),
    ...(conversation.activeBatchId ? { activeBatchId: conversation.activeBatchId } : {}),
    messages: clone(conversation.messages),
    lastSeq: conversation.lastSeq,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
function phaseOf(value: unknown): Message['phase'] { return value === 'commentary' ? 'commentary' : value === 'final_answer' || value === 'final' ? 'final' : null; }
/**
 * Conversations bound to attachments, one active request per conversation. All state changes for a
 * conversation run through one queue, so snapshots and event seq numbers describe the same state.
 */
export class ReaderService {
  private loaded = new Map<UUID, StoredConversation>();
  private queues = new Map<UUID, Promise<void>>();
  private runs = new Map<UUID, Run>();
  private runsByThread = new Map<string, Run>();
  private knownThreads = new Set<string>();
  private knownDocuments = new Map<string, string>();
  private usageRoutes = new Map<string, { conversationId: UUID; requestId: UUID; model: string }>();
  private listeners = new Set<(event: ReaderEvent) => void>();
  private recovered = new Set<UUID>();
  private recovering = new Set<UUID>();
  private lastErrorCodes = new Map<UUID, ErrorCode>();
  private closed = false;
  private opening = new Map<string, Promise<Conversation>>();
  constructor(private store: ConversationStore, private upstream: ServiceUpstream, private options: ServiceOptions) {}
  subscribe(listener: (event: ReaderEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  // ---- conversations -------------------------------------------------------------------------
  current(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> {
    const scope = validatePaperScope(paper);
    const key = paperId(scope);
    const pending = this.opening.get(key);
    if (pending) return pending.then(clone);
    const operation = this.openCurrent(scope, title, settings).finally(() => { this.opening.delete(key); });
    this.opening.set(key, operation);
    return operation.then(clone);
  }
  private async openCurrent(scope: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> {
    const existing = await this.store.current(scope);
    if (existing) {
      await this.load(existing.id, existing);
      await this.ensureRecovered(existing.id);
      return toPublic(await this.load(existing.id));
    }
    return this.create(scope, title, settings);
  }
  /** The stored current chat, if any. Nothing is created: opening the sidebar must not leave a record behind. */
  async peekCurrent(paper: PaperScope): Promise<Conversation | null> {
    const scope = validatePaperScope(paper);
    const existing = await this.store.current(scope);
    if (!existing) return null;
    await this.load(existing.id, existing);
    await this.ensureRecovered(existing.id);
    return toPublic(await this.load(existing.id));
  }
  newConversation(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> {
    return this.create(validatePaperScope(paper), title, settings);
  }
  private async create(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> {
    const initial = settings ? validateSettings(settings) : this.defaultSettings();
    if (!initial) throw new ReaderError('MODEL_UNAVAILABLE', 'Sign in and load the model catalog before starting a conversation.');
    const created = await this.store.create(paper, title.slice(0, 1024), initial);
    this.loaded.set(created.id, created);
    return toPublic(created);
  }
  private defaultSettings(): GenerationSettings | null {
    const model = this.upstream.models().find(m => m.isDefault);
    return model ? { model: model.id, serviceTier: model.defaultServiceTier, effort: model.defaultReasoningEffort } : null;
  }
  async list(paper: PaperScope): Promise<Conversation[]> {
    const all = await this.store.list(validatePaperScope(paper));
    const result: Conversation[] = [];
    for (const c of all) result.push(toPublic(await this.load(c.id, c)));
    return result;
  }
  async get(conversationId: string): Promise<Conversation> {
    await this.ensureRecovered(conversationId);
    return toPublic(await this.load(conversationId));
  }
  async select(paper: PaperScope, conversationId: string): Promise<Conversation> {
    const selected = await this.store.select(validatePaperScope(paper), conversationId);
    await this.load(selected.id, selected);
    await this.ensureRecovered(selected.id);
    return toPublic(await this.load(selected.id));
  }
  async deleteConversation(paper: PaperScope, conversationId: string): Promise<Conversation | null> {
    const scope = validatePaperScope(paper);
    await this.serial(conversationId, async () => {
      const conversation = await this.load(conversationId);
      if (paperId(scope) !== paperId(conversation.paper)) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
      if (conversation.activeRequestId || conversation.requests.some(r => ACTIVE.includes(r.state) || r.state === 'uncertain')) {
        throw new ReaderError('BUSY', 'Stop the task and wait for a confirmed result before deleting this chat.');
      }
      await this.store.remove(scope, conversationId);
      this.loaded.delete(conversationId); this.recovered.delete(conversationId);
    });
    // Deleting the last chat leaves the attachment with no chat, not with a freshly created empty one.
    return this.peekCurrent(scope);
  }
  async renameConversation(conversationId: string, title: string): Promise<Conversation> {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 1024) throw new ReaderError('INVALID_REQUEST', 'Enter a chat name between 1 and 1024 characters.');
    await this.mutate(conversationId, c => { c.title = title.trim(); c.titleCustomized = true; });
    return toPublic(await this.load(conversationId));
  }
  async branchConversation(conversationId: string, messageId: string): Promise<Conversation> {
    const source = await this.load(conversationId);
    const position = source.messages.findIndex(message => message.id === messageId);
    if (position < 0) throw new ReaderError('NOT_FOUND', 'Unknown message');
    // Editing starts before the selected question; regenerating starts before its question too.
    const requestId = source.messages[position]!.requestId;
    const first = source.messages.findIndex(message => message.requestId === requestId);
    const kept = source.messages.slice(0, first).filter(message => message.status === 'completed');
    const created = await this.store.create(source.paper, source.paperIdentity?.title ?? source.title, source.settings);
    created.parentConversationId = source.id; created.forkMessageId = messageId;
    if (source.paperIdentity) created.paperIdentity = clone(source.paperIdentity);
    created.messages = clone(kept);
    const sources = new Set(kept.flatMap(message => [message.document?.id, ...(message.referenceDocuments?.map(ref => ref.document.id) ?? [])]).filter((id): id is string => !!id));
    created.documents = Object.fromEntries(Object.entries(source.documents ?? {}).filter(([id]) => sources.has(id)));
    await this.store.save(created); this.loaded.set(created.id, created);
    return toPublic(created);
  }
  /** Loads once. Leftover dispatching/running becomes uncertain; leftover accepted is redelivered once after recover. */
  private async load(id: UUID, fetched?: StoredConversation): Promise<StoredConversation> {
    const live = this.loaded.get(id); if (live) return live;
    const conversation = fetched ?? await this.store.get(id);
    const leftover = conversation.requests.filter(r => r.state === 'dispatching' || r.state === 'running');
    if (leftover.length) {
      const now = this.options.now();
      for (const request of leftover) { request.state = 'uncertain'; request.updatedAt = now; }
      for (const message of conversation.messages) if (message.role === 'assistant' && ['pending', 'streaming'].includes(message.status)) message.status = 'uncertain';
      if (conversation.activeRequestId && leftover.some(r => r.requestId === conversation.activeRequestId)) conversation.activeRequestId = null;
      await this.store.save(conversation).catch(() => undefined);
    }
    this.loaded.set(id, conversation);
    return conversation;
  }
  private async recoverOnce(conversationId: UUID): Promise<Run | null> {
    if (this.recovered.has(conversationId)) return null;
    if (this.closed || !this.upstream.ready() || !this.upstream.signedIn()) return null;
    this.recovering.add(conversationId);
    try {
      const run = await this.recover(conversationId);
      this.recovered.add(conversationId);
      return run;
    } catch { this.recovered.add(conversationId); return null; }
    finally { this.recovering.delete(conversationId); }
  }
  private ensureRecovered(conversationId: UUID): Promise<void> {
    if (this.recovered.has(conversationId) && !this.recovering.has(conversationId)) return Promise.resolve();
    return this.serial(conversationId, () => this.recoverOnce(conversationId)).then(run => { if (run) return this.dispatch(run); });
  }
  /** Accepted leftover is dispatched once. Uncertain leftover: resume the thread, then match `thread/read` history. */
  private async recover(conversationId: UUID): Promise<Run | null> {
    const live = await this.load(conversationId);
    const uncertain = [...live.requests].reverse().find(r => r.state === 'uncertain');
    if (!uncertain) {
      const accepted = this.nextAccepted(live);
      if (accepted && (!live.activeRequestId || live.activeRequestId === accepted.requestId)) return this.redeliver(live, accepted);
      return null;
    }
    const threadId = live.upstream.threadId;
    if (!uncertain || !threadId) return null;
    const settings = live.messages.find(m => m.requestId === uncertain.requestId && m.role === 'user')?.settings ?? live.settings;
    const original = live.messages.find(message => message.requestId === uncertain.requestId && message.role === 'user');
    const diagram = original?.workflow?.skill?.workflow === 'diagram' && original.batch?.phase !== 'map';
    const model = this.upstream.models().find(m => m.id === settings.model);
    if (!model) return null;
    try {
      if (!this.knownThreads.has(threadId)) {
        const resolved = resolveSettings(settings, model);
        const response = await this.upstream.request('thread/resume', resumeParams(this.options.cwd, threadId, resolved, diagram));
        validateThread(response, this.options.cwd, resolved, { ephemeral: false, emptyHistory: false });
        if (diagram || live.upstream.permissionMode === 'diagram') await this.verifyImagePermission(threadId, diagram);
        this.knownThreads.add(threadId);
      }
    } catch { return null; }
    let history: HistoryTurn[];
    try { history = parseThreadHistory(await this.upstream.request('thread/read', { threadId, includeTurns: true })); }
    catch { return null; }
    const matched = [...history].reverse().find(turn => turn.requestIds.includes(uncertain.requestId));
    if (!matched) return null;
    if (matched.unsupportedItemTypes.length || (!diagram && matched.imageGenerations.length)) {
      await this.commit(conversationId, (c, emit) => {
        const request = c.requests.find(request => request.requestId === uncertain.requestId)!;
        request.state = 'failed'; request.updatedAt = this.options.now(); this.releaseActive(c, request.requestId);
        for (const message of c.messages) if (message.requestId === request.requestId && message.role === 'assistant') message.status = 'failed';
        emit({ type: 'failed', requestId: request.requestId, code: 'UNSUPPORTED_INTERACTION', message: 'Unexpected tool activity in saved history; the reader connection has been stopped.' });
      });
      this.upstream.breach(); return null;
    }
    await this.applyHistory(live, uncertain, matched);
    if (original?.batch && matched.status !== 'inProgress' && (matched.status !== 'completed' || original.batch.phase === 'reduce')) await this.commit(conversationId, c => { if (c.activeBatchId === original.batch!.id) delete c.activeBatchId; });
    const reconciled = await this.load(conversationId);
    if (!reconciled.activeRequestId && !reconciled.requests.some(request => request.state === 'uncertain')) {
      const next = this.nextAccepted(reconciled);
      if (next) return this.redeliver(reconciled, next);
    }
    return null;
  }
  private async redeliver(conversation: StoredConversation, request: RequestRecord): Promise<Run | null> {
    const input = await this.reconstructInput(conversation, request);
    const model = input ? this.upstream.models().find(m => m.id === input.settings.model) : undefined;
    if (!input || !model) {
      await this.commit(conversation.id, c => {
        const rec = c.requests.find(r => r.requestId === request.requestId);
        if (rec && rec.state === 'accepted') { rec.state = 'uncertain'; rec.updatedAt = this.options.now(); }
        if (c.activeRequestId === request.requestId) c.activeRequestId = null;
      });
      return null;
    }
    const run: Run = { conversationId: conversation.id, requestId: request.requestId, input, resolved: resolveSettings(input.settings, model), threadId: conversation.upstream.threadId, turnId: request.turnId, cancelWanted: false, interrupted: false, submitted: false, settled: false, items: new Map(), pending: new Map(), flushTimer: null, lastEventAt: null, progressAt: 0 };
    await this.commit(conversation.id, c => { c.activeRequestId = request.requestId; if (input.batch) c.activeBatchId = input.batch.id; });
    this.runs.set(run.requestId, run);
    return run;
  }
  private async reconstructInput(conversation: StoredConversation, request: RequestRecord): Promise<SendInput | null> {
    const user = conversation.messages.find(m => m.requestId === request.requestId && m.role === 'user');
    if (!user) return null;
    const paper = user.paper ?? (request.hashVersion === 2 ? undefined : user.citations[0]
      ? { title: user.citations[0].title, authors: user.citations[0].authors, ...(user.citations[0].year ? { year: user.citations[0].year } : {}), ...(user.citations[0].doi ? { doi: user.citations[0].doi } : {}) }
      : conversation.title.trim() ? { title: conversation.title, authors: [] } : undefined);
    const document = user.document ? conversation.documents?.[user.document.id] : undefined;
    if (user.document && !document) return null;
    const references = user.references?.map(reference => {
      const source = user.referenceDocuments?.find(source => source.referenceId === reference.id);
      const document = source ? conversation.documents?.[source.document.id] : undefined;
      return { ...reference, ...(document ? { document } : {}) };
    });
    if (user.referenceDocuments?.some(source => !conversation.documents?.[source.document.id])) return null;
    const images = { ...(user.images?.length ? { images: user.images } : {}), ...(document ? { document } : {}), ...(references ? { references } : {}), ...(user.workflow ? { workflow: user.workflow } : {}), ...(user.batch ? { batch: user.batch } : {}), ...(user.contextReport ? { contextReport: user.contextReport } : {}) };
    if (request.action) {
      const restored = { requestId: request.requestId, conversationId: conversation.id, action: request.action, question: user.text, citations: user.citations, settings: user.settings, ...(paper ? { paper } : {}), ...images };
      if ((request.hashVersion === 2 || user.workflow || user.references || user.batch || user.contextReport) && await hashInput(restored, request.hashVersion ?? 1) !== request.hash) return null;
      return restored;
    }
    for (const action of ['explain', 'ask'] as const) {
      const input: SendInput = { requestId: request.requestId, conversationId: conversation.id, action, question: user.text, citations: user.citations, settings: user.settings, ...(paper ? { paper } : {}), ...images };
      if (await hashInput(input, request.hashVersion ?? 1) === request.hash) return input;
    }
    if (request.hashVersion === 2) return null;
    return { requestId: request.requestId, conversationId: conversation.id, action: user.citations.length > 0 ? 'explain' : 'ask', question: user.text, citations: user.citations, settings: user.settings, ...(paper ? { paper } : {}), ...images };
  }
  private async applyHistory(conversation: StoredConversation, request: RequestRecord, turn: HistoryTurn): Promise<void> {
    if (turn.status === 'inProgress') {
      const input = await this.reconstructInput(conversation, request);
      const threadId = conversation.upstream.threadId;
      const model = input ? this.upstream.models().find(m => m.id === input.settings.model) : undefined;
      if (!input || !model || !threadId) return;
      await this.commit(conversation.id, c => {
        const rec = c.requests.find(r => r.requestId === request.requestId);
        if (rec) { rec.state = 'running'; rec.turnId = turn.id; rec.updatedAt = this.options.now(); }
        c.activeRequestId = request.requestId;
        for (const message of c.messages) if (message.requestId === request.requestId && message.role === 'assistant' && message.status === 'uncertain') message.status = 'streaming';
      });
      const run: Run = { conversationId: conversation.id, requestId: request.requestId, input, resolved: resolveSettings(input.settings, model), threadId, turnId: turn.id, cancelWanted: false, interrupted: false, submitted: true, settled: false, items: new Map(), pending: new Map(), flushTimer: null, lastEventAt: null, progressAt: 0 };
      const assistants = (await this.load(conversation.id)).messages.filter(message => message.requestId === request.requestId && message.role === 'assistant');
      for (const message of assistants) if (message.upstreamItemId) run.items.set(message.upstreamItemId, message.id);
      // Legacy snapshots had no native item ids. Reconcile their reported order once.
      for (const [index, item] of turn.agentMessages.entries()) { const message = assistants[index]; if (message && !message.upstreamItemId && !run.items.has(item.itemId)) run.items.set(item.itemId, message.id); }
      this.runs.set(run.requestId, run);
      this.runsByThread.set(threadId, run);
      this.usageRoutes.set(threadId, { conversationId: conversation.id, requestId: request.requestId, model: input.settings.model });
      this.knownThreads.add(threadId);
      return;
    }
    if (turn.status === 'completed') {
      const user = conversation.messages.find(message => message.requestId === request.requestId && message.role === 'user');
      const diagram = user?.workflow?.skill?.workflow === 'diagram' && user.batch?.phase !== 'map';
      if (diagram) { await this.recoverImages(conversation, request, turn); return; }
      if (turn.imageGenerations.length) throw new ReaderError('READER_POLICY_UNAVAILABLE', 'Unexpected image generation in a reading request.');
      await this.commit(conversation.id, (c, emit) => {
        this.releaseActive(c, request.requestId);
        const rec = c.requests.find(r => r.requestId === request.requestId);
        const last = turn.agentMessages.at(-1);
        if (!last || !last.text.trim()) {
          if (rec) { rec.state = 'failed'; rec.turnId = turn.id; rec.updatedAt = this.options.now(); }
          for (const message of c.messages) if (message.requestId === request.requestId && message.role === 'assistant' && (message.status === 'streaming' || message.status === 'pending' || message.status === 'uncertain')) message.status = 'failed';
          this.lastErrorCodes.set(c.id, 'INTERNAL_ERROR');
          emit({ type: 'failed', requestId: request.requestId, code: 'INTERNAL_ERROR', message: 'The model completed without an answer.' });
          return;
        }
        this.recordFirstText(c, request.requestId, true);
        const settings = c.messages.find(m => m.requestId === request.requestId && m.role === 'user')?.settings ?? c.settings;
        const existing = c.messages.filter(m => m.requestId === request.requestId && m.role === 'assistant');
        let lastId = existing.at(-1)?.id ?? this.options.uuid();
        for (let i = 0; i < turn.agentMessages.length; i++) {
          const agent = turn.agentMessages[i]!;
          const phase = phaseOf(agent.phase);
          const message = existing.find(message => message.upstreamItemId === agent.itemId) ?? existing[i];
          if (message) {
            message.text = agent.text; message.phase = phase; message.status = 'completed'; message.upstreamItemId = agent.itemId; lastId = message.id;
            emit({ type: 'messageCompleted', requestId: request.requestId, messageId: message.id, finalText: agent.text, phase });
          } else {
            const created: Message = { id: this.options.uuid(), upstreamItemId: agent.itemId, requestId: request.requestId, role: 'assistant', phase, settings, text: agent.text, citations: [], status: 'completed' };
            c.messages.push(created); lastId = created.id;
            emit({ type: 'messageCompleted', requestId: request.requestId, messageId: created.id, finalText: agent.text, phase });
          }
        }
        if (rec) { rec.state = 'completed'; rec.turnId = turn.id; rec.updatedAt = this.options.now(); }
        emit({ type: 'completed', requestId: request.requestId, messageId: lastId, finalText: last.text });
      });
      return;
    }
    if (turn.status === 'interrupted') {
      await this.commit(conversation.id, (c, emit) => {
        this.releaseActive(c, request.requestId);
        const rec = c.requests.find(r => r.requestId === request.requestId);
        if (rec) { rec.state = 'cancelled'; rec.turnId = turn.id; rec.updatedAt = this.options.now(); }
        const last = c.messages.filter(m => m.requestId === request.requestId && m.role === 'assistant').at(-1);
        for (const message of c.messages) if (message.requestId === request.requestId && message.role === 'assistant' && (message.status === 'streaming' || message.status === 'pending' || message.status === 'uncertain')) message.status = 'cancelled';
        emit({ type: 'cancelled', requestId: request.requestId, messageId: last?.id ?? null });
      });
      return;
    }
    const failure = describeTurnError(turn.error);
    await this.commit(conversation.id, (c, emit) => {
      this.releaseActive(c, request.requestId);
      const rec = c.requests.find(r => r.requestId === request.requestId);
      if (rec) { rec.state = 'failed'; rec.turnId = turn.id; rec.updatedAt = this.options.now(); }
      for (const message of c.messages) if (message.requestId === request.requestId && message.role === 'assistant' && (message.status === 'streaming' || message.status === 'pending' || message.status === 'uncertain')) message.status = 'failed';
      this.lastErrorCodes.set(c.id, failure.code);
      emit({ type: 'failed', requestId: request.requestId, code: failure.code, message: failure.message });
    });
  }
  private async recoverImages(conversation: StoredConversation, request: RequestRecord, turn: HistoryTurn): Promise<void> {
    const settings = conversation.messages.find(message => message.requestId === request.requestId && message.role === 'user')?.settings ?? conversation.settings;
    let images: ImageAttachment[] = [];
    try {
      if (turn.imageGenerations.length) {
        for (const item of turn.imageGenerations) {
          const persisted = conversation.messages.find(message => message.requestId === request.requestId && message.upstreamItemId === item.id)?.generatedImages;
          if (persisted?.length) images.push(...persisted);
          else { if (!this.options.generatedImage) throw new Error('No image output adapter'); images.push(await this.options.generatedImage(item, settings.model)); }
        }
      } else images = conversation.messages.filter(message => message.requestId === request.requestId).flatMap(message => message.generatedImages ?? []);
    } catch { images = []; }
    const caption = turn.agentMessages.filter(message => message.phase !== 'commentary').map(message => message.text).join('\n\n');
    await this.commit(conversation.id, (c, emit) => {
      this.releaseActive(c, request.requestId);
      const record = c.requests.find(record => record.requestId === request.requestId)!;
      record.turnId = turn.id; record.updatedAt = this.options.now();
      if (!images.length || caption.length > ANSWER_LIMIT) {
        record.state = 'failed';
        for (const message of c.messages) if (message.role === 'assistant' && message.requestId === request.requestId && ['pending', 'streaming', 'uncertain'].includes(message.status)) message.status = 'failed';
        emit({ type: 'failed', requestId: request.requestId, code: 'INTERNAL_ERROR', message: 'The completed image task has no recoverable verified image. It was not sent again.' });
        return;
      }
      const messageId = c.messages.find(message => message.requestId === request.requestId && message.role === 'assistant')?.id ?? this.options.uuid();
      this.recordFirstText(c, request.requestId, caption.length > 0);
      c.messages = c.messages.filter(message => message.requestId !== request.requestId || message.role !== 'assistant');
      c.messages.push({ id: messageId, requestId: request.requestId, role: 'assistant', phase: 'final', settings, text: caption, citations: [], status: 'completed', generatedImages: images });
      record.state = 'completed';
      for (const image of images) emit({ type: 'image', requestId: request.requestId, messageId, image });
      emit({ type: 'messageCompleted', requestId: request.requestId, messageId, finalText: caption, phase: 'final' });
      emit({ type: 'completed', requestId: request.requestId, messageId, finalText: caption });
    });
  }
  private releaseActive(conversation: StoredConversation, requestId: UUID): void {
    if (conversation.activeRequestId === requestId) conversation.activeRequestId = null;
  }
  private serial<T>(conversationId: UUID, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve();
    const result = previous.then(operation);
    this.queues.set(conversationId, result.then(() => undefined, () => undefined));
    return result;
  }
  /** Inside the queue: mutate a copy, persist, then publish memory and events. Nothing leaks on a failed write unless forced. */
  private async commit(conversationId: UUID, change: Change, force = false): Promise<void> {
    const live = await this.load(conversationId);
    const next = clone(live); const events: ReaderEvent[] = [];
    change(next, event => { events.push({ ...event, seq: ++next.lastSeq, conversationId, at: this.options.now() }); });
    try { await this.store.save(next); } catch (error) { if (!force) throw error; }
    this.loaded.set(conversationId, next);
    for (const event of events) this.publish(event);
  }
  private mutate(conversationId: UUID, change: Change): Promise<void> { return this.serial(conversationId, () => this.commit(conversationId, change)); }
  private publish(event: ReaderEvent): void { for (const listener of this.listeners) { try { listener(clone(event)); } catch { /* views must not affect the service */ } } }
  private receipt(request: RequestRecord, replay: boolean): SendReceipt { return { requestId: request.requestId, state: request.state, replay }; }
  // ---- requests --------------------------------------------------------------------------------
  enqueue(raw: unknown): Promise<SendReceipt> { return this.send(raw, true); }
  async releaseBatch(conversationId: UUID, batchId: UUID): Promise<void> {
    await this.mutate(conversationId, c => {
      if (!c.activeBatchId) return;
      if (c.activeBatchId !== batchId) throw new ReaderError('REQUEST_CONFLICT', 'A different reading batch owns this conversation.');
      if (c.activeRequestId || c.requests.some(request => request.state === 'uncertain')) throw new ReaderError('BUSY', 'Confirm the current request before releasing the reading batch.');
      delete c.activeBatchId;
    });
    void this.startQueued(conversationId);
  }
  async send(raw: unknown, allowQueue = false): Promise<SendReceipt> {
    const input = validateSendInput(raw);
    const hash = await hashInput(input);
    await this.ensureRecovered(input.conversationId);
    const outcome = await this.serial(input.conversationId, async (): Promise<{ receipt: SendReceipt; run: Run | null }> => {
      const live = await this.load(input.conversationId);
      const existing = live.requests.find(r => r.requestId === input.requestId);
      if (existing) {
        if (existing.hash !== (existing.hashVersion === 2 ? hash : await hashInput(input, 1))) throw new ReaderError('REQUEST_CONFLICT', 'This request ID was already used for different content.');
        return { receipt: this.receipt(existing, true), run: null };
      }
      if (this.closed || !this.upstream.ready()) throw new ReaderError('RUNTIME_UNAVAILABLE', 'Codex is not available; retry the connection first.', true);
      if (!this.upstream.signedIn()) throw new ReaderError('AUTH_REQUIRED', 'Sign in with ChatGPT before sending.');
      if (input.citations.some(c => paperId(c.paper) !== paperId(live.paper))) throw new ReaderError('INVALID_REQUEST', 'Citations must come from the attachment of this conversation.');
      if (input.document && paperId(input.document.paper) !== paperId(live.paper)) throw new ReaderError('INVALID_REQUEST', 'PDF context must come from the attachment of this conversation.');
      if (input.document && input.citations.some(citation => citation.documentRevision && JSON.stringify(citation.documentRevision) !== JSON.stringify(input.document!.revision))) throw new ReaderError('INVALID_REQUEST', 'A selection belongs to a different PDF version. Select the passage again before combining it with this document.');
      const inputSources = new Map<string, string>();
      for (const source of [input.document, ...(input.references?.map(reference => reference.document) ?? [])]) {
        if (!source) continue;
        const body = JSON.stringify(source);
        if (inputSources.has(source.id) && inputSources.get(source.id) !== body) throw new ReaderError('REQUEST_CONFLICT', 'Two sources in this request use the same identity for different content.');
        inputSources.set(source.id, body);
      }
      if (input.document && live.documents?.[input.document.id] && JSON.stringify(live.documents[input.document.id]) !== JSON.stringify(input.document)) throw new ReaderError('REQUEST_CONFLICT', 'This PDF snapshot identity already refers to different content.');
      for (const ref of input.references ?? []) {
        if (ref.paper && ref.paper.clientId !== live.paper.clientId) throw new ReaderError('INVALID_REQUEST', 'A reference belongs to a different profile.');
        if (ref.document && live.documents?.[ref.document.id] && JSON.stringify(live.documents[ref.document.id]) !== JSON.stringify(ref.document)) throw new ReaderError('REQUEST_CONFLICT', 'A referenced snapshot identity already refers to different content.');
      }
      const model = this.upstream.models().find(m => m.id === input.settings.model);
      if (!model) throw new ReaderError('MODEL_UNAVAILABLE', 'The selected model is not in the current catalog.');
      if (input.images?.length && !model.inputModalities?.includes('image')) throw new ReaderError('MODEL_UNAVAILABLE', 'This model has not reported support for image input. Choose an image-capable model.');
      if (input.settings.effort !== null && !model.supportedReasoningEfforts.some(e => e.id === input.settings.effort)) throw new ReaderError('INVALID_REQUEST', 'The selected reasoning effort is not supported by this model.');
      if (input.settings.serviceTier !== null && !model.serviceTiers.some(t => t.id === input.settings.serviceTier)) throw new ReaderError('INVALID_REQUEST', 'The selected speed is not supported by this model.');
      if (live.requests.some(r => r.state === 'uncertain')) throw new ReaderError('BUSY', 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.');
      const otherBatch = live.activeBatchId && input.batch?.id !== live.activeBatchId;
      if ((live.activeRequestId || otherBatch) && !allowQueue) throw new ReaderError('BUSY', 'This conversation is still answering; wait for it or stop it first.');
      if (live.requests.filter(request => request.state === 'accepted').length >= 10) throw new ReaderError('BUSY', 'This chat already has ten waiting questions.');
      const waiting = !!live.activeRequestId || !!otherBatch;
      const now = this.options.now();
      const request: RequestRecord = { requestId: input.requestId, hash, hashVersion: 2, state: 'accepted', turnId: null, createdAt: now, updatedAt: now, action: input.action };
      await this.commit(input.conversationId, (c, emit) => {
        c.requests.push(request);
        c.schemaVersion = 3;
        if (input.document) c.documents = { ...c.documents, [input.document.id]: input.document };
        const references = input.references?.map(({ document, ...reference }) => {
          if (document) c.documents = { ...c.documents, [document.id]: document };
          return reference;
        });
        if (input.paper) c.paperIdentity = input.paper;
        // The first question names the chat, the way a chat tab is named after what was asked; a name
        // the owner typed is never overwritten, and a chat that already has messages keeps its name.
        if (c.messages.length === 0 && !c.titleCustomized) c.title = titleFromQuestion(input.question) ?? c.title;
        c.messages.push({ id: this.options.uuid(), requestId: input.requestId, role: 'user', phase: null, settings: input.settings, text: input.question, citations: input.citations, status: 'completed', action: input.action,
          ...(input.images?.length ? { images: input.images } : {}), ...(input.paper ? { paper: input.paper } : {}), ...(input.document ? { document: documentSummary(input.document) } : {}),
          ...(input.workflow ? { workflow: input.workflow } : {}), ...(input.batch ? { batch: input.batch } : {}), ...(input.contextReport ? { contextReport: input.contextReport } : {}),
          ...(references ? { references, referenceDocuments: input.references!.flatMap(ref => ref.document ? [{ referenceId: ref.id, document: documentSummary(ref.document) }] : []) } : {}),
        });
        if (!waiting) { c.activeRequestId = input.requestId; if (input.batch) c.activeBatchId = input.batch.id; }
        c.settings = input.settings;
        emit({ type: 'accepted', requestId: input.requestId });
      });
      if (waiting) return { receipt: this.receipt(request, false), run: null };
      const run: Run = { conversationId: input.conversationId, requestId: input.requestId, input, resolved: resolveSettings(input.settings, model), threadId: null, turnId: null, cancelWanted: false, interrupted: false, submitted: false, settled: false, items: new Map(), pending: new Map(), flushTimer: null, lastEventAt: null, progressAt: 0 };
      this.runs.set(input.requestId, run);
      return { receipt: this.receipt(request, false), run };
    });
    if (outcome.run) void this.dispatch(outcome.run);
    return outcome.receipt;
  }
  private async dispatch(run: Run): Promise<void> {
    const { conversationId, requestId, resolved } = run; const cwd = this.options.cwd;
    try {
      if (run.cancelWanted) { await this.settle(run, { kind: 'cancelled' }); return; }
      await this.mutate(conversationId, c => { this.setState(c, requestId, 'dispatching'); });
      if (run.settled) return;
      if (this.closed || !this.upstream.ready()) throw new ReaderError('RUNTIME_UNAVAILABLE', 'Codex is not available; nothing was submitted.', true);
      const conversation = await this.load(conversationId);
      const diagram = run.input.workflow?.skill?.workflow === 'diagram' && run.input.batch?.phase !== 'map';
      const mode = diagram ? 'diagram' : 'read';
      const oldMode = conversation.upstream.permissionMode ?? 'read';
      let threadId = run.input.batch ? null : conversation.upstream.threadId;
      const fresh = !threadId;
      if (threadId && (!this.knownThreads.has(threadId) || mode !== oldMode)) {
        let response: unknown;
        try { response = await this.upstream.request('thread/resume', resumeParams(cwd, threadId, resolved, diagram)); }
        catch { throw new ReaderError('HISTORY_UNAVAILABLE', 'The earlier Codex conversation could not be resumed; start a new conversation to continue.'); }
        validateThread(response, cwd, resolved, { ephemeral: false, emptyHistory: false });
        this.knownThreads.add(threadId);
      } else if (!threadId) {
        const response = await this.upstream.request('thread/start', threadParams(cwd, resolved, diagram));
        const created = validateThread(response, cwd, resolved, { ephemeral: false, emptyHistory: true });
        threadId = created; this.knownThreads.add(created);
      }
      if (diagram || oldMode === 'diagram') await this.verifyImagePermission(threadId, diagram);
      await this.mutate(conversationId, c => { c.upstream.threadId = threadId; c.upstream.permissionMode = mode; });
      if (run.settled) return;
      run.threadId = threadId; this.runsByThread.set(threadId, run);
      this.usageRoutes.set(threadId, { conversationId, requestId, model: resolved.model });
      if (run.cancelWanted) { await this.settle(run, { kind: 'cancelled' }); return; }
      const documentKey = run.input.document ? `${run.input.document.id}:${resolved.model}` : null;
      const reuse = documentKey !== null && this.knownDocuments.get(threadId) === documentKey;
      if (documentKey) this.knownDocuments.set(threadId, documentKey);
      const history = fresh && !run.input.batch ? conversation.messages.filter(message => message.requestId !== requestId && message.status === 'completed') : [];
      const text = readingInput(run.input, reuse, history);
      if (history.length && new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The saved conversation is too large to restore in one turn. Reference selected messages in a new chat.');
      run.submitted = true;
      const result = record(await this.upstream.request('turn/start', turnParams(threadId, requestId, text, cwd, resolved, run.input.images ?? [])));
      const turnId = string(record(result.turn).id);
      if (run.turnId && run.turnId !== turnId) throw new Error('turn mismatch');
      run.turnId = turnId;
      if (!run.settled) await this.mutate(conversationId, c => { const request = this.setState(c, requestId, 'running'); if (request) request.turnId = turnId; });
      void this.maybeInterrupt(run);
    } catch (error) {
      if (run.settled) return;
      if (run.submitted) { await this.settle(run, { kind: 'uncertain', message: 'The submission could not be confirmed; this request will not be resent.' }); return; }
      const failure: TurnFailure = error instanceof ReaderError ? { code: error.code, message: error.message, retryable: error.retryable }
        : error instanceof RuntimeFailure ? { code: 'READER_POLICY_UNAVAILABLE', message: `${error.message}; no turn was submitted.`, retryable: false }
        : { code: 'RUNTIME_UNAVAILABLE', message: 'Codex did not accept the request; nothing was submitted.', retryable: true };
      await this.settle(run, { kind: 'failed', failure });
    }
  }
  private async verifyImagePermission(threadId: string, enabled: boolean): Promise<void> {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = record(await this.upstream.request('experimentalFeature/list', { threadId, limit: 200, ...(cursor ? { cursor } : {}) }));
      if (!Array.isArray(result.data)) break;
      const feature = result.data.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).name === 'image_generation') as Record<string, unknown> | undefined;
      if (feature) { if (feature.enabled === enabled) return; break; }
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
      if (!cursor) break;
    }
    throw new ReaderError('READER_POLICY_UNAVAILABLE', 'Codex did not confirm the image generation permission for this request.');
  }
  private setState(conversation: StoredConversation, requestId: UUID, state: RequestState): RequestRecord | undefined {
    const request = conversation.requests.find(r => r.requestId === requestId);
    if (request && ACTIVE.includes(request.state)) { request.state = state; request.updatedAt = this.options.now(); }
    return request;
  }
  /** Whitelist counts from stored requests only. Does not resume, reread history, or include paper text. */
  async diagnostics(conversationId: string, versions: { pluginVersion: string; runtimeVersion: string; errorCode?: ErrorCode | null }): Promise<ShareableDiagnostics> {
    const conversation = await this.load(conversationId);
    return shareableDiagnostics({
      pluginVersion: versions.pluginVersion,
      runtimeVersion: versions.runtimeVersion,
      errorCode: this.lastErrorCodes.get(conversation.id) ?? versions.errorCode ?? null,
      requests: conversation.requests.map(request => ({ state: request.state })),
    });
  }
  async request(conversationId: string, requestId: string): Promise<SendReceipt> {
    await this.ensureRecovered(conversationId);
    const live = await this.load(conversationId);
    const request = live.requests.find(r => r.requestId === requestId);
    if (!request) throw new ReaderError('NOT_FOUND', 'Unknown request');
    return this.receipt(request, false);
  }
  /** Before any turn was submitted the request is cancelled at once; afterwards only the terminal event confirms it. */
  async cancel(conversationId: string, requestId: string): Promise<SendReceipt> {
    const run = this.runs.get(requestId);
    if (run && run.conversationId !== conversationId) throw new ReaderError('NOT_FOUND', 'Unknown request in this conversation');
    if (run && !run.settled) {
      run.cancelWanted = true;
      if (!run.submitted) await this.settle(run, { kind: 'cancelled' });
      else await this.maybeInterrupt(run);
    } else {
      await this.mutate(conversationId, (c, emit) => {
        const request = c.requests.find(request => request.requestId === requestId);
        if (request?.state === 'accepted') {
          request.state = 'cancelled'; request.updatedAt = this.options.now();
          for (const message of c.messages) if (message.requestId === requestId && message.role === 'user') message.status = 'cancelled';
          if (c.activeRequestId === requestId) c.activeRequestId = null;
          emit({ type: 'cancelled', requestId, messageId: null });
        }
      });
    }
    return this.request(conversationId, requestId);
  }
  private async maybeInterrupt(run: Run): Promise<void> {
    if (!run.cancelWanted || run.interrupted || run.settled || !run.threadId || !run.turnId) return;
    run.interrupted = true;
    try { await this.upstream.request('turn/interrupt', { threadId: run.threadId, turnId: run.turnId }); }
    catch { void this.settle(run, { kind: 'uncertain', message: 'Codex did not confirm the stop request; this request will not be resent.' }); }
  }
  // ---- upstream notifications -------------------------------------------------------------------
  /** Thread-scoped notifications routed from the runtime session. Unknown threads are ignored. */
  handleNotice(method: string, params: Record<string, unknown>): void {
    if (typeof params.threadId !== 'string') return;
    if (method === 'thread/tokenUsage/updated') {
      const usage = parseThreadUsage(params); const route = this.usageRoutes.get(params.threadId);
      const threadId = params.threadId;
      if (usage && route) void this.mutate(route.conversationId, (c, emit) => {
        const request = [...c.requests].reverse().find(request => request.turnId || request.requestId === c.activeRequestId);
        if (!request || request.requestId !== route.requestId || (request.turnId && request.turnId !== usage.turnId)) return;
        // A usage report is upstream liveness too, and this commit already persists it. Its own `usage`
        // event tells the view the turn is alive, so it needs no separate progress ping.
        const run = this.runsByThread.get(threadId); const at = this.options.now();
        request.lastEventAt = at; if (run) run.lastEventAt = at;
        c.usage = { model: route.model, contextWindow: usage.modelContextWindow, last: usage.last, total: usage.total };
        emit({ type: 'usage', requestId: route.requestId, usage: c.usage });
      }).catch(() => undefined);
      return;
    }
    if (method === 'thread/compacted' || ((method === 'item/started' || method === 'item/completed') && params.item && typeof params.item === 'object' && (params.item as Record<string, unknown>).type === 'contextCompaction')) this.knownDocuments.delete(params.threadId);
    const run = this.runsByThread.get(params.threadId);
    if (!run || run.settled) return;
    void this.serial(run.conversationId, () => this.process(run, method, params)).catch(() => undefined);
  }
  private async process(run: Run, method: string, params: Record<string, unknown>): Promise<void> {
    if (run.settled) return;
    if (params.turnId !== undefined) { if (run.turnId && params.turnId !== run.turnId) return; run.turnId = string(params.turnId); }
    // Anything that survives the turn check is liveness for this turn, including reasoning deltas and
    // item lifecycle, which the reader never renders as answer text.
    this.noteActivity(run);
    if (method === 'turn/started' || method === 'turn/completed') { await this.applyTurn(run, record(params.turn)); return; }
    if (method === 'error') { if (params.willRetry === true) return; await this.finish(run, { kind: 'failed', failure: describeTurnError(params.error) }); return; }
    if (method === 'item/agentMessage/delta') { await this.bufferDelta(run, string(params.itemId), string(params.delta)); return; }
    if (method === 'item/started' || method === 'item/completed') await this.applyItem(run, record(params.item), method === 'item/completed');
  }
  private async applyTurn(run: Run, turn: Record<string, unknown>): Promise<void> {
    const id = string(turn.id);
    if (run.turnId && run.turnId !== id) return;
    run.turnId = id;
    if (!Array.isArray(turn.items)) throw new Error('turn items');
    for (const item of turn.items) { await this.applyItem(run, record(item), true); if (run.settled) return; }
    const status = string(turn.status);
    if (status === 'inProgress') { void this.maybeInterrupt(run); return; }
    if (status === 'completed') { await this.finish(run, { kind: 'completed' }); return; }
    if (status === 'interrupted') { await this.finish(run, { kind: 'cancelled' }); return; }
    await this.finish(run, { kind: 'failed', failure: describeTurnError(turn.error) });
  }
  private async applyItem(run: Run, item: Record<string, unknown>, completed: boolean): Promise<void> {
    const type = string(item.type);
    if (type === 'imageGeneration' && run.input.workflow?.skill?.workflow === 'diagram' && run.input.batch?.phase !== 'map') {
      if (!completed) return;
      const messageId = await this.ensureMessage(run, string(item.id));
      if ((await this.load(run.conversationId)).messages.find(message => message.id === messageId)?.generatedImages?.length) return;
      try {
        if (!this.options.generatedImage) throw new Error('No output adapter');
        const image = await this.options.generatedImage(item, run.resolved.model);
        await this.commit(run.conversationId, (c, emit) => {
          const message = c.messages.find(message => message.id === messageId)!;
          message.generatedImages = [image]; message.status = 'completed';
          emit({ type: 'image', requestId: run.requestId, messageId, image });
        });
      } catch { await this.finish(run, { kind: 'failed', failure: { code: 'INTERNAL_ERROR', message: 'The generated image could not be verified or saved. No image result is available.', retryable: false } }); }
      return;
    }
    if (type !== 'agentMessage') {
      if (HARMLESS_ITEMS.includes(type)) return;
      await this.finish(run, { kind: 'failed', failure: { code: 'UNSUPPORTED_INTERACTION', message: 'Unexpected tool activity; the reader connection has been stopped.', retryable: false } });
      this.upstream.breach();
      return;
    }
    const messageId = await this.ensureMessage(run, string(item.id));
    if (!completed) return;
    const text = string(item.text); const phase = phaseOf(item.phase);
    if (text.length > ANSWER_LIMIT) { await this.finish(run, { kind: 'failed', failure: { code: 'PAYLOAD_TOO_LARGE', message: 'The answer exceeded the reader limit.', retryable: false } }); return; }
    run.pending.delete(messageId);
    await this.commit(run.conversationId, (c, emit) => {
      const message = c.messages.find(m => m.id === messageId); if (!message) return;
      this.recordFirstText(c, run.requestId, text.length > 0);
      message.text = text; message.phase = phase; message.status = 'completed';
      emit({ type: 'messageCompleted', requestId: run.requestId, messageId, finalText: text, phase });
    });
  }
  private async ensureMessage(run: Run, itemId: string): Promise<UUID> {
    const existing = run.items.get(itemId); if (existing) return existing;
    const messageId = this.options.uuid(); run.items.set(itemId, messageId);
    const live = await this.load(run.conversationId);
    live.messages.push({ id: messageId, upstreamItemId: itemId, requestId: run.requestId, role: 'assistant', phase: null, settings: run.input.settings, text: '', citations: [], status: 'streaming' });
    return messageId;
  }
  private async bufferDelta(run: Run, itemId: string, delta: string): Promise<void> {
    const messageId = await this.ensureMessage(run, itemId);
    run.pending.set(messageId, (run.pending.get(messageId) ?? '') + delta);
    const live = await this.load(run.conversationId);
    const total = [...run.pending.entries()].reduce((n, [id, t]) => n + t.length + (live.messages.find(m => m.id === id)?.text.length ?? 0), 0);
    if (total > ANSWER_LIMIT) { await this.finish(run, { kind: 'failed', failure: { code: 'PAYLOAD_TOO_LARGE', message: 'The answer exceeded the reader limit.', retryable: false } }); return; }
    run.flushTimer ??= setTimeout(() => { run.flushTimer = null; void this.serial(run.conversationId, () => this.flush(run)).catch(() => undefined); }, this.options.deltaFlushMs ?? 80);
  }
  /**
   * Upstream liveness for one run. Reasoning output, item lifecycle and usage reports all prove the
   * runtime is still working on the turn even when none of them become assistant text. The stamp is
   * in memory only; a coalesced flush publishes it, so liveness never adds a store write of its own.
   */
  private noteActivity(run: Run): void {
    run.lastEventAt = this.options.now();
    run.flushTimer ??= setTimeout(() => { run.flushTimer = null; void this.serial(run.conversationId, () => this.flush(run)).catch(() => undefined); }, this.options.deltaFlushMs ?? 80);
  }
  /** Consumes the throttle window: true at most once per `PROGRESS_INTERVAL_MS`, per run. */
  private takeProgress(run: Run): boolean {
    const now = run.lastEventAt === null ? Number.NaN : Date.parse(run.lastEventAt);
    if (!Number.isFinite(now) || now - run.progressAt < PROGRESS_INTERVAL_MS) return false;
    run.progressAt = now;
    return true;
  }
  /** Inside the queue: appends buffered increments to memory and publishes coalesced delta events. */
  private async flush(run: Run): Promise<void> {
    const activity = run.lastEventAt;
    // Nothing to deliver and nothing heard from upstream: the idle case stays a no-op.
    if (run.pending.size === 0 && activity === null) return;
    const live = await this.load(run.conversationId);
    const delivered: Array<{ messageId: UUID; text: string }> = [];
    for (const [messageId, text] of run.pending) {
      const message = live.messages.find(m => m.id === messageId);
      if (!message) continue;
      message.text += text;
      delivered.push({ messageId, text });
    }
    run.pending.clear();
    this.recordFirstText(live, run.requestId, delivered.length > 0);
    // Liveness rides the record the next commit already persists, so one reasoning delta never causes
    // a write by itself.
    const request = live.requests.find(record => record.requestId === run.requestId);
    if (request && activity !== null) request.lastEventAt = activity;
    for (const { messageId, text } of delivered) {
      this.publish({ type: 'delta', seq: ++live.lastSeq, conversationId: run.conversationId, requestId: run.requestId, at: this.options.now(), messageId, text });
    }
    // A settled run has nothing left to prove; the ping exists only to keep a live wait honest.
    if (!run.settled && activity !== null && this.takeProgress(run)) {
      this.publish({ type: 'progress', seq: ++live.lastSeq, conversationId: run.conversationId, requestId: run.requestId, at: activity });
    }
  }
  /**
   * Record, once, when assistant text first becomes visible. Both streamed deltas and a
   * single-shot completed item count: views derive time-to-first-text from this plus the
   * accepted time and never invent a value.
   */
  private recordFirstText(conversation: StoredConversation, requestId: UUID, hasText: boolean): void {
    if (!hasText) return;
    const request = conversation.requests.find(r => r.requestId === requestId);
    if (request && !request.firstTokenAt) request.firstTokenAt = this.options.now();
  }
  private settle(run: Run, outcome: Outcome): Promise<void> { return this.serial(run.conversationId, () => this.finish(run, outcome)); }
  /** Inside the queue: flush increments, persist, publish exactly one terminal event. */
  private async finish(run: Run, outcome: Outcome): Promise<void> {
    if (run.settled) return;
    run.settled = true;
    if (outcome.kind !== 'completed' && run.threadId) this.knownDocuments.delete(run.threadId);
    if (run.flushTimer) { clearTimeout(run.flushTimer); run.flushTimer = null; }
    this.runs.delete(run.requestId); if (run.threadId) this.runsByThread.delete(run.threadId);
    await this.flush(run).catch(() => undefined);
    await this.commit(run.conversationId, (c, emit) => {
      const request = c.requests.find(r => r.requestId === run.requestId);
      const assistant = c.messages.filter(m => m.requestId === run.requestId && m.role === 'assistant');
      const last = assistant.at(-1);
      const mark = (state: RequestState, status: Message['status']) => { if (request) { request.state = state; request.updatedAt = this.options.now(); } for (const m of assistant) if (m.status === 'streaming' || m.status === 'pending') m.status = status; };
      if (c.activeRequestId === run.requestId) c.activeRequestId = null;
      if (run.input.batch && c.activeBatchId === run.input.batch.id && outcome.kind !== 'uncertain' && (outcome.kind !== 'completed' || run.input.batch.phase === 'reduce')) delete c.activeBatchId;
      if (outcome.kind === 'completed') {
        const generated = assistant.some(message => message.generatedImages?.length);
        const diagram = run.input.workflow?.skill?.workflow === 'diagram' && run.input.batch?.phase !== 'map';
        if (!last || (!last.text.trim() && !generated) || (diagram && !generated)) {
          if (run.input.batch && c.activeBatchId === run.input.batch.id) delete c.activeBatchId;
          this.lastErrorCodes.set(run.conversationId, 'INTERNAL_ERROR');
          mark('failed', 'failed'); emit({ type: 'failed', requestId: run.requestId, code: 'INTERNAL_ERROR', message: diagram ? 'The model completed without generating an image.' : 'The model completed without an answer.' }); return;
        }
        mark('completed', 'completed'); emit({ type: 'completed', requestId: run.requestId, messageId: last.id, finalText: last.text });
      } else if (outcome.kind === 'cancelled') { mark('cancelled', 'cancelled'); emit({ type: 'cancelled', requestId: run.requestId, messageId: last?.id ?? null }); }
      else if (outcome.kind === 'failed') {
        this.lastErrorCodes.set(run.conversationId, outcome.failure.code);
        mark('failed', 'failed'); emit({ type: 'failed', requestId: run.requestId, code: outcome.failure.code, message: outcome.failure.message });
      }
      else { mark('uncertain', 'uncertain'); emit({ type: 'uncertain', requestId: run.requestId, message: outcome.message }); }
    }, true);
    if (!this.closed && outcome.kind !== 'uncertain') void this.startQueued(run.conversationId);
  }
  private async startQueued(conversationId: UUID): Promise<void> {
    try {
      const run = await this.serial(conversationId, async () => {
        const c = await this.load(conversationId);
        if (this.closed || c.activeRequestId || c.requests.some(request => request.state === 'uncertain')) return null;
        const next = this.nextAccepted(c);
        return next ? this.redeliver(c, next) : null;
      });
      if (run) await this.dispatch(run);
    } catch { /* The durable accepted record remains available for reconnect. */ }
  }
  private nextAccepted(c: StoredConversation): RequestRecord | undefined {
    return c.requests.find(request => request.state === 'accepted' && (!c.activeBatchId || c.messages.find(message => message.requestId === request.requestId && message.role === 'user')?.batch?.id === c.activeBatchId));
  }
  /** Transport loss or shutdown: every unsettled request becomes uncertain; nothing is resent. */
  settleAll(reason: string): Promise<void> {
    return Promise.all([...this.runs.values()].map(run => this.settle(run, { kind: 'uncertain', message: reason }))).then(() => undefined);
  }
  /** A server-initiated request reached a thread: that request fails closed. */
  failThread(threadId: string, code: ErrorCode, message: string): Promise<void> {
    const run = this.runsByThread.get(threadId);
    return run ? this.settle(run, { kind: 'failed', failure: { code, message, retryable: false } }) : Promise.resolve();
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.settleAll('The plugin stopped before confirmation; this request will not be resent.');
    this.listeners.clear();
  }
}
