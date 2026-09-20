import { expect, it } from 'vitest';
import type { HistoryChange } from '../../packages/contracts/src/workspace.ts';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import { HistoryManager } from '../../packages/core/src/workspace/history.ts';
import { WorkspaceStore } from '../../packages/core/src/workspace/store.ts';
import { paperA, paperB, settings } from '../contracts/factories.ts';
import { MemoryStorage } from './doubles.ts';

const NOW = '2026-09-13T10:00:00.000Z';
function uniqueClock() {
  let id = 0;
  return { now: () => NOW, uuid: () => `12345678-0000-4000-8000-${(++id).toString(16).padStart(12, '0')}` };
}
function storePath(id: string): string { return `conversations/${id}.json`; }

/** Seeded chats share one storage: a real ConversationStore writes them, a real WorkspaceStore reads. */
function seed() {
  const storage = new MemoryStorage();
  const clock = uniqueClock();
  const conversations = new ConversationStore(storage, clock);
  const workspace = new WorkspaceStore(storage, clock, { clientId: paperA.clientId });
  const make = async (paper: typeof paperA, title: string, text: string) => {
    const created = await conversations.create(paper, title, settings);
    created.messages.push({ id: `${created.id}-m1`, requestId: `${created.id}-r1`, role: 'user', phase: null, settings, text, citations: [], status: 'completed' });
    await conversations.save(created);
    return created;
  };
  return { storage, conversations, workspace, make };
}

it('publishes one committed removal to every subscriber and stops after unsubscribe', async () => {
  const { storage, workspace, make } = seed();
  const target = await make(paperA, 'Target', 'target question');
  const other = await make(paperA, 'Other', 'other question');
  const changes: HistoryChange[] = [];
  const stop = workspace.subscribeHistory(change => changes.push(change));
  await new HistoryManager(workspace).removeByIds([target.id]);
  expect(changes).toEqual([{ paper: paperA, removed: [target.id] }]);
  // The notification is published after the files are gone, so a listener can never drop a live row.
  expect(storage.files.has(storePath(target.id))).toBe(false);
  expect((await workspace.history()).map(entry => entry.id)).toEqual([other.id]);
  // A second, identical removal is reported as failed and must not publish a second change.
  await new HistoryManager(workspace).removeByIds([target.id]);
  expect(changes).toHaveLength(1);
  stop();
  await new HistoryManager(workspace).removeByIds([other.id]);
  expect(changes).toHaveLength(1);
});

it('does not publish a removal that did not commit', async () => {
  const { storage, workspace, make } = seed();
  const chat = await make(paperA, 'Kept', 'question');
  const changes: HistoryChange[] = [];
  workspace.subscribeHistory(change => changes.push(change));
  storage.fail = true;
  const report = await new HistoryManager(workspace).removeByIds([chat.id]);
  expect(report.changed).toEqual([]);
  expect(changes).toEqual([]);
  storage.fail = false;
  expect(storage.files.has(storePath(chat.id))).toBe(true);
});

it('scopes the published change to the paper that owned the chat', async () => {
  const { workspace, make } = seed();
  const a = await make(paperA, 'A chat', 'a question');
  const b = await make(paperB, 'B chat', 'b question');
  const changes: HistoryChange[] = [];
  workspace.subscribeHistory(change => changes.push(change));
  await new HistoryManager(workspace).removeByIds([b.id]);
  expect(changes).toEqual([{ paper: paperB, removed: [b.id] }]);
  await new HistoryManager(workspace).removeByIds([a.id]);
  expect(changes.map(change => change.removed)).toEqual([[b.id], [a.id]]);
});

it('refuses to write a removed chat back from a stale in-memory copy', async () => {
  const { storage, conversations, workspace, make } = seed();
  const chat = await make(paperA, 'Removed', 'question');
  // A second owner (the core session store) still holds this chat, exactly like the running service.
  const stale = await conversations.get(chat.id);
  await workspace.removeConversation(paperA, chat.id);
  expect(storage.files.has(storePath(chat.id))).toBe(false);
  stale.messages.push({ id: 'late', requestId: 'late-r', role: 'assistant', phase: 'final', settings, text: 'a late save', citations: [], status: 'completed' });
  await expect(conversations.save(stale)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  // The file is not recreated by the late save, and the chat stays out of history.
  expect(storage.files.has(storePath(chat.id))).toBe(false);
  expect((await workspace.history()).map(entry => entry.id)).not.toContain(chat.id);
});

it('keeps the paper index consistent so a removed chat is not read back as the current one', async () => {
  const { workspace, make } = seed();
  const first = await make(paperA, 'First', 'first question');
  const second = await make(paperA, 'Second', 'second question');
  // The store's index falls back to the remaining chat, not to the removed one.
  await workspace.removeConversation(paperA, second.id);
  expect((await workspace.currentConversation(paperA))?.id).toBe(first.id);
  const third = await make(paperA, 'Third', 'third question');
  await workspace.removeConversation(paperA, third.id);
  await workspace.removeConversation(paperA, first.id);
  expect(await workspace.currentConversation(paperA)).toBeNull();
});
