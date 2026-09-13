import { expect, it } from 'vitest';
import { paperId, type Conversation, type PaperScope } from '../../packages/contracts/src/index.ts';
import type { StoragePort } from '../../packages/contracts/src/runtime.ts';
import type { HistoryEntry, HistoryListing, HistoryMutationReport, HistorySource } from '../../packages/contracts/src/workspace.ts';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import { filterHistory, HistoryManager, historyCounts, historyPapers, isHistoryListing, isHistoryReport } from '../../packages/core/src/workspace/history.ts';
import { WorkspaceStore } from '../../packages/core/src/workspace/store.ts';
import { paperA, paperB, settings } from '../contracts/factories.ts';
import { MemoryStorage } from './doubles.ts';

const NOW = '2026-09-13T10:00:00.000Z';
function uniqueClock() {
  let id = 0;
  return { now: () => NOW, uuid: () => `12345678-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}` };
}
function ids(entries: readonly HistoryEntry[]): string[] { return entries.map(entry => entry.id); }
function storePath(id: string): string { return `conversations/${id}.json`; }

/** Seeded chats share one storage: a real ConversationStore writes them and a real WorkspaceStore reads them. */
function seed() {
  const storage = new MemoryStorage();
  const clock = uniqueClock();
  const conversations = new ConversationStore(storage, clock);
  const workspace = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  const make = async (paper: PaperScope, title: string, text: string): Promise<Conversation> => {
    const created = await conversations.create(paper, title, settings);
    created.messages.push({ id: `${created.id}-m1`, requestId: `${created.id}-r1`, role: 'user', phase: null, settings, text, citations: [], status: 'completed' });
    await conversations.save(created);
    return created;
  };
  return { storage, conversations, workspace, make };
}

it('archiving through the manager hides a chat from the default scope and restore brings it back', async () => {
  const { workspace, make } = seed();
  const chat = await make(paperA, 'Bayesian notes', 'posterior derivation');
  const manager = new HistoryManager(workspace);
  const before = await manager.listing();
  expect(before).toMatchObject({ activeCount: 1, archivedCount: 0 });
  expect(ids(before.entries)).toEqual([chat.id]);

  const archived = await manager.setArchived([before.entries[0]!], true);
  expect(archived).toMatchObject({ action: 'archive', requested: 1, changed: [chat.id], failed: [], partial: false });
  // The default store scope is unarchived: the chat leaves it and stays in the archived scope.
  expect(await workspace.history()).toEqual([]);
  expect(ids(await workspace.history('', { archived: true }))).toEqual([chat.id]);
  const afterArchive = await manager.listing();
  expect(afterArchive).toMatchObject({ activeCount: 0, archivedCount: 1 });
  expect(afterArchive.entries[0]?.archivedAt).toBe(NOW);

  const restored = await manager.setArchived([afterArchive.entries[0]!], false);
  expect(restored).toMatchObject({ action: 'restore', changed: [chat.id], failed: [], partial: false });
  expect(ids(await workspace.history())).toEqual([chat.id]);
  expect(await workspace.history('', { archived: true })).toEqual([]);
});

it('delete removes exactly the target chat and nothing else', async () => {
  const { storage, workspace, make } = seed();
  const first = await make(paperA, 'First', 'first question');
  const target = await make(paperA, 'Target', 'target question');
  const other = await make(paperB, 'Supplement', 'supplement question');
  const manager = new HistoryManager(workspace);
  const report = await manager.remove([(await manager.listing()).entries.find(entry => entry.id === target.id)!]);
  expect(report).toMatchObject({ action: 'delete', requested: 1, changed: [target.id], failed: [], partial: false });
  expect(storage.files.has(storePath(target.id))).toBe(false);
  expect(storage.files.has(storePath(first.id))).toBe(true);
  expect(storage.files.has(storePath(other.id))).toBe(true);
  expect(ids(await workspace.history())).toEqual([first.id, other.id]);
  expect(ids(await workspace.history('', { archived: true }))).toEqual([]);
});

it('counts a removal as done when the record is gone even if the call reported an error afterwards', async () => {
  const { storage, workspace, make } = seed();
  const chat = await make(paperA, 'Removed', 'question');
  const entry = (await new HistoryManager(workspace).listing()).entries[0]!;
  const source: HistorySource = {
    history: (query, scope) => workspace.history(query, scope),
    removeConversation: async (paper, id) => { await workspace.removeConversation(paper, id); throw new Error('the follow-up notification failed'); },
  };
  const report = await new HistoryManager(source).remove([entry]);
  // The record itself is gone, so the honest outcome is a confirmed delete plus a warning, not a failure.
  expect(report.changed).toEqual([chat.id]);
  expect(report.failed).toEqual([]);
  expect(report.partial).toBe(false);
  expect(report.warnings).toHaveLength(1);
  expect(storage.files.has(storePath(chat.id))).toBe(false);
});

it('reports an unconfirmed archive honestly instead of assuming the store changed', async () => {
  const { workspace, make } = seed();
  await make(paperA, 'No-op', 'question');
  const entry = (await new HistoryManager(workspace).listing()).entries[0]!;
  const source: HistorySource = { history: (query, scope) => workspace.history(query, scope), setConversationArchived: () => Promise.resolve() };
  const report = await new HistoryManager(source).setArchived([entry], true);
  expect(report.changed).toEqual([]);
  expect(report.failed).toEqual([{ id: entry.id, message: 'The change could not be confirmed.' }]);
  expect(report.partial).toBe(true);
  expect(await workspace.history()).toHaveLength(1);
});

it('reports a refused removal as failed and leaves the stored chat on disk', async () => {
  const { storage, workspace, make } = seed();
  const chat = await make(paperA, 'Kept', 'question');
  const entry = (await new HistoryManager(workspace).listing()).entries[0]!;
  storage.fail = true;
  const report = await new HistoryManager(workspace).remove([entry]);
  expect(report.changed).toEqual([]);
  expect(report.failed.map(item => item.id)).toEqual([chat.id]);
  expect(report.partial).toBe(true);
  storage.fail = false;
  expect(storage.files.has(storePath(chat.id))).toBe(true);
  expect(ids(await workspace.history())).toEqual([chat.id]);
});

it('refuses to delete a chat whose answer or native task is unfinished', async () => {
  const { storage, workspace, make } = seed();
  const chat = await make(paperA, 'Running', 'question');
  const entry: HistoryEntry = { ...(await new HistoryManager(workspace).listing()).entries[0]!, unfinishedWork: true };
  const report = await new HistoryManager(workspace).remove([entry]);
  expect(report.changed).toEqual([]);
  expect(report.failed.map(item => item.id)).toEqual([chat.id]);
  expect(report.partial).toBe(true);
  expect(storage.files.has(storePath(chat.id))).toBe(true);
});

it('filters by scope and paper, counts both scopes, and handles an empty result', async () => {
  const { workspace, make } = seed();
  const activeA = await make(paperA, 'Active A', 'alpha question');
  const activeB = await make(paperB, 'Active B', 'beta question');
  const archivedA = await make(paperA, 'Archived A', 'gamma question');
  const manager = new HistoryManager(workspace);
  await manager.setArchived([(await manager.listing()).entries.find(entry => entry.id === archivedA.id)!], true);
  const listing = await manager.listing();
  expect(ids(listing.entries).sort()).toEqual([activeA.id, activeB.id, archivedA.id].sort());
  expect(listing).toMatchObject({ activeCount: 2, archivedCount: 1 });

  expect(ids(filterHistory(listing.entries, { scope: 'active', paperId: null })).sort()).toEqual([activeA.id, activeB.id].sort());
  expect(ids(filterHistory(listing.entries, { scope: 'archived', paperId: null }))).toEqual([archivedA.id]);
  expect(ids(filterHistory(listing.entries, { scope: 'all', paperId: paperId(paperB) }))).toEqual([activeB.id]);
  expect(filterHistory(listing.entries, { scope: 'all', paperId: JSON.stringify(['other', 2, 'PDF']) })).toEqual([]);
  expect(historyCounts(listing.entries)).toEqual({ total: 3, active: 2, archived: 1 });
  // Selecting all from an empty subset must be an empty list, never every chat.
  expect(filterHistory([], { scope: 'all', paperId: null })).toEqual([]);
});

it('derives the paper filter from listed chats with a readable label and a stable order', async () => {
  const { workspace, make } = seed();
  await make(paperA, 'Zeta', 'question');
  await make(paperB, 'Alpha', 'question');
  const listing = await new HistoryManager(workspace).listing();
  const papers = historyPapers(listing.entries);
  expect(papers.map(entry => entry.label)).toEqual(['Alpha', 'Zeta']);
  expect(papers.map(entry => entry.id)).toEqual([paperId(paperB), paperId(paperA)]);
});

it('rejects malformed listing and report payloads instead of accepting or collapsing them', () => {
  const valid: HistoryListing = { entries: [], activeCount: 0, archivedCount: 0 };
  expect(isHistoryListing(valid)).toBe(true);
  expect(isHistoryListing(null)).toBe(false);
  expect(isHistoryListing([])).toBe(false);
  expect(isHistoryListing({ ...valid, activeCount: 1 })).toBe(false);
  expect(isHistoryListing({ ...valid, archivedCount: -1 })).toBe(false);
  expect(isHistoryListing({ ...valid, entries: 'nope' })).toBe(false);
  expect(isHistoryListing({ ...valid, extra: true })).toBe(false);
  expect(isHistoryListing({ ...valid, entries: [{ id: 1, paper: paperA, title: 'x' }] })).toBe(false);
  const entry: HistoryEntry = { id: '12345678-0000-4000-8000-000000000001', paper: paperA, title: 'Chat', identity: { title: 'Paper', authors: [] }, updatedAt: NOW, createdAt: NOW, messageCount: 0, preview: '', hasDraft: false, activeRequestId: null };
  expect(isHistoryListing({ entries: [entry], activeCount: 1, archivedCount: 0 })).toBe(true);
  expect(isHistoryListing({ entries: [{ ...entry, unfinishedWork: true }], activeCount: 1, archivedCount: 0 })).toBe(true);
  expect(isHistoryListing({ entries: [{ ...entry, unfinishedWork: false }], activeCount: 1, archivedCount: 0 })).toBe(false);
  // Two rows with the same id would double-count; one archived and one not is not a real listing.
  expect(isHistoryListing({ entries: [{ ...entry, archivedAt: NOW }, entry], activeCount: 1, archivedCount: 1 })).toBe(false);

  const report: HistoryMutationReport = { action: 'delete', requested: 1, changed: [entry.id], failed: [], warnings: [], partial: false };
  expect(isHistoryReport(report)).toBe(true);
  expect(isHistoryReport({ ...report, action: 'unknown' })).toBe(false);
  expect(isHistoryReport({ ...report, changed: 'nope' })).toBe(false);
  expect(isHistoryReport({ ...report, failed: [{ id: entry.id }] })).toBe(false);
  expect(isHistoryReport({ ...report, partial: true })).toBe(false);
  expect(isHistoryReport(null)).toBe(false);
});

it('lists chats without reading stored document bodies or image assets', async () => {
  const { storage, make } = seed();
  const chat = await make(paperA, 'Notes', 'question');
  await storage.writeAtomic(`conversations/${chat.id}.${'0'.repeat(64)}.source.json`, new TextEncoder().encode('{"body":"x"}'));
  await storage.writeAtomic(`workspace/assets/${'1'.repeat(64)}.json`, new TextEncoder().encode('{"dataUrl":"x"}'));
  const reads: string[] = [];
  const spy: StoragePort = {
    read: path => { reads.push(path); return storage.read(path); },
    list: directory => storage.list(directory),
    writeAtomic: (path, bytes) => storage.writeAtomic(path, bytes),
    append: (path, bytes) => storage.append(path, bytes),
    remove: path => storage.remove(path),
  };
  const listing = await new HistoryManager(new WorkspaceStore(spy, uniqueClock(), { clientId: paperA.clientId })).listing();
  expect(ids(listing.entries)).toEqual([chat.id]);
  // Only the record and its request ledger are read; the large per-source texts and chat images are not.
  expect(reads).toContain(storePath(chat.id));
  expect(reads.filter(path => path.endsWith('.source.json'))).toEqual([]);
  expect(reads.filter(path => path.startsWith('workspace/assets/'))).toEqual([]);
});

it('safe-rejects a malformed conversation record instead of returning an empty history', async () => {
  const storage = new MemoryStorage();
  const corruptPath = storePath('12345678-0000-4000-8000-000000000009');
  const corrupt = new TextEncoder().encode('{"schemaVersion":99}');
  storage.files.set(corruptPath, corrupt);
  const workspace = new WorkspaceStore(storage, uniqueClock(), { clientId: paperA.clientId });
  await expect(new HistoryManager(workspace).listing()).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  // The unreadable record itself is never rewritten or dropped.
  expect(storage.files.get(corruptPath)).toEqual(corrupt);
});
