import { expect, it, vi } from 'vitest';
import type { NativeOrganizationItemSnapshot, NativeReaderPort } from '../../../packages/contracts/src/native.ts';
import { captureSelectedLibraryItems } from '../../../packages/zotero/src/library/selection.ts';

const snapshot = (key: string): NativeOrganizationItemSnapshot => ({
  clientId: 'profile-a', libraryId: 1, key,
  metadata: { itemType: 'journalArticle', title: key, creators: [] },
  tags: [], collectionKeys: [], attachmentKeys: [], dateModified: 'now',
  contentSignature: key, organizationSignature: key,
});

it('freezes the actual regular items selected in the active Zotero library pane', async () => {
  const selected = [
    { id: 1, key: 'ITEMONE1', libraryID: 1, deleted: false, isRegularItem: () => true },
    { id: 2, key: 'PDFCHILD', libraryID: 1, deleted: false, isRegularItem: () => false },
    { id: 3, key: 'ITEMTWO2', libraryID: 1, deleted: false, isRegularItem: () => true },
  ];
  const inspectOrganizationItem = vi.fn(({ key }: { key: string }) => Promise.resolve(snapshot(key)));
  const result = await captureSelectedLibraryItems({
    clientId: 'profile-a',
    getWindow: () => ({ ZoteroPane: { getSelectedItems: () => selected } }),
    reader: { inspectOrganizationItem },
  });
  expect(result.map(item => item.key)).toEqual(['ITEMONE1', 'ITEMTWO2']);
  expect(inspectOrganizationItem.mock.calls.map(call => call[0])).toEqual([
    { clientId: 'profile-a', libraryId: 1, key: 'ITEMONE1' },
    { clientId: 'profile-a', libraryId: 1, key: 'ITEMTWO2' },
  ]);
});

it('refuses an empty or oversized selection instead of silently expanding scope', async () => {
  const inspectOrganizationItem = vi.fn(); const reader = { inspectOrganizationItem } as unknown as NativeReaderPort;
  await expect(captureSelectedLibraryItems({ clientId: 'profile-a', getWindow: () => ({ ZoteroPane: { getSelectedItems: () => [] } }), reader })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  const tooMany = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, key: `ITEM${String(i).padStart(4, '0')}`, libraryID: 1, deleted: false, isRegularItem: () => true }));
  await expect(captureSelectedLibraryItems({ clientId: 'profile-a', getWindow: () => ({ ZoteroPane: { getSelectedItems: () => tooMany } }), reader })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(inspectOrganizationItem).not.toHaveBeenCalled();
});

it('copies every selected identity before the first asynchronous readback', async () => {
  const selected = [
    { id: 1, key: 'ITEMONE1', libraryID: 1, deleted: false, isRegularItem: () => true },
    { id: 2, key: 'ITEMTWO2', libraryID: 1, deleted: false, isRegularItem: () => true },
  ];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const inspectOrganizationItem = vi.fn(async ({ key }: { key: string }) => { if (key === 'ITEMONE1') await gate; return snapshot(key); });
  const pending = captureSelectedLibraryItems({ clientId: 'profile-a', getWindow: () => ({ ZoteroPane: { getSelectedItems: () => selected } }), reader: { inspectOrganizationItem } });
  await Promise.resolve(); selected[1]!.key = 'RETARGET'; release();
  expect((await pending).map(item => item.key)).toEqual(['ITEMONE1', 'ITEMTWO2']);
});

it('rejects a multi-library selection without reading or expanding either library', async () => {
  const inspectOrganizationItem = vi.fn();
  const selected = [
    { id: 1, key: 'ITEMONE1', libraryID: 1, deleted: false, isRegularItem: () => true },
    { id: 2, key: 'ITEMTWO2', libraryID: 2, deleted: false, isRegularItem: () => true },
  ];
  await expect(captureSelectedLibraryItems({ clientId: 'profile-a', getWindow: () => ({ ZoteroPane: { getSelectedItems: () => selected } }), reader: { inspectOrganizationItem } })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  expect(inspectOrganizationItem).not.toHaveBeenCalled();
});
