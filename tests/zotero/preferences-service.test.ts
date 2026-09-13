/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../packages/contracts/src/index.ts';
import type { ReaderSkill, ReaderWorkspace, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { createPreferencesService } from '../../packages/zotero/src/workspace/preferences-service.ts';

const copy = <T>(value: T): T => structuredClone(value);

const userSkill: ReaderSkill = { id: 'user-study', name: 'Study', description: 'Study the supplied source', version: '1.0', revision: 'revision-one', markdown: '# Study\nPreserve notation.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };

function fixture(overrides: Partial<ReaderWorkspace> = {}, exportFailure?: Error) {
  let settings: WorkspaceSettings = { ...defaultSettings(), skills: [...defaultSettings().skills, copy(userSkill)], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }] };
  const workspace: ReaderWorkspace = {
    settings: vi.fn(() => Promise.resolve(copy(settings))),
    saveSettings: vi.fn<ReaderWorkspace['saveSettings']>(value => { settings = copy(value); return Promise.resolve(); }),
    saveSkill: vi.fn<ReaderWorkspace['saveSkill']>(value => { const next = { ...copy(value), revision: 'revision-two' }; settings.skills = [...settings.skills.filter(item => item.id !== value.id), next]; return Promise.resolve(next); }),
    ...overrides,
  } as ReaderWorkspace;
  const exportText = vi.fn(() => exportFailure === undefined ? Promise.resolve() : Promise.reject(exportFailure));
  return { service: createPreferencesService({ workspace: () => Promise.resolve(workspace), uuid: () => 'aaaaaaaa-0000-4000-8000-00000000000a', exportText }), workspace, exportText, current: () => copy(settings) };
}

it('mints a valid profile id in the plugin sandbox', () => {
  const { service } = fixture();
  expect(service.newProfileId()).toBe('profile-aaaaaaaa-0000-4000-8000-00000000000a');
});

it('reads the real stored settings as JSON without inventing fields', async () => {
  const { service, current } = fixture();
  const parsed = JSON.parse(await service.readSettings()) as WorkspaceSettings;
  expect(parsed).toEqual(current());
  expect(Object.keys(parsed).sort()).toEqual(['preferences', 'profiles', 'schemaVersion', 'skills', 'textScale', 'uiLanguage']);
});

it('writes a full validated snapshot through saveSettings, including skill activation', async () => {
  const { service, workspace } = fixture();
  const next = { ...JSON.parse(await service.readSettings()) as WorkspaceSettings, uiLanguage: 'zh' as const, textScale: 1.5 };
  await service.writeSettings(JSON.stringify(next));
  expect(workspace.saveSettings).toHaveBeenCalledWith(next);
});

it('refuses malformed or non-object payloads with a clean error instead of touching the store', async () => {
  const { service, workspace } = fixture();
  await expect(service.writeSettings('not json')).rejects.toBeInstanceOf(ReaderError);
  await expect(service.writeSettings('[]')).rejects.toBeInstanceOf(ReaderError);
  await expect(service.writeSettings('null')).rejects.toBeInstanceOf(ReaderError);
  expect(workspace.saveSettings).not.toHaveBeenCalled();
  await expect(service.writeSettings('not json')).rejects.toThrow(/invalid/iu);
});

it('propagates store failures so the pane can report them honestly', async () => {
  const failure = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened.');
  const { service } = fixture({ saveSettings: vi.fn<ReaderWorkspace['saveSettings']>().mockRejectedValue(failure) });
  const snapshot = await service.readSettings();
  await expect(service.writeSettings(snapshot)).rejects.toBe(failure);
});

it('toggles exactly one installed workflow through saveSkill and preserves its revision', async () => {
  const { service, workspace, current } = fixture();
  await expect(service.setSkillEnabled('user-study', false)).resolves.toBeUndefined();
  expect(workspace.saveSkill).toHaveBeenCalledWith({ ...userSkill, enabled: false });
  expect(current().skills.find(skill => skill.id === 'user-study')?.enabled).toBe(false);
  // Other skills are untouched: only the requested workflow is written.
  expect(workspace.saveSkill).toHaveBeenCalledOnce();
});

it('refuses to toggle unknown workflows or non-boolean values', async () => {
  const { service, workspace } = fixture();
  await expect(service.setSkillEnabled('missing', true)).rejects.toThrow('no longer installed');
  await expect(service.setSkillEnabled('user-study', 'yes' as unknown as boolean)).rejects.toThrow(/enabled/iu);
  expect(workspace.saveSkill).not.toHaveBeenCalled();
});

it('surfaces a conflict when the stored workflow revision changed underneath the pane', async () => {
  const conflict = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened. Load the newer revision before editing it.');
  const { service } = fixture({ saveSkill: vi.fn<ReaderWorkspace['saveSkill']>().mockRejectedValue(conflict) });
  await expect(service.setSkillEnabled('user-study', false)).rejects.toBe(conflict);
});

it('exports the same preference snapshot the sidebar exports, through the native export port', async () => {
  const { service, exportText, current } = fixture();
  await expect(service.exportPreferences()).resolves.toBeUndefined();
  expect(exportText).toHaveBeenCalledWith(
    'reading-preferences.json',
    JSON.stringify({ preferences: current().preferences, profiles: current().profiles }, null, 2),
  );
});

it('reports a failed export instead of pretending the file was written', async () => {
  const failure = new ReaderError('UNSUPPORTED_INTERACTION', 'The selected export file could not be written.');
  const { service } = fixture({}, failure);
  await expect(service.exportPreferences()).rejects.toBe(failure);
});
