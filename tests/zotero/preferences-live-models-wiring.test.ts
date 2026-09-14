import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { HistoryListing, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../packages/zotero/src/workspace/preferences-pane.ts';
import { createPreferencesService, type PreferencesService } from '../../packages/zotero/src/workspace/preferences-service.ts';

/**
 * The wiring, not the widget: these tests compose the same objects the plugin entry composes — the
 * real `createPreferencesService` and the real pane — so a dropped live-model port fails here even
 * if the pane itself still renders. `index.ts` is a Zotero compartment that reads plugin globals at
 * load, so the composition below mirrors its `liveModels` line instead of importing it.
 */
function serviceHost(liveModels?: () => Promise<string[] | null>) {
  return {
    workspace: () => Promise.reject(new Error('The workspace is not needed to read the live models.')),
    exportText: () => Promise.resolve(),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: () => undefined,
    ...(liveModels ? { liveModels } : {}),
  };
}

const listing: HistoryListing = { entries: [], activeCount: 0, archivedCount: 0 };

function mountPane(service: PreferencesService) {
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'en', textScale: 1 };
  const host: PreferencesPaneHost = {
    read: () => Promise.resolve(settings),
    save: vi.fn<PreferencesPaneHost['save']>(() => Promise.resolve()),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
    readHistory: () => Promise.resolve(listing),
    deleteHistory: () => Promise.resolve({ action: 'delete', requested: 0, changed: [], failed: [], warnings: [], partial: false }),
    // Exactly what `preferences-entry.ts` does: the port is forwarded only when the service has it.
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

it('forwards the runtime live list to the pane so a Spark id composes end to end, and filters excluded ids', async () => {
  const service = createPreferencesService({ ...serviceHost(), liveModels: () => Promise.resolve(['gpt-6-astra', 'gpt-5.3-codex-spark', 'gpt-5.5']) });
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.3-codex-spark"]')).not.toBeNull();
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/running runtime's report/u);
});

it('keeps the bundled families and honest copy when the service has no live model port', async () => {
  const service = createPreferencesService(serviceHost());
  expect('readLiveModels' in service).toBe(false);
  const { ready, root, find } = mountPane(service);
  await ready;
  expect(root.querySelector('[data-zcr-model^="gpt-5.3"]')).toBeNull();
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/bundled catalog, not your account/u);
});
