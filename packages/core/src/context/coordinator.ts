import type { ReaderClient, StoragePort } from '../../../contracts/src/runtime.ts';
import { ReaderError, paperId, type DocumentContext, type SendInput, type SendReceipt } from '../../../contracts/src/index.ts';
import { validateSendInput, validatePaperScope } from '../../../contracts/src/validation.ts';
import { validateDocument } from '../../../contracts/src/document.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { buildContextBudget, type ContextBudget } from '../codex/model-capabilities.ts';
import type { StoreClock } from '../sessions/store.ts';
import type { ContextPlan } from './planner.ts';
export type ReadingStatus = 'reserved' | 'submitting' | 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'paused' | 'failed' | 'uncertain';
export interface ReadingResult { text: string; messageIds: string[]; pages: number[]; pageLabels: string[]; paper?: import('../../../contracts/src/index.ts').PaperScope; title?: string; generatedImageIds?: string[] }
export interface ReadingStep { index: number; requestId: string; phase: 'direct' | 'map' | 'reduce'; status: ReadingStatus; result?: ReadingResult; resultHash?: string }
export interface ReadingJob { schemaVersion: 1; id: string; conversationId: string; inputHash: string; revision: number; status: ReadingStatus; steps: ReadingStep[]; createdAt: string; updatedAt: string; cancelRequested: boolean; enqueueFirst?: true; waitingForRequestId?: string; error?: { code: string; message: string }; persistence?: 'unconfirmed' }
interface ReadingInput { schemaVersion: 1; id: string; inputHash: string; input: SendInput; plan: ContextPlan; requestIds: string[]; enqueueFirst?: true }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const statuses: ReadingStatus[] = ['reserved', 'submitting', 'queued', 'running', 'cancelling', 'completed', 'cancelled', 'paused', 'failed', 'uncertain'];
const terminal = new Set<ReadingStatus>(['completed', 'cancelled', 'failed']);
const INPUT_BYTES = 64 * 1024 * 1024, JOB_BYTES = 8 * 1024 * 1024, RESULT_BYTES = 2 * 1024 * 1024;
const errors = {
  storage: 'Reading task persistence could not be confirmed. Reconcile before continuing.',
  uncertain: 'The reading request could not be confirmed. It will not be resent automatically.',
  failed: 'A reading pass failed. Its request will not be retried automatically.',
  missingAnswer: 'The completed reading pass has no stored final answer; no summary was invented.',
  resultMismatch: 'The stored answer does not match this reading task and its frozen settings.',
  reduceBudget: 'The complete returned summaries exceed the synthesis budget. Nothing was truncated or sent.',
  mapBudget: 'The source fragment and shared context exceed this pass budget. Nothing was truncated or sent.',
  unsupportedReference: 'This reference type is not supported by the reading coordinator; no source was silently omitted.',
  busy: 'Another request is active in this conversation. Reconcile after it has finished.',
  precedingUncertain: 'The preceding request is not confirmed. Reconcile it before continuing the queued reading task.',
  enqueueUnsupported: 'This reader connection does not support durable queuing. The task was not sent as an ordinary request.',
  batchRelease: 'The reading batch could not be safely released. Reconcile before continuing.',
  chatMode: 'A multi-pass reading task is Agent work. Switch to Agent mode to run it.',
} as const;
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved reading task data could not be read; it was left untouched.'); }
function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'The reading task input or plan is invalid.'); }
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value; }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>; if (Object.keys(result).some(key => !keys.includes(key))) invalid(); return result;
}
function text(value: unknown, max = 4096): string { if (typeof value !== 'string' || value.length > max) invalid(); return value; }
function integer(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(); return value; }
function array(value: unknown, max = 257): unknown[] { if (!Array.isArray(value) || value.length > max) invalid(); return value; }
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).length; }
async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function snapshot<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function sameSource(original: DocumentContext, fragment: DocumentContext): boolean {
  return paperId(original.paper) === paperId(fragment.paper) && JSON.stringify(original.revision) === JSON.stringify(fragment.revision) && original.parserVersion === fragment.parserVersion && original.totalPages === fragment.totalPages
    && (original.id === fragment.id || (fragment.sourceId !== undefined && (original.sourceId ?? original.id) === fragment.sourceId));
}
function checkedBudget(value: unknown): ContextBudget {
  const source = object(value, ['capacity', 'provenance', 'accuracy', 'textBudgetTokens', 'reservations', 'overBudget', 'assumptions']);
  const reservations = object(source.reservations, ['history', 'instructions', 'workflow', 'images', 'question', 'output', 'safety', 'total']);
  for (const [key, amount] of Object.entries(reservations)) if (amount !== null || !['history', 'safety', 'total'].includes(key)) integer(amount);
  const capacity = integer(source.capacity); const limit = integer(source.textBudgetTokens);
  if (!capacity || limit > capacity || source.accuracy !== 'estimate' || (source.provenance !== 'pinned-catalog' && source.provenance !== 'runtime-reported') || (source.overBudget !== true && source.overBudget !== false)) invalid();
  array(source.assumptions, 64).forEach(value => text(value, 256));
  if (reservations.total === null || integer(reservations.total) + limit > capacity) invalid();
  return clone(source) as unknown as ContextBudget;
}
function checkedPlan(value: unknown, input: SendInput): ContextPlan {
  const source = object(value, ['mode', 'documents', 'coverage', 'budget']);
  if (source.mode !== 'full' && source.mode !== 'focused' && source.mode !== 'multi-pass') invalid();
  const documents = array(source.documents, 256).map(validateDocument);
  if (!documents.length || (source.mode !== 'multi-pass' && documents.length !== 1) || new Set(documents.map(document => document.id)).size !== documents.length) invalid();
  const authorized = [input.document, ...(input.references ?? []).map(reference => reference.document)].filter((document): document is DocumentContext => !!document);
  for (const document of documents) {
    const original = authorized.find(item => sameSource(item, document)); if (!original) invalid();
    for (const page of document.pages) {
      const originalPage = original.pages.find(item => item.pageIndex === page.pageIndex);
      if (!originalPage || page.pageLabel !== originalPage.pageLabel || page.status !== originalPage.status || !originalPage.text.includes(page.text) || ((page.text !== originalPage.text || originalPage.partial) && !page.partial)) invalid();
    }
  }
  const coverage = object(source.coverage, ['totalPages', 'selectedPages', 'reason']);
  const totalPages = integer(coverage.totalPages); const selectedPages = array(coverage.selectedPages, 10000).map(integer);
  if (!totalPages || new Set(selectedPages).size !== selectedPages.length) invalid();
  return { mode: source.mode, documents, coverage: { totalPages, selectedPages, reason: text(coverage.reason) }, budget: checkedBudget(source.budget) };
}
function checkedResult(value: unknown): ReadingResult {
  const source = object(value, ['text', 'messageIds', 'pages', 'pageLabels', 'paper', 'title', 'generatedImageIds']);
  const result: ReadingResult = { text: text(source.text, RESULT_BYTES), messageIds: array(source.messageIds, 10000).map(value => text(value, 256)), pages: array(source.pages, 10000).map(integer), pageLabels: array(source.pageLabels, 10000).map(value => text(value, 64)) };
  if (source.generatedImageIds !== undefined) { result.generatedImageIds = array(source.generatedImageIds, 1000).map(id); if (new Set(result.generatedImageIds).size !== result.generatedImageIds.length) invalid(); }
  if ((!result.text.trim() && !result.generatedImageIds?.length) || !result.messageIds.length) invalid();
  if (bytes(result) > RESULT_BYTES) throw new ReaderError('PAYLOAD_TOO_LARGE', errors.reduceBudget);
  if (source.paper !== undefined) result.paper = validatePaperScope(source.paper);
  if (source.title !== undefined) result.title = text(source.title, 2048);
  return result;
}
function checkedJob(value: unknown): ReadingJob {
  const source = object(value, ['schemaVersion', 'id', 'conversationId', 'inputHash', 'revision', 'status', 'steps', 'createdAt', 'updatedAt', 'cancelRequested', 'error', 'enqueueFirst', 'waitingForRequestId']);
  if (source.schemaVersion !== 1 || !statuses.includes(source.status as ReadingStatus) || typeof source.cancelRequested !== 'boolean') invalid();
  if (source.enqueueFirst !== undefined && source.enqueueFirst !== true) invalid();
  const steps: ReadingStep[] = array(source.steps).map((value, index) => {
    const step = object(value, ['index', 'requestId', 'phase', 'status', 'result', 'resultHash']);
    if (step.index !== index || (step.phase !== 'direct' && step.phase !== 'map' && step.phase !== 'reduce') || !statuses.includes(step.status as ReadingStatus)) invalid();
    const result = step.result === undefined ? undefined : checkedResult(step.result);
    if ((step.status === 'completed') !== (result !== undefined) || (result ? typeof step.resultHash !== 'string' || !/^[0-9a-f]{64}$/u.test(step.resultHash) : step.resultHash !== undefined)) invalid();
    return { index, requestId: id(step.requestId), phase: step.phase, status: step.status as ReadingStatus, ...(result ? { result, resultHash: step.resultHash as string } : {}) };
  });
  if (!steps.length || new Set(steps.map(step => step.requestId)).size !== steps.length) invalid();
  const firstPending = steps.findIndex(step => step.status !== 'completed');
  if (firstPending >= 0 && steps.slice(firstPending + 1).some(step => step.status !== (source.status === 'cancelled' ? 'cancelled' : 'reserved'))) invalid();
  const result: ReadingJob = { schemaVersion: 1, id: id(source.id), conversationId: id(source.conversationId), inputHash: text(source.inputHash, 64), revision: integer(source.revision), status: source.status as ReadingStatus, steps, createdAt: text(source.createdAt, 40), updatedAt: text(source.updatedAt, 40), cancelRequested: source.cancelRequested };
  if (source.enqueueFirst) result.enqueueFirst = true;
  if (source.waitingForRequestId !== undefined) result.waitingForRequestId = id(source.waitingForRequestId);
  if (!/^[0-9a-f]{64}$/u.test(result.inputHash) || (result.status === 'completed' && steps.some(step => step.status !== 'completed'))) invalid();
  if (source.error !== undefined) { const error = object(source.error, ['code', 'message']); result.error = { code: text(error.code, 128), message: text(error.message, 1024) }; }
  return result;
}

/** Plugin-owned task lifetime. Unsubscribing a view never cancels the reader or this coordinator. */
export class ReadingCoordinator {
  private startQueue = Promise.resolve();
  private queues = new Map<string, Promise<unknown>>();
  private requestJobs = new Map<string, string>();
  private listeners = new Set<(job: ReadingJob) => void>();
  private cancelling = new Set<string>();
  private lastKnown = new Map<string, ReadingJob>();
  private storageFailures = new Set<string>();
  private queuedConversations = new Map<string, string>();
  private disposed = false;
  private disposeFlight: Promise<void> | null = null;
  private unsubscribeClient: () => void;
  constructor(private client: ReaderClient | null, private storage: StoragePort, private clock: StoreClock) {
    this.unsubscribeClient = client?.subscribe(event => {
      if (this.disposed) return;
      const owned = this.requestJobs.get(event.requestId);
      const isTerminal = ['completed', 'cancelled', 'failed', 'uncertain'].includes(event.type);
      const jobId = isTerminal ? owned ?? this.queuedConversations.get(event.conversationId) : owned && this.lastKnown.get(owned)?.status === 'queued' ? owned : undefined;
      if (jobId) void this.kick(jobId).catch(() => undefined);
    }) ?? (() => undefined);
  }
  private get connected(): ReaderClient {
    if (this.disposed || !this.client) throw new ReaderError('RUNTIME_UNAVAILABLE', 'The reading coordinator is offline or stopped. Reconnect before changing a task.'); return this.client;
  }
  /** Stops new dispatch immediately. Await this before replacing the writer with another coordinator. */
  dispose(): Promise<void> {
    if (this.disposeFlight) return this.disposeFlight;
    this.disposed = true; this.unsubscribeClient(); this.listeners.clear();
    this.disposeFlight = Promise.allSettled([this.startQueue, ...this.queues.values()]).then(() => {
      this.requestJobs.clear(); this.queuedConversations.clear(); this.lastKnown.clear(); this.storageFailures.clear(); this.cancelling.clear(); this.queues.clear();
    });
    return this.disposeFlight;
  }
  subscribe(listener: (job: ReadingJob) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(job: ReadingJob): void { for (const listener of this.listeners) { try { listener(clone(job)); } catch { /* Views do not own tasks. */ } } }
  private register(job: ReadingJob): void {
    if (this.disposed) return;
    for (const step of job.steps) this.requestJobs.set(step.requestId, job.id); this.lastKnown.set(job.id, clone(job));
    if (job.status === 'queued') this.queuedConversations.set(job.conversationId, job.id);
    else if (this.queuedConversations.get(job.conversationId) === job.id) this.queuedConversations.delete(job.conversationId);
  }
  private retire(job: ReadingJob): void {
    if (!terminal.has(job.status)) return;
    for (const step of job.steps) if (this.requestJobs.get(step.requestId) === job.id) this.requestJobs.delete(step.requestId);
    if (this.queuedConversations.get(job.conversationId) === job.id) this.queuedConversations.delete(job.conversationId);
    this.lastKnown.delete(job.id); this.cancelling.delete(job.id); this.storageFailures.delete(job.id);
  }
  private path(jobId: string, suffix = ''): string { return `reading/${id(jobId)}${suffix}.json`; }
  private async read(path: string, limit: number): Promise<unknown> {
    let raw: Uint8Array | null; try { raw = await this.storage.read(path); } catch { unavailable(); }
    if (raw === null) return undefined; if (raw.length > limit) unavailable();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown; } catch { unavailable(); }
  }
  private async write(path: string, value: unknown, limit: number): Promise<void> {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    if (encoded.length > limit) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The reading task exceeds its persistence size limit.');
    try { await this.storage.writeAtomic(path, encoded); } catch { throw new ReaderError('INTERNAL_ERROR', errors.storage); }
  }
  private async loadInput(job: ReadingJob): Promise<ReadingInput> {
    try {
      const source = object(await this.read(this.path(job.id, '.input'), INPUT_BYTES), ['schemaVersion', 'id', 'inputHash', 'input', 'plan', 'requestIds', 'enqueueFirst']);
      if (source.schemaVersion !== 1 || source.id !== job.id || source.inputHash !== job.inputHash) unavailable();
      const input = validateSendInput(source.input); if (input.batch || input.requestId !== job.id || input.conversationId !== job.conversationId) unavailable();
      const plan = checkedPlan(source.plan, input); const requestIds = array(source.requestIds).map(id);
      if (source.enqueueFirst !== job.enqueueFirst || JSON.stringify(requestIds) !== JSON.stringify(job.steps.map(step => step.requestId)) || await hash({ input, plan, ...(source.enqueueFirst ? { enqueueFirst: true } : {}) }) !== job.inputHash) unavailable();
      const expected = plan.mode === 'multi-pass' ? plan.documents.length + 1 : 1;
      if (job.steps.length !== expected || job.steps.some((step, index) => step.phase !== (plan.mode !== 'multi-pass' ? 'direct' : index === expected - 1 ? 'reduce' : 'map'))) unavailable();
      for (const step of job.steps) {
        if (!step.result) continue;
        if (step.phase === 'map' && !step.result.text.trim()) unavailable();
        if (await hash(step.result) !== step.resultHash) unavailable();
        const document = step.phase === 'reduce' ? undefined : plan.documents[step.index];
        if (document && (JSON.stringify(step.result.pages) !== JSON.stringify(document.pages.map(page => page.pageIndex)) || JSON.stringify(step.result.pageLabels) !== JSON.stringify(document.pages.map(page => page.pageLabel)) || !step.result.paper || paperId(step.result.paper) !== paperId(document.paper))) unavailable();
      }
      return { schemaVersion: 1, id: job.id, inputHash: job.inputHash, input, plan, requestIds, ...(job.enqueueFirst ? { enqueueFirst: true } : {}) };
    } catch { unavailable(); }
  }
  private async load(jobId: string): Promise<{ job: ReadingJob; saved: ReadingInput }> {
    const raw = await this.read(this.path(jobId), JOB_BYTES); if (raw === undefined) throw new ReaderError('NOT_FOUND', 'Unknown reading task');
    let job: ReadingJob; try { job = checkedJob(raw); if (job.id !== jobId) unavailable(); } catch { unavailable(); }
    return { job, saved: await this.loadInput(job) };
  }
  private overlay(job: ReadingJob): ReadingJob {
    return this.storageFailures.has(job.id) ? { ...clone(job), status: 'uncertain', persistence: 'unconfirmed', error: { code: 'storage', message: errors.storage } } : clone(job);
  }
  async get(jobId: string): Promise<ReadingJob> { return this.overlay((await this.load(jobId)).job); }
  async list(conversationId?: string): Promise<ReadingJob[]> {
    if (conversationId !== undefined) id(conversationId); if (!this.storage.list) unavailable();
    let names: string[]; try { names = await this.storage.list('reading'); } catch { unavailable(); }
    if (!Array.isArray(names) || names.length > 30_000) unavailable();
    const jobs: ReadingJob[] = [];
    for (const name of names) {
      if (typeof name !== 'string') unavailable();
      if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) continue;
      const job = await this.get(name.slice(0, -5)); if (conversationId === undefined || job.conversationId === conversationId) jobs.push(job);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }
  private async save(job: ReadingJob): Promise<void> {
    if (this.disposed) return;
    const next = { ...job, revision: job.revision + 1, updatedAt: this.clock.now() };
    await this.write(this.path(job.id), next, JOB_BYTES); Object.assign(job, next); this.register(job); if (!this.disposed) this.emit(job); this.retire(job);
  }
  start(raw: SendInput, rawPlan: ContextPlan): Promise<ReadingJob> { return this.create(raw, rawPlan, false); }
  enqueue(raw: SendInput, rawPlan: ContextPlan): Promise<ReadingJob> { return this.create(raw, rawPlan, true); }
  private async create(raw: SendInput, rawPlan: ContextPlan, enqueueFirst: boolean): Promise<ReadingJob> {
    const client = this.connected;
    if (enqueueFirst && !client.enqueue) throw new ReaderError('UNSUPPORTED_INTERACTION', errors.enqueueUnsupported);
    const captured = snapshot(raw), capturedPlan = snapshot(rawPlan);
    const operation = this.startQueue.then(async () => {
      void this.connected;
      const input = validateSendInput(captured); if (input.batch) invalid();
      // A reading job is Agent work: creating one from a Chat request would start the very task/run
      // that Chat mode must not. The presenter's Chat path already refuses the multi-pass plan, so
      // this only catches a caller that skipped it.
      if ((input.mode ?? 'chat') !== 'agent') throw new ReaderError('UNSUPPORTED_INTERACTION', errors.chatMode);
      const plan = checkedPlan(capturedPlan, input);
      const inputHash = await hash({ input, plan, ...(enqueueFirst ? { enqueueFirst: true } : {}) }); const jobId = input.requestId;
      const existing = await this.read(this.path(jobId), JOB_BYTES);
      if (existing !== undefined) {
        const found = await this.load(jobId); if (found.job.inputHash !== inputHash) throw new ReaderError('REQUEST_CONFLICT', 'This reading task id already belongs to different input.');
        this.register(found.job); return found.job;
      }
      if ((await this.list(input.conversationId)).some(job => !terminal.has(job.status))) throw new ReaderError('BUSY', 'Another reading task is unfinished in this conversation.');
      const conversation = await client.get(input.conversationId); void this.connected;
      if (conversation.activeRequestId && !enqueueFirst) throw new ReaderError('BUSY', errors.busy);
      const waitingFor = enqueueFirst ? conversation.queuedRequestIds?.at(-1) ?? conversation.activeRequestId : null;
      if (input.document && paperId(input.document.paper) !== paperId(conversation.paper)) invalid();
      const count = plan.mode === 'multi-pass' ? plan.documents.length + 1 : 1;
      const priorInput = await this.read(this.path(jobId, '.input'), INPUT_BYTES);
      let requestIds = [input.requestId, ...Array.from({ length: count - 1 }, () => id(this.clock.uuid()))];
      if (priorInput !== undefined) {
        const prior = object(priorInput, ['schemaVersion', 'id', 'inputHash', 'input', 'plan', 'requestIds', 'enqueueFirst']);
        if (prior.schemaVersion !== 1 || prior.id !== jobId || prior.inputHash !== inputHash || prior.enqueueFirst !== (enqueueFirst ? true : undefined) || await hash({ input: prior.input, plan: prior.plan, ...(prior.enqueueFirst ? { enqueueFirst: true } : {}) }) !== inputHash) unavailable();
        requestIds = array(prior.requestIds).map(id);
      }
      if (requestIds.length !== count || requestIds[0] !== input.requestId || new Set(requestIds).size !== count) invalid();
      const saved: ReadingInput = { schemaVersion: 1, id: jobId, inputHash, input, plan, requestIds, ...(enqueueFirst ? { enqueueFirst: true } : {}) };
      void this.connected;
      if (priorInput === undefined) await this.write(this.path(jobId, '.input'), saved, INPUT_BYTES);
      const job: ReadingJob = { schemaVersion: 1, id: jobId, conversationId: input.conversationId, inputHash, revision: 0, status: enqueueFirst ? 'queued' : 'reserved', createdAt: this.clock.now(), updatedAt: this.clock.now(), cancelRequested: false, ...(enqueueFirst ? { enqueueFirst: true } : {}), ...(waitingFor ? { waitingForRequestId: waitingFor } : {}), steps: requestIds.map((requestId, index) => ({ index, requestId, phase: plan.mode !== 'multi-pass' ? 'direct' : index === count - 1 ? 'reduce' : 'map', status: 'reserved' })) };
      await this.save(job); this.register(job); return job;
    });
    this.startQueue = operation.then(() => undefined, () => undefined);
    const job = await operation; void this.kick(job.id).catch(() => undefined); return this.overlay(job);
  }
  private kick(jobId: string, explicit = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const previous = this.queues.get(jobId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      if (this.disposed) return;
      if (this.storageFailures.has(jobId) && !explicit) return;
      if (explicit) this.storageFailures.delete(jobId);
      try { await this.drive(jobId, explicit); }
      catch (error) {
        if (!this.disposed) { this.storageFailures.add(jobId); const known = this.lastKnown.get(jobId); if (known) this.emit(this.overlay(known)); }
        throw error;
      }
    });
    const settled = operation.catch(() => undefined); this.queues.set(jobId, settled);
    void settled.then(() => { if (this.queues.get(jobId) === settled) this.queues.delete(jobId); }); return operation;
  }
  async reconcile(jobId: string): Promise<ReadingJob> {
    void this.connected;
    const { job } = await this.load(jobId); this.register(job); await this.kick(jobId, true); return this.get(jobId);
  }
  async cancel(jobId: string): Promise<ReadingJob> {
    void this.connected;
    id(jobId); this.cancelling.add(jobId);
    const { job } = await this.load(jobId); if (job.status === 'completed' || job.status === 'cancelled') return this.overlay(job);
    await this.write(this.path(jobId, '.cancel'), { schemaVersion: 1, id: jobId, requestedAt: this.clock.now() }, 1024);
    this.register(job); await this.kick(jobId, true); return this.get(jobId);
  }
  private async cancellation(job: ReadingJob): Promise<boolean> {
    const raw = await this.read(this.path(job.id, '.cancel'), 1024);
    if (raw !== undefined) { const marker = object(raw, ['schemaVersion', 'id', 'requestedAt']); if (marker.schemaVersion !== 1 || marker.id !== job.id || typeof marker.requestedAt !== 'string') unavailable(); return true; }
    return job.cancelRequested || this.cancelling.has(job.id);
  }
  private async halt(job: ReadingJob, status: 'paused' | 'failed' | 'uncertain', code: keyof typeof errors, step?: ReadingStep): Promise<void> {
    if (step && status !== 'paused') step.status = status;
    const released = status !== 'failed' || await this.releaseBatch(job);
    job.status = released ? status : 'paused';
    const reason = released ? code : 'batchRelease'; job.error = { code: reason, message: errors[reason] }; await this.save(job);
  }
  private async receipt(job: ReadingJob, step: ReadingStep): Promise<SendReceipt | null> {
    try { const receipt = await this.connected.request(job.conversationId, step.requestId); if (receipt.requestId !== step.requestId) throw new Error('Request identity mismatch'); return receipt; }
    catch (error) { if (error instanceof ReaderError && error.code === 'NOT_FOUND') return null; throw error; }
  }
  private targetTitle(saved: ReadingInput, document: DocumentContext): string {
    if (saved.input.document && paperId(saved.input.document.paper) === paperId(document.paper)) return saved.input.paper?.title ?? 'Current document';
    const reference = saved.input.references?.find(item => item.document && sameSource(item.document, document));
    return reference?.identity?.title ?? reference?.label ?? 'Referenced document';
  }
  private makeRequest(job: ReadingJob, saved: ReadingInput, step: ReadingStep): SendInput {
    // Every step of a reading job is Agent work by construction, including a recovered job whose
    // stored input predates `mode`. Stamping it here keeps the runtime boundary true for a replayed
    // step instead of relying on whatever the original caller froze.
    const input: SendInput = { ...clone(saved.input), mode: 'agent' }; input.requestId = step.requestId;
    const report = (budget: ContextBudget, document: DocumentContext | null, reason: string) => {
      input.contextReport = { mode: saved.plan.mode, capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: document?.pages.map(page => page.pageIndex) ?? [], totalPages: document?.totalPages ?? 0, reason };
    };
    if (step.phase === 'reduce') {
      delete input.document; delete input.images; delete input.references; input.citations = []; input.action = 'ask';
      const summaries = job.steps.filter(item => item.phase === 'map').map(item => {
        if (item.status !== 'completed' || !item.result) invalid();
        return { index: item.index, pages: [...item.result.pages], pageLabels: [...item.result.pageLabels], text: item.result.text, ...(item.result.paper ? { paper: clone(item.result.paper) } : {}), ...(item.result.title ? { title: item.result.title } : {}) };
      });
      const prior = saved.plan.budget;
      const budget = buildContextBudget({ modelId: input.settings.model, ...(prior.provenance === 'runtime-reported' ? { reportedWindow: prior.capacity } : {}), historyTokens: 0, instructionBytes: prior.reservations.instructions, workflowBytes: prior.reservations.workflow, imageCount: 0, questionBytes: new TextEncoder().encode(input.question).length, outputReserve: prior.reservations.output });
      if (budget.textBudgetTokens === null || bytes(summaries) > budget.textBudgetTokens) throw new ReaderError('PAYLOAD_TOO_LARGE', errors.reduceBudget);
      input.batch = { id: job.id, index: step.index, total: job.steps.length, phase: 'reduce', question: saved.input.question, summaries };
      report(budget, null, `Synthesis uses ${summaries.length} completed source summaries; no raw PDF pages, images or references are reattached.`);
      return validateSendInput(input);
    }
    const document = saved.plan.documents[step.index]; if (!document) invalid();
    const current = saved.input.document && paperId(saved.input.document.paper) === paperId(document.paper);
    if (step.phase === 'direct') {
      if ((input.references ?? []).some(reference => reference.kind !== 'article' && reference.kind !== 'chat')) throw new ReaderError('UNSUPPORTED_INTERACTION', errors.unsupportedReference);
      let matched = !!current;
      if (current) input.document = clone(document);
      else input.references = (input.references ?? []).map(reference => {
        if (reference.document && sameSource(reference.document, document)) { matched = true; return { ...reference, document: clone(document) }; }
        return reference;
      });
      const documents = [input.document, ...(input.references ?? []).map(reference => reference.document)].filter((item): item is DocumentContext => !!item);
      const shared = (input.references ?? []).reduce((total, reference) => total + (reference.text ? bytes(reference.text) : 0), 0);
      if (!matched) throw new ReaderError('UNSUPPORTED_INTERACTION', errors.unsupportedReference);
      if (documents.reduce((total, item) => total + bytes(item), shared) > saved.plan.budget.textBudgetTokens!) throw new ReaderError('PAYLOAD_TOO_LARGE', errors.mapBudget);
      report(saved.plan.budget, document, saved.plan.coverage.reason); return validateSendInput(input);
    }
    delete input.document;
    if (current) input.document = clone(document);
    let matched = !!current;
    const references = (input.references ?? []).map(reference => {
      if (reference.kind !== 'article' && reference.kind !== 'chat') throw new ReaderError('UNSUPPORTED_INTERACTION', errors.unsupportedReference);
      const copy = clone(reference); delete copy.document;
      if (copy.kind !== 'chat') delete copy.text;
      const target = !current && reference.document && sameSource(reference.document, document);
      if (target) { copy.document = clone(document); matched = true; }
      return copy;
    });
    if (!matched) throw new ReaderError('UNSUPPORTED_INTERACTION', errors.unsupportedReference);
    if (references.length) input.references = references; else delete input.references;
    const sharedBytes = references.filter(reference => reference.kind === 'chat').reduce((total, reference) => total + (reference.text ? bytes(reference.text) : 0), 0);
    if (bytes(document) + sharedBytes > saved.plan.budget.textBudgetTokens!) throw new ReaderError('PAYLOAD_TOO_LARGE', errors.mapBudget);
    if (step.phase === 'map') { input.action = 'ask'; input.batch = { id: job.id, index: step.index, total: job.steps.length, phase: 'map', question: saved.input.question }; }
    report(saved.plan.budget, document, `Reading pass ${step.index + 1} supplies only this target source fragment. The overall task remains incomplete until all planned passes and synthesis finish.`);
    return validateSendInput(input);
  }
  private async answer(job: ReadingJob, saved: ReadingInput, step: ReadingStep): Promise<ReadingResult | null> {
    const conversation = await this.connected.get(job.conversationId);
    const question = conversation.messages.find(message => message.requestId === step.requestId && message.role === 'user');
    if (!question || question.text !== saved.input.question || JSON.stringify(question.settings) !== JSON.stringify(saved.input.settings) || (step.phase !== 'direct' && (question.batch?.id !== job.id || question.batch.index !== step.index || question.batch.phase !== step.phase))) throw new ReaderError('REQUEST_CONFLICT', errors.resultMismatch);
    const messages = conversation.messages.filter(message => message.requestId === step.requestId && message.role === 'assistant' && message.status === 'completed' && message.phase !== 'commentary' && (message.text.trim() || (step.phase !== 'map' && message.generatedImages?.length)));
    if (!messages.length) return null;
    const document = step.phase === 'reduce' ? undefined : saved.plan.documents[step.index];
    const generatedImageIds = step.phase === 'map' ? [] : [...new Set(messages.flatMap(message => message.generatedImages?.map(image => image.id) ?? []))];
    return checkedResult({ text: messages.map(message => message.text).filter(Boolean).join('\n\n'), messageIds: messages.map(message => message.id), pages: document ? document.pages.map(page => page.pageIndex) : [], pageLabels: document ? document.pages.map(page => page.pageLabel) : [], ...(document ? { paper: document.paper, title: this.targetTitle(saved, document) } : {}), ...(generatedImageIds.length ? { generatedImageIds } : {}) });
  }
  private async releaseBatch(job: ReadingJob): Promise<boolean> {
    if (!job.steps.some(step => step.phase === 'map')) return true;
    if (this.disposed) return false;
    try {
      const client = this.connected; const conversation = await client.get(job.conversationId); if (this.disposed) return false;
      if (conversation.activeBatchId !== job.id) return true;
      if (conversation.activeRequestId || !client.releaseBatch) return false;
      await client.releaseBatch(job.conversationId, job.id); return !this.disposed;
    } catch { return false; }
  }
  private async finishCancelled(job: ReadingJob): Promise<void> {
    if (!await this.releaseBatch(job)) { await this.halt(job, 'paused', 'batchRelease'); return; }
    for (const step of job.steps) if (step.status !== 'completed') step.status = 'cancelled';
    job.status = 'cancelled'; job.cancelRequested = true; delete job.error; delete job.waitingForRequestId; await this.save(job);
  }
  private async drive(jobId: string, explicit: boolean): Promise<void> {
    if (this.disposed) return;
    const { job, saved } = await this.load(jobId); this.register(job);
    if (this.disposed) return;
    if (job.status === 'completed' || job.status === 'cancelled') { this.retire(job); return; }
    const cancel = await this.cancellation(job);
    if (!explicit && !cancel && ['paused', 'failed', 'uncertain'].includes(job.status)) return;
    if (cancel && !job.cancelRequested) { job.cancelRequested = true; await this.save(job); }
    while (true) {
      if (this.disposed) return;
      const step = job.steps.find(item => item.status !== 'completed');
      if (!step) { if (!await this.releaseBatch(job)) { await this.halt(job, 'paused', 'batchRelease'); return; } job.status = 'completed'; delete job.error; delete job.waitingForRequestId; await this.save(job); return; }
      job.cancelRequested ||= await this.cancellation(job);
      let receipt: SendReceipt | null;
      try { receipt = await this.receipt(job, step); } catch { await this.halt(job, 'uncertain', 'uncertain', step); return; }
      if (this.disposed) return;
      if (!receipt) {
        if (step.status !== 'reserved') { await this.halt(job, 'uncertain', 'uncertain', step); return; }
        if (job.cancelRequested) { await this.finishCancelled(job); return; }
        let request: SendInput;
        try { request = this.makeRequest(job, saved, step); }
        catch (error) { await this.halt(job, 'paused', error instanceof ReaderError && error.code === 'UNSUPPORTED_INTERACTION' ? 'unsupportedReference' : step.phase === 'reduce' ? 'reduceBudget' : 'mapBudget'); return; }
        const queue = !!saved.enqueueFirst && step.index === 0; const client = this.connected;
        if (queue && !client.enqueue) { await this.halt(job, 'paused', 'enqueueUnsupported'); return; }
        const conversation = await client.get(job.conversationId); if (this.disposed) return;
        if (!queue && conversation.activeRequestId && conversation.activeRequestId !== step.requestId) { await this.halt(job, 'paused', 'busy'); return; }
        step.status = 'submitting'; job.status = 'running'; delete job.error; await this.save(job);
        if (this.disposed) return;
        if (await this.cancellation(job)) { step.status = 'reserved'; await this.finishCancelled(job); return; }
        if (this.disposed) return;
        try { receipt = queue ? await client.enqueue!(request) : await client.send(request); }
        catch { await this.halt(job, 'uncertain', 'uncertain', step); return; }
        if (this.disposed) return;
        if (receipt.requestId !== step.requestId) { await this.halt(job, 'uncertain', 'uncertain', step); return; }
      }
      if (receipt.state === 'completed') {
        let result: ReadingResult | null;
        try { result = await this.answer(job, saved, step); }
        catch (error) { await this.halt(job, error instanceof ReaderError && error.code === 'PAYLOAD_TOO_LARGE' ? 'paused' : 'failed', error instanceof ReaderError && error.code === 'PAYLOAD_TOO_LARGE' ? 'reduceBudget' : 'resultMismatch', step); return; }
        if (!result) { await this.halt(job, 'failed', 'missingAnswer', step); return; }
        const resultHash = await hash(result); if (this.disposed) return;
        step.result = result; step.resultHash = resultHash; step.status = 'completed'; delete job.error; await this.save(job);
        continue;
      }
      if (receipt.state === 'failed') { await this.halt(job, 'failed', 'failed', step); return; }
      if (receipt.state === 'uncertain') { await this.halt(job, 'uncertain', 'uncertain', step); return; }
      if (receipt.state === 'cancelled') { await this.finishCancelled(job); return; }
      if (!['accepted', 'dispatching', 'running'].includes(receipt.state)) { await this.halt(job, 'uncertain', 'uncertain', step); return; }
      job.cancelRequested ||= await this.cancellation(job);
      if (this.disposed) return;
      if (job.cancelRequested) {
        step.status = 'cancelling'; job.status = 'cancelling'; await this.save(job);
        try {
          const stopped = await this.connected.cancel(job.conversationId, step.requestId); if (this.disposed) return;
          if (stopped.state === 'cancelled') await this.finishCancelled(job);
          else if (stopped.state === 'failed' || stopped.state === 'uncertain') await this.halt(job, stopped.state, stopped.state === 'failed' ? 'failed' : 'uncertain', step);
          else if (stopped.state === 'completed') continue;
        } catch { await this.halt(job, 'uncertain', 'uncertain', step); }
        return;
      }
      if (saved.enqueueFirst && step.index === 0 && receipt.state === 'accepted') {
        const conversation = await this.connected.get(job.conversationId); if (this.disposed) return;
        if (conversation.activeRequestId !== step.requestId) {
          if (job.waitingForRequestId) {
            try {
              const preceding = await this.connected.request(job.conversationId, job.waitingForRequestId); if (this.disposed) return;
              if (preceding.requestId !== job.waitingForRequestId || preceding.state === 'uncertain') { await this.halt(job, 'paused', 'precedingUncertain'); return; }
            } catch { await this.halt(job, 'paused', 'precedingUncertain'); return; }
          }
          const changed = step.status !== 'queued' || job.status !== 'queued'; step.status = 'queued'; job.status = 'queued'; delete job.error;
          if (changed) await this.save(job); else this.register(job); return;
        }
      }
      delete job.waitingForRequestId;
      step.status = 'running'; job.status = 'running'; delete job.error; await this.save(job); return;
    }
  }
}
