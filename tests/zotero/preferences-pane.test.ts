import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../packages/contracts/src/index.ts';
import type { ReaderSkill, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { defaultAllowedModels } from '../../packages/core/src/workspace/allowed-models.ts';
import { PINNED_MODEL_CATALOG } from '../../runtime/model-capabilities.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../packages/zotero/src/workspace/preferences-pane.ts';

const copy = <T>(value: T): T => structuredClone(value);
const userSkill: ReaderSkill = { id: 'user-study', name: 'Study', description: 'Study the supplied source', version: '1.0', revision: 'revision-one', markdown: '# Study\nPreserve notation.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const blockedSkill: ReaderSkill = { ...userSkill, id: 'imported-blocked', name: 'Blocked', origin: 'imported', enabled: false, unsupportedDependencies: ['mcp'] };

function fixture(initial?: WorkspaceSettings, overrides: Partial<PreferencesPaneHost> = {}) {
  let state: WorkspaceSettings = initial ?? { ...defaultSettings(), skills: [...defaultSettings().skills, copy(userSkill), copy(blockedSkill)], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }], uiLanguage: 'en', textScale: 1 };
  // The automatic-PDF pref is plugin state, not a workspace field: the fixture keeps it beside the
  // store so a test can prove the checkbox writes the same value the reader reads.
  const pref = { automaticPdfText: true };
  const read = vi.fn(() => Promise.resolve(copy(state)));
  const save = vi.fn<PreferencesPaneHost['save']>(value => { state = copy(value); return Promise.resolve(); });
  const setSkillEnabled = vi.fn<PreferencesPaneHost['setSkillEnabled']>((id, enabled) => { state = { ...state, skills: state.skills.map(skill => (skill.id === id ? { ...skill, enabled } : skill)) }; return Promise.resolve(); });
  const exportPreferences = vi.fn<PreferencesPaneHost['exportPreferences']>(() => Promise.resolve());
  const readAutomaticPdfText = vi.fn<PreferencesPaneHost['readAutomaticPdfText']>(() => pref.automaticPdfText);
  const writeAutomaticPdfText = vi.fn<PreferencesPaneHost['writeAutomaticPdfText']>(enabled => { pref.automaticPdfText = enabled; });
  const base: PreferencesPaneHost = { read, save, setSkillEnabled, exportPreferences, profileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a', readAutomaticPdfText, writeAutomaticPdfText };
  const host: PreferencesPaneHost = { ...base, ...overrides };
  return { host, read, save, setSkillEnabled, exportPreferences, readAutomaticPdfText, writeAutomaticPdfText, pref, current: () => copy(state) };
}

/** The same fixture settings in a chosen UI language; profile and skill names stay data. */
function localized(language: 'en' | 'zh'): WorkspaceSettings {
  return { ...defaultSettings(), skills: [...defaultSettings().skills, copy(userSkill), copy(blockedSkill)], profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }], uiLanguage: language, textScale: 1 };
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
  // The UI language is already zh, so the refusal is rendered in the language the pane now shows.
  expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe('请选择 0.5 到 3 之间的聊天字号。');
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

it('owns the automatic-PDF-text opt-out in the native pane without writing the workspace store', async () => {
  const { host, save, readAutomaticPdfText, writeAutomaticPdfText, pref, current } = fixture();
  const { ready, find, change } = mount(host);
  await ready;
  const toggle = find<HTMLInputElement>('[data-zcr-pref="automatic-pdf-text"]');
  expect(toggle.checked).toBe(true);
  expect(toggle.closest('label')?.textContent).toMatch(/Use current PDF text automatically/u);
  // The checkbox writes the same pref the reader re-checks at every request boundary.
  toggle.checked = false; change(toggle);
  expect(writeAutomaticPdfText).toHaveBeenCalledWith(false);
  expect(readAutomaticPdfText()).toBe(false);
  expect(pref.automaticPdfText).toBe(false);
  // It is a pref, not workspace state: no snapshot is written and no store field changes.
  expect(save).not.toHaveBeenCalled();
  expect(current()).toMatchObject({ uiLanguage: 'en', textScale: 1 });
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/off/iu);

  toggle.checked = true; change(toggle);
  expect(readAutomaticPdfText()).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/on/iu);
});

it('keeps the automatic-PDF checkbox and the pref in agreement when the write is refused', async () => {
  const failure = new ReaderError('READER_POLICY_UNAVAILABLE', 'The preference could not be written.');
  const { host, pref } = fixture(undefined, { writeAutomaticPdfText: vi.fn<PreferencesPaneHost['writeAutomaticPdfText']>(() => { throw failure; }) });
  const { ready, find, change } = mount(host);
  await ready;
  const toggle = find<HTMLInputElement>('[data-zcr-pref="automatic-pdf-text"]');
  toggle.checked = false; change(toggle);
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe(failure.message));
  // The checkbox shows what the pref actually holds, never what the user clicked.
  expect(toggle.checked).toBe(true);
  expect(pref.automaticPdfText).toBe(true);
  expect(find<HTMLElement>('[data-zcr-pref="status"]').hidden).toBe(true);
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

it('renders the persisted model allowlist as labelled checkbox rows with exact ids', async () => {
  const { host } = fixture();
  const { ready, root, find } = mount(host);
  await ready;
  const rows = [...find('[data-zcr-pref="models"]').querySelectorAll<HTMLElement>('.zcr-preferences-model')];
  expect(rows.map(row => row.dataset.zcrModel)).toEqual(Object.keys(PINNED_MODEL_CATALOG.models));
  expect(rows).toHaveLength(11);
  const astra = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-6-astra"]');
  expect(astra.checked).toBe(true);
  expect(astra.disabled).toBe(false);
  expect(astra.closest('label')?.textContent).toBe('GPT-6 Astra');
  expect(root.querySelector('[data-zcr-model="gpt-6-astra"] .zcr-preferences-muted')?.textContent).toBe('gpt-6-astra');
  // The default allowlist is exactly GPT-6-Astra plus the GPT-5.6 family; everything else is off.
  expect([...root.querySelectorAll<HTMLInputElement>('[data-zcr-model-allowed]')].filter(input => input.checked).map(input => input.dataset.zcrModelAllowed))
    .toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  // The pane states its candidate-list source honestly rather than implying live entitlements.
  expect(find('[data-zcr-pref="models"]').closest('fieldset')?.querySelector('.zcr-preferences-muted')?.textContent).toMatch(/bundled with the pinned Codex runtime/u);
});

it('saves a changed allowlist through the workspace snapshot and refuses to empty it', async () => {
  const { host, save, current } = fixture();
  const { ready, find, change, settle } = mount(host);
  await ready;
  const toggle = (id: string, checked: boolean) => { const input = find<HTMLInputElement>(`[data-zcr-model-allowed="${id}"]`); input.checked = checked; change(input); };
  toggle('gpt-5.6-luna', false);
  await vi.waitFor(() => expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/saved/iu);
  toggle('gpt-5.6-terra', false); await settle();
  toggle('gpt-5.6-sol', false); await settle();
  expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra']);

  // Unchecking the last model is refused locally with an honest message and restores the selection:
  // no write is attempted, so the picker can never be emptied.
  const writes = save.mock.calls.length;
  toggle('gpt-6-astra', false);
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="error"]').hidden).toBe(false));
  await settle();
  expect(find<HTMLElement>('[data-zcr-pref="error"]').textContent).toBe('At least one model must stay available. The previous selection was kept.');
  expect(save.mock.calls.length).toBe(writes);
  expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra']);
  expect(find<HTMLInputElement>('[data-zcr-model-allowed="gpt-6-astra"]').checked).toBe(true);
  expect(find<HTMLElement>('[data-zcr-pref="status"]').hidden).toBe(true);
});

it('renders and preserves a stored allowed model the pinned catalog no longer lists', async () => {
  const settings = { ...defaultSettings(), allowedModels: [...defaultAllowedModels(), { id: 'gpt-retired-x', name: 'GPT Retired X' }] };
  const { host, current } = fixture(settings);
  const { ready, root, find, change, settle } = mount(host);
  await ready;
  const retired = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-retired-x"]');
  expect(retired.checked).toBe(true);
  expect(root.querySelector('[data-zcr-model="gpt-retired-x"] label')?.textContent).toBe('GPT Retired X');
  expect(root.querySelector('[data-zcr-model="gpt-retired-x"] .zcr-preferences-muted')?.textContent).toBe('gpt-retired-x');
  const sol = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.6-sol"]');
  sol.checked = false; change(sol);
  await settle();
  expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-retired-x']);
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

it('renders the pane copy in the stored UI language and never translates identifiers', async () => {
  const { host } = fixture(localized('zh'));
  const { ready, root, find } = mount(host);
  await ready;
  const label = (pref: string): string => find(`[data-zcr-pref="${pref}"]`).closest('label')?.firstChild?.textContent ?? '';
  expect([...find('[data-zcr-pref="form"]').querySelectorAll('legend')].map(node => node.textContent)).toEqual(['对话', '模型与生成设置', '研究偏好', '研究配置', '已安装的工作流']);
  expect(label('uiLanguage')).toBe('界面语言');
  expect(label('textScale')).toBe('聊天字号（0.5–3）');
  expect(label('automatic-pdf-text')).toBe('自动使用当前 PDF 文本');
  expect(label('preference-language')).toBe('回答语言');
  expect(label('preference-detail')).toBe('回答详细程度');
  expect(label('preference-mathematics')).toBe('数学解释方式');
  expect(label('preference-background')).toBe('研究背景');
  expect(label('preference-citationStyle')).toBe('引用风格');
  expect(label('preference-annotationStyle')).toBe('标注风格');
  expect(label('profile')).toBe('正在编辑的研究配置');
  expect(label('profile-name')).toBe('研究配置名称');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('保存偏好');
  expect(find<HTMLButtonElement>('[data-zcr-pref="export-preferences"]').textContent).toBe('导出偏好');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-profile"]').textContent).toBe('另存为新配置');
  expect(find<HTMLButtonElement>('[data-zcr-pref="update-profile"]').textContent).toBe('更新所选配置');
  expect(find<HTMLButtonElement>('[data-zcr-pref="delete-profile"]').textContent).toBe('删除所选配置');
  expect([...find<HTMLSelectElement>('[data-zcr-pref="preference-detail"]').options].map(option => option.textContent)).toEqual(['简短', '标准', '详细']);
  expect([...find<HTMLSelectElement>('[data-zcr-pref="preference-mathematics"]').options].map(option => option.textContent)).toEqual(['自动', '直觉优先', '形式推导']);
  // Identifiers, ids and stored values are data, not copy.
  const skillRow = (id: string): Element => find(`[data-zcr-skill-enabled="${id}"]`).closest('.zcr-preferences-skill')!;
  expect([...find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]').options].map(option => option.textContent)).toEqual(['English', '中文']);
  expect(find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]').value).toBe('zh');
  expect(find<HTMLSelectElement>('[data-zcr-pref="profile"]').value).toBe('');
  expect([...find<HTMLSelectElement>('[data-zcr-pref="profile"]').options].map(option => option.value)).toEqual(['', 'formal']);
  expect(find<HTMLSelectElement>('[data-zcr-pref="profile"]').options[1]!.textContent).toBe('Formal');
  expect(find<HTMLSelectElement>('[data-zcr-pref="profile"]').options[0]!.textContent).toBe('未选择研究配置');
  expect(root.querySelector('[data-zcr-skill="user-study"]')).not.toBeNull();
  expect(skillRow('user-study').querySelector('span')?.textContent).toBe('Study');
  expect(skillRow('user-study').querySelector('.zcr-preferences-muted')?.textContent).toBe('user · v1.0 · read');
  expect(skillRow('imported-blocked').querySelector('span')?.textContent).toBe('Blocked');
  expect(skillRow('imported-blocked').querySelector('.zcr-preferences-muted')?.textContent).toBe('imported · v1.0 · read · 不可用：mcp');
  // Model names and ids are data, not copy: the derived label and the exact id stay verbatim.
  expect(root.querySelector('[data-zcr-model="gpt-5.6-sol"] label')?.textContent).toBe('GPT-5.6 Sol');
  expect(root.querySelector('[data-zcr-model="gpt-5.6-sol"] .zcr-preferences-muted')?.textContent).toBe('gpt-5.6-sol');
});

it('follows a language change in both directions and reports the outcome in that language', async () => {
  const { host, current } = fixture(localized('en'));
  const { ready, find, change, settle } = mount(host);
  await ready;
  const label = (pref: string): string => find(`[data-zcr-pref="${pref}"]`).closest('label')?.firstChild?.textContent ?? '';
  expect(label('uiLanguage')).toBe('Interface language');
  expect(label('textScale')).toBe('Chat text scale (0.5–3)');
  expect(label('preference-background')).toBe('Research background');
  const language = find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]');
  language.value = 'zh'; change(language);
  await settle();
  expect(current().uiLanguage).toBe('zh');
  expect(label('uiLanguage')).toBe('界面语言');
  expect(label('textScale')).toBe('聊天字号（0.5–3）');
  expect(label('preference-background')).toBe('研究背景');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('保存偏好');
  // The pane announces its own write in the language it is now showing.
  expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toBe('界面语言已保存。');
  expect(find<HTMLElement>('[data-zcr-pref="error"]').hidden).toBe(true);
  // Switching back restores the English copy instead of leaving the pane half-translated.
  const scale = find<HTMLInputElement>('[data-zcr-pref="textScale"]');
  scale.value = '1.5'; change(scale);
  await settle();
  language.value = 'en'; change(language);
  await settle();
  expect(current().uiLanguage).toBe('en');
  expect(current().textScale).toBe(1.5);
  expect(label('uiLanguage')).toBe('Interface language');
  expect(label('textScale')).toBe('Chat text scale (0.5–3)');
  expect(find<HTMLInputElement>('[data-zcr-pref="textScale"]').value).toBe('1.5');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('Save preferences');
});
