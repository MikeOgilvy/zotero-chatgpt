import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../packages/contracts/src/index.ts';
import type { ReaderSkill, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { defaultAllowedModels } from '../../packages/core/src/workspace/allowed-models.ts';
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
  const readAutomaticPdfText = vi.fn<PreferencesPaneHost['readAutomaticPdfText']>(() => pref.automaticPdfText);
  const writeAutomaticPdfText = vi.fn<PreferencesPaneHost['writeAutomaticPdfText']>(enabled => { pref.automaticPdfText = enabled; });
  const base: PreferencesPaneHost = { read, save, setSkillEnabled, readAutomaticPdfText, writeAutomaticPdfText };
  const host: PreferencesPaneHost = { ...base, ...overrides };
  return { host, read, save, setSkillEnabled, readAutomaticPdfText, writeAutomaticPdfText, pref, current: () => copy(state) };
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
  // One instructions box, carried by the existing free-text `background` field; the five other
  // preference fields are no longer editable here.
  expect(find<HTMLTextAreaElement>('[data-zcr-pref="preference-background"]').value).toBe('');
  expect(root.querySelector('[data-zcr-pref="preference-language"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="preference-detail"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="preference-mathematics"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="preference-citationStyle"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="preference-annotationStyle"]')).toBeNull();
  // The Research profiles block is gone from the surface, not from the store.
  expect(root.querySelector('[data-zcr-pref="profile"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="profile-name"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="save-profile"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="update-profile"]')).toBeNull();
  expect(root.querySelector('[data-zcr-pref="delete-profile"]')).toBeNull();
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="user-study"]').checked).toBe(true);
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="imported-blocked"]').checked).toBe(false);
  expect(find<HTMLInputElement>('[data-zcr-skill-enabled="imported-blocked"]').disabled).toBe(true);
  // Every control is associated with a label so it is reachable by name.
  for (const control of find('[data-zcr-pref="form"]').querySelectorAll('input, select, textarea')) {
    expect(control.closest('label'), control.getAttribute('data-zcr-pref') ?? control.tagName).not.toBeNull();
  }
  // The pane no longer offers a preferences export at all: no control, and no button that would ask
  // for one. The `exportText` host port is gone from the pane's own interface too.
  expect(root.querySelector('[data-zcr-pref="export-preferences"]')).toBeNull();
  expect([...root.querySelectorAll<HTMLButtonElement>('button')].some(button => /export/iu.test(button.textContent ?? ''))).toBe(false);
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

it('saves the single instructions box and carries the five no-longer-editable fields through unchanged', async () => {
  const { host, save, current } = fixture();
  const { ready, find, settle } = mount(host);
  await ready;
  const stored = current();
  const instructions = find<HTMLTextAreaElement>('[data-zcr-pref="preference-background"]');
  instructions.value = 'I know linear algebra; prefer SI units.';
  find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await settle();
  // Only the editable instructions change; the other five fields are written back from the record.
  expect(current().preferences).toEqual({ ...stored.preferences, background: 'I know linear algebra; prefer SI units.' });
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-pref="status"]').textContent).toMatch(/saved/iu));
  expect(find<HTMLElement>('[data-zcr-pref="status"]').hidden).toBe(false);
});

it('leaves stored research profiles readable on disk without rendering or touching them', async () => {
  // Profiles are data: the block is gone, but the record and the shipped export must keep them.
  const stored: WorkspaceSettings = { ...defaultSettings(), profiles: [{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }] };
  const { host, current } = fixture(stored);
  const { ready, find } = mount(host);
  await ready;
  expect(find('[data-zcr-pref="form"]').querySelector('[data-zcr-pref="profile"]')).toBeNull();
  find<HTMLTextAreaElement>('[data-zcr-pref="preference-background"]').value = 'New instructions';
  find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').click();
  await vi.waitFor(() => expect(current().preferences.background).toBe('New instructions'));
  // Not pruned, not migrated, not rewritten: the same profile survives a pane save byte for byte.
  expect(current().profiles).toEqual([{ id: 'formal', name: 'Formal', preferences: { mathematics: 'formal' } }]);
});

it('renders only the annotate builtin while the other definitions stay installed and enabled', async () => {
  const { host, current, save } = fixture();
  const { ready, root, find } = mount(host);
  await ready;
  const rendered = [...find('[data-zcr-pref="skills"]').querySelectorAll<HTMLElement>('.zcr-preferences-skill')].map(row => row.dataset.zcrSkill);
  // The owner's own workflows still list; only the builtin set is withdrawn to annotate.
  expect(rendered).toEqual(['builtin-annotate', 'user-study', 'imported-blocked']);
  for (const withdrawn of ['read', 'derive', 'compare', 'acquire', 'diagram']) {
    expect(root.querySelector(`[data-zcr-skill="builtin-${withdrawn}"]`), withdrawn).toBeNull();
  }

  // The definition is withdrawn from the list, not from the record: a pane save keeps all six
  // builtins, so the default path and every persisted `read` selection keep resolving.
  find<HTMLTextAreaElement>('[data-zcr-pref="preference-background"]').value = 'Keep read installed';
  find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(current().preferences.background).toBe('Keep read installed'));
  expect(current().skills.filter(skill => skill.origin === 'builtin').map(skill => skill.id))
    .toEqual(['builtin-read', 'builtin-derive', 'builtin-compare', 'builtin-annotate', 'builtin-acquire', 'builtin-diagram']);
  // Withdrawing a row never disables the definition behind it.
  expect(current().skills.filter(skill => skill.origin === 'builtin').every(skill => skill.enabled)).toBe(true);
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

it('renders only the offerable model families as labelled checkbox rows with exact ids', async () => {
  const { host } = fixture();
  const { ready, root, find } = mount(host);
  await ready;
  const rows = [...find('[data-zcr-pref="models"]').querySelectorAll<HTMLElement>('.zcr-preferences-model')];
  expect(rows.map(row => row.dataset.zcrModel)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  expect(rows).toHaveLength(4);
  const astra = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-6-astra"]');
  expect(astra.checked).toBe(true);
  expect(astra.disabled).toBe(false);
  expect(astra.closest('label')?.textContent).toBe('GPT-6 Astra');
  expect(root.querySelector('[data-zcr-model="gpt-6-astra"] .zcr-preferences-muted')?.textContent).toBe('gpt-6-astra');
  // Every rendered option keeps its exact id visible, because that id is what gets sent.
  for (const row of rows) {
    const id = row.querySelector('.zcr-preferences-muted')?.textContent;
    expect(id).toBe(row.dataset.zcrModel);
    expect(id).not.toBe('');
  }
  // The excluded families stay in the bundled catalog but are not offered here.
  for (const excluded of ['gpt-daybreak-blue-latest', 'gpt-5.5', 'gpt-5.4', 'gpt-5.2', 'codex-auto-review']) {
    expect(root.querySelector(`[data-zcr-model="${excluded}"]`), excluded).toBeNull();
  }
  // The default allowlist is exactly GPT-6-Astra plus the GPT-5.6 family; everything else is off.
  expect([...root.querySelectorAll<HTMLInputElement>('[data-zcr-model-allowed]')].filter(input => input.checked).map(input => input.dataset.zcrModelAllowed))
    .toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  // The pane states its candidate-list source honestly rather than implying live entitlements.
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/bundled catalog, not your account/u);
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

it('offers a runtime-reported GPT-5.3 Spark model and persists the owner\'s choice', async () => {
  // The runtime reports the Spark family plus models the pane must not offer; only the Spark id joins.
  const live = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark', 'gpt-5.5', 'codex-auto-review'];
  const { host, current } = fixture(undefined, { readLiveModels: () => Promise.resolve(live) });
  const { ready, root, find, change, settle } = mount(host);
  await ready;
  const spark = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.3-codex-spark"]');
  expect(spark.checked).toBe(false);
  expect(root.querySelector('[data-zcr-model="gpt-5.3-codex-spark"] .zcr-preferences-muted')?.textContent).toBe('gpt-5.3-codex-spark');
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
  expect(root.querySelector('[data-zcr-model="codex-auto-review"]')).toBeNull();
  spark.checked = true; change(spark);
  await settle();
  expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark']);
});

it('keeps a saved Spark selection visible and checked without a live list', async () => {
  const settings = { ...defaultSettings(), allowedModels: [...defaultAllowedModels(), { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' }] };
  const { host } = fixture(settings);
  const { ready, root, find } = mount(host);
  await ready;
  const spark = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.3-codex-spark"]');
  expect(spark.checked).toBe(true);
  // The exact id the owner saved stays on screen even though no live list reported it this time.
  expect(root.querySelector('[data-zcr-model="gpt-5.3-codex-spark"] .zcr-preferences-muted')?.textContent).toBe('gpt-5.3-codex-spark');
});

it('never offers an excluded model from a stale allowlist, and never silently drops the stored id', async () => {
  const settings = { ...defaultSettings(), allowedModels: [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-5.5', name: 'GPT-5.5' }] };
  const { host, current } = fixture(settings);
  const { ready, root, find, change, settle } = mount(host);
  await ready;
  // The excluded family gets no row, so it can never be checked, offered or re-selected here.
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
  expect(find<HTMLInputElement>('[data-zcr-model-allowed="gpt-6-astra"]').checked).toBe(true);
  const sol = find<HTMLInputElement>('[data-zcr-model-allowed="gpt-5.6-sol"]');
  sol.checked = true; change(sol);
  await settle();
  // The offerable selection is saved. The stored id the pane can no longer offer stays in the record
  // instead of being silently dropped, and it is still not a row.
  expect(current().allowedModels?.map(model => model.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5']);
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
});

it('tells the truth about where the Spark models come from when no live list exists', async () => {
  // No host method at all: the bundled catalog is all the pane knows, and it says so.
  const absent = fixture();
  const first = mount(absent.host);
  await first.ready;
  const note = first.find('[data-zcr-pref="models-note"]').textContent ?? '';
  expect(note).toMatch(/bundled catalog, not your account's live entitlements/u);
  expect(note).toMatch(/GPT-5\.3-Spark models come from the running runtime/u);
  expect(note).toMatch(/appear only after it reports them/u);
  expect(first.root.querySelector('[data-zcr-model^="gpt-5.3"]')).toBeNull();

  // The host has the port but no running runtime: the same honest copy, never an invented row.
  const reported = fixture(undefined, { readLiveModels: () => Promise.resolve(null) });
  const second = mount(reported.host);
  await second.ready;
  expect(second.find('[data-zcr-pref="models-note"]').textContent).toBe(note);
  expect(second.root.querySelector('[data-zcr-model^="gpt-5.3"]')).toBeNull();
});

it('explains the live list when the running runtime reports models', async () => {
  const { host } = fixture(undefined, { readLiveModels: () => Promise.resolve(['gpt-6-astra', 'gpt-5.3-codex-spark']) });
  const { ready, find } = mount(host);
  await ready;
  const note = find('[data-zcr-pref="models-note"]').textContent ?? '';
  expect(note).toMatch(/running runtime reported/u);
  // The bundled-catalog disclaimer would be false here, so it is not shown.
  expect(note).not.toMatch(/bundled catalog, not your account/u);
});

it('keeps the bundled copy when the runtime reports models none of which are offerable', async () => {
  // The runtime is running and reported models, but only excluded families: no row joins from it, so
  // the "this combines what the runtime reported" sentence would be false and is not shown.
  const { host } = fixture(undefined, { readLiveModels: () => Promise.resolve(['gpt-5.5', 'gpt-5.4', 'codex-auto-review']) });
  const { ready, root, find } = mount(host);
  await ready;
  expect(root.querySelector('[data-zcr-model="gpt-5.5"]')).toBeNull();
  expect(find<HTMLInputElement>('[data-zcr-model-allowed="gpt-6-astra"]').checked).toBe(true);
  const note = find('[data-zcr-pref="models-note"]').textContent ?? '';
  expect(note).toMatch(/bundled catalog, not your account/u);
  expect(note).not.toMatch(/running Codex runtime reported/u);
});

it('keeps the bundled catalog list when the live read fails instead of half-rendering', async () => {
  const { host } = fixture(undefined, { readLiveModels: () => Promise.reject(new Error('The runtime is unavailable.')) });
  const { ready, root, find } = mount(host);
  await ready;
  expect([...find('[data-zcr-pref="models"]').querySelectorAll<HTMLElement>('.zcr-preferences-model')].map(row => row.dataset.zcrModel))
    .toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/bundled catalog, not your account/u);
  expect(root.querySelector<HTMLElement>('[data-zcr-pref="error"]')?.hidden).toBe(true);
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
  expect([...find('[data-zcr-pref="form"]').querySelectorAll('legend')].map(node => node.textContent)).toEqual(['外观', 'PDF 文本', '模型', 'Codex 指令', '已安装的工作流']);
  // The model note is stateful copy and follows the stored language like the rest of the pane.
  expect(find('[data-zcr-pref="models-note"]').textContent).toMatch(/随包目录/u);
  expect(label('uiLanguage')).toBe('界面语言');
  expect(label('textScale')).toBe('聊天字号（0.5–3）');
  expect(label('automatic-pdf-text')).toBe('自动使用当前 PDF 文本');
  expect(label('preference-background')).toBe('指令');
  // The withdrawn builtin rows are simply absent; the owner's own workflows still render.
  expect(root.querySelector('[data-zcr-skill="builtin-read"]')).toBeNull();
  expect(root.querySelector('[data-zcr-skill="builtin-derive"]')).toBeNull();
  expect(root.querySelector('[data-zcr-skill="builtin-annotate"]')).not.toBeNull();
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('保存');
  // Identifiers, ids and stored values are data, not copy.
  const skillRow = (id: string): Element => find(`[data-zcr-skill-enabled="${id}"]`).closest('.zcr-preferences-skill')!;
  expect([...find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]').options].map(option => option.textContent)).toEqual(['English', '中文']);
  expect(find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]').value).toBe('zh');
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
  expect(label('preference-background')).toBe('Instructions');
  const language = find<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]');
  language.value = 'zh'; change(language);
  await settle();
  expect(current().uiLanguage).toBe('zh');
  expect(label('uiLanguage')).toBe('界面语言');
  expect(label('textScale')).toBe('聊天字号（0.5–3）');
  expect(label('preference-background')).toBe('指令');
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('保存');
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
  expect(find<HTMLButtonElement>('[data-zcr-pref="save-preferences"]').textContent).toBe('Save');
});
