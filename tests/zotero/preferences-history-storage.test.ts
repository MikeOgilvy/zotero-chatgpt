import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HISTORY_STORAGE_LIMITS, createHistoryStorageReader, type HistoryStorageLimits } from '../../packages/zotero/src/workspace/history-storage.ts';
import type { FileAPI } from '../../packages/zotero/src/runtime/storage.ts';
import { isHistoryStorageReport } from '../../packages/core/src/workspace/history.ts';
import { nodeFiles } from '../runtime/files-fixture.ts';

/**
 * Synthetic trees built from scratch in the OS temp directory. Nothing here touches a Zotero
 * profile, the owner's library or `.zcr-dev/`; the walk is scoped to the plugin's own records store.
 */
const RECORDS = 'zotero-codex-reader/v1/records';
const id = (suffix: number) => `12345678-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function records(limits?: Partial<HistoryStorageLimits>) {
  const root = await mkdtemp(path.join(tmpdir(), 'zcr-history-storage-'));
  roots.push(root);
  const store = path.join(root, ...RECORDS.split('/'));
  const write = async (relative: string, size: number): Promise<void> => {
    const target = path.join(store, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(size));
  };
  const host = { ...nodeFiles(), profileDir: root };
  return { root, store, host, write, measure: createHistoryStorageReader(host, limits) };
}

it('measures only the records store and splits chats, drafts and other records', async () => {
  const { root, store, write, measure } = await records();
  const chat = id(1); const task = id(2); const source = id(4); const paper = `${id(3)}-1-PDFONE01`;
  await write(`conversations/${chat}.json`, 100);
  await write(`conversations/${chat}.jsonl`, 50);
  await write(`conversations/${chat}.${source}.source.json`, 25);
  await write(`workspace/drafts/${paper}-unbound.json`, 10);
  await write('workspace/settings.json', 5);
  await write(`papers/${paper}.json`, 7);
  await write(`tasks/${task}.json`, 3);
  // Siblings inside the plugin root but outside the records store: the Codex account home holds
  // auth files and the runtime home holds caches. A large byte count there must never be measured.
  await mkdir(path.join(root, 'zotero-codex-reader/v1/account'), { recursive: true });
  await writeFile(path.join(root, 'zotero-codex-reader/v1/account/config.toml'), new Uint8Array(9999));
  await mkdir(path.join(root, 'zotero-codex-reader/v1/home/data'), { recursive: true });
  await writeFile(path.join(root, 'zotero-codex-reader/v1/home/data/cache.json'), new Uint8Array(9999));

  const report = await measure();
  expect(isHistoryStorageReport(report), 'report shape').toBe(true);
  expect(report).toMatchObject({
    location: store, scope: RECORDS,
    bytes: 200, chatBytes: 175, draftBytes: 10, otherBytes: 15, files: 7,
    complete: true, stoppedBy: null, chatsComplete: true,
  });
  expect(report.chats).toEqual([{ id: chat, bytes: 175 }]);
  expect(report.limits).toEqual({ entries: HISTORY_STORAGE_LIMITS.entries, bytes: HISTORY_STORAGE_LIMITS.bytes, depth: HISTORY_STORAGE_LIMITS.depth });
  expect(HISTORY_STORAGE_LIMITS).toEqual({ entries: 20_000, bytes: 1024 ** 3, depth: 4, chats: 500 });
});

it('stops at the entry bound and reports the bound instead of a precise total', async () => {
  const { write, measure } = await records({ entries: 3 });
  for (let index = 1; index <= 5; index += 1) await write(`conversations/${id(index)}.json`, 10);
  const report = await measure();
  // The bound counts every visited child, the conversations directory included: one directory plus
  // two records, then the walk stops and the figure is a lower bound.
  expect(report).toMatchObject({ complete: false, stoppedBy: 'entries', files: 2, bytes: 20 });
  expect(report.limits.entries).toBe(3);
  expect(isHistoryStorageReport(report)).toBe(true);
});

it('stops at the byte bound and reports at least that figure', async () => {
  const { write, measure } = await records({ entries: 100, bytes: 40 });
  for (let index = 1; index <= 5; index += 1) await write(`conversations/${id(index)}.json`, 10);
  const report = await measure();
  expect(report).toMatchObject({ complete: false, stoppedBy: 'bytes', bytes: 40, files: 4 });
});

it('refuses to measure deeper than the depth bound', async () => {
  const { write, measure } = await records({ depth: 2 });
  await write(`conversations/${id(1)}.json`, 10);
  await write('workspace/plugins/deep/nested.json', 10);
  const report = await measure();
  expect(report).toMatchObject({ complete: false, stoppedBy: 'depth', bytes: 10, files: 1 });
  expect(report.limits.depth).toBe(2);
});

it('never follows a link out of the records store', async () => {
  const { store, write, measure } = await records();
  const outside = await mkdtemp(path.join(tmpdir(), 'zcr-history-outside-'));
  roots.push(outside);
  await writeFile(path.join(outside, 'secret.json'), new Uint8Array(4096));
  await write(`conversations/${id(1)}.json`, 10);
  await symlink(path.join(outside, 'secret.json'), path.join(store, 'link.json'));
  const report = await measure();
  expect(report).toMatchObject({ complete: false, stoppedBy: 'entry-type', bytes: 10, files: 1 });
});

it('reports an unlistable store without inventing a number', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'zcr-history-storage-'));
  roots.push(root);
  const base = nodeFiles();
  const io: FileAPI = { ...base.io };
  delete io.getChildren;
  const measure = createHistoryStorageReader({ ...base, profileDir: root, io });
  const report = await measure();
  expect(report).toMatchObject({ complete: false, stoppedBy: 'listing', bytes: 0, files: 0, chats: [], chatsComplete: true });
  expect(report.location).toBe(path.join(root, ...RECORDS.split('/')));
});
