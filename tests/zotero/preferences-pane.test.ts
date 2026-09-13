import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../packages/contracts/src/index.ts';
import type { ReaderSkill, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../packages/zotero/src/workspace/preferences-pane.ts';

const copy = <T>(value: T): T => structuredClone(value);
const userSkill: ReaderSkill = { id: 'user-study', name: 'Study', description: 'Study the supplied source', version: '1.0', revision: 'revision-one', markdown: '# Study\nPreserve notation.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const blockedSkill: ReaderSkill = { ...userSkill, id: 'imported-blocked', name: 'Blocked', origin: 'imported', enabled: false, unsupportedDependencies: ['mcp'] };

function fixture(initial?: WorkspaceSettings, overrides: Partial<PreferencesPaneHost> = {}) {
  let state: WorkspaceSettings = initial ?? { ...defaultSettings(), skills: [...defaultSettings().skills, copy(userSkill), copy(blockedSkill)], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }], uiLanguage: 'en', textScale: 1 };
  const read = vi.fn(() => Promise.resolve(copy(state)));
  const save = vi.fn<PreferencesPaneHost['save']>(value => { state = copy(value); return Promise.resolve(); });
  const setSkillEnabled = vi.fn<PreferencesPaneHost['setSkillEnabled']>((id, enabled) => { state = { ...state, skills: state.skills.map(skill => (skill.id === id ? { ...skill, enabled } : skill)) }; return Promise.resolve(); });
  const exportPreferences = vi.fn<PreferencesPaneHost['exportPreferences']>(() => Promise.resolve());
  const base: PreferencesPaneHost = { read, save, setSkillEnabled, exportPreferences, profileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a' };
  const host: PreferencesPaneHost = { ...base, ...overrides };
  return { host, read, save, setSkillEnabled, exportPreferences, current: () => copy(state) };
}

function mount(host: PreferencesPaneHost, markup = '<vbox/>') {
  const window = new Window({ url: 'https://test.invalid' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = markup;
  const root = document.body.firstElementChild!;
  const pane = createPreferencesPane(host);
  const ready = pane.mount(root);
  const find = <T extends Element>(selector: string): T => { const found = root.querySelector<T>(selector); if (!found) throw new Error(`Missing ${selector}`); return found; };
  const change = (element: Element) => element.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
  // Writes disable the form while they are in flight; the next interaction waits for the real idle state.
  const settle = () => vi.waitFor(() => expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').disabled).toBe(false));
  return { document, root, pane, ready, find, change, settle };
}

it('renders the real stored settings into native, labelled controls and tracks a real shipped fragment', async () => {
  const fragment = readFileSync(path.join(import.meta.dirname, '../../packages/zotero/preferences/preferences.xhtml'), 'utf8');
  const { host } = fixture();
  const { ready, root, find } = mount(host, fragment);
  await ready;
  expect(find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]').value).toBe('en');
  expect(find<HTMLInputElement>('[data-zcr-pref="textScale"]').value).toBe('1');
  expect(find<HTMLInputElement>('[data-zcr-pref="preference-language"]').value).toBe('auto');
  expect(find<HTMLSelectElement>('[data-zcr-pref="preference-detail"]').value).toBe('standard');
  expect(find<HTMLTextAreaElement>('[data-zcr-pref="preference-background"]').value).toBe('');
  expect(find<HTMLSelectElement>('[data-zcr-pref="profile"]').options).toHaveLength(2);
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="user-study"]').checked).toBe(true);
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="imported-blocked"]').checked).toBe(false);
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="imported-blocked"]').disabled).toBe(true);
  // Every control is associated with a label so it is reachable by name.
  for (const control of find('[data-zcr-pref="form"]').querySelectorAll('input, select, textarea')) {
    expect(control.closest('label'), control.getAttribute('data-zcr-pref') ?? control.tagName).not.toBeNull();
  }
  // The shipped fragment's "loading" placeholder is gone once the pane owns the root.
  expect(root.querySelector('[data-zcr-pref="loading"]')).toBeNull();
  const status = find('[data-zcr-pref="status"]');
  expect(status.getAttribute('role')).toBe('status');
  expect(status.getAttribute('aria-live')).toBe('polite');
  const error = find<HTMLElement>('[data-zcr-pref="error"]');
  expect(error.getAttribute('role')).toBe('alert');
  expect(error.hidden).toBe(true);
});

it('saves interface language and chat text scale through the store and reports failures without lying', async () => {
  const { host, save, current } = fixture();
  const { ready, find, change, settle } = mount(host);
  await ready;
  const language = find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]');
  language.value = 'zh'; change(language);
  await vi.waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ uiLanguage: 'zh', textScale: 1 })));
  await settle();
  expect(current().uiLanguage).toBe('zh');

  const scale = find<HTMLInputElement>('[data-zcr-pref="textScale"]');
  scale.value = '1.5'; change(scale);
  await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ textScale: 1.5, uiLanguage: 'zh' })));
  await settle();
  expect(current().textScale).toBe(1.5);

  // An out-of-range scale is refused locally: no write, an honest alert and the stored value stays.
  scale.value = '9'; change(scale);
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').hidden).toBe(false));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toMatch(/0\.5 to 3/u);
  expect(save).toHaveBeenCalledTimes(2);
  expect(scale.value).toBe('1.5');
});

it('saves the six research preferences and profiles as one validated snapshot', async () => {
  const { host, save, current } = fixture();
  const { ready, find, change, settle } = mount(host);
  await ready;
  const language = find<HTMLInputElement>('[data-zcr-pref="preference-language"]');
  const detail = find<HTMLSelectElement>('[data-zcr-pref="preference-detail"]');
  const mathematics = find<HTMLSelectElement>('[data-zcr-pref="preference-mathematics"]');
  language.value = '中文'; detail.value = 'detailed'; mathematics.value = 'formal'; change(detail);
  find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await settle();
  expect(save.mock.calls[0]![0].preferences).toMatchObject({ language: '中文', detail: 'detailed', mathematics: 'formal' });
  expect(current().preferences.detail).toBe('detailed');
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/saved/iu));
  expect(find<HTMLElement>('[data-zcr-pref="status"]').hidden).toBe(false);

  // A selected profile is saved into that profile only; the global preferences stay untouched.
  const profile = find<HTMLSelectElement>('[data-zcr-pref="profile"]');
  profile.value = 'formal'; change(profile);
  language.value = 'formal-language'; change(language);
  find<HTMLButtonElement>('[data-zcr-pref="update-profile"]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await settle();
  expect(current().profiles).toEqual([{ id: 'formal', name: 'Formal', preferences: expect.objectContaining({ language: 'formal-language' }) as unknown }]);
  expect(current().preferences.language).toBe('中文');

  // A new profile gets an id from the host and appears in the select after the reload.
  find<HTMLInputElement>('[data-zcr-pref="profile-name"]').value = 'Formal copy';
  find<HTMLButtonElement>('[data-zcr-pref="save-profile"]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(3));
  await settle();
  expect(current().profiles.some(item => item.id === 'profile-aaaaaaaa-0000-4000-8000-00000000000a' && item.name === 'Formal copy')).toBe(true);
  expect(find<HTMLSelectElement>('[data-zcr-pref="profile"]').options).toHaveLength(3);
});

it('shows a clean error message from the store and reloads the real state after a conflict', async () => {
  const conflict = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened. Load the newer revision before editing it.');
  const { host, read } = fixture(undefined, { save: vi.fn<PreferencesPaneHost['save']>().mockRejectedValue(conflict) });
  const { ready, find, settle } = mount(host);
  await ready;
  find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').hidden).toBe(false));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe(conflict.message);
  // The pane re-reads the store so it never keeps showing a snapshot the store refused.
  expect(read).toHaveBeenCalledTimes(2);
  expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).not.toContain('/private');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').disabled).toBe(false);
});

it('toggles one workflow through setSkillEnabled and reverts the checkbox when the store refuses', async () => {
  const { host, setSkillEnabled } = fixture();
  const { ready, find, change, settle } = mount(host);
  await ready;
  const toggle = find<HTMLInputElement>('[data-zcr-skill-enabled="user-study"]');
  toggle.checked = false; change(toggle);
  await vi.waitFor(() => expect(setSkillEnabled).toHaveBeenCalledWith('user-study', false));
  await settle();
  expect(toggle.checked).toBe(false);

  const failure = new ReaderError('REQUEST_CONFLICT', 'This workflow has changed since it was opened.');
  setSkillEnabled.mockRejectedValueOnce(failure);
  toggle.checked = true; change(toggle);
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe(failure.message));
  await settle();
  expect(toggle.checked).toBe(false);
  expect(toggle.disabled).toBe(false);
});

it('exports through the host and reports a failed export instead of claiming success', async () => {
  const { host, exportPreferences } = fixture();
  const { ready, find, settle } = mount(host);
  await ready;
  find<HTMLButtonElement>('[data-zcr-pref="export-preferences"]').click();
  await vi.waitFor(() => expect(exportPreferences).toHaveBeenCalledTimes(1));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/exported/iu);

  const failure = new ReaderError('UNSUPPORTED_INTERACTION', 'The selected export file could not be written.');
  exportPreferences.mockRejectedValueOnce(failure);
  find<HTMLButtonElement>('[data-zcr-pref="export-preferences"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe(failure.message));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).not.toMatch(/exported/iu);
  expect(find<HTMLButtonElement>('[data-zcr-pref="export-preferences"]').disabled).toBe(false);
});

it('reports an unreadable or malformed store without rendering a form', async () => {
  const failure = new ReaderError('HISTORY_UNAVAILABLE', 'Saved workspace data could not be read; it was left untouched.');
  const unreadable = fixture(undefined, { read: vi.fn<PreferencesPaneHost['read']>().mockRejectedValue(failure) });
  const first = mount(unreadable.host);
  await first.ready;
  expect(first.find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe(failure.message);
  expect(first.root.querySelector('[data-zcr-pref="form"]')).toBeNull();

  const malformed = fixture(undefined, { read: vi.fn(() => Promise.resolve({ schemaVersion: 1, skills: 'nope' } as unknown as WorkspaceSettings)) });
  const second = mount(malformed.host);
  await second.ready;
  expect(second.find<HTMLElement>('[data-zcr-pref="error"]').textContent).toMatch(/could not be read/iu);
  expect(second.root.querySelector('[data-zcr-pref="form"]')).toBeNull();
});

it('stops writing after unmount so a closed Preferences window cannot race the store', async () => {
  const { host, save } = fixture();
  const { ready, find, change, pane, root } = mount(host);
  await ready;
  const scale = find<HTMLInputElement>('[data-zcr-pref="textScale"]');
  scale.value = '1.25'; change(scale);
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  pane.dispose();
  expect(root.querySelector('[data-zcr-pref="save-preferences"]')).toBeNull();
  // A late event on a detached control must not reach the store.
  scale.value = '2'; change(scale);
  await Promise.resolve();
  expect(save).toHaveBeenCalledTimes(1);
});
