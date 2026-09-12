import { describe, expect, it } from 'vitest';
import { ConversationStore } from '../../packages/core/src/sessions/store.ts';
import { ReaderError } from '../../packages/contracts/src/index.ts';
import { MemoryStorage } from './doubles.ts';
import { citationA, imageA, paperA, paperB, settings } from '../contracts/factories.ts';
import { documentA } from '../contracts/document-fixture.ts';
let counter = 0;
function store(storage = new MemoryStorage()) {
  counter = 0;
  return { storage, store: new ConversationStore(storage, { uuid: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`, now: () => '2026-09-09T08:00:00.000Z' }) };
}
describe('conversation store', () => {
  it('stores immutable PDF text once outside streaming snapshots and restores schema 2 sources', async () => {
    const { storage, store: s } = store(); const c = await s.create(paperA, 'A', settings);
    c.schemaVersion = 2; c.documents = { [documentA.id]: documentA };
    await s.save(c); c.lastSeq++; await s.save(c);
    expect(storage.writes.filter(text => text.includes('Definition: x denotes'))).toHaveLength(1);
    const snapshot = new TextDecoder().decode(storage.files.get(`conversations/${c.id}.json`));
    expect(snapshot).not.toContain('Definition: x denotes');
    const restored = new ConversationStore(storage, { uuid: () => 'unused', now: () => 'later' });
    expect((await restored.get(c.id)).documents?.[documentA.id]?.pages[1]?.text).toContain('y = x + 7');
  });
  it('creates the current conversation once per attachment and keeps sibling attachments apart', async () => {
    const { store: s } = store();
    expect(await s.current(paperA)).toBeNull();
    const [a1, a2] = await Promise.all([s.create(paperA, 'Paper A', settings), s.current(paperA)]);
    expect(a2?.id).toBe(a1.id);
    const b = await s.create(paperB, 'Supplement B', settings);
    expect(b.id).not.toBe(a1.id); expect((await s.current(paperB))?.id).toBe(b.id); expect((await s.current(paperA))?.id).toBe(a1.id);
    expect(await s.list(paperA)).toHaveLength(1);
  });
  it('persists messages, request records and the upstream thread atomically and restores them', async () => {
    const { storage, store: s } = store();
    const conversation = await s.create(paperA, 'Paper A', settings);
    conversation.messages.push({ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'q', citations: [citationA], status: 'completed', images: [imageA] });
    conversation.requests.push({ requestId: 'r1', hash: 'h', state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now' });
    conversation.upstream.threadId = 'thread-1'; conversation.lastSeq = 3; conversation.activeRequestId = 'r1';
    await s.save(conversation);
    const restored = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    const loaded = await restored.get(conversation.id);
    expect(loaded.messages[0]?.citations[0]?.text).toBe(citationA.text); expect(loaded.messages[0]?.images?.[0]?.name).toBe('figure.png');
    expect(loaded.requests[0]?.state).toBe('accepted');
    expect(loaded.upstream.threadId).toBe('thread-1'); expect(loaded.lastSeq).toBe(3); expect(loaded.activeRequestId).toBe('r1');
    expect(storage.writes.filter(w => w.includes('"requests"')).length).toBeGreaterThan(0);
    expect(loaded).not.toBe(conversation);
  });
  it('returns detached copies so callers cannot mutate the stored state', async () => {
    const { store: s } = store();
    const created = await s.create(paperA, 'Paper A', settings); created.title = 'mutated';
    expect((await s.get(created.id)).title).toBe('Paper A');
  });
  it('keeps corrupt files as evidence and reports history as unavailable without overwriting', async () => {
    const { storage, store: s } = store();
    const created = await s.create(paperA, 'Paper A', settings);
    const path = [...storage.files.keys()].find(k => k.endsWith(`${created.id}.json`))!;
    storage.files.set(path, new TextEncoder().encode('{"schemaVersion":1,"id":'));
    const fresh = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    await expect(fresh.get(created.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
    await expect(fresh.current(paperA)).rejects.toBeInstanceOf(ReaderError);
    expect(new TextDecoder().decode(storage.files.get(path))).toBe('{"schemaVersion":1,"id":');
    storage.files.set(path, new TextEncoder().encode(JSON.stringify({ schemaVersion: 2 })));
    await expect(fresh.get(created.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  });
  it('rejects unknown ids and unsafe paper components before touching storage', async () => {
    const { storage, store: s } = store();
    await expect(s.get('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(s.current({ ...paperA, attachmentKey: '../x' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(storage.writes).toHaveLength(0);
  });
  it('a failed write leaves the in-memory state unchanged and surfaces a storage error', async () => {
    const { storage, store: s } = store();
    const created = await s.create(paperA, 'Paper A', settings);
    storage.fail = true; created.title = 'changed';
    await expect(s.save(created)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    storage.fail = false; expect((await s.get(created.id)).title).toBe('Paper A');
  });
  it('newConversation switches the current pointer while keeping the previous conversation listed', async () => {
    const { store: s } = store();
    const first = await s.create(paperA, 'Paper A', settings); const second = await s.create(paperA, 'Paper A', settings);
    expect((await s.current(paperA))?.id).toBe(second.id); expect((await s.list(paperA)).map(c => c.id)).toEqual([first.id, second.id]);
  });
  it('selects a listed conversation as current without dropping the others', async () => {
    const { store: s } = store();
    const first = await s.create(paperA, 'Paper A', settings); const second = await s.create(paperA, 'Paper A', settings);
    const selected = await s.select(paperA, first.id);
    expect(selected.id).toBe(first.id);
    expect((await s.current(paperA))?.id).toBe(first.id);
    expect((await s.list(paperA)).map(c => c.id)).toEqual([first.id, second.id]);
  });
  it('rejects selecting a conversation that is not on this attachment', async () => {
    const { store: s } = store();
    const a = await s.create(paperA, 'Paper A', settings);
    await s.create(paperB, 'Supplement B', settings);
    await expect(s.select(paperB, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await s.current(paperA))?.id).toBe(a.id);
  });
  it('deletes a conversation and its log without touching a sibling attachment', async () => {
    const { storage, store: s } = store();
    const first = await s.create(paperA, 'Paper A', settings);
    const second = await s.create(paperA, 'Paper A', settings);
    const other = await s.create(paperB, 'Supplement B', settings);
    await s.remove(paperA, first.id);
    expect((await s.list(paperA)).map(c => c.id)).toEqual([second.id]);
    expect((await s.current(paperA))?.id).toBe(second.id);
    expect((await s.current(paperB))?.id).toBe(other.id);
    expect([...storage.files.keys()].some(k => k.endsWith(`${first.id}.json`))).toBe(false);
    expect([...storage.files.keys()].some(k => k.endsWith(`${first.id}.jsonl`))).toBe(false);
    await expect(s.get(first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('after deleting the current chat, falls back to another listed conversation', async () => {
    const { store: s } = store();
    const first = await s.create(paperA, 'Paper A', settings);
    const second = await s.create(paperA, 'Paper A', settings);
    expect((await s.current(paperA))?.id).toBe(second.id);
    await s.remove(paperA, second.id);
    expect((await s.current(paperA))?.id).toBe(first.id);
    expect((await s.list(paperA)).map(c => c.id)).toEqual([first.id]);
  });
  it('does not write an empty snapshot when history is unavailable', async () => {
    const { storage, store: s } = store();
    const created = await s.create(paperA, 'Paper A', settings);
    const indexPath = [...storage.files.keys()].find(k => k.startsWith('papers/'))!;
    const conversationPath = [...storage.files.keys()].find(k => k.endsWith(`${created.id}.json`))!;
    const originalConversation = storage.files.get(conversationPath)!;
    storage.files.set(indexPath, new TextEncoder().encode('{"schemaVersion":1,"conversations":'));
    const fresh = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    await expect(fresh.remove(paperA, created.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
    expect(new TextDecoder().decode(storage.files.get(indexPath))).toBe('{"schemaVersion":1,"conversations":');
    expect(storage.files.get(conversationPath)).toEqual(originalConversation);
  });
  it('leaves a truncated paper index and a garbage-tailed conversation file untouched', async () => {
    const { storage, store: s } = store();
    const created = await s.create(paperA, 'Paper A', settings);
    const indexPath = [...storage.files.keys()].find(k => k.startsWith('papers/'))!;
    const conversationPath = [...storage.files.keys()].find(k => k.endsWith(`${created.id}.json`))!;
    const originalConversation = storage.files.get(conversationPath)!;
    storage.files.set(indexPath, new TextEncoder().encode('{"schemaVersion":1,"conversations":'));
    const brokenIndex = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    await expect(brokenIndex.current(paperA)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
    expect(new TextDecoder().decode(storage.files.get(indexPath))).toBe('{"schemaVersion":1,"conversations":');
    storage.files.set(indexPath, new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, conversations: [created.id], current: created.id })));
    storage.files.set(conversationPath, new Uint8Array([...originalConversation, ...new TextEncoder().encode('\n{"truncated":')]));
    const brokenTail = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    await expect(brokenTail.get(created.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
    expect(storage.files.get(conversationPath)).toEqual(new Uint8Array([...originalConversation, ...new TextEncoder().encode('\n{"truncated":')]));
  });
  it('replays a complete request-log line that landed after the last snapshot and ignores a truncated tail', async () => {
    const { storage, store: s } = store();
    const conversation = await s.create(paperA, 'Paper A', settings);
    conversation.requests.push({ requestId: 'r1', hash: 'h', state: 'accepted', turnId: null, createdAt: 'now', updatedAt: 'now' });
    conversation.activeRequestId = 'r1';
    await s.save(conversation);
    const logPath = [...storage.files.keys()].find(k => k.endsWith(`${conversation.id}.jsonl`))!;
    const snapshotPath = [...storage.files.keys()].find(k => k.endsWith(`${conversation.id}.json`))!;
    const snapshotBytes = storage.files.get(snapshotPath);
    const previous = storage.files.get(logPath);
    if (!snapshotBytes || !previous) throw new Error('expected snapshot and request log');
    const extra = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, n: (JSON.parse(new TextDecoder().decode(snapshotBytes)) as { logSeq: number }).logSeq + 1, requestId: 'r1', state: 'dispatching', turnId: null, at: 'later' })}\n{"schemaVersion":1,"n":`);
    const combined = new Uint8Array(previous.length + extra.length);
    combined.set(previous, 0); combined.set(extra, previous.length);
    storage.files.set(logPath, combined);
    const restored = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    const loaded = await restored.get(conversation.id);
    expect(loaded.requests[0]?.state).toBe('dispatching');
    expect(new TextDecoder().decode(storage.files.get(logPath))).toContain('{"schemaVersion":1,"n":');
  });
  it('applies a later cancelled log line to the streaming assistant without inventing text or rewriting the truncated tail', async () => {
    const { storage, store: s } = store();
    const conversation = await s.create(paperA, 'Paper A', settings);
    conversation.requests.push({ requestId: 'r1', hash: 'h', state: 'running', turnId: 'turn-1', createdAt: 'now', updatedAt: 'now' });
    conversation.messages.push(
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'q', citations: [citationA], status: 'completed' },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: null, settings, text: '部分回答', citations: [], status: 'streaming' },
    );
    conversation.activeRequestId = 'r1';
    await s.save(conversation);
    const logPath = [...storage.files.keys()].find(k => k.endsWith(`${conversation.id}.jsonl`));
    const snapshotPath = [...storage.files.keys()].find(k => k.endsWith(`${conversation.id}.json`));
    const snapshotBytes = snapshotPath ? storage.files.get(snapshotPath) : undefined;
    const previous = logPath ? storage.files.get(logPath) : undefined;
    if (!logPath || !snapshotBytes || !previous) throw new Error('expected snapshot and request log');
    const parsed: unknown = JSON.parse(new TextDecoder().decode(snapshotBytes));
    const logSeq = typeof parsed === 'object' && parsed !== null && 'logSeq' in parsed && typeof parsed.logSeq === 'number' ? parsed.logSeq : 0;
    const extra = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1, n: logSeq + 1, requestId: 'r1', state: 'cancelled', turnId: 'turn-1', at: 'later' })}\n{"schemaVersion":1,"n":`);
    const combined = new Uint8Array(previous.length + extra.length);
    combined.set(previous, 0); combined.set(extra, previous.length);
    storage.files.set(logPath, combined);
    const restored = new ConversationStore(storage, { uuid: () => 'x', now: () => 'later' });
    const loaded = await restored.get(conversation.id);
    expect(loaded.requests[0]?.state).toBe('cancelled');
    expect(loaded.activeRequestId).toBeNull();
    expect(loaded.messages.find(m => m.id === 'a1')).toMatchObject({ status: 'cancelled', text: '部分回答' });
    expect(new TextDecoder().decode(storage.files.get(logPath))).toContain('{"schemaVersion":1,"n":');
  });
});
