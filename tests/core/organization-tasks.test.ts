import { expect, it, vi } from 'vitest';
import type { NativeActionPort, NativeOrganizationItemSnapshot, NativeOrganizationChange } from '../../packages/contracts/src/native.ts';
import { citationFromAnnotation, parseOrganizationProposals } from '../../packages/contracts/src/tasks.ts';
import { validateOrganizationContext } from '../../packages/contracts/src/validation.ts';
import { ActionTaskController } from '../../packages/core/src/tasks/controller.ts';
import { MemoryStorage } from './doubles.ts';
import { clientId, paperA } from '../contracts/factories.ts';

const before = (overrides: Partial<NativeOrganizationItemSnapshot> = {}): NativeOrganizationItemSnapshot => ({
  clientId,
  libraryId: 1,
  key: 'ITEMONE1',
  metadata: { itemType: 'journalArticle', title: 'Frozen selected paper', creators: [] },
  tags: ['existing'],
  collectionKeys: [],
  attachmentKeys: [],
  dateModified: '2026-09-19 10:00:00',
  contentSignature: 'before-full',
  organizationSignature: 'same-non-organization-fields',
  ...overrides,
});

it('accepts collection indexes beyond 49 within the frozen 1000-collection bound', () => {
  expect(parseOrganizationProposals('{"candidates":[{"itemIndex":0,"tags":[],"collectionIndexes":[50,999]}]}')).toEqual([{ itemIndex: 0, tags: [], collectionIndexes: [50, 999] }]);
  expect(() => parseOrganizationProposals('{"candidates":[{"itemIndex":0,"tags":[],"collectionIndexes":[1000]}]}')).toThrow();
});

function fixture() {
  const storage = new MemoryStorage();
  let current = before();
  const organize = vi.fn((input: { expected: NativeOrganizationItemSnapshot; tags: string[]; collections: Array<{ collectionKey: string }> }): Promise<NativeOrganizationChange> => {
    const after = before({
      tags: [...new Set([...input.expected.tags, ...input.tags])].sort(),
      collectionKeys: [...new Set([...input.expected.collectionKeys, ...input.collections.map(collection => collection.collectionKey)])].sort(),
      dateModified: '2026-09-19 10:01:00',
      contentSignature: 'after-full',
    });
    current = after;
    return Promise.resolve({ before: input.expected, after, addedTags: ['topic-a'], addedCollectionKeys: ['COLLECT1'] });
  });
  const native = {
    organizeItem: organize,
    inspectItem: vi.fn(() => Promise.resolve(structuredClone(current))),
    inspectOrganizationItem: vi.fn(() => Promise.resolve(structuredClone(current))),
    undoOrganization: vi.fn((input: { expected: NativeOrganizationChange }) => {
      if (current.contentSignature !== input.expected.after.contentSignature) return Promise.resolve({ status: 'conflict' as const });
      current = structuredClone(input.expected.before);
      return Promise.resolve({ status: 'removed' as const, after: structuredClone(current) });
    }),
  } as unknown as NativeActionPort;
  let n = 0;
  const controller = new ActionTaskController(storage, native, {
    uuid: () => `organization-${++n}`,
    key: () => `ORG${String(++n).padStart(5, '0')}`,
    now: () => `2026-09-19T10:00:${String(n).padStart(2, '0')}.000Z`,
  });
  const input = {
    conversationId: 'conversation-a',
    question: 'Organize the selected papers by topic.',
    modelRequestId: 'request-organize-a',
    selection: [before()],
    collections: [{ clientId, libraryId: 1, collectionKey: 'COLLECT1' }],
    proposals: [{ itemIndex: 0, tags: ['topic-a'], collectionIndexes: [0] }],
  };
  return { storage, native, controller, input, organize, current: () => current, setCurrent: (value: NativeOrganizationItemSnapshot) => { current = structuredClone(value); }, edit: () => { current = before({ ...current, metadata: { ...current.metadata, title: 'Later human title' }, contentSignature: 'human-edit' }); } };
}

it('parses bounded organization proposals without accepting model-selected native keys', () => {
  expect(parseOrganizationProposals('{"candidates":[{"itemIndex":0,"tags":["topic-a"],"collectionIndexes":[1]}]}')).toEqual([
    { itemIndex: 0, tags: ['topic-a'], collectionIndexes: [1] },
  ]);
  for (const hostile of [
    '{"candidates":[{"itemKey":"ITEMONE1","tags":["topic-a"],"collectionIndexes":[]}]}',
    '{"candidates":[{"itemIndex":0,"tags":["topic-a"],"collectionKeys":["COLLECT1"]}]}',
    '{"candidates":[{"itemIndex":0,"tags":[""],"collectionIndexes":[]}]}',
  ]) expect(() => parseOrganizationProposals(hostile)).toThrow();
});

it('keeps both adjacent native positions when opening a cross-page annotation source', () => {
  const revision = { fingerprint: 'frozen', size: 10, modifiedAt: 1 };
  const citation = citationFromAnnotation({
    paper: paperA, documentRevision: revision, title: 'Paper', clock: { uuid: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', now: () => '2026-09-19T10:00:00.000Z' },
    candidate: { source: { paper: paperA, revision, quote: 'across pages' }, text: 'across pages', pageLabel: '4', sortIndex: '00003', position: { pageIndex: 3, rects: [[1, 2, 3, 4]], nextPageRects: [[5, 6, 7, 8]] } },
  });
  expect(citation.positions).toEqual([{ pageIndex: 3, rects: [[1, 2, 3, 4]] }, { pageIndex: 4, rects: [[5, 6, 7, 8]] }]);
});

it('freezes selected native items into one concrete review and writes only after approval', async () => {
  const f = fixture();
  const task = await f.controller.planOrganization(f.input);
  expect(task).toMatchObject({ kind: 'organization', state: 'review', items: [{ before: { key: 'ITEMONE1', tags: ['existing'] }, proposal: { tags: ['topic-a'], collections: [{ collectionKey: 'COLLECT1' }] } }] });
  expect(f.organize).not.toHaveBeenCalled();
  const applied = await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(applied).toMatchObject({ state: 'completed', items: [{ status: 'applied', change: { addedTags: ['topic-a'], addedCollectionKeys: ['COLLECT1'] } }] });
  expect(f.organize).toHaveBeenCalledTimes(1);
  await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(f.organize).toHaveBeenCalledTimes(1);
});

it('uses the persisted readback for safe undo and refuses to overwrite a later human edit', async () => {
  const f = fixture();
  const task = await f.controller.planOrganization(f.input);
  await f.controller.approve(task.id, task.items.map(item => item.id));
  f.edit();
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'conflict', items: [{ errorCode: 'OUTPUT_CHANGED' }] });
  expect(f.current().metadata.title).toBe('Later human title');
});

it('does not claim task ownership when matching additions exist without a durable after snapshot', async () => {
  const f = fixture(); const task = await f.controller.planOrganization(f.input);
  f.organize.mockImplementationOnce(input => {
    const after = before({ tags: [...input.expected.tags, 'topic-a'].sort(), collectionKeys: ['COLLECT1'], contentSignature: 'matching-but-unowned' });
    // This state could equally be a user adding the same values after an interrupted write.
    f.setCurrent(after);
    f.storage.fail = true;
    return Promise.resolve({ before: input.expected, after, addedTags: ['topic-a'], addedCollectionKeys: ['COLLECT1'] });
  });
  await expect(f.controller.approve(task.id, task.items.map(item => item.id))).rejects.toThrow();
  f.storage.fail = false;
  const restored = new ActionTaskController(f.storage, f.native, { uuid: () => 'restored-id', key: () => 'RESTORE1', now: () => '2026-09-19T10:02:00.000Z' });
  const reconciled = await restored.reconcile(task.id);
  expect(reconciled).toMatchObject({ state: 'uncertain', items: [{ status: 'uncertain', errorCode: 'OUTPUT_UNCONFIRMED' }] });
  expect(reconciled.items[0]).not.toHaveProperty('change');
  await expect(restored.undo(task.id)).rejects.toMatchObject({ code: 'BUSY' });
  expect(f.organize).toHaveBeenCalledTimes(1);
});

it('reuses an exact model request and rejects a conflicting replay without widening selection', async () => {
  const f = fixture();
  const first = await f.controller.planOrganization(f.input);
  expect(await f.controller.planOrganization(f.input)).toEqual(first);
  await expect(f.controller.planOrganization({ ...f.input, selection: [before({ key: 'ITEMTWO2' })] })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
});

it('rejects a corrupt persisted delta that claims a pre-existing tag as task-owned', async () => {
  const f = fixture(); const task = await f.controller.planOrganization(f.input);
  await f.controller.approve(task.id, task.items.map(item => item.id));
  const path = `tasks/${task.id}.json`;
  const raw = JSON.parse(new TextDecoder().decode(f.storage.files.get(path)!)) as { items: Array<{ change: { addedTags: string[] } }> };
  raw.items[0]!.change.addedTags = ['existing']; f.storage.files.set(path, new TextEncoder().encode(JSON.stringify(raw)));
  await expect(f.controller.get(task.id)).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
  expect(f.current().tags).toEqual(['existing', 'topic-a']);
});

it('bounds the frozen request so the tripled applied ledger remains below its record cap', () => {
  const large = 'x'.repeat(1024 * 1024);
  expect(() => validateOrganizationContext({ selection: [before({ contentSignature: large, organizationSignature: large })], collections: [] })).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
});
