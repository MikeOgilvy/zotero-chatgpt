import { it, expect } from 'vitest';
import { RequestJournal } from '../../packages/core/src/sessions/journal.ts';
import { MemoryStorage } from './doubles.ts';
const input = { requestId: 'r1', state: 'accepted' as const, question: 'test', model: 'default', output: '', error: null };
it('persists accepted then dispatching, dedupes stable IDs and rejects changed content or parallel work', async () => {
  const storage = new MemoryStorage(); const journal = await RequestJournal.open(storage);
  expect(await journal.accept(input)).toBe(true); expect(await journal.accept(input)).toBe(false);
  await expect(journal.accept({ ...input, question: 'other' })).rejects.toThrow('conflict');
  await expect(journal.accept({ ...input, requestId: 'r2' })).rejects.toThrow('busy');
  await journal.save({ ...input, state: 'dispatching' });
  expect(storage.writes.map(text => (JSON.parse(text) as { requests: { state: string }[] }).requests[0]?.state)).toEqual(['accepted', 'dispatching']);
});
it('storage failure never creates an accepted record and restart marks outstanding work uncertain without submission', async () => {
  const storage = new MemoryStorage(); const journal = await RequestJournal.open(storage); storage.fail = true;
  await expect(journal.accept(input)).rejects.toThrow('Storage'); expect(journal.latest()).toBeNull();
  storage.fail = false; await journal.accept(input); await journal.save({ ...input, state: 'running', output: 'partial' });
  const restored = await RequestJournal.open(storage); expect(restored.latest()).toMatchObject({ state: 'uncertain', output: 'partial' });
  expect(await restored.accept(input)).toBe(false);
});
it('rejects corrupt storage without overwriting evidence', async () => {
  const storage = new MemoryStorage(); storage.files.set('s2-requests.json', new TextEncoder().encode('{broken'));
  await expect(RequestJournal.open(storage)).rejects.toThrow('Storage'); expect(storage.writes).toHaveLength(0);
});
