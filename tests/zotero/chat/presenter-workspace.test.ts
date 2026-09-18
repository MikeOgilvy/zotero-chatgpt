/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { ConversationPresenter, type PresenterReading, type PresenterServices } from '../../../packages/zotero/src/chat/presenter.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../../packages/contracts/src/runtime.ts';
import { ReaderError, SHAREABLE_STORAGE_LOCATION, type Conversation, type ReaderEvent, type SendInput } from '../../../packages/contracts/src/index.ts';
import type { ReaderReference, ReaderSkill, ReaderWorkspace, PickedFile, SavedDraft, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import type { ActionTaskRecord, ActionTasks } from '../../../packages/contracts/src/tasks.ts';
import type { ReadingJob } from '../../../packages/core/src/context/coordinator.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import { paperA, paperB, citationA, imageA, settings } from '../../contracts/factories.ts';
import { presenterContext } from '../presenter-context.ts';
import { documentA } from '../../contracts/document-fixture.ts';

const userSkill: ReaderSkill = { id: 'user-study', name: 'Study', description: 'Study the supplied source', version: '1.0', revision: 'revision-one', markdown: '# Study\nPreserve notation.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const reference: ReaderReference = { id: 'other-paper', kind: 'article', label: 'Paper B', paper: paperB, identity: { title: 'Paper B', authors: [] }, capturedAt: '2026-09-12T00:00:00Z' };
const copy = <T>(value: T): T => structuredClone(value);
function fixture(options: { offline?: boolean; document?: boolean; searchTimeoutMs?: number } = {}) {
  let conversation: Conversation = { id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Paper A', settings, messages: [], activeRequestId: null, lastSeq: 0, createdAt: '2026-09-12T00:00:00Z', updatedAt: '2026-09-12T00:00:00Z' };
  const conversations = new Map([[conversation.id, conversation]]);
  let workspaceSettings: WorkspaceSettings = { ...defaultSettings(), skills: [userSkill], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }] };
  const saved = new Map<string, SavedDraft>(); const listeners = new Set<(event: ReaderEvent) => void>();
  const workspace: ReaderWorkspace = {
    settings: vi.fn(() => Promise.resolve(copy(workspaceSettings))), saveSettings: vi.fn<ReaderWorkspace['saveSettings']>(value => { workspaceSettings = copy(value); return Promise.resolve(); }),
    saveSkill: vi.fn<ReaderWorkspace['saveSkill']>(value => { const next = { ...copy(value), revision: 'revision-two' }; workspaceSettings.skills = [...workspaceSettings.skills.filter(item => item.id !== value.id), next]; return Promise.resolve(next); }),
    importSkill: vi.fn(() => Promise.resolve(userSkill)), deleteSkill: vi.fn(id => { workspaceSettings.skills = workspaceSettings.skills.filter(item => item.id !== id); return Promise.resolve(); }),
    saveDraft: vi.fn<ReaderWorkspace['saveDraft']>(value => { saved.set(value.conversationId ?? 'unbound', copy(value)); return Promise.resolve(); }), readDraft: vi.fn<ReaderWorkspace['readDraft']>((_paper, id) => Promise.resolve(copy(saved.get(id ?? 'unbound') ?? null))), deleteDraft: vi.fn<ReaderWorkspace['deleteDraft']>((_paper, id) => { saved.delete(id ?? 'unbound'); return Promise.resolve(); }),
    currentConversation: vi.fn(() => Promise.resolve(copy(conversation))), readConversation: vi.fn<ReaderWorkspace['readConversation']>(id => { const value = conversations.get(id); return value ? Promise.resolve(copy(value)) : Promise.reject(new ReaderError('NOT_FOUND', 'Unknown chat')); }),
    history: vi.fn<ReaderWorkspace['history']>((query, scope) => {
      const search = (query ?? '').toLowerCase();
      return Promise.resolve([...conversations.values()]
        .filter(item => (scope?.archived ? !!item.archivedAt : !item.archivedAt))
        .filter(item => !search || `${item.title} ${item.messages.map(message => message.text).join(' ')}`.toLowerCase().includes(search))
        .map(item => ({ id: item.id, paper: item.paper, title: item.title, identity: { title: item.title, authors: [] }, createdAt: item.createdAt, updatedAt: item.updatedAt, preview: item.messages.at(-1)?.text ?? '', messageCount: item.messages.length, hasDraft: saved.has(item.id), activeRequestId: item.activeRequestId, ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}) })));
    }),
    snapshotChat: vi.fn<ReaderWorkspace['snapshotChat']>(id => Promise.resolve({ id: `chat-${id}`, kind: 'chat' as const, label: 'Saved chat', conversationId: id, messageIds: ['m1'], text: 'Bounded chat snapshot', capturedAt: '2026-09-12T00:00:00Z' })),
  };
  const runtime: RuntimeSnapshot = { revision: 1, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [{ id: settings.model, displayName: 'Model', isDefault: true, supportedReasoningEfforts: [{ id: 'medium', description: '' }, { id: 'high', description: '' }], defaultReasoningEffort: 'medium', serviceTiers: [], defaultServiceTier: null, inputModalities: ['text', 'image'] }], error: null };
  const sent: SendInput[] = []; const queued: SendInput[] = [];
  const saveConversation = (value: Conversation) => { conversation = value; conversations.set(value.id, value); };
  const persistConversation = (value: Conversation) => { conversations.set(value.id, value); if (conversation.id === value.id) conversation = value; };
  const client: ReaderClient = {
    snapshot: () => copy(runtime), observe: listener => { listener(copy(runtime)); return () => undefined; }, refreshAccount: () => Promise.resolve(), startLogin: () => Promise.reject(new Error('No login in tests')), cancelLogin: () => Promise.resolve(),
    current: vi.fn(() => Promise.resolve(copy(conversation))), peekCurrent: vi.fn(() => Promise.resolve(copy(conversation))), newConversation: vi.fn(() => { saveConversation({ ...conversation, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], activeRequestId: null, queuedRequestIds: [], lastSeq: 0 }); return Promise.resolve(copy(conversation)); }),
    list: () => Promise.resolve(copy([...conversations.values()].filter(item => item.paper.attachmentKey === paperA.attachmentKey))), get: id => { const found = conversations.get(id); return found ? Promise.resolve(copy(found)) : Promise.reject(new ReaderError('NOT_FOUND', 'Unknown')); }, select: (_paper, id) => { const value = conversations.get(id); if (!value) return Promise.reject(new Error('Unknown')); conversation = value; return Promise.resolve(copy(value)); },
    send: vi.fn<ReaderClient['send']>(input => { const target = conversations.get(input.conversationId)!; sent.push(copy(input)); persistConversation({ ...target, activeRequestId: input.requestId, lastSeq: target.lastSeq + 1, messages: [...target.messages, { id: `u-${sent.length}`, requestId: input.requestId, role: 'user', phase: null, text: input.question, settings: input.settings, citations: input.citations, status: 'completed', ...(input.images ? { images: input.images } : {}), ...(input.workflow ? { workflow: input.workflow } : {}), ...(input.document ? { document: { id: input.document.id, revision: input.document.revision, parserVersion: input.document.parserVersion, totalPages: input.document.totalPages, pages: input.document.pages.map(page => ({ pageIndex: page.pageIndex, pageLabel: page.pageLabel, status: page.status })), textBytes: input.document.pages.reduce((sum, page) => sum + new TextEncoder().encode(page.text).length, 0) } } : {}), ...(input.references ? { references: input.references.map(reference => { const metadata = { ...reference }; delete metadata.document; return metadata; }) } : {}) }] }); return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false }); }),
    enqueue: vi.fn<NonNullable<ReaderClient['enqueue']>>(input => { queued.push(copy(input)); saveConversation({ ...conversation, queuedRequestIds: [...(conversation.queuedRequestIds ?? []), input.requestId] }); return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false }); }),
    request: (_conversation, requestId) => Promise.resolve({ requestId, state: 'completed', replay: false }), cancel: vi.fn<ReaderClient['cancel']>((_conversation, requestId) => Promise.resolve({ requestId, state: 'cancelled' as const, replay: false })),
    deleteConversation: () => Promise.resolve(copy(conversation)),
    renameConversation: vi.fn<NonNullable<ReaderClient['renameConversation']>>((id, title) => { const target = conversations.get(id)!; const renamed = { ...target, title, titleCustomized: true }; conversations.set(id, renamed); if (conversation.id === id) conversation = renamed; return Promise.resolve(copy(renamed)); }),
    branchConversation: vi.fn<NonNullable<ReaderClient['branchConversation']>>((_id, messageId) => { saveConversation({ ...conversation, id: 'bbbbbbbb-0000-4000-8000-000000000003', activeRequestId: null, parentConversationId: conversation.id, forkMessageId: messageId, messages: [] }); return Promise.resolve(copy(conversation)); }),
    diagnostics: () => Promise.resolve({ pluginVersion: 'test', runtimeVersion: 'test', errorCode: null, requestCount: 0, states: {}, storageLocation: SHAREABLE_STORAGE_LOCATION }), subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, close: () => Promise.resolve(),
  };
  const library = { search: vi.fn(() => Promise.resolve([copy(reference)])), read: vi.fn((value: ReaderReference) => Promise.resolve({ ...copy(value), document: { ...copy(documentA), paper: paperB } })), open: vi.fn(() => Promise.resolve()), pickFile: vi.fn<() => Promise<PickedFile>>(() => Promise.resolve({ references: [], images: [] })), exportImage: vi.fn(() => Promise.resolve()) };
  let id = 0;
  const services: PresenterServices = { ensureStarted: vi.fn(() => options.offline ? Promise.reject(new Error('Runtime unavailable')) : Promise.resolve(client)), openAuthorization: () => undefined, uuid: () => `9a1c3e5f-7b2d-4c6e-8f0a-${String(++id).padStart(12, '0')}`, now: () => '2026-09-12T00:00:00Z', getWorkspace: () => Promise.resolve(workspace), library, openHistory: vi.fn(() => Promise.resolve()), ...(options.searchTimeoutMs === undefined ? {} : { searchTimeoutMs: options.searchTimeoutMs }), ...(options.document ? { document: { prepare: () => Promise.resolve(copy(documentA)), validate: () => Promise.resolve(), readEnabled: () => true, writeEnabled: () => {} } } : {}) };
  const presenter = new ConversationPresenter(presenterContext(paperA, 'Paper A'), services);
  type Pending = ReaderEvent extends infer E ? E extends ReaderEvent ? Omit<E, 'seq' | 'conversationId' | 'at'> : never : never;
  const emit = (event: Pending) => { const value: ReaderEvent = { ...event, seq: conversation.lastSeq + 1, conversationId: conversation.id, at: 'now' }; saveConversation({ ...conversation, lastSeq: value.seq, ...(['completed', 'cancelled', 'failed', 'uncertain'].includes(event.type) ? { activeRequestId: null } : {}) }); for (const listener of listeners) listener(value); };
  const emitFor = (id: string, event: Pending) => { const record = conversations.get(id)!; const value: ReaderEvent = { ...event, seq: record.lastSeq + 1, conversationId: id, at: 'now' }; conversations.set(id, { ...record, lastSeq: value.seq, ...(['completed', 'cancelled', 'failed', 'uncertain'].includes(event.type) ? { activeRequestId: null } : {}) }); for (const listener of listeners) listener(value); };
  return { presenter, services, workspace, saved, conversations, client, library, sent, queued, emit, emitFor, conversation: () => conversation, saveConversation, workspaceSettings: () => workspaceSettings };
}

it('restores local chat, rich draft and scroll while runtime is unavailable, then persists edits', async () => {
  const f = fixture({ offline: true }); const id = f.conversation().id;
  f.saved.set(id, { schemaVersion: 1, conversationId: id, paper: paperA, updatedAt: '2026-09-12T00:00:00Z', scrollTop: 175, pageRange: [2, 2], draft: { paper: paperA, settings, question: 'Saved question', citations: [citationA], images: [imageA], references: [reference], skillId: 'user-study', profileId: 'formal', overrides: {} } });
  await f.presenter.activate();
  // The record's `pageRange` is read without error and dropped: the control that could show or clear
  // it is gone, so a restored range would silently narrow every later request forever.
  expect(f.presenter.snapshot()).toMatchObject({ conversation: { id }, draft: { question: 'Saved question', references: [reference], profileId: 'formal' }, scrollTop: 175, document: { range: null } });
  expect(f.sent).toHaveLength(0); f.presenter.setQuestion('Edited offline'); f.presenter.setScrollTop(230); await f.presenter.flushDraft();
  expect(f.saved.get(id)).toMatchObject({ draft: { question: 'Edited offline', references: [reference] }, scrollTop: 230 });
  // Nothing re-persists a range either: the schema field stays but is always written as null.
  expect(f.saved.get(id)?.pageRange).toBeNull();
  f.presenter.dispose();
});

it('sends the whole PDF after a legacy draft with a saved page range is loaded', async () => {
  const f = fixture({ document: true }); const id = f.conversation().id;
  f.saved.set(id, { schemaVersion: 1, conversationId: id, paper: paperA, updatedAt: '2026-09-12T00:00:00Z', scrollTop: 40, pageRange: [2, 2], draft: { paper: paperA, settings, question: 'Summarize the whole paper', citations: [], images: [], references: [], skillId: null, profileId: null, overrides: {} } });
  // A real reader honours the range it is handed, which is how a restored range would narrow the send.
  f.services.document!.prepare = (_signal, _progress, range) => Promise.resolve(range
    ? { ...copy(documentA), pages: documentA.pages.filter(page => page.pageIndex + 1 >= range[0] && page.pageIndex + 1 <= range[1]) }
    : copy(documentA));
  await f.presenter.activate();
  expect(f.presenter.snapshot().document.range).toBeNull();
  f.presenter.setQuestion('Summarize the whole paper'); await f.presenter.send();
  expect(f.sent).toHaveLength(1);
  // The whole PDF, not the single page a dead UI once narrowed to.
  expect(f.sent[0]!.document?.pages.map(page => page.pageIndex)).toEqual([0, 1]);
  await f.presenter.flushDraft();
  for (const record of f.saved.values()) expect(record.pageRange).toBeNull();
  f.presenter.dispose();
});

it('still honours an explicit programmatic page range, even though no UI persists one', async () => {
  const f = fixture({ document: true });
  // The range capability stayed functional: only the automatic round-trip through storage is gone.
  f.services.document!.prepare = (_signal, _progress, range) => Promise.resolve(range
    ? { ...copy(documentA), pages: documentA.pages.filter(page => page.pageIndex + 1 >= range[0] && page.pageIndex + 1 <= range[1]) }
    : copy(documentA));
  await f.presenter.activate();
  f.presenter.setDocumentRange(2, 2); await f.presenter.prepareContext();
  expect(f.presenter.snapshot().document.range).toEqual([2, 2]);
  expect(f.presenter.snapshot().document.prepared?.pages.map(page => page.pageIndex)).toEqual([1]);
  f.presenter.setQuestion('Explain the theorem'); await f.presenter.send();
  expect(f.sent[0]!.document?.pages.map(page => page.pageIndex)).toEqual([1]);
  // ...but the explicit scope is never written to storage, so it cannot outlive this session.
  await f.presenter.flushDraft();
  for (const record of f.saved.values()) expect(record.pageRange).toBeNull();
  f.presenter.dispose();
});

it('adds metadata references without reading PDF bodies, freezes workflow and references on send, and retains newer input', async () => {
  const f = fixture(); await f.presenter.activate();
  await f.presenter.addReference(reference); await f.presenter.selectSkill('user-study'); await f.presenter.selectProfile('formal');
  expect(f.library.read).not.toHaveBeenCalled();
  let release!: (value: Awaited<ReturnType<typeof f.library.read>>) => void;
  f.library.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  f.presenter.setQuestion('Compare both articles'); const sending = f.presenter.send();
  await vi.waitFor(() => expect(f.library.read).toHaveBeenCalled());
  f.presenter.setQuestion('Next question'); await f.presenter.selectSkill(null); await f.presenter.selectProfile(null);
  release({ ...reference, document: { ...copy(documentA), paper: paperB } }); await sending;
  expect(f.sent[0]).toMatchObject({ question: 'Compare both articles', workflow: { skill: { id: 'user-study', revision: 'revision-one' }, profileId: 'formal', preferences: { mathematics: 'formal' } }, references: [{ id: 'other-paper', document: { paper: paperB } }] });
  expect(f.presenter.snapshot().draft.question).toBe('Next question'); f.presenter.dispose();
});

it('captures @chat through bounded workspace snapshots and persists appearance independently', async () => {
  const f = fixture(); await f.presenter.activate();
  await f.presenter.addReference({ id: 'chat-candidate', kind: 'chat', label: 'Chat', conversationId: f.conversation().id, capturedAt: '2026-09-12T00:00:00Z' });
  expect(f.presenter.snapshot().draft.references[0]?.text).toBe('Bounded chat snapshot');
  const generation = copy(f.presenter.snapshot().draft.settings);
  await f.presenter.saveAppearance({ uiLanguage: 'zh', textScale: 1.5 });
  expect(f.workspaceSettings()).toMatchObject({ uiLanguage: 'zh', textScale: 1.5 });
  expect(f.presenter.snapshot().draft.settings).toEqual(generation); f.presenter.dispose();
});

it('attaches one chosen file as text context, dedupes it, and previews the frozen body without re-reading the path', async () => {
  const f = fixture(); await f.presenter.activate();
  const attached: ReaderReference = { id: 'file-9a1c3e5f-1', kind: 'file', label: 'Weekly.Analysis.md', text: '# Weekly\nEvidence on p. 3.', capturedAt: '2026-09-12T00:00:00Z' };
  f.library.pickFile.mockResolvedValueOnce({ references: [copy(attached)], images: [copy(imageA)] });
  await f.presenter.pickFile();
  expect(f.presenter.snapshot().draft.references).toEqual([copy(attached)]);
  expect(f.presenter.snapshot().draft.images.map(image => image.id)).toEqual([imageA.id]);
  // The host is never asked to open the chosen file again: the body travels inside the reference.
  expect(f.library.read).not.toHaveBeenCalled();
  // A second identical pick is a no-op rather than a duplicate attachment.
  f.library.pickFile.mockResolvedValueOnce({ references: [copy(attached)], images: [] });
  await f.presenter.pickFile();
  expect(f.presenter.snapshot().draft.references).toHaveLength(1);
  await expect(f.presenter.previewReference(copy(attached))).resolves.toEqual(copy(attached));
  expect(f.library.read).not.toHaveBeenCalled();
  // A file reference without a body is refused instead of being sent as an empty snapshot.
  const bare: ReaderReference = { id: 'file-9a1c3e5f-2', kind: 'file', label: 'empty.txt', capturedAt: '2026-09-12T00:00:00Z' };
  await expect(f.presenter.previewReference(bare)).rejects.toThrow(/text/iu);
  // Image caps still apply to a picked file that arrives as an image.
  const full = fixture(); await full.presenter.activate();
  for (let index = 0; index < 4; index += 1) full.presenter.addImage({ ...copy(imageA), id: `6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b2${index}` });
  full.library.pickFile.mockResolvedValueOnce({ references: [], images: [copy(imageA)] });
  await expect(full.presenter.pickFile()).rejects.toThrow(/at most 4 images/iu);
  expect(full.library.pickFile).toHaveBeenCalled();
  f.presenter.dispose(); full.presenter.dispose();
});

it('lists a record carrying archivedAt as an ordinary chat in the one listing and never rewrites it', async () => {
  const f = fixture(); await f.presenter.activate();
  const open = f.conversation().id;
  const archivedId = 'dddddddd-0000-4000-8000-000000000005';
  f.conversations.set(archivedId, { ...f.conversation(), id: archivedId, title: 'Old discussion', archivedAt: '2026-09-12T00:00:00Z' });
  // There is one listing: the legacy record sits beside the active chat as a plain history entry.
  const history = await f.presenter.searchHistory('');
  expect(history.map(entry => entry.id).sort()).toEqual([open, archivedId].sort());
  expect(history.find(entry => entry.id === archivedId)?.archivedAt).toBe('2026-09-12T00:00:00Z');
  expect(f.presenter.snapshot().history.map(entry => entry.id).sort()).toEqual([open, archivedId].sort());
  expect(f.presenter.snapshot().historyQuery).toBe('');
  // The query still reaches both store scopes, so a chat only the archived scope holds is not lost.
  expect((await f.presenter.searchHistory('Old discussion')).map(entry => entry.id)).toEqual([archivedId]);
  expect(f.presenter.snapshot().history.map(entry => entry.id)).toEqual([archivedId]);
  // Opening it reads the stored record unchanged; nothing rewrites or drops the field.
  await f.presenter.openHistoryEntry(archivedId);
  expect(f.presenter.snapshot().conversation?.id).toBe(archivedId);
  expect(f.presenter.snapshot().conversation?.archivedAt).toBe('2026-09-12T00:00:00Z');
  expect(f.conversations.get(archivedId)?.archivedAt).toBe('2026-09-12T00:00:00Z');
  // The other chat-search surface agrees with the one listing: '@' reaches the legacy record too, so
  // it is not hidden from mentions while the sidebar shows it as an ordinary chat.
  const mentioned = await f.presenter.searchReferences('Old discussion', 'chat');
  expect(mentioned.map(reference => reference.conversationId)).toEqual([archivedId]);
  f.presenter.dispose();
});

it('closes the active workspace chat without deleting it and restores it from history with its draft', async () => {
  const f = fixture(); await f.presenter.activate();
  const id = f.conversation().id;
  f.presenter.setQuestion('Unsaved thought');
  f.presenter.closeConversation();
  expect(f.presenter.snapshot().conversation).toBeNull();
  expect(f.workspace.deleteDraft).not.toHaveBeenCalled();
  // The workspace listing still holds the closed chat; the next request starts a new one.
  expect(f.presenter.snapshot().history.map(entry => entry.id)).toContain(id);
  expect(f.conversations.has(id)).toBe(true);
  f.presenter.setQuestion('Fresh question'); await f.presenter.send();
  expect(f.client.newConversation).toHaveBeenCalledTimes(1);
  expect(f.presenter.snapshot().conversation?.id).not.toBe(id);
  // Re-opening the closed chat from history restores it together with its draft.
  await f.presenter.openHistoryEntry(id);
  expect(f.presenter.snapshot().conversation?.id).toBe(id);
  expect(f.presenter.snapshot().draft.question).toBe('Unsaved thought');
  expect(f.workspace.deleteDraft).not.toHaveBeenCalled();
  f.presenter.dispose();
});

it('renames via the core, branches an old question without sending, and routes cross-paper history externally', async () => {
  const f = fixture(); f.saveConversation({ ...f.conversation(), messages: [{ id: 'old-question', requestId: 'old-request', role: 'user', phase: null, text: 'Original question', settings, citations: [citationA], status: 'completed' }] });
  await f.presenter.activate(); const original = f.conversation().id;
  await f.presenter.renameConversation(original, 'Custom discussion'); expect(f.presenter.snapshot().conversation?.title).toBe('Custom discussion');
  await f.presenter.branchConversation('old-question', 'Revised question');
  expect(f.presenter.snapshot().draft.question).toBe('Revised question'); expect(f.sent).toHaveLength(0);
  const other = { ...f.conversation(), id: 'cccccccc-0000-4000-8000-000000000004', paper: paperB }; f.conversations.set(other.id, other);
  await f.presenter.openHistoryEntry(other.id); expect(f.services.openHistory).toHaveBeenCalledWith(paperB, other.id);
  f.presenter.dispose();
});

it('uses durable core admission for queued drafts and can cancel an individual queued request', async () => {
  const f = fixture(); f.saveConversation({ ...f.conversation(), activeRequestId: 'active-request' }); await f.presenter.activate();
  f.presenter.setQuestion('Run this next'); await f.presenter.queueDraft();
  expect(f.sent).toHaveLength(0); expect(f.queued).toHaveLength(1);
  expect(f.presenter.snapshot().conversation?.queuedRequestIds).toContain(f.queued[0]!.requestId);
  await f.presenter.cancelQueuedRequest(f.queued[0]!.requestId);
  expect(f.presenter.snapshot().conversation?.activeRequestId).toBe('active-request'); f.presenter.dispose();
});

it('reorders images without mutating the previously captured draft', async () => {
  const f = fixture(); await f.presenter.activate(); const second = { ...imageA, id: 'aaaaaaaa-0000-4000-8000-000000000002' };
  f.presenter.addImage(imageA); f.presenter.addImage(second); const before = f.presenter.snapshot().draft;
  f.presenter.moveImage(second.id, -1);
  expect(f.presenter.snapshot().draft.images.map(image => image.id)).toEqual([second.id, imageA.id]);
  expect(before.images.map(image => image.id)).toEqual([imageA.id, second.id]);   f.presenter.dispose();
});

function readingPort(conversationId: string) {
  const jobs: ReadingJob[] = [];
  const create = (input: SendInput, status: ReadingJob['status']) => { const job: ReadingJob = { schemaVersion: 1, id: input.requestId, conversationId, inputHash: 'hash', revision: 1, status, steps: [{ index: 0, requestId: input.requestId, phase: 'map', status: 'reserved' }], createdAt: 'now', updatedAt: 'now', cancelRequested: false }; jobs.push(job); return Promise.resolve(copy(job)); };
  const reading: PresenterReading = { list: () => Promise.resolve(copy(jobs)), get: id => Promise.resolve(copy(jobs.find(job => job.id === id)!)), subscribe: () => () => {}, start: vi.fn<PresenterReading['start']>(input => create(input, 'reserved')), enqueue: vi.fn<PresenterReading['enqueue']>(input => create(input, 'queued')), cancel: vi.fn<PresenterReading['cancel']>(id => { const job = jobs.find(job => job.id === id)!; job.status = 'cancelled'; return Promise.resolve(copy(job)); }), reconcile: vi.fn<PresenterReading['reconcile']>(id => Promise.resolve(copy(jobs.find(job => job.id === id)!))) };
  return { reading, jobs };
}
function taskPort(conversationId: string) {
  const tasks: ActionTaskRecord[] = [];
  const base = () => ({ schemaVersion: 1 as const, id: 'aaaaaaaa-1111-4000-8000-000000000001', conversationId, question: '', state: 'review' as const, createdAt: 'now', updatedAt: 'now', revision: 1 });
  const port: ActionTasks = { list: () => Promise.resolve(copy(tasks)), get: id => Promise.resolve(copy(tasks.find(task => task.id === id)!)), subscribe: () => () => {}, planAnnotations: vi.fn<ActionTasks['planAnnotations']>(input => { const task: ActionTaskRecord = { ...base(), question: input.question, kind: 'annotations', paper: input.paper, documentRevision: input.revision, ...(input.modelRequestId ? { modelRequestId: input.modelRequestId } : {}), items: [] }; tasks.push(task); return Promise.resolve(copy(task)); }), planAcquisition: vi.fn<ActionTasks['planAcquisition']>(input => { const task: ActionTaskRecord = { ...base(), question: input.question, kind: 'acquisition', target: input.target, items: [] }; tasks.push(task); return Promise.resolve(copy(task)); }), approve: vi.fn<ActionTasks['approve']>(id => Promise.resolve(copy(tasks.find(task => task.id === id)!))), cancel: vi.fn<ActionTasks['cancel']>(id => Promise.resolve(copy(tasks.find(task => task.id === id)!))), reconcile: vi.fn<ActionTasks['reconcile']>(id => Promise.resolve(copy(tasks.find(task => task.id === id)!))), undo: vi.fn<ActionTasks['undo']>(id => Promise.resolve(copy(tasks.find(task => task.id === id)!))) };
  return { port, tasks };
}
function smallBudget(): ReturnType<NonNullable<PresenterServices['contextBudget']>> {
  return { capacity: 100000, provenance: 'runtime-reported', accuracy: 'estimate', textBudgetTokens: 1500, reservations: { history: 0, instructions: 1000, workflow: 1000, images: 0, question: 100, output: 1000, safety: 1000, total: 4100 }, overBudget: false, assumptions: ['synthetic test budget'] };
}
function unknownBudget(): ReturnType<NonNullable<PresenterServices['contextBudget']>> {
  return { capacity: null, provenance: 'unknown', accuracy: 'unknown', textBudgetTokens: null, reservations: { history: null, instructions: 1000, workflow: 1000, images: 0, question: 100, output: 1000, safety: null, total: null }, overBudget: null, assumptions: ['no reported window and no pinned catalog entry'] };
}

it('routes long-source sends and explicit queues through the shared reading coordinator', async () => {
  const f = fixture({ document: true }); const r = readingPort(f.conversation().id);
  const long = { ...copy(documentA), pages: documentA.pages.map(page => ({ ...page, text: 'A source paragraph.\n\n'.repeat(200) })) };
  f.services.document!.prepare = () => Promise.resolve(long); f.services.contextBudget = smallBudget; f.services.getReading = () => Promise.resolve(r.reading);
  await f.presenter.activate(); f.presenter.setQuestion('Summarize all pages'); await f.presenter.send();
  expect(r.reading.start).toHaveBeenCalledWith(expect.objectContaining({ document: long }), expect.objectContaining({ mode: 'multi-pass' })); expect(f.sent).toHaveLength(0);
  expect(f.presenter.snapshot().contextReport?.mode).toBe('multi-pass');
  // The planner's own per-source explanation reaches the report instead of a generic sentence.
  expect(f.presenter.snapshot().contextReport?.reason).toContain('All authorized pages are partitioned into reading passes');
  expect(f.presenter.snapshot().contextReport?.reason).toContain('marked partial');
  await f.presenter.cancelReading(r.jobs[0]!.id);
  expect(f.presenter.snapshot().readingJobs[0]?.status).toBe('cancelled');
  f.saveConversation({ ...f.conversation(), activeRequestId: 'active-request' });
  f.presenter.setQuestion('Read all pages next'); await f.presenter.queueDraft();
  expect(r.reading.enqueue).toHaveBeenCalled(); expect(f.queued).toHaveLength(0); f.presenter.dispose();
});

it('reports the planner\'s real gap disclosure when the model window is unknown', async () => {
  const f = fixture({ document: true });
  // A recorded gap: the second authorized page exists but the extractor returned no text for it.
  const gapped = { ...copy(documentA), pages: [{ ...documentA.pages[0]! }, { ...documentA.pages[1]!, text: '', status: 'empty' as const }] };
  f.services.document!.prepare = () => Promise.resolve(gapped); f.services.contextBudget = unknownBudget;
  await f.presenter.activate(); f.presenter.setQuestion('What does this paper claim?'); await f.presenter.send();
  const report = f.presenter.snapshot().contextReport;
  expect(report?.mode).toBe('full');
  expect(report?.textBudgetTokens).toBeNull();
  // The unknown branch must not claim fit, and must not hide that a page had no extractable text.
  expect(report?.reason).toContain('All locally extracted authorized text is supplied');
  expect(report?.reason).toContain('fit was not asserted');
  expect(report?.reason).toContain('Recorded source gaps: ii (no text: empty)');
  expect(f.sent).toHaveLength(1); f.presenter.dispose();
});

it('reports the planner\'s excluded-page explanation, not a generic sentence, for a focused send', async () => {
  const f = fixture({ document: true });
  const long = { ...copy(documentA), pages: [
    { ...documentA.pages[0]!, text: 'Definition: x denotes the hidden state.\n\n'.repeat(80) },
    { ...documentA.pages[1]!, text: 'A source paragraph about many other things.\n\n'.repeat(80) },
  ] };
  f.services.document!.prepare = () => Promise.resolve(long); f.services.contextBudget = smallBudget;
  await f.presenter.activate(); f.presenter.setQuestion('What is the definition of x?'); await f.presenter.send();
  const report = f.presenter.snapshot().contextReport;
  expect(report?.mode).toBe('focused');
  expect(report?.reason).toContain('Partial, question-focused coverage selected by local term matching');
  expect(report?.reason).toContain('Excluded pages: ii');
  expect(f.sent).toHaveLength(1); f.presenter.dispose();
});

it('loads persisted reading jobs without a runtime connection', async () => {
  const f = fixture({ offline: true }); const r = readingPort(f.conversation().id);
  r.jobs.push({ schemaVersion: 1, id: 'saved-job', conversationId: f.conversation().id, inputHash: 'hash', revision: 1, status: 'uncertain', steps: [], createdAt: 'now', updatedAt: 'now', cancelRequested: false });
  f.services.getReading = vi.fn(() => Promise.resolve(r.reading)); await f.presenter.activate();
  expect(f.services.getReading).toHaveBeenCalledWith(undefined); expect(f.presenter.snapshot().readingJobs).toEqual(r.jobs); f.presenter.dispose();
});

it('turns an acquire workflow into a scoped native preview without sending a model request', async () => {
  const f = fixture(); const t = taskPort(f.conversation().id); f.services.getTasks = () => Promise.resolve(t.port);
  f.workspaceSettings().skills.push({ ...userSkill, id: 'acquire', name: 'Acquire', workflow: 'acquire' });
  const target = { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' };
  f.services.library!.collections = () => Promise.resolve([{ ...target, name: 'Research' }]);
  await f.presenter.activate(); await f.presenter.collections(); f.presenter.setAcquisitionTarget(target); await f.presenter.selectSkill('acquire');
  f.presenter.setQuestion('Get 10.1234/example'); await f.presenter.send();
  expect(t.port.planAcquisition).toHaveBeenCalledWith({ conversationId: f.conversation().id, target, question: 'Get 10.1234/example', identifiers: ['10.1234/example'] });
  expect(f.sent).toHaveLength(0); expect(t.port.approve).not.toHaveBeenCalled(); f.presenter.dispose();
});

it('plans completed annotation JSON once against the frozen PDF version without approving writes', async () => {
  const f = fixture({ document: true }); const t = taskPort(f.conversation().id); f.services.getTasks = () => Promise.resolve(t.port);
  f.workspaceSettings().skills.push({ ...userSkill, id: 'annotate', name: 'Annotate', workflow: 'annotate' });
  await f.presenter.activate(); await f.presenter.selectSkill('annotate'); f.presenter.setQuestion('Mark the definition'); await f.presenter.send();
  const requestId = f.sent[0]!.requestId; const text = JSON.stringify({ candidates: [{ quote: 'Definition', pageIndex: 0, reason: 'Central definition' }] });
  f.emit({ type: 'messageCompleted', requestId, messageId: 'answer', finalText: text, phase: 'final' }); f.emit({ type: 'completed', requestId, messageId: 'answer', finalText: text });
  await vi.waitFor(() => expect(t.port.planAnnotations).toHaveBeenCalledTimes(1));
  expect(t.port.planAnnotations).toHaveBeenCalledWith(expect.objectContaining({ revision: documentA.revision, modelRequestId: requestId }));
  f.emit({ type: 'completed', requestId, messageId: 'answer', finalText: text }); await Promise.resolve(); await Promise.resolve();
  expect(t.port.planAnnotations).toHaveBeenCalledTimes(1); expect(t.port.approve).not.toHaveBeenCalled(); f.presenter.dispose();
});

it('refuses chat deletion while native work remains without cancelling or undoing it', async () => {
  const f = fixture(); const t = taskPort(f.conversation().id); f.services.getTasks = () => Promise.resolve(t.port);
  await t.port.planAcquisition({ conversationId: f.conversation().id, target: { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' }, question: 'Get paper', identifiers: ['10.1234/example'] });
  f.client.deleteConversation = vi.fn(f.client.deleteConversation); await f.presenter.activate(); await f.presenter.deleteConversation(f.conversation().id);
  expect(f.client.deleteConversation).not.toHaveBeenCalled(); expect(f.presenter.snapshot().message).toMatch(/unfinished native tasks/iu);
  expect(t.port.cancel).not.toHaveBeenCalled(); expect(t.port.undo).not.toHaveBeenCalled(); f.presenter.dispose();
});

it('carries the stored Codex instructions into the outgoing request for an ordinary question', async () => {
  const f = fixture(); await f.presenter.activate();
  const stored = f.workspaceSettings();
  await f.presenter.savePreferences({ ...stored.preferences, background: 'I know linear algebra; prefer SI units.' });
  f.presenter.setQuestion('Explain the main claim');
  await f.presenter.send();
  // An ordinary question carries no skill — that is why withdrawing builtin `read` from the pane's
  // list cannot affect it — but it still carries the global preferences, instructions included.
  expect(f.sent[0]?.workflow).toMatchObject({ skill: null, preferences: { background: 'I know linear algebra; prefer SI units.' } });
  expect(f.sent).toHaveLength(1);

  // Changing the box changes the next payload: the instructions are read per request, not cached.
  f.emit({ type: 'completed', requestId: f.sent[0]!.requestId, messageId: 'answer', finalText: 'Done' });
  const next = f.workspaceSettings();
  await f.presenter.savePreferences({ ...next.preferences, background: 'Answer in Chinese.' });
  f.presenter.setQuestion('And the second claim?');
  await f.presenter.send();
  expect(f.sent[1]?.workflow?.preferences.background).toBe('Answer in Chinese.');
  f.presenter.dispose();
});

it('persists editable research profiles but refuses a stale workflow editor', async () => {
  const f = fixture(); await f.presenter.activate();
  const profile = await f.presenter.saveProfile({ id: null, name: 'My project', preferences: { detail: 'detailed' } }); await f.presenter.selectProfile(profile.id);
  f.presenter.setQuestion('Explain'); await f.presenter.send();
  // Per-chat overrides were removed from the sidebar; only the selected profile's preferences apply.
  expect(f.sent[0]?.workflow?.preferences).toMatchObject({ detail: 'detailed' });
  expect(f.presenter.snapshot().draft.overrides).toEqual({});
  f.workspaceSettings().skills[0]!.revision = 'newer-file-revision';
  await expect(f.presenter.saveSkill({ ...userSkill, id: userSkill.id, revision: 'revision-one' })).rejects.toThrow(/changed/iu);
  expect(f.workspace.saveSkill).not.toHaveBeenCalled(); await f.presenter.deleteProfile(profile.id); expect(f.presenter.snapshot().draft.profileId).toBeNull(); f.presenter.dispose();
});

it('projects runtime usage and generated images without treating cumulative usage as occupancy', async () => {
  const f = fixture(); await f.presenter.activate(); f.presenter.setQuestion('Explain'); await f.presenter.send(); const requestId = f.sent[0]!.requestId;
  const usage = { model: settings.model, contextWindow: 100000, last: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 12 }, total: { inputTokens: 100, cachedInputTokens: 20, outputTokens: 20, reasoningOutputTokens: 10, totalTokens: 120 } };
  f.emit({ type: 'usage', requestId, usage }); f.emit({ type: 'image', requestId, messageId: 'answer', image: { ...imageA, origin: { kind: 'generated' } } });
  expect(f.presenter.snapshot().conversation?.usage).toEqual(usage); expect(f.presenter.snapshot().conversation?.messages.at(-1)?.generatedImages).toHaveLength(1); f.presenter.dispose();
});

it('keeps a background annotation completion owned by its original chat after New chat', async () => {
  const f = fixture({ document: true }); const original = f.conversation().id; const t = taskPort(original); f.services.getTasks = () => Promise.resolve(t.port);
  f.workspaceSettings().skills.push({ ...userSkill, id: 'annotate', workflow: 'annotate' });
  await f.presenter.activate(); await f.presenter.selectSkill('annotate'); f.presenter.setQuestion('Mark definitions'); await f.presenter.send();
  const requestId = f.sent[0]!.requestId;   await f.presenter.newConversation();
  expect(f.presenter.snapshot().conversation).toBeNull(); expect(f.presenter.snapshot().generating).toBe(false);
  const text = JSON.stringify({ candidates: [{ quote: 'Definition', pageIndex: 0, reason: 'Useful' }] });
  const old = f.conversations.get(original)!;
  f.conversations.set(original, { ...old, activeRequestId: null, messages: [...old.messages, { id: 'answer-a', requestId, role: 'assistant', phase: 'final', settings, citations: [], status: 'completed', text }] });
  f.emitFor(original, { type: 'completed', requestId, messageId: 'answer-a', finalText: text });
  await vi.waitFor(() => expect(t.port.planAnnotations).toHaveBeenCalledWith(expect.objectContaining({ conversationId: original, modelRequestId: requestId })));
  expect(f.presenter.snapshot().conversation).toBeNull(); expect(f.presenter.snapshot().tasks).toEqual([]); f.presenter.dispose();
});

it('recovers completed annotation output after a restart gap without re-planning an existing task', async () => {
  const f = fixture({ document: true }); const original = f.conversation().id; const t = taskPort(original); f.services.getTasks = () => Promise.resolve(t.port);
  f.workspaceSettings().skills.push({ ...userSkill, id: 'annotate', workflow: 'annotate' });
  await f.presenter.activate(); await f.presenter.selectSkill('annotate'); f.presenter.setQuestion('Mark definitions'); await f.presenter.send();
  const requestId = f.sent[0]!.requestId; const text = JSON.stringify({ candidates: [{ quote: 'Definition', pageIndex: 0, reason: 'Useful' }] });
  f.saveConversation({ ...f.conversation(), activeRequestId: null, messages: [...f.conversation().messages, { id: 'saved-answer', requestId, role: 'assistant', phase: 'final', settings, citations: [], status: 'completed', text }] });
  f.presenter.dispose();
  const restored = new ConversationPresenter(presenterContext(paperA, 'Paper A'), f.services); await restored.activate();
  await vi.waitFor(() => expect(t.port.planAnnotations).toHaveBeenCalledTimes(1));
  const unbind = restored.bind(() => {}); unbind(); await Promise.resolve(); await Promise.resolve();
  expect(t.port.planAnnotations).toHaveBeenCalledTimes(1); restored.dispose();
});

it('keeps a new chat usable during older preparation and clears only the accepted older draft', async () => {
  const f = fixture({ document: true }); let finish!: (document: typeof documentA) => void;
  f.services.document!.prepare = () => new Promise(resolve => { finish = resolve; });
  await f.presenter.activate(); const original = f.conversation().id; f.presenter.setQuestion('Question A'); const pending = f.presenter.send();
  await vi.waitFor(() => expect(f.presenter.snapshot().generating).toBe(true));
  await f.presenter.newConversation();
  expect(f.presenter.snapshot().conversation).toBeNull();
  expect(f.presenter.snapshot().generating).toBe(false); f.presenter.setQuestion('Question B'); finish(documentA); await pending;
  expect(f.sent[0]?.conversationId).toBe(original); expect(f.presenter.snapshot().draft.question).toBe('Question B');
  await f.presenter.openConversation(original); expect(f.presenter.snapshot().draft.question).toBe('');
  await f.presenter.newConversation(); expect(f.presenter.snapshot().draft.question).toBe('Question B'); f.presenter.dispose();
});

it('settles an unanswered @ search with an honest failure instead of waiting forever', async () => {
  const f = fixture({ searchTimeoutMs: 20 });
  // A host bridge that never answers must not leave the composer on 'Searching…' indefinitely.
  f.library.search.mockImplementationOnce(() => new Promise(() => undefined));
  await expect(f.presenter.searchReferences('never answers', 'article')).rejects.toThrow('The article search did not answer. Try again.');
  // The same bound covers the saved-chat source searched by the workspace store.
  vi.mocked(f.workspace.history).mockImplementationOnce(() => new Promise(() => undefined));
  await expect(f.presenter.searchReferences('never answers', 'chat')).rejects.toThrow('Saved chats could not be searched. Try again.');
  f.presenter.dispose();
});

it('settles an in-flight @ search as soon as the caller aborts it', async () => {
  const f = fixture({ searchTimeoutMs: 60_000 });
  f.library.search.mockImplementationOnce(() => new Promise(() => undefined));
  const controller = new AbortController();
  const pending = f.presenter.searchReferences('abandoned', 'article', controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow(/cancelled/u);
  f.presenter.dispose();
});

it('lists matching articles and saved chats from both @ sources for an unfiltered query', async () => {
  const f = fixture(); await f.presenter.activate();
  const results = await f.presenter.searchReferences('paper');
  expect(f.library.search).toHaveBeenCalledWith('paper');
  expect(f.workspace.history).toHaveBeenCalledWith('paper');
  expect(results.map(item => item.kind)).toEqual(['article', 'chat']);
  f.presenter.dispose();
});
