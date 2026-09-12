import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { ReaderReference, ReaderSkill, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { mountWorkspaceView, type WorkspaceViewActions, type WorkspaceViewState } from '../../packages/zotero/src/chat/workspace-view.ts';

const skill: ReaderSkill = { id: 'derive', name: 'Derive', description: 'Derive the selected equation', version: '1.0', revision: 'one', markdown: '# Derive\nCheck assumptions.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const preferences: WorkspaceSettings['preferences'] = { language: 'English', detail: 'standard', mathematics: 'auto', background: '', citationStyle: '', annotationStyle: '' };
const settings: WorkspaceSettings = { schemaVersion: 1, preferences, profiles: [{ id: 'math', name: 'Mathematics', preferences: { mathematics: 'formal' } }], skills: [skill], uiLanguage: 'en', textScale: 1 };
const reference: ReaderReference = { id: 'paper-one', kind: 'article', label: 'Shared title', identity: { title: 'Shared title', authors: ['Ada'], year: '2026' }, text: 'Reference evidence', capturedAt: '2026-09-12T00:00:00Z' };

function setup(overrides: Partial<WorkspaceViewActions> = {}) {
  const document = new Window().document as unknown as Document;
  const pane = document.createElement('section'); pane.dataset.zcrSidebar = '';
  const context = document.createElement('div'); const input = document.createElement('textarea'); const leading = document.createElement('div'); const advanced = document.createElement('div');
  pane.append(context, input, leading, advanced); document.body.append(pane);
  const actions: WorkspaceViewActions = {
    searchReferences: vi.fn().mockResolvedValue([reference]), previewReference: vi.fn().mockResolvedValue(reference),
    addReference: vi.fn().mockResolvedValue(undefined), removeReference: vi.fn().mockResolvedValue(undefined), selectSkill: vi.fn().mockResolvedValue(undefined), selectProfile: vi.fn().mockResolvedValue(undefined), savePreferences: vi.fn().mockResolvedValue(undefined),
    saveSkill: vi.fn().mockResolvedValue(skill), duplicateSkill: vi.fn().mockResolvedValue({ ...skill, id: 'copy', name: 'Derive copy' }), setSkillEnabled: vi.fn().mockResolvedValue(undefined), deleteSkill: vi.fn().mockResolvedValue(undefined), importSkill: vi.fn().mockResolvedValue(skill), exportSkill: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = mountWorkspaceView({ input, context, leading, settings: advanced }, actions);
  const state: WorkspaceViewState = { settings: structuredClone(settings), draft: { references: [], skillId: null, profileId: null } };
  view.update(state);
  const type = (value: string) => { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true })); };
  const key = (key: string) => input.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const button = (label: string) => [...pane.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!;
  return { document, pane, context, input, advanced, actions, view, state, type, key, button };
}

it('searches @ objects with a type filter and adds the selected snapshot without sending', async () => {
  const { pane, input, actions, type, key, button } = setup();
  const sent = vi.fn(); input.addEventListener('keydown', event => { if (event.key === 'Enter') sent(); });
  type('Compare @Shared');
  await vi.waitFor(() => expect(pane.querySelector('[role="option"]')?.textContent).toContain('Ada · 2026'));
  button('Chats').click();
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenLastCalledWith('Shared', 'chat', expect.any(AbortSignal)));
  button('Articles').click();
  await vi.waitFor(() => expect(pane.querySelector('[role="option"]')).not.toBeNull());
  key('Enter');
  await vi.waitFor(() => expect(actions.addReference).toHaveBeenCalledWith(reference));
  expect(sent).not.toHaveBeenCalled(); expect(input.value).toBe('Compare ');
});

it('ignores stale search results and selects only supported installed workflows with slash', async () => {
  let resolveOld!: (value: ReaderReference[]) => void;
  const search = vi.fn<(query: string) => Promise<ReaderReference[]>>(query => query === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([{ ...reference, id: 'new', label: 'New source' }]));
  const { pane, type, key, actions } = setup({ searchReferences: search });
  type('@old'); type('@new');
  await vi.waitFor(() => expect(pane.querySelector('[role="option"]')?.textContent).toContain('New source'));
  resolveOld([{ ...reference, label: 'Old source' }]); await Promise.resolve();
  expect(pane.textContent).not.toContain('Old source');
  type('/der'); key('Enter');
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
  expect(actions.addReference).not.toHaveBeenCalled();
});

it('previews reference and skill chips as inert text and removes them through callbacks', async () => {
  const malicious = { ...reference, text: '<svg onload=alert(1)>Evidence</svg>' };
  const { pane, actions, view, state, button } = setup({ previewReference: vi.fn().mockResolvedValue(malicious) });
  view.update({ ...state, draft: { references: [reference], skillId: 'derive', profileId: null } });
  button('Preview Shared title').click();
  await vi.waitFor(() => expect(pane.textContent).toContain(malicious.text));
  expect(pane.querySelector('svg, script, img')).toBeNull();
  button('Remove Shared title').click(); button('Remove workflow Derive').click();
  await vi.waitFor(() => { expect(actions.removeReference).toHaveBeenCalledWith('paper-one'); expect(actions.selectSkill).toHaveBeenCalledWith(null); });
});

it('persists explicit profile and preference edits while preserving unsaved fields across updates', async () => {
  const { advanced, actions, view, state, document, button } = setup();
  const profile = advanced.querySelector<HTMLSelectElement>('[data-zcr-profile]')!;
  profile.value = 'math'; profile.dispatchEvent(new document.defaultView!.Event('change'));
  await vi.waitFor(() => expect(actions.selectProfile).toHaveBeenCalledWith('math'));
  const background = advanced.querySelector<HTMLTextAreaElement>('[name="background"]')!;
  background.value = 'I know linear algebra'; background.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true }));
  view.update({ ...state, draft: { ...state.draft, profileId: 'math' } });
  expect(background.value).toBe('I know linear algebra');
  button('Save preferences').click();
  await vi.waitFor(() => expect(actions.savePreferences).toHaveBeenCalledWith({ ...preferences, background: 'I know linear algebra' }));
});
it('creates research profiles and sets explicit chat overrides without changing global preferences', async () => {
  const saveProfile = vi.fn().mockResolvedValue({ id: 'new-profile', name: 'Control theory', preferences });
  const setOverrides = vi.fn();
  const f = setup({ saveProfile, deleteProfile: vi.fn().mockResolvedValue(undefined), setOverrides });
  const name = f.advanced.querySelector<HTMLInputElement>('[name="profile-name"]')!;
  expect(name).not.toBeNull(); name.value = 'Control theory'; f.button('Save as new profile').click();
  await vi.waitFor(() => expect(saveProfile).toHaveBeenCalledWith({ id: null, name: 'Control theory', preferences }));
  expect(f.actions.savePreferences).not.toHaveBeenCalled();
  const language = f.advanced.querySelector<HTMLInputElement>('[name="override-language"]')!; language.value = 'zh'; language.dispatchEvent(new f.document.defaultView!.Event('change'));
  expect(setOverrides).toHaveBeenCalledWith({ language: 'zh' });
});

it('creates, edits, duplicates, toggles, imports, exports, and tries skills through real handlers', async () => {
  const { pane, actions, document, button } = setup();
  button('Create workflow').click();
  const name = pane.querySelector<HTMLInputElement>('[data-zcr-skill-editor] [name="name"]')!;
  const markdown = pane.querySelector<HTMLTextAreaElement>('[data-zcr-skill-editor] [name="markdown"]')!;
  name.value = 'New derive'; markdown.value = '# New derive';
  button('Save workflow').click();
  await vi.waitFor(() => expect(actions.saveSkill).toHaveBeenCalledWith(expect.objectContaining({ id: null, name: 'New derive', markdown: '# New derive' })));
  button('Edit Derive').click();
  expect(pane.querySelector<HTMLTextAreaElement>('[data-zcr-skill-editor] [name="markdown"]')!.value).toBe(skill.markdown);
  button('Cancel editing').click(); button('Duplicate Derive').click();
  await vi.waitFor(() => expect(actions.duplicateSkill).toHaveBeenCalledWith('derive'));
  button('Cancel editing').click();
  const enabled = pane.querySelector<HTMLInputElement>('[data-zcr-skill-enabled="derive"]')!;
  enabled.checked = false; enabled.dispatchEvent(new document.defaultView!.Event('change'));
  button('Export Derive').click(); button('Import workflow').click(); button('Try Derive in draft').click();
  await vi.waitFor(() => { expect(actions.setSkillEnabled).toHaveBeenCalledWith('derive', false); expect(actions.exportSkill).toHaveBeenCalledWith('derive'); expect(actions.importSkill).toHaveBeenCalled(); expect(actions.selectSkill).toHaveBeenCalledWith('derive'); });
});

it('requires an inline delete confirmation and leaves failed saves editable', async () => {
  const { pane, actions, button } = setup({ saveSkill: vi.fn().mockRejectedValue(new Error('Revision changed')) });
  button('Delete Derive').click(); expect(actions.deleteSkill).not.toHaveBeenCalled();
  button('Confirm delete Derive').click();
  await vi.waitFor(() => expect(actions.deleteSkill).toHaveBeenCalledWith('derive'));
  button('Edit Derive').click(); button('Save workflow').click();
  await vi.waitFor(() => expect(pane.textContent).toContain('Revision changed'));
  expect(pane.querySelector('[data-zcr-skill-editor]')).not.toBeNull();
});

it('restores profile and enabled controls when persistence rejects the change', async () => {
  const { advanced, pane, document } = setup({ selectProfile: vi.fn().mockRejectedValue(new Error('Profile unavailable')), setSkillEnabled: vi.fn().mockRejectedValue(new Error('Save failed')) });
  const profile = advanced.querySelector<HTMLSelectElement>('[data-zcr-profile]')!;
  profile.value = 'math'; profile.dispatchEvent(new document.defaultView!.Event('change'));
  await vi.waitFor(() => expect(pane.textContent).toContain('Profile unavailable'));
  expect(profile.value).toBe('');
  const enabled = pane.querySelector<HTMLInputElement>('[data-zcr-skill-enabled="derive"]')!;
  enabled.checked = false; enabled.dispatchEvent(new document.defaultView!.Event('change'));
  await vi.waitFor(() => expect(pane.textContent).toContain('Save failed'));
  expect(enabled.checked).toBe(true);
});

it('leaves a newer query and its open menu intact when an earlier selection finishes', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { input, pane, type, key } = setup({ addReference: () => pending });
  type('@Shared'); await vi.waitFor(() => expect(pane.querySelector('[role="option"]')).not.toBeNull());
  key('Enter'); type('@next');
  await vi.waitFor(() => expect(pane.querySelector('[role="option"]')).not.toBeNull());
  release(); await pending; await Promise.resolve(); await Promise.resolve();
  expect(input.value).toBe('@next');
  expect(pane.querySelector<HTMLElement>('.zcr-command-menu')!.hidden).toBe(false);
});

it('keeps preview controls and focus stable as asynchronous source text arrives', async () => {
  const { pane, view, state, document, button } = setup();
  view.update({ ...state, draft: { ...state.draft, references: [reference] } });
  button('Preview Shared title').click();
  const close = button('Close preview'); close.focus();
  await vi.waitFor(() => expect(pane.textContent).toContain('Reference evidence'));
  expect(button('Close preview')).toBe(close);
  expect(document.activeElement).toBe(close);
});

it('does not select a disabled or unsupported installed workflow', () => {
  const { view, state, type, key, actions } = setup();
  view.update({ ...state, settings: { ...state.settings, skills: [{ ...skill, enabled: false }] } });
  type('/Derive'); key('Enter'); expect(actions.selectSkill).not.toHaveBeenCalled();
  view.update({ ...state, settings: { ...state.settings, skills: [{ ...skill, unsupportedDependencies: ['Unapproved executable'] }] } });
  type('/Derive'); key('Enter'); expect(actions.selectSkill).not.toHaveBeenCalled();
});

it('supports explicit @chat and /skill entrypoints in the same composer', async () => {
  const { type, key, actions } = setup();
  type('@chat recent');
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenLastCalledWith('recent', 'chat', expect.any(AbortSignal)));
  type('/skill Der'); key('Enter');
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
});
