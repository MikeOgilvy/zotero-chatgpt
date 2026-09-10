import { ReaderError, type Conversation, type GenerationSettings, type PaperScope, type RequestState, type UUID } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { validatePaperScope, validateSettings, validateCitation } from '../../../contracts/src/validation.ts';
import type { StoragePort } from '../../../contracts/src/runtime.ts';
import { encodeRequestLog, parseRequestLog } from './log.ts';
export interface RequestRecord { requestId: UUID; hash: string; state: RequestState; turnId: string | null; createdAt: string; updatedAt: string; action?: 'explain' | 'ask' }
/** Persisted shape. Requests share the conversation file so accepted state and the user message land atomically. */
export interface StoredConversation extends Conversation { schemaVersion: 1; logSeq: number; upstream: { threadId: string | null }; requests: RequestRecord[] }
interface PaperIndex { schemaVersion: 1; conversations: UUID[]; current: UUID | null }
export interface StoreClock { uuid: () => string; now: () => string }
const UUID_PATTERN = /^[0-9a-f-]{36}$/u;
const requestStates: RequestState[] = ['accepted', 'dispatching', 'running', 'completed', 'cancelled', 'failed', 'uncertain'];
const messageStatuses = ['pending', 'streaming', 'completed', 'cancelled', 'failed', 'uncertain'];
const TERMINAL: RequestState[] = ['completed', 'cancelled', 'failed', 'uncertain'];
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Saved conversation data could not be read; it was left untouched.'); }
function storageFailure(): never { throw new ReaderError('INTERNAL_ERROR', 'Conversation data could not be saved.'); }
function asRecord(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable(); return value as Record<string, unknown>; }
function str(value: unknown): string { if (typeof value !== 'string') unavailable(); return value; }
function nullableStr(value: unknown): string | null { return value === null ? null : str(value); }
function int(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) unavailable(); return value; }
function settingsOf(value: unknown): GenerationSettings { try { return validateSettings(value); } catch { return unavailable(); } }
function parseConversation(value: unknown): StoredConversation {
  const c = asRecord(value);
  if (c.schemaVersion !== 1 || !Array.isArray(c.messages) || !Array.isArray(c.requests) || c.messages.length > 10_000 || c.requests.length > 10_000) unavailable();
  let paper: PaperScope; try { paper = validatePaperScope(c.paper); } catch { return unavailable(); }
  const messages = c.messages.map(entry => {
    const m = asRecord(entry);
    if ((m.role !== 'user' && m.role !== 'assistant') || (m.phase !== null && m.phase !== 'commentary' && m.phase !== 'final') || !messageStatuses.includes(str(m.status)) || !Array.isArray(m.citations)) unavailable();
    let citations; try { citations = m.citations.map(validateCitation); } catch { return unavailable(); }
    const message: StoredConversation['messages'][number] = { id: str(m.id), requestId: str(m.requestId), role: m.role, phase: m.phase, settings: settingsOf(m.settings), text: str(m.text), citations, status: m.status as StoredConversation['messages'][number]['status'] };
    if (m.effectiveSettings !== undefined) message.effectiveSettings = settingsOf(m.effectiveSettings);
    return message;
  });
  const requests = c.requests.map(entry => {
    const r = asRecord(entry);
    if (!requestStates.includes(str(r.state) as RequestState)) unavailable();
    const record: RequestRecord = { requestId: str(r.requestId), hash: str(r.hash), state: r.state as RequestState, turnId: nullableStr(r.turnId), createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) };
    if (r.action === 'explain' || r.action === 'ask') record.action = r.action;
    return record;
  });
  const upstream = asRecord(c.upstream);
  return { schemaVersion: 1, logSeq: c.logSeq === undefined ? 0 : int(c.logSeq), id: str(c.id), paper, title: str(c.title), settings: settingsOf(c.settings), activeRequestId: nullableStr(c.activeRequestId), messages, lastSeq: int(c.lastSeq), createdAt: str(c.createdAt), updatedAt: str(c.updatedAt), upstream: { threadId: nullableStr(upstream.threadId) }, requests };
}
function parseIndex(value: unknown): PaperIndex {
  const index = asRecord(value);
  if (index.schemaVersion !== 1 || !Array.isArray(index.conversations) || index.conversations.length > 10_000) unavailable();
  return { schemaVersion: 1, conversations: index.conversations.map(str), current: nullableStr(index.current) };
}
export class ConversationStore {
  private conversations = new Map<UUID, StoredConversation>();
  private indexes = new Map<string, PaperIndex>();
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
  private async applyLog(conversation: StoredConversation): Promise<StoredConversation> {
    let bytes: Uint8Array | null;
    try { bytes = await this.storage.read(this.logPath(conversation.id)); } catch { return conversation; }
    if (!bytes || bytes.length > 64 * 1024 * 1024) return conversation;
    const { records } = parseRequestLog(bytes);
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
  private async loadIndex(paper: PaperScope): Promise<PaperIndex> {
    const path = this.indexPath(paper);
    const cached = this.indexes.get(path); if (cached) return cached;
    const raw = await this.readJson(path);
    const index = raw === null ? { schemaVersion: 1 as const, conversations: [], current: null } : parseIndex(raw);
    this.indexes.set(path, index); return index;
  }
  private async load(id: UUID): Promise<StoredConversation> {
    const cached = this.conversations.get(id); if (cached) return cached;
    const raw = await this.readJson(this.conversationPath(id));
    if (raw === null) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
    const conversation = await this.applyLog(parseConversation(raw));
    this.conversations.set(id, conversation); return conversation;
  }
  current(paper: PaperScope): Promise<StoredConversation | null> {
    return this.serial(async () => { const index = await this.loadIndex(paper); return index.current ? clone(await this.load(index.current)) : null; });
  }
  list(paper: PaperScope): Promise<StoredConversation[]> {
    return this.serial(async () => { const index = await this.loadIndex(paper); const all = []; for (const id of index.conversations) all.push(clone(await this.load(id))); return all; });
  }
  get(id: UUID): Promise<StoredConversation> { return this.serial(async () => clone(await this.load(id))); }
  create(paper: PaperScope, title: string, settings: GenerationSettings): Promise<StoredConversation> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      const now = this.clock.now(); const id = this.clock.uuid();
      const conversation: StoredConversation = { schemaVersion: 1, logSeq: 0, id, paper: validatePaperScope(paper), title, settings: validateSettings(settings), activeRequestId: null, messages: [], lastSeq: 0, createdAt: now, updatedAt: now, upstream: { threadId: null }, requests: [] };
      await this.writeJson(this.conversationPath(id), conversation);
      const updated: PaperIndex = { ...index, conversations: [...index.conversations, id], current: id };
      await this.writeJson(this.indexPath(paper), updated);
      this.conversations.set(id, conversation); this.indexes.set(this.indexPath(paper), updated);
      return clone(conversation);
    });
  }
  select(paper: PaperScope, id: UUID): Promise<StoredConversation> {
    return this.serial(async () => {
      const index = await this.loadIndex(paper);
      if (!index.conversations.includes(id)) throw new ReaderError('NOT_FOUND', 'Unknown conversation');
      const conversation = await this.load(id);
      const updated: PaperIndex = { ...index, current: id };
      await this.writeJson(this.indexPath(paper), updated);
      this.indexes.set(this.indexPath(paper), updated);
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
      await this.writeJson(this.conversationPath(copy.id), copy);
      this.conversations.set(copy.id, copy);
    });
  }
}
