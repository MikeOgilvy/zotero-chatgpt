import { ReaderError, type Conversation, type DocumentContext, type DocumentSummary, type GenerationSettings, type PaperScope, type RequestState, type UUID } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { validatePaperScope, validateSettings, validateCitation, validateImageAttachment, validateOutputImage, validatePaperIdentity } from '../../../contracts/src/validation.ts';
import { validateBatch, validateContextReport, validateReference, validateWorkflow } from '../../../contracts/src/workspace-validation.ts';
import { parseThreadUsage } from '../codex/model-capabilities.ts';
import { DOCUMENT_BYTES, documentSummary, validateDocument, validateRevision } from '../../../contracts/src/document.ts';
import type { StoragePort } from '../../../contracts/src/runtime.ts';
import { encodeRequestLog, parseRequestLog } from './log.ts';
export interface RequestRecord { requestId: UUID; hash: string; hashVersion?: 2 | 3; state: RequestState; turnId: string | null; createdAt: string; updatedAt: string; action?: 'explain' | 'ask'; firstTokenAt?: string; lastEventAt?: string }
/** Persisted shape. Requests share the conversation file so accepted state and the user message land atomically. */
export interface StoredConversation extends Conversation { schemaVersion: 1 | 2 | 3; documents?: Record<string, DocumentContext>; logSeq: number; upstream: { threadId: string | null; permissionMode?: 'read' | 'diagram' }; requests: RequestRecord[] }
/** Snapshot and journal metadata only. Referenced source files have not been opened or verified. */
export type ConversationMetadata = Omit<StoredConversation, 'documents'>;
interface PaperIndex { schemaVersion: 1; conversations: UUID[]; current: UUID | null }
export interface StoreClock { uuid: () => string; now: () => string }
const UUID_PATTERN = /^[0-9a-f-]{36}$/u;
const DOCUMENT_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;
const requestStates: RequestState[] = ['accepted', 'dispatching', 'running', 'completed', 'cancelled', 'failed', 'uncertain'];
const messageStatuses = ['pending', 'streaming', 'completed', 'cancelled', 'failed', 'uncertain'];
const TERMINAL: RequestState[] = ['completed', 'cancelled', 'failed', 'uncertain'];
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved conversation data could not be read; it was left untouched.'); }
function storageFailure(): never { throw new ReaderError('INTERNAL_ERROR', 'Conversation data could not be saved.'); }
function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable(); return value as Record<string, unknown>; }
function str(value: unknown): string { if (typeof value !== 'string') unavailable(); return value; }
function timestamp(value: unknown): string {
  const result = str(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(result) || !Number.isFinite(Date.parse(result))) unavailable();
  return result;
}
function nullableStr(value: unknown): string | null { return value === null ? null : str(value); }
function int(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) unavailable(); return value; }
function settingsOf(value: unknown): GenerationSettings { try { return validateSettings(value); } catch { return unavailable(); } }
function documentIds(value: Record<string, unknown>): string[] {
  if (value.schemaVersion === 1) return [];
  if (!Array.isArray(value.documentIds) || value.documentIds.length > 10_000) unavailable();
  const ids = value.documentIds.map(str); if (ids.some(id => !DOCUMENT_ID.test(id)) || new Set(ids).size !== ids.length) unavailable(); return ids;
}
function summaryOf(value: unknown): DocumentSummary {
  const summary = asRecord(value);
  if (Object.keys(summary).some(key => !['id', 'revision', 'parserVersion', 'totalPages', 'pages', 'textBytes', 'sourceId'].includes(key))) unavailable();
  const id = str(summary.id); if (!DOCUMENT_ID.test(id)) unavailable();
  if (summary.sourceId !== undefined && !DOCUMENT_ID.test(str(summary.sourceId))) unavailable();
  let revision; try { revision = validateRevision(summary.revision); } catch { unavailable(); }
  const label = (value: unknown, max: number) => { const result = str(value); if (!result.length || result.length > max || /[\u0000-\u001f]/u.test(result)) unavailable(); return result; };
  const totalPages = int(summary.totalPages); const textBytes = int(summary.textBytes);
  if (totalPages < 1 || totalPages > 10_000 || textBytes > DOCUMENT_BYTES || !Array.isArray(summary.pages) || !summary.pages.length || summary.pages.length > totalPages) unavailable();
  const seen = new Set<number>();
  const pages: DocumentSummary['pages'] = summary.pages.map(value => {
    const page = asRecord(value);
    if (Object.keys(page).some(key => !['pageIndex', 'pageLabel', 'status', 'partial'].includes(key)) || (page.partial !== undefined && page.partial !== true) || !['text', 'empty', 'error'].includes(str(page.status))) unavailable();
    const pageIndex = int(page.pageIndex); if (pageIndex >= totalPages || seen.has(pageIndex)) unavailable(); seen.add(pageIndex);
    return { pageIndex, pageLabel: label(page.pageLabel, 64), status: page.status as DocumentSummary['pages'][number]['status'], ...(page.partial ? { partial: true } : {}) };
  });
  if (pages.some(page => page.status === 'text') ? textBytes === 0 : textBytes !== 0) unavailable();
  return { id, revision, parserVersion: label(summary.parserVersion, 64), totalPages, pages, textBytes, ...(summary.sourceId !== undefined ? { sourceId: str(summary.sourceId) } : {}) };
}
function parseConversation(value: unknown, metadataOnly = false): StoredConversation {
  const c = asRecord(value);
  if ((c.schemaVersion !== 1 && c.schemaVersion !== 2 && c.schemaVersion !== 3) || !Array.isArray(c.messages) || !Array.isArray(c.requests) || c.messages.length > 10_000 || c.requests.length > 10_000) unavailable();
  const documents: Record<string, DocumentContext> = {};
  if (c.schemaVersion >= 2 && !metadataOnly) {
    for (const [id, raw] of Object.entries(asRecord(c.documents))) {
      try { const doc = validateDocument(raw); if (doc.id !== id) unavailable(); documents[id] = doc; }
      catch { unavailable(); }
    }
  }
  let paper: PaperScope; try { paper = validatePaperScope(c.paper); } catch { return unavailable(); }
  const declared = new Set(metadataOnly ? documentIds(c) : []);
  const summaries = new Map<string, { summary: DocumentSummary; paper: PaperScope }>();
  const resolveSummary = (value: unknown, expectedPaper: PaperScope): DocumentSummary => {
    if (!metadataOnly) {
      const source = documents[str(asRecord(value).id)];
      if (!source || JSON.stringify(source.paper) !== JSON.stringify(expectedPaper)) unavailable(); return documentSummary(source);
    }
    const summary = summaryOf(value); if (!declared.has(summary.id)) unavailable();
    const previous = summaries.get(summary.id);
    if (previous && (JSON.stringify(previous.summary) !== JSON.stringify(summary) || JSON.stringify(previous.paper) !== JSON.stringify(expectedPaper))) unavailable();
    summaries.set(summary.id, { summary, paper: expectedPaper }); return summary;
  };
  const messages = c.messages.map(entry => {
    const m = asRecord(entry);
    if ((m.role !== 'user' && m.role !== 'assistant') || (m.phase !== null && m.phase !== 'commentary' && m.phase !== 'final') || !messageStatuses.includes(str(m.status)) || !Array.isArray(m.citations)) unavailable();
    let citations; try { citations = m.citations.map(validateCitation); } catch { return unavailable(); }
    const message: StoredConversation['messages'][number] = { id: str(m.id), requestId: str(m.requestId), role: m.role, phase: m.phase, settings: settingsOf(m.settings), text: str(m.text), citations, status: m.status as StoredConversation['messages'][number]['status'] };
    if (m.upstreamItemId !== undefined) { const id = str(m.upstreamItemId); if (!id.length || id.length > 1024) unavailable(); message.upstreamItemId = id; }
    if (m.effectiveSettings !== undefined) message.effectiveSettings = settingsOf(m.effectiveSettings);
    if (m.action === 'explain' || m.action === 'ask') message.action = m.action;
    // Frozen routing mode. Absent on records written before the field existed; D3 interprets it as
    // `'chat'`, so it is not materialized here and an old record is never rewritten just to add it.
    if (m.mode !== undefined) { if (m.mode !== 'chat' && m.mode !== 'agent') unavailable(); message.mode = m.mode; }
    if (m.paper !== undefined) { try { message.paper = validatePaperIdentity(m.paper); } catch { unavailable(); } }
    try {
      if (m.workflow !== undefined) message.workflow = validateWorkflow(m.workflow);
      if (m.batch !== undefined) message.batch = validateBatch(m.batch);
      if (m.contextReport !== undefined) message.contextReport = validateContextReport(m.contextReport);
      if (m.references !== undefined) { if (!Array.isArray(m.references)) unavailable(); message.references = m.references.map(validateReference); }
      if (m.generatedImages !== undefined) { if (!Array.isArray(m.generatedImages)) unavailable(); message.generatedImages = m.generatedImages.map(validateOutputImage); }
    } catch { unavailable(); }
    if (m.document !== undefined) {
      message.document = resolveSummary(m.document, paper);
    }
    if (m.referenceDocuments !== undefined) {
      if (!Array.isArray(m.referenceDocuments)) unavailable();
      message.referenceDocuments = m.referenceDocuments.map(entry => {
        const r = asRecord(entry); const id = str(r.referenceId);
        const ref = message.references?.find(ref => ref.id === id);
        if (!ref?.paper) unavailable();
        return { referenceId: id, document: resolveSummary(r.document, ref.paper) };
      });
    }
    if (m.images !== undefined) {
      if (!Array.isArray(m.images)) unavailable();
      try { message.images = m.images.map(validateImageAttachment); } catch { return unavailable(); }
    }
    return message;
  });
  const requests = c.requests.map(entry => {
    const r = asRecord(entry);
    if (!requestStates.includes(str(r.state) as RequestState)) unavailable();
    const record: RequestRecord = { requestId: str(r.requestId), hash: str(r.hash), state: r.state as RequestState, turnId: nullableStr(r.turnId), createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) };
    if (r.hashVersion !== undefined) { if (r.hashVersion !== 2 && r.hashVersion !== 3) unavailable(); record.hashVersion = r.hashVersion; }
    if (r.action === 'explain' || r.action === 'ask') record.action = r.action;
    if (r.firstTokenAt !== undefined) record.firstTokenAt = str(r.firstTokenAt);
    if (r.lastEventAt !== undefined) record.lastEventAt = str(r.lastEventAt);
    return record;
  });
  const upstream = asRecord(c.upstream);
  const result: StoredConversation = { schemaVersion: c.schemaVersion, ...(c.schemaVersion >= 2 && !metadataOnly ? { documents } : {}), logSeq: c.logSeq === undefined ? 0 : int(c.logSeq), id: str(c.id), paper, title: str(c.title), settings: settingsOf(c.settings), activeRequestId: nullableStr(c.activeRequestId), messages, lastSeq: int(c.lastSeq), createdAt: str(c.createdAt), updatedAt: str(c.updatedAt), upstream: { threadId: nullableStr(upstream.threadId), ...(upstream.permissionMode === 'read' || upstream.permissionMode === 'diagram' ? { permissionMode: upstream.permissionMode } : {}) }, requests };
  try { if (c.paperIdentity !== undefined) result.paperIdentity = validatePaperIdentity(c.paperIdentity); } catch { unavailable(); }
  if (c.titleCustomized === true) result.titleCustomized = true;
  if (c.activeBatchId !== undefined) { if (!UUID_PATTERN.test(str(c.activeBatchId))) unavailable(); result.activeBatchId = str(c.activeBatchId); }
  if (c.parentConversationId !== undefined) { if (!UUID_PATTERN.test(str(c.parentConversationId))) unavailable(); result.parentConversationId = str(c.parentConversationId); }
  if (c.forkMessageId !== undefined) result.forkMessageId = str(c.forkMessageId);
  // Additive optional field: legacy records omit it and therefore load as unarchived. It is not a
  // schema change, so the record stays schema 3 and older builds keep reading it.
  if (c.archivedAt !== undefined) result.archivedAt = timestamp(c.archivedAt);
  if (c.usage !== undefined) {
    const usage = asRecord(c.usage); const checked = parseThreadUsage({ threadId: 'stored', turnId: 'stored', tokenUsage: { last: usage.last, total: usage.total, modelContextWindow: usage.contextWindow } });
    if (!checked) unavailable(); result.usage = { model: str(usage.model), contextWindow: checked.modelContextWindow, last: checked.last, total: checked.total };
  }
  return result;
}
function parseIndex(value: unknown): PaperIndex {
  const index = asRecord(value);
  if (index.schemaVersion !== 1 || !Array.isArray(index.conversations) || index.conversations.length > 10_000) unavailable();
  return { schemaVersion: 1, conversations: index.conversations.map(str), current: nullableStr(index.current) };
}
export class ConversationStore {
  private conversations = new Map<UUID, StoredConversation>();
  private queue = Promise.resolve();
  constructor(private storage: StoragePort, private clock: StoreClock) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private indexPath(paper: PaperScope): string {
    const checked = (() => { try { return validatePaperScope(paper); } catch (error) { throw error instanceof ReaderError ? error : new ReaderError('INVALID_REQUEST', 'paper is invalid'); } })();
    return `papers/${checked.clientId}-${checked.libraryId}-${checked.attachmentKey}.json`;
  }
  private conversationPath(id: UUID): string {
    if (!UUID_PATTERN.test(id)) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
    return `conversations/${id}.json`;
  }
  private logPath(id: UUID): string { return `conversations/${id}.jsonl`; }
  private sourcePath(conversationId: UUID, sourceId: UUID): string {
    this.conversationPath(conversationId); this.conversationPath(sourceId);
    return `conversations/${conversationId}.${sourceId}.source.json`;
  }
  private async readJson(path: string): Promise<unknown> {
    let bytes: Uint8Array | null;
    try { bytes = await this.storage.read(path); } catch { unavailable(); }
    if (!bytes) return null;
    if (bytes.length > 64 * 1024 * 1024) unavailable();
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; } catch { return unavailable(); }
  }
  private async writeJson(path: string, value: unknown): Promise<void> {
    try { await this.storage.writeAtomic(path, new TextEncoder().encode(JSON.stringify(value))); } catch { storageFailure(); }
  }
  private async applyLog(conversation: StoredConversation, strict = false): Promise<StoredConversation> {
    let bytes: Uint8Array | null;
    try { bytes = await this.storage.read(this.logPath(conversation.id)); } catch { if (strict) unavailable(); return conversation; }
    if (!bytes) return conversation;
    if (bytes.length > 64 * 1024 * 1024) { if (strict) unavailable(); return conversation; }
    const { records } = parseRequestLog(bytes);
    if (strict) {
      // An interrupted final append is recoverable; a corrupt complete record is not.
      const completedBytes = bytes.subarray(0, bytes.lastIndexOf(10) + 1);
      let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(completedBytes); } catch { unavailable(); }
      const complete = text.split('\n').filter(Boolean);
      if (complete.length !== records.length || records.some((record, index) => index > 0 && record.n <= records[index - 1]!.n)) unavailable();
    }
    let logSeq = conversation.logSeq;
    const byId = new Map(conversation.requests.map(entry => [entry.requestId, entry]));
    for (const record of records) {
      if (record.n <= conversation.logSeq) continue;
      const request = byId.get(record.requestId);
      if (request) {
        request.state = record.state; request.turnId = record.turnId; request.updatedAt = record.at;
        if (TERMINAL.includes(record.state)) {
          if (conversation.activeRequestId === record.requestId) conversation.activeRequestId = null;
          const status = record.state === 'completed' ? 'completed' : record.state === 'cancelled' ? 'cancelled' : record.state === 'failed' ? 'failed' : 'uncertain';
          for (const message of conversation.messages) {
            if (message.requestId === record.requestId && message.role === 'assistant' && (message.status === 'streaming' || message.status === 'pending')) message.status = status;
          }
        }
      }
      if (record.n > logSeq) logSeq = record.n;
    }
    conversation.logSeq = logSeq;
    return conversation;
  }
  /**
   * The paper index is re-read on every use rather than cached: the preferences pane deletes chats
   * through its own store instance, and a cached index here would keep listing a chat whose file is
   * gone, which is how the sidebar ended up asking for an "Unknown conversation". The file is tiny.
   */
  private async loadIndex(paper: PaperScope): Promise<PaperIndex> {
    const raw = await this.readJson(this.indexPath(paper));
    return raw === null ? { schemaVersion: 1 as const, conversations: [], current: null } : parseIndex(raw);
  }
  private async load(id: UUID): Promise<StoredConversation> {
    const loaded = await this.loadIfPresent(id);
    if (!loaded) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
    return loaded;
  }
  /** A missing file is a dangling index entry (null); a present but unreadable one is still an error. */
  private async loadIfPresent(id: UUID): Promise<StoredConversation | null> {
    const cached = this.conversations.get(id); if (cached) return cached;
    const raw = await this.readJson(this.conversationPath(id));
    if (raw === null) return null;
    const object = asRecord(raw);
    if (object.id !== id) unavailable();
    if (object.schemaVersion === 2 || object.schemaVersion === 3) {
      const documents: Record<string, unknown> = {};
      for (const key of documentIds(object)) documents[key] = await this.readJson(this.sourcePath(id, key));
      object.documents = documents;
    }
    const conversation = await this.applyLog(parseConversation(raw));
    this.conversations.set(id, conversation); return conversation;
  }
  current(paper: PaperScope): Promise<StoredConversation | null> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      const conversation = index.current ? await this.loadIfPresent(index.current) : null;
      return conversation ? clone(conversation) : null;
    });
  }
  list(paper: PaperScope): Promise<StoredConversation[]> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper); const all = [];
      for (const id of index.conversations) { const conversation = await this.loadIfPresent(id); if (conversation) all.push(clone(conversation)); }
      return all;
    });
  }
  get(id: UUID): Promise<StoredConversation> { return this.serial(async () => clone(await this.load(id))); }
  /** Does not populate the full-source cache: a subsequent get still verifies every source. */
  peek(id: UUID, scope?: { clientId: string }): Promise<ConversationMetadata> {
    return this.serial(async () => {
      const raw = await this.readJson(this.conversationPath(id));
      if (raw === null) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
      const object = asRecord(raw); if (object.id !== id) unavailable();
      let paper: PaperScope; try { paper = validatePaperScope(object.paper); } catch { unavailable(); }
      if (scope && paper.clientId !== scope.clientId) unavailable();
      const result = await this.applyLog(parseConversation(raw, true), true);
      result.queuedRequestIds = result.requests.filter(request => request.state === 'accepted' && request.requestId !== result.activeRequestId).map(request => request.requestId);
      return clone(result);
    });
  }
  create(paper: PaperScope, title: string, settings: GenerationSettings): Promise<StoredConversation> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      const now = this.clock.now(); const id = this.clock.uuid();
      // The title is stored as given: no "讨论 N" counter is derived from sibling records, so a chat is
      // never named after records the owner cannot see. Views tell same-name chats apart.
      const conversation: StoredConversation = { schemaVersion: 3, documents: {}, paperIdentity: { title, authors: [] }, logSeq: 0, id, paper: validatePaperScope(paper), title: title.trim() || title, settings: validateSettings(settings), activeRequestId: null, messages: [], lastSeq: 0, createdAt: now, updatedAt: now, upstream: { threadId: null, permissionMode: 'read' }, requests: [] };
      await this.writeJson(this.conversationPath(id), { ...conversation, documents: undefined, documentIds: [] });
      const updated: PaperIndex = { ...index, conversations: [...index.conversations, id], current: id };
      await this.writeJson(this.indexPath(paper), updated);
      this.conversations.set(id, conversation);
      return clone(conversation);
    });
  }
  /** Removes the conversation files and drops the id from the paper index. Does not overwrite a corrupt index. */
  remove(paper: PaperScope, id: UUID): Promise<void> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      if (!index.conversations.includes(id)) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
      const remaining = index.conversations.filter(entry => entry !== id);
      const updated: PaperIndex = { ...index, conversations: remaining, current: index.current === id ? remaining.at(-1) ?? null : index.current };
      try {
        // A dangling entry (file already gone) still leaves the index: only the files that exist are removed.
        const conversation = await this.loadIfPresent(id);
        if (conversation) {
          for (const sourceId of Object.keys(conversation.documents ?? {})) await this.storage.remove(this.sourcePath(id, sourceId));
          await this.storage.remove(this.conversationPath(id));
          await this.storage.remove(this.logPath(id));
        }
      } catch { storageFailure(); }
      await this.writeJson(this.indexPath(paper), updated);
      this.conversations.delete(id);
    });
  }
  select(paper: PaperScope, id: UUID): Promise<StoredConversation> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      if (!index.conversations.includes(id)) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
      const conversation = await this.load(id);
      const updated: PaperIndex = { ...index, current: id };
      await this.writeJson(this.indexPath(paper), updated);
      return clone(conversation);
    });
  }
  /** Replaces the stored conversation. Memory changes only after the ordered log append and atomic snapshot succeeded. */
  save(conversation: StoredConversation): Promise<void> {
    return this.serial(async () => {
      const previous = await this.load(conversation.id);
      const copy = clone(conversation); copy.updatedAt = this.clock.now();
      let logSeq = previous.logSeq;
      const beforeById = new Map(previous.requests.map(entry => [entry.requestId, entry]));
      try {
        for (const request of copy.requests) {
          const before = beforeById.get(request.requestId);
          if (before && before.state === request.state && before.turnId === request.turnId) continue;
          logSeq += 1;
          await this.storage.append(this.logPath(copy.id), encodeRequestLog({ schemaVersion: 1, n: logSeq, requestId: request.requestId, state: request.state, turnId: request.turnId, at: copy.updatedAt }));
        }
      } catch { storageFailure(); }
      copy.logSeq = logSeq;
      if (copy.schemaVersion >= 2) {
        for (const [id, document] of Object.entries(copy.documents ?? {})) {
          const before = previous.documents?.[id];
          if (!before) await this.writeJson(this.sourcePath(copy.id, id), validateDocument(document));
          else if (JSON.stringify(before) !== JSON.stringify(document)) throw new ReaderError('REQUEST_CONFLICT', 'Saved PDF sources are immutable.');
        }
        const { documents, ...snapshot } = copy;
        await this.writeJson(this.conversationPath(copy.id), { ...snapshot, documentIds: Object.keys(documents ?? {}) });
      } else await this.writeJson(this.conversationPath(copy.id), copy);
      this.conversations.set(copy.id, copy);
    });
  }
}
