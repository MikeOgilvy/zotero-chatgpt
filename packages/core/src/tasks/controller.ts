import { clone } from '../../../contracts/src/clone.ts';
import { NATIVE_ANNOTATION_PROVENANCE, NativeOperationError, type NativeActionPort, type NativeAnnotationSnapshot, type NativeCollectionTarget } from '../../../contracts/src/native.ts';
import { ReaderError, type DocumentRevision } from '../../../contracts/src/index.ts';
import { validatePaperScope } from '../../../contracts/src/validation.ts';
import type { StoragePort } from '../../../contracts/src/runtime.ts';
import { validateAnnotationProposal as proposal, type AcquisitionChoice, type AcquisitionTaskItem, type ActionTaskOperation, type ActionTaskRecord, type ActionTasks, type AnnotationTaskItem } from '../../../contracts/src/tasks.ts';
export interface ActionTaskClock { uuid(): string; key(): string; now(): string }
interface TaskCoordination { queue: Promise<void>; active: Map<string, AbortController>; stopRequests: Set<string> }
const coordinationByStorage = new WeakMap<StoragePort, TaskCoordination>();
const ID = /^[a-zA-Z0-9-]{1,128}$/u;
const KEY = /^[A-Z0-9]{8}$/u;
const STATES = ['preparing', 'review', 'running', 'completed', 'partial', 'cancelled', 'uncertain', 'undone', 'conflict', 'failed'];
const ITEM_STATES = ['candidate', 'unresolved', 'skipped', 'writing', 'applied', 'metadata-only', 'failed', 'uncertain', 'undoing', 'undone', 'conflict'];
const OPERATIONS = ['annotation-create', 'metadata-create', 'collection-add', 'pdf-acquire', 'annotation-delete', 'collection-remove', 'item-trash', 'attachment-trash'];
function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'The task input is invalid or no longer matches its review.'); }
function unavailable(): never { throw new ReaderError('HISTORY_UNAVAILABLE', 'Task records could not be read and remain untouched.'); }
function id(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) invalid(); return value; }
function key(value: unknown): string { if (typeof value !== 'string' || !KEY.test(value)) invalid(); return value; }
function text(value: unknown, max: number, min = 0): string { if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0')) invalid(); return value; }
function record(value: unknown, allowed?: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); const object = value as Record<string, unknown>; if (allowed && Object.keys(object).some(k => !allowed.includes(k))) invalid(); return object; }
function equal(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
    return JSON.stringify(value);
  };
  return canonical(a) === canonical(b);
}
function documentRevision(value: unknown): DocumentRevision {
  const r = record(value, ['fingerprint', 'size', 'modifiedAt', 'sha256']);
  text(r.fingerprint, 1024, 1);
  if (!Number.isSafeInteger(r.size) || (r.size as number) < 0 || !Number.isFinite(r.modifiedAt) || (r.modifiedAt as number) < 0 || (r.sha256 !== undefined && (typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(r.sha256)))) invalid();
  return clone(r) as unknown as DocumentRevision;
}
function collectionTarget(value: unknown): NativeCollectionTarget {
  const t = record(value, ['clientId', 'libraryId', 'collectionKey']);
  validatePaperScope({ clientId: t.clientId, libraryId: t.libraryId, attachmentKey: key(t.collectionKey) });
  return { clientId: t.clientId as string, libraryId: t.libraryId as number, collectionKey: t.collectionKey as string };
}
function choice(value: unknown): AcquisitionChoice {
  const c = record(value, ['metadataIndex', 'duplicateKey', 'downloadPDF']);
  if (c.metadataIndex !== undefined && (!Number.isSafeInteger(c.metadataIndex) || (c.metadataIndex as number) < 0 || (c.metadataIndex as number) >= 20)) invalid();
  if (c.duplicateKey !== undefined) key(c.duplicateKey);
  if (c.downloadPDF !== undefined && typeof c.downloadPDF !== 'boolean') invalid();
  return clone(c);
}
export function validateTaskRecord(value: unknown): ActionTaskRecord {
  const raw = record(value, ['schemaVersion', 'id', 'conversationId', 'kind', 'state', 'question', 'createdAt', 'updatedAt', 'revision', 'approvedAt', 'cancelRequested', 'paper', 'documentRevision', 'modelRequestId', 'target', 'items']);
  if (raw.schemaVersion !== 1 || !STATES.includes(String(raw.state)) || !['annotations', 'acquisition'].includes(String(raw.kind))) invalid();
  id(raw.id); id(raw.conversationId); text(raw.question, 16000); text(raw.createdAt, 64, 1); text(raw.updatedAt, 64, 1);
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 || !Array.isArray(raw.items) || raw.items.length > 50 || (raw.cancelRequested !== undefined && raw.cancelRequested !== true)) invalid();
  if (raw.approvedAt !== undefined) text(raw.approvedAt, 64, 1);
  if (raw.kind === 'annotations') { validatePaperScope(raw.paper); documentRevision(raw.documentRevision); if (raw.modelRequestId !== undefined) id(raw.modelRequestId); }
  else collectionTarget(raw.target);
  const ids = new Set<string>(); const keys = new Set<string>();
  for (const value of raw.items) {
    const entry = record(value, ['id', 'kind', 'reservedKey', 'status', 'operation', 'errorCode', 'selected', 'proposal', 'resolution', 'annotation', 'identifier', 'preview', 'duplicates', 'choice', 'item', 'created', 'collectionAddition', 'acquisition', 'attachmentUndone']);
    const itemID = id(entry.id); const itemKey = key(entry.reservedKey);
    if (ids.has(itemID) || keys.has(itemKey) || !ITEM_STATES.includes(String(entry.status)) || (entry.selected !== undefined && typeof entry.selected !== 'boolean') || (entry.operation !== undefined && (typeof entry.operation !== 'string' || !OPERATIONS.includes(entry.operation)))) invalid();
    ids.add(itemID); keys.add(itemKey);
    if (entry.errorCode !== undefined && (typeof entry.errorCode !== 'string' || !/^[A-Z_]{1,80}$/u.test(entry.errorCode))) invalid();
    if (raw.kind === 'annotations') {
      if (entry.kind !== 'annotation') invalid(); proposal(entry.proposal);
      if (entry.resolution !== undefined) {
        const resolution = record(entry.resolution);
        if (!['resolved', 'unresolved', 'ambiguous'].includes(String(resolution.status))) invalid();
        if (resolution.status === 'resolved') { const candidate = record(resolution.candidate); const source = record(candidate.source); if (!equal(source.paper, raw.paper) || !equal(source.revision, raw.documentRevision)) invalid(); text(candidate.text, 16000, 2); }
      }
      if (entry.annotation !== undefined) { const annotation = record(entry.annotation); if (annotation.key !== itemKey || !equal(annotation.paper, raw.paper)) invalid(); }
    } else {
      if (entry.kind !== 'acquisition') invalid(); text(entry.identifier, 8192, 1); if (!Array.isArray(entry.duplicates) || entry.duplicates.length > 1000) invalid();
      if (entry.preview !== undefined) { const preview = record(entry.preview); if (!Array.isArray(preview.candidates) || preview.candidates.length > 20) invalid(); }
      if (entry.choice !== undefined) choice(entry.choice);
      if (entry.created !== undefined && typeof entry.created !== 'boolean') invalid();
      if (entry.attachmentUndone !== undefined && entry.attachmentUndone !== true) invalid();
      if (entry.item !== undefined) { const item = record(entry.item); const target = record(raw.target); if (item.clientId !== target.clientId || item.libraryId !== target.libraryId || (entry.created && item.key !== itemKey)) invalid(); }
    }
  }
  return clone(raw) as unknown as ActionTaskRecord;
}
function errorCode(error: unknown): string { return error instanceof NativeOperationError ? error.code : 'NATIVE_ERROR'; }
async function readWhileActive<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  const cancelled = () => new NativeOperationError('CANCELLED', 'Task preparation was cancelled.');
  if (signal.aborted) throw cancelled();
  let abort = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
function matchesAnnotation(item: AnnotationTaskItem, snapshot: NativeAnnotationSnapshot): boolean {
  if (item.resolution?.status !== 'resolved') return false; const candidate = item.resolution.candidate;
  return snapshot.key === item.reservedKey && equal(snapshot.paper, candidate.source.paper) && snapshot.type === 'highlight' && snapshot.color === '#ffd400'
    && snapshot.text === candidate.text && snapshot.comment === NATIVE_ANNOTATION_PROVENANCE + (item.proposal.reason ? '\n' + item.proposal.reason.trim().normalize('NFC') : '')
    && !snapshot.isExternal && snapshot.authorName === '' && snapshot.tags.length === 0 && snapshot.sortIndex === candidate.sortIndex && snapshot.pageLabel === candidate.pageLabel && equal(snapshot.position, candidate.position);
}
function aggregate(task: ActionTaskRecord): ActionTaskRecord['state'] {
  const selected = task.items.filter(item => item.selected);
  if (selected.some(item => ['uncertain', 'writing', 'undoing'].includes(item.status))) return 'uncertain';
  if (selected.some(item => item.status === 'conflict')) return 'conflict';
  if (selected.length && selected.every(item => item.status === 'undone')) return 'undone';
  if (selected.some(item => item.kind === 'acquisition' && item.attachmentUndone && item.status !== 'undone')) return task.cancelRequested ? 'cancelled' : 'partial';
  if (selected.length && selected.every(item => ['applied', 'metadata-only', 'undone'].includes(item.status))) return selected.some(item => item.status === 'metadata-only') ? 'partial' : 'completed';
  if (task.cancelRequested) return 'cancelled';
  if (selected.some(item => item.status === 'failed')) return selected.some(item => ['applied', 'metadata-only'].includes(item.status)) ? 'partial' : 'failed';
  return selected.length ? 'partial' : 'completed';
}

/** One controller per plugin instance; the only owner of task approval and native write intent. */
export class ActionTaskController implements ActionTasks {
  private coordination: TaskCoordination;
  private active: Map<string, AbortController>;
  private stopRequests: Set<string>;
  private listeners = new Set<(record: ActionTaskRecord) => void>();
  constructor(private storage: StoragePort, private native: NativeActionPort, private clock: ActionTaskClock) {
    const existing = coordinationByStorage.get(storage);
    this.coordination = existing ?? { queue: Promise.resolve(), active: new Map(), stopRequests: new Set() };
    if (!existing) coordinationByStorage.set(storage, this.coordination);
    this.active = this.coordination.active; this.stopRequests = this.coordination.stopRequests;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const result = this.coordination.queue.then(operation); this.coordination.queue = result.then(() => undefined, () => undefined); return result; }
  private path(value: string): string { return `tasks/${id(value)}.json`; }
  private async load(value: string): Promise<ActionTaskRecord> {
    let bytes: Uint8Array | null;
    try { bytes = await this.storage.read(this.path(value)); } catch { unavailable(); }
    if (!bytes) throw new ReaderError('NOT_FOUND', 'This task was not found.');
    if (bytes.length > 8 * 1024 * 1024) unavailable();
    try { const task = validateTaskRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown); if (task.id !== value) unavailable(); return task; }
    catch { unavailable(); }
  }
  private async save(task: ActionTaskRecord): Promise<void> {
    task.updatedAt = this.clock.now(); task.revision++;
    const checked = validateTaskRecord(task); const bytes = new TextEncoder().encode(JSON.stringify(checked)); if (bytes.length > 8 * 1024 * 1024) invalid();
    try { await this.storage.writeAtomic(this.path(task.id), bytes); } catch { throw new ReaderError('HISTORY_UNAVAILABLE', 'Task state could not be saved. Native intent must be reconciled before continuing.'); }
    for (const listener of this.listeners) { try { listener(clone(task)); } catch { /* A view cannot invalidate a durable task update. */ } }
  }
  private recovered(task: ActionTaskRecord): ActionTaskRecord {
    if (this.active.has(task.id)) return task;
    if (task.state === 'running' || task.items.some(item => ['writing', 'undoing'].includes(item.status))) { task.state = 'uncertain'; for (const item of task.items) if (['writing', 'undoing'].includes(item.status)) item.status = 'uncertain'; }
    else if (task.state === 'preparing') task.state = 'failed';
    return task;
  }
  get = async (value: string): Promise<ActionTaskRecord> => this.recovered(await this.load(value));
  list = async (conversationId?: string): Promise<ActionTaskRecord[]> => {
    if (conversationId !== undefined) id(conversationId); if (!this.storage.list) unavailable();
    let names: string[]; try { names = await this.storage.list('tasks'); } catch { unavailable(); }
    const tasks: ActionTaskRecord[] = [];
    for (const name of names) { if (!/^[a-zA-Z0-9-]{1,128}\.json$/u.test(name)) { if (name.endsWith('.json')) unavailable(); continue; } const task = await this.get(name.slice(0, -5)); if (conversationId === undefined || task.conversationId === conversationId) tasks.push(task); }
    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  };
  subscribe = (listener: (record: ActionTaskRecord) => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private base(conversationId: string, question: string) { const now = this.clock.now(); return { schemaVersion: 1 as const, id: id(this.clock.uuid()), conversationId: id(conversationId), question: text(question, 16000), state: 'preparing' as const, createdAt: now, updatedAt: now, revision: 0 }; }
  private async begin(task: ActionTaskRecord): Promise<AbortController> {
    if (await this.storage.read(this.path(task.id))) throw new ReaderError('REQUEST_CONFLICT', 'A task with this identifier already exists.');
    const abort = new AbortController(); this.active.set(task.id, abort);
    try { await this.save(task); } catch (error) { this.active.delete(task.id); throw error; } return abort;
  }
  planAnnotations: ActionTasks['planAnnotations'] = value => {
    const input = clone(value); if (!Array.isArray(input.candidates)) invalid(); const candidates = input.candidates.map(proposal); if (candidates.length > 50) invalid();
    const frozen = { conversationId: id(input.conversationId), question: text(input.question, 16000), paper: validatePaperScope(input.paper), documentRevision: documentRevision(input.revision) };
    const requestID = input.modelRequestId === undefined ? undefined : id(input.modelRequestId);
    return this.serial(async () => {
      let existing: Extract<ActionTaskRecord, { kind: 'annotations' }> | undefined;
      if (requestID) {
        let bytes: Uint8Array | null; try { bytes = await this.storage.read(this.path(requestID)); } catch { unavailable(); }
        if (bytes) {
          const stored = await this.load(requestID);
          if (stored.kind !== 'annotations' || stored.modelRequestId !== requestID || stored.conversationId !== frozen.conversationId || stored.question !== frozen.question || !equal(stored.paper, frozen.paper) || !equal(stored.documentRevision, frozen.documentRevision) || !equal(stored.items.map(item => item.proposal), candidates)) throw new ReaderError('REQUEST_CONFLICT', 'This model request already belongs to a different annotation task.');
          if (stored.state !== 'preparing' || stored.approvedAt || stored.cancelRequested) return this.recovered(stored);
          // A read-only preparation interrupted by shutdown may resume under its original keys.
          existing = stored;
        }
      }
      const task: Extract<ActionTaskRecord, { kind: 'annotations' }> = existing ?? { ...this.base(frozen.conversationId, frozen.question), ...frozen, ...(requestID ? { id: requestID, modelRequestId: requestID } : {}), kind: 'annotations', items: candidates.map(p => ({ kind: 'annotation', id: id(this.clock.uuid()), reservedKey: key(this.clock.key()), status: 'candidate', proposal: p })) };
      const abort = existing ? new AbortController() : await this.begin(task);
      if (existing) this.active.set(task.id, abort);
      if (this.stopRequests.has(task.id)) abort.abort();
      try {
        for (const item of task.items) {
          if (abort.signal.aborted) break;
          if (existing && item.resolution) continue;
          try { item.resolution = await readWhileActive(this.native.resolveQuote({ paper: task.paper, revision: task.documentRevision, quote: item.proposal.quote, pageIndexes: [item.proposal.pageIndex] }, abort.signal), abort.signal); item.status = item.resolution.status === 'resolved' ? 'candidate' : 'unresolved'; }
          catch (error) { item.status = 'unresolved'; item.errorCode = errorCode(error); }
          if (abort.signal.aborted) break;
          await this.save(task);
        }
        if (abort.signal.aborted) { task.cancelRequested = true; task.state = 'cancelled'; } else task.state = 'review';
        await this.save(task); return clone(task);
      } finally { this.active.delete(task.id); }
    });
  };
  planAcquisition: ActionTasks['planAcquisition'] = value => {
    const input = clone(value); if (!Array.isArray(input.identifiers) || input.identifiers.length > 50) invalid();
    const identifiers = [...new Set(input.identifiers.map(value => text(value, 8192, 1).trim()))];
    return this.serial(async () => {
      const task: ActionTaskRecord = { ...this.base(input.conversationId, input.question), kind: 'acquisition', target: collectionTarget(input.target), items: identifiers.map(identifier => ({ kind: 'acquisition', id: id(this.clock.uuid()), reservedKey: key(this.clock.key()), status: 'candidate', identifier, duplicates: [] })) };
      const abort = await this.begin(task);
      try {
        for (const item of task.items) {
          if (abort.signal.aborted) break;
          try {
            item.preview = await readWhileActive(this.native.previewMetadata({ identifier: item.identifier }, abort.signal), abort.signal);
            for (const metadata of item.preview.candidates) if (metadata.DOI) { const duplicates = await readWhileActive(this.native.findDuplicateDOI({ ...task.target, doi: metadata.DOI }, abort.signal), abort.signal); for (const duplicate of duplicates) if (!item.duplicates.some(i => i.key === duplicate.key)) item.duplicates.push(duplicate); }
            if (!item.preview.candidates.length) item.status = 'unresolved';
          } catch (error) { item.status = 'unresolved'; item.errorCode = errorCode(error); }
          if (abort.signal.aborted) break;
          await this.save(task);
        }
        if (abort.signal.aborted) { task.cancelRequested = true; task.state = 'cancelled'; } else task.state = 'review';
        await this.save(task); return clone(task);
      } finally { this.active.delete(task.id); }
    });
  };
  private async write<T>(task: ActionTaskRecord, item: AnnotationTaskItem | AcquisitionTaskItem, operation: ActionTaskOperation, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    item.status = operation.endsWith('delete') || operation.endsWith('remove') || operation.endsWith('trash') ? 'undoing' : 'writing'; item.operation = operation; delete item.errorCode;
    await this.save(task);
    try { return { ok: true, value: await run() }; }
    catch (error) {
      const code = errorCode(error); item.errorCode = code;
      item.status = code === 'CANCELLED' ? (item.kind === 'acquisition' && item.item ? 'metadata-only' : 'candidate') : ['INVALID_INPUT', 'SOURCE_CHANGED', 'NOT_FOUND', 'NOT_EDITABLE', 'CONFLICT'].includes(code) ? 'failed' : 'uncertain';
      await this.save(task); return { ok: false };
    }
  }
  approve: ActionTasks['approve'] = (value, selectedValues, choiceValues = {}) => {
    const selectedIDs = clone(selectedValues); const choices = clone(choiceValues);
    return this.serial(async () => {
      const task = this.recovered(await this.load(value));
      if (!Array.isArray(selectedIDs) || new Set(selectedIDs).size !== selectedIDs.length || selectedIDs.some(value => !task.items.some(item => item.id === value))) invalid();
      if (task.state !== 'review' || task.approvedAt) return clone(task);
      if (this.stopRequests.has(task.id)) { task.cancelRequested = true; task.state = 'cancelled'; await this.save(task); return clone(task); }
      if (Object.keys(choices).some(value => !selectedIDs.includes(value))) invalid();
      for (const item of task.items) {
        item.selected = selectedIDs.includes(item.id);
        if (!item.selected) { item.status = 'skipped'; continue; }
        if (item.status !== 'candidate') invalid();
        if (item.kind === 'annotation') { if (item.resolution?.status !== 'resolved') invalid(); }
        else {
          item.choice = choice(choices[item.id] ?? {});
          const candidates = item.preview?.candidates; if (!candidates?.length || (candidates.length > 1 && item.choice.metadataIndex === undefined)) invalid();
          const metadata = candidates[item.choice.metadataIndex ?? 0]; if (!metadata) invalid();
          const duplicates = item.duplicates.filter(duplicate => duplicate.metadata.DOI && duplicate.metadata.DOI.toLowerCase() === metadata.DOI?.toLowerCase());
          if (item.choice.duplicateKey && !duplicates.some(duplicate => duplicate.key === item.choice!.duplicateKey)) invalid();
          if (!item.choice.duplicateKey && duplicates.length > 1) invalid();
          if (!item.choice.duplicateKey && duplicates.length === 1) item.choice.duplicateKey = duplicates[0]!.key;
        }
      }
      task.approvedAt = this.clock.now(); task.state = 'running';
      const abort = new AbortController(); this.active.set(task.id, abort);
      try {
        await this.save(task);
        for (const item of task.items) {
          if (!item.selected || item.status !== 'candidate') continue;
          if (abort.signal.aborted) break;
          if (item.kind === 'annotation' && task.kind === 'annotations') {
            if (item.resolution?.status !== 'resolved') invalid();
            const candidate = item.resolution.candidate;
            const result = await this.write(task, item, 'annotation-create', () => this.native.createAnnotation({ candidate, key: item.reservedKey, type: 'highlight', color: '#ffd400', comment: item.proposal.reason }, abort.signal));
            if (result.ok) { item.annotation = result.value; item.status = 'applied'; await this.save(task); }
          } else if (item.kind === 'acquisition' && task.kind === 'acquisition') await this.acquire(task, item, abort.signal);
          if (['uncertain'].includes(item.status)) break;
        }
        if (abort.signal.aborted) task.cancelRequested = true;
        task.state = aggregate(task); await this.save(task); return clone(task);
      } finally { this.active.delete(task.id); }
    });
  };
  private async acquire(task: Extract<ActionTaskRecord, { kind: 'acquisition' }>, entry: AcquisitionTaskItem, signal: AbortSignal): Promise<void> {
    const selected = entry.choice ?? {}; const metadata = entry.preview?.candidates[selected.metadataIndex ?? 0]; if (!metadata) invalid();
    if (selected.duplicateKey) {
      const duplicate = entry.duplicates.find(item => item.key === selected.duplicateKey); if (!duplicate || duplicate.clientId !== task.target.clientId || duplicate.libraryId !== task.target.libraryId) invalid();
      entry.item = clone(duplicate); entry.created = false;
      const result = await this.write(task, entry, 'collection-add', () => this.native.addItemToCollection({ expected: duplicate, target: task.target }, signal));
      if (!result.ok) return;
      entry.collectionAddition = result.value; entry.item = result.value.after;
    } else {
      entry.created = true;
      const result = await this.write(task, entry, 'metadata-create', () => this.native.createItem({ target: task.target, key: entry.reservedKey, metadata }, signal));
      if (!result.ok) return;
      entry.item = result.value;
    }
    entry.status = 'applied'; await this.save(task);
    if (selected.downloadPDF === false) return;
    if (signal.aborted) { entry.status = 'metadata-only'; entry.errorCode = 'PDF_NOT_ATTEMPTED'; await this.save(task); return; }
    const item = entry.item;
    const result = await this.write(task, entry, 'pdf-acquire', () => this.native.acquireOpenAccessPDF({ item }, signal));
    if (!result.ok) return;
    entry.acquisition = result.value;
    if (result.value.status !== 'attached') { entry.status = 'metadata-only'; await this.save(task); return; }
    // Save the exact confirmed attachment before reading its parent's refreshed child list.
    await this.save(task);
    try {
      const current = await this.native.inspectItem(item);
      if (!current || !current.attachmentKeys.includes(result.value.attachment.key)) { entry.status = 'uncertain'; entry.errorCode = 'PDF_RESULT_UNCONFIRMED'; }
      else { entry.item = current; entry.status = 'applied'; }
    } catch { entry.status = 'uncertain'; entry.errorCode = 'PDF_RESULT_UNCONFIRMED'; }
    await this.save(task);
  }
  cancel: ActionTasks['cancel'] = value => {
    id(value); this.stopRequests.add(value); this.active.get(value)?.abort();
    return this.serial(async () => {
      try {
        const task = this.recovered(await this.load(value));
        if (['completed', 'partial', 'undone'].includes(task.state)) return task;
        task.cancelRequested = true;
        if (task.state !== 'uncertain') task.state = 'cancelled';
        await this.save(task); return clone(task);
      } finally { this.stopRequests.delete(value); }
    });
  };
  reconcile: ActionTasks['reconcile'] = value => this.serial(async () => {
    const task = this.recovered(await this.load(value));
    if (!task.approvedAt) return task;
    for (const item of task.items) {
      if (!['uncertain', 'writing', 'undoing'].includes(item.status)) continue;
      try {
        if (item.kind === 'annotation' && task.kind === 'annotations') {
          const current = await this.native.inspectAnnotation({ paper: task.paper, key: item.reservedKey });
          if (item.operation === 'annotation-create') {
            if (current && matchesAnnotation(item, current)) { item.annotation = current; item.status = 'applied'; delete item.errorCode; }
            else { item.status = current ? 'conflict' : 'failed'; item.errorCode = current ? 'OUTPUT_CHANGED' : 'WRITE_NOT_OBSERVED'; }
          } else if (item.operation === 'annotation-delete') {
            if (!current) { item.status = 'undone'; delete item.errorCode; }
            else { item.status = 'conflict'; item.errorCode = 'REMOVAL_NOT_CONFIRMED'; }
          }
        } else if (item.kind === 'acquisition' && task.kind === 'acquisition') {
          const ref = item.item ?? { clientId: task.target.clientId, libraryId: task.target.libraryId, key: item.reservedKey };
          const current = await this.native.inspectItem(ref);
          if (item.operation === 'metadata-create') {
            const metadata = item.preview?.candidates[item.choice?.metadataIndex ?? 0];
            // A matching DOI/title does not prove that fields outside the preview stayed untouched.
            // Without the post-save full signature, never adopt present-day human edits as task output.
            if (current && equal(current.metadata, metadata) && equal(current.collectionKeys, [task.target.collectionKey]) && current.attachmentKeys.length === 0) { item.status = 'uncertain'; item.errorCode = 'OUTPUT_UNCONFIRMED'; }
            else { item.status = current ? 'conflict' : 'failed'; item.errorCode = current ? 'OUTPUT_CHANGED' : 'WRITE_NOT_OBSERVED'; }
          } else if (item.operation === 'pdf-acquire') {
            if (current && item.item && item.acquisition?.status === 'attached' && equal(current.metadata, item.item.metadata) && current.attachmentKeys.includes(item.acquisition.attachment.key)) { item.item = current; item.status = 'applied'; delete item.errorCode; }
            else if (current && item.item && equal(current, item.item)) { item.status = 'metadata-only'; item.errorCode = 'PDF_NOT_CONFIRMED'; }
            else { item.status = 'uncertain'; item.errorCode = 'PDF_RESULT_UNCONFIRMED'; }
          } else if (item.operation === 'attachment-trash' && item.acquisition?.status === 'attached') {
            const attachment = await this.native.inspectAttachment(item.acquisition.attachment);
            if (!attachment) { item.attachmentUndone = true; item.status = 'applied'; item.errorCode = 'COLLECTION_UNDO_PENDING'; }
            else { item.status = 'conflict'; item.errorCode = 'REMOVAL_NOT_CONFIRMED'; }
          } else if (item.operation === 'item-trash') {
            if (!current) { item.status = 'undone'; delete item.errorCode; }
            else { item.status = 'conflict'; item.errorCode = 'REMOVAL_NOT_CONFIRMED'; }
          } else if (item.operation === 'collection-remove' && item.collectionAddition) {
            if (!current || !current.collectionKeys.includes(item.collectionAddition.collectionKey)) { item.status = 'undone'; delete item.errorCode; }
            else { item.status = 'conflict'; item.errorCode = 'REMOVAL_NOT_CONFIRMED'; }
          } else { item.status = 'uncertain'; item.errorCode = 'COLLECTION_RESULT_UNCONFIRMED'; }
        }
      } catch { item.status = 'uncertain'; item.errorCode = 'INSPECTION_UNAVAILABLE'; }
      await this.save(task);
    }
    task.state = aggregate(task); await this.save(task); return clone(task);
  });
  undo: ActionTasks['undo'] = value => this.serial(async () => {
    const task = this.recovered(await this.load(value));
    if (!task.approvedAt) return task;
    if (task.items.some(item => ['writing', 'undoing', 'uncertain'].includes(item.status))) throw new ReaderError('BUSY', 'Reconcile uncertain native writes before undoing this task.');
    if (task.state === 'undone') return task;
    const abort = new AbortController(); this.active.set(task.id, abort);
    try {
      task.state = 'running'; await this.save(task);
      for (const item of [...task.items].reverse()) {
        if (abort.signal.aborted) break;
        if (!['applied', 'metadata-only', 'conflict'].includes(item.status)) continue;
        if (item.kind === 'annotation' && item.annotation) {
          const expected = item.annotation;
          const result = await this.write(task, item, 'annotation-delete', () => this.native.deleteAnnotation({ expected }, abort.signal));
          if (result.ok) { item.status = result.value.status === 'conflict' ? 'conflict' : 'undone'; if (item.status === 'conflict') item.errorCode = 'OUTPUT_CHANGED'; await this.save(task); }
        } else if (item.kind === 'acquisition' && item.item) {
          if (item.created) {
            const expected = item.item; const attachments = item.acquisition?.status === 'attached' ? [item.acquisition.attachment] : [];
            const result = await this.write(task, item, 'item-trash', () => this.native.undoCreatedItem({ expected, attachments }, abort.signal));
            if (result.ok) { item.status = result.value.status === 'conflict' ? 'conflict' : 'undone'; if (item.status === 'conflict') item.errorCode = 'OUTPUT_CHANGED'; await this.save(task); }
          } else {
            if (item.acquisition?.status === 'attached' && !item.attachmentUndone) {
              const expected = item.acquisition.attachment;
              const result = await this.write(task, item, 'attachment-trash', () => this.native.undoAttachment({ expected }, abort.signal));
              if (!result.ok) { if (['uncertain'].includes(item.status)) break; continue; }
              if (result.value.status === 'conflict') { item.status = 'conflict'; item.errorCode = 'OUTPUT_CHANGED'; await this.save(task); continue; }
              item.attachmentUndone = true; item.status = 'applied'; await this.save(task);
            }
            if (abort.signal.aborted) break;
            if (item.collectionAddition) {
              const expected = item.collectionAddition;
              const result = await this.write(task, item, 'collection-remove', () => this.native.undoCollectionAddition({ expected }, abort.signal));
              if (result.ok) { item.status = result.value.status === 'conflict' ? 'conflict' : 'undone'; if (item.status === 'conflict') item.errorCode = 'OUTPUT_CHANGED'; await this.save(task); }
            }
          }
        }
        if (item.status === 'uncertain') break;
      }
      if (abort.signal.aborted) task.cancelRequested = true;
      task.state = aggregate(task); await this.save(task); return clone(task);
    } finally { this.active.delete(task.id); }
  });
}
