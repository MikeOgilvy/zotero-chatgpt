import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Window } from 'happy-dom';
import type { HistoryListing, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { isHistoryStorageReport } from '../../packages/core/src/workspace/history.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import type { ReaderDocumentCache } from '../../packages/zotero/src/reader/document.ts';
import { createLocalServices } from '../../packages/zotero/src/runtime/local-services.ts';
import { createHistoryStorageReader } from '../../packages/zotero/src/workspace/history-storage.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../packages/zotero/src/workspace/preferences-pane.ts';
import { createPreferencesService, type PreferencesService } from '../../packages/zotero/src/workspace/preferences-service.ts';
import { nodeFiles } from '../runtime/files-fixture.ts';

/**
 * The wiring, not the widget: these tests compose the same objects the plugin entry composes — the
 * real `createLocalServices` reader and the real `createPreferencesService` — so a broken bridge
 * (`measureRecords` missing, or the service dropping the port) fails here even if the section itself
 * still renders. The one thing that cannot be exercised off-host is `index.ts` itself, which is a
 * Zotero compartment that reads plugin globals at load; the composition below mirrors its two lines.
 *
 * Synthetic temp directories only: no Zotero profile, no owner library, no `.zcr-dev/`.
 */
const RECORDS = 'zotero-codex-reader/v1/records';
const id = (suffix: number) => `12345678-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function profile() {
  const root = await mkdtemp(path.join(tmpdir(), 'zcr-storage-wiring-'));
  roots.push(root);
  const store = path.join(root, ...RECORDS.split('/'));
  const write = async (relative: string, size: number): Promise<void> => {
    const target = path.join(store, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(size));
  };
  // The same host shape `geckoHost().host` has, backed by the filesystem instead of Gecko.
  const host = { ...nodeFiles(), profileDir: root, os: 'Darwin', abi: 'aarch64', load: () => Promise.resolve(new Uint8Array()) };
  return { root, store, host, write };
}

/** The service host `index.ts` builds; the workspace is never reached by a storage measurement. */
function serviceHost(storageReport?: () => Promise<unknown>) {
  return {
    workspace: () => Promise.reject(new Error('The workspace is not needed for a storage measurement.')),
    uuid: () => 'uuid-0000-4000-8000-000000000000',
    exportText: () => Promise.resolve(),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: () => undefined,
    ...(storageReport ? { storageReport } : {}),
  };
}

const listing: HistoryListing = { entries: [], activeCount: 0, archivedCount: 0 };

function mountPane(service: PreferencesService) {
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'en', textScale: 1 };
  const host: PreferencesPaneHost = {
    read: () => Promise.resolve(settings),
    save: vi.fn<PreferencesPaneHost['save']>(() => Promise.resolve()),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    exportPreferences: vi.fn<PreferencesPaneHost['exportPreferences']>(() => Promise.resolve()),
    profileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a',
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
    readHistory: () => Promise.resolve(listing),
    setHistoryArchived: () => Promise.resolve({ action: 'archive', requested: 0, changed: [], failed: [], warnings: [], partial: false }),
    deleteHistory: () => Promise.resolve({ action: 'delete', requested: 0, changed: [], failed: [], warnings: [], partial: false }),
    // Exactly what `preferences-entry.ts` does: the port is forwarded only when the service has it.
    ...(service.readStorageReport ? { readStorageReport: async (): Promise<unknown> => JSON.parse(await service.readStorageReport!()) as unknown } : {}),
    ...(service.readLiveModels ? { readLiveModels: async (): Promise<unknown> => JSON.parse(await service.readLiveModels!()) as unknown } : {}),
  };
  const window = new Window({ url: 'https://test.invalid' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = '<vbox/>';
  const root = document.body.firstElementChild!;
  const pane = createPreferencesPane(host);
  const ready = pane.mount(root);
  const find = <T extends Element>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`Missing ${selector}`);
    return found;
  };
  return { ready, root, find };
}

it('composes the records reader into the preferences service so the pane shows a measured location and size', async () => {
  const { store, host, write } = await profile();
  const chat = id(1);
  await write(`conversations/${chat}.json`, 1024);
  await write(`workspace/drafts/${id(2)}-unbound.json`, 128);
  // A sibling of the records store inside the plugin root: the Codex account home holds credentials.
  await mkdir(path.join(host.profileDir, 'zotero-codex-reader/v1/account'), { recursive: true });
  await writeFile(path.join(host.profileDir, 'zotero-codex-reader/v1/account/config.toml'), new Uint8Array(8192));

  // This is the object `startup()` builds and the reader it must expose for the port to exist at all.
  const services = createLocalServices(host, {}, 'wiring-client', {} as unknown as ReaderDocumentCache);
  expect(typeof services.measureRecords).toBe('function');

  // Mirror of `index.ts`: `storageReport: () => localServices.measureRecords()`.
  const service = createPreferencesService(serviceHost(() => Promise.resolve(services.measureRecords())));
  const raw = await service.readStorageReport!();
  const report: unknown = JSON.parse(raw);
  expect(isHistoryStorageReport(report), 'the composed port yields a valid report').toBe(true);
  expect(report).toMatchObject({
    location: store, scope: RECORDS,
    bytes: 1152, chatBytes: 1024, draftBytes: 128, otherBytes: 0, files: 2,
    complete: true, stoppedBy: null, chats: [{ id: chat, bytes: 1024 }],
    // The pinned ceilings the port itself applies, echoed so the pane states the real bound.
    limits: { entries: 20_000, bytes: 1024 ** 3, depth: 4 },
  });

  // And the owner sees it: real location, real byte figure, no "unavailable" fallback.
  const { ready, find } = mountPane(service);
  await ready;
  const size = find<HTMLElement>('[data-zcr-history="storage-size"]');
  expect(size.textContent).toMatch(/not measured yet/iu);
  find<HTMLButtonElement>('[data-zcr-history="measure"]').click();
  // The parts are the measurement: chat bytes + draft bytes + other records, which must sum to the
  // total the port reported (validator-enforced), so no separate total figure is needed here.
  await vi.waitFor(() => expect(size.textContent).toContain('Chats 1.0 KiB'));
  expect(size.textContent).toBe('Chats 1.0 KiB · Drafts 128 B · Other records 0 B · 2 files');
  expect(find('[data-zcr-history="storage-path"]').textContent).toBe(`Absolute path: ${store}`);
  expect(find('[data-zcr-history="storage-scope"]').textContent).toBe(`Location: ${RECORDS}`);
  expect(find('[data-zcr-history="storage-note"]').textContent).toMatch(/^Measured /u);
});

it('applies the pinned bounds at the port, so a bound hit reaches the service as a stated "at least"', async () => {
  const { host, write } = await profile();
  for (let index = 1; index <= 5; index += 1) await write(`conversations/${id(index)}.json`, 10);

  // The reader — the port boundary — applies the bound, not the section: only 3 children are visited
  // (the conversations directory plus two records), so the figure is a stated lower bound.
  const bounded = createHistoryStorageReader(host, { entries: 3 });
  const measured = await bounded();
  expect(measured).toMatchObject({ complete: false, stoppedBy: 'entries', bytes: 20, files: 2, limits: { entries: 3 } });

  // And the bound survives the service boundary untouched, so the pane can only claim "at least".
  const service = createPreferencesService(serviceHost(() => Promise.resolve(measured)));
  const roundTripped: unknown = JSON.parse(await service.readStorageReport!());
  expect(isHistoryStorageReport(roundTripped)).toBe(true);
  expect(roundTripped).toMatchObject({ complete: false, stoppedBy: 'entries', limits: { entries: 3 } });
});

it('forwards the runtime live list to the pane so a Spark id composes end to end, and filters excluded ids', async () => {
  const service = createPreferencesService({ ...serviceHost(), liveModels: () => Promise.resolve(['gpt-6-astra', 'gpt-5.3-codex-spark', 'gpt-5.5']) });
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.3-codex-spark"]')).not.toBeNull();
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/running Codex runtime reported/u);
});

it('keeps the bundled families and honest copy when the service has no live model port', async () => {
  const service = createPreferencesService(serviceHost());
  expect('readLiveModels' in service).toBe(false);
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(root.querySelector('[data-zcr-model^="gpt-5.3"]')).toBeNull();
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/not in the bundled catalog/u);
});

it('keeps the port optional, so a host without the reader still lists chats and degrades honestly', async () => {
  const service = createPreferencesService(serviceHost());
  // Presence, not a flag: the older host has nothing to call, so the pane cannot fabricate a figure.
  expect('readStorageReport' in service).toBe(false);

  const { ready, find } = mountPane(service);
  await ready;
  expect(find<HTMLButtonElement>('[data-zcr-history="measure"]').hidden).toBe(true);
  expect(find('[data-zcr-history="storage-size"]').textContent).toMatch(/cannot report/iu);
  // The documented subtree is still stated, printed straight from the constants.
  expect(find('[data-zcr-history="storage-scope"]').textContent).toBe(`Location: ${RECORDS}`);
  expect(find<HTMLElement>('[data-zcr-history="storage-path"]').hidden).toBe(true);
});
