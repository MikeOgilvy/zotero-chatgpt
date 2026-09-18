import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { ReaderReference, ReaderSkill, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import { mountWorkspaceView, type WorkspaceViewActions, type WorkspaceViewState } from '../../../packages/zotero/src/chat/workspace-view.ts';

const skill: ReaderSkill = { id: 'derive', name: 'Derive', description: 'Derive the selected equation', version: '1.0', revision: 'one', markdown: '# Derive\nCheck assumptions.', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const preferences: WorkspaceSettings['preferences'] = { language: 'English', detail: 'standard', mathematics: 'auto', background: '', citationStyle: '', annotationStyle: '' };
const settings: WorkspaceSettings = { schemaVersion: 1, preferences, profiles: [{ id: 'math', name: 'Mathematics', preferences: { mathematics: 'formal' } }], skills: [skill], uiLanguage: 'en', textScale: 1 };
const reference: ReaderReference = { id: 'paper-one', kind: 'article', label: 'Shared title', identity: { title: 'Shared title', authors: ['Ada'], year: '2026' }, text: 'Reference evidence', capturedAt: '2026-09-12T00:00:00Z' };

function setup(overrides: Partial<WorkspaceViewActions> = {}) {
  const document = new Window().document as unknown as Document;
  const pane = document.createElement('section'); pane.dataset.zchatgptSidebar = '';
  const context = document.createElement('div'); const input = document.createElement('textarea'); const leading = document.createElement('div');
  pane.append(context, input, leading); document.body.append(pane);
  const actions: WorkspaceViewActions = {
    searchReferences: vi.fn().mockResolvedValue([reference]), previewReference: vi.fn().mockResolvedValue(reference),
    addReference: vi.fn().mockResolvedValue(undefined), removeReference: vi.fn().mockResolvedValue(undefined), selectSkill: vi.fn().mockResolvedValue(undefined), selectProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = mountWorkspaceView({ input, context, leading }, actions);
  const state: WorkspaceViewState = { settings: structuredClone(settings), draft: { references: [], skillId: null, profileId: null } };
  view.update(state);
  const type = (value: string) => { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true })); };
  const key = (key: string) => input.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const button = (label: string) => [...pane.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!;
  return { document, pane, context, input, leading, actions, view, state, type, key, button };
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
  button('Remove Shared title').click(); button('Remove skill Derive').click();
  await vi.waitFor(() => { expect(actions.removeReference).toHaveBeenCalledWith('paper-one'); expect(actions.selectSkill).toHaveBeenCalledWith(null); });
});

it('renders no per-chat research-profile control in the composer and points at the native Preferences window', () => {
  const { context, actions, pane } = setup();
  // The profile select, its visible "Profile" label and its scope row are gone from the composer.
  expect(context.querySelector('[data-zchatgpt-profile]')).toBeNull();
  expect(context.querySelector('[data-zchatgpt-chat-scope]')).toBeNull();
  expect(context.querySelector('.zchatgpt-chat-profile-label')).toBeNull();
  expect(pane.textContent).not.toContain('Global preferences');
  expect(actions.selectProfile).not.toHaveBeenCalled();
  // The global controls live in Zotero's own Preferences window, not the sidebar; the old
  // in-pane hint at that window was redundant and is gone with the container it lived in.
  expect(pane.querySelector('[name="background"]')).toBeNull();
  expect(pane.querySelector('[name="profile-name"]')).toBeNull();
  expect(pane.querySelector('[data-zchatgpt-global-hint]')).toBeNull();
  expect(pane.textContent).not.toMatch(/Zotero's Preferences window/u);
});

it('keeps the / workflow chooser and its installed-skill heading after the profile control is removed', async () => {
  const { pane, context, type, key, actions } = setup();
  expect(context.querySelector('[data-zchatgpt-profile]')).toBeNull();
  type('/Der');
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  expect(menu.hidden).toBe(false);
    expect(menu.textContent).toContain('Installed skills');
  key('Enter');
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
});

it('no longer offers any per-chat override controls in the sidebar', () => {
  const { pane } = setup();
  for (const name of ['override-language', 'override-detail', 'override-mathematics']) expect(pane.querySelector(`[name="${name}"]`)).toBeNull();
  expect(pane.textContent).not.toMatch(/Chat overrides|Answer language for this chat|Clear chat overrides/u);
});

it('offers no skill authoring, import or export in the sidebar', () => {
  const { pane } = setup();
  for (const label of ['Create skill', 'Import skill', 'Save skill', 'Cancel editing', 'Duplicate', 'Export', 'Try in draft', 'Edit', 'Delete']) {
    expect(pane.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`), label).toBeNull();
  }
  expect(pane.querySelector('[data-zchatgpt-skill-id]')).toBeNull();
  expect(pane.querySelector('[data-zchatgpt-skill-editor]')).toBeNull();
  expect(pane.textContent).not.toMatch(/Installed skills|SKILL\.md content|No skills installed/u);
  expect(pane.querySelector('[name="workflow"]')).toBeNull();
});

it('offers no global preference, research-profile or workflow-availability control in the sidebar', () => {
  const { pane, button } = setup();
  // Two changes meet here: the More menu is gone, so there is no export control, and the settings
  // mount that used to hold a global language override is gone too, so the pane itself is searched.
  for (const label of ['Save preferences', 'Save as new profile', 'Update selected profile', 'Delete selected profile']) expect(button(label), label).toBeUndefined();
  expect(pane.querySelector('[name="language"]')).toBeNull();
  expect(pane.querySelector('[data-zchatgpt-skill-enabled="derive"]')).toBeNull();
  // Workflow availability is a native Preferences checkbox; the sidebar only selects one for the chat.
  expect(pane.querySelector('[data-zchatgpt-skill-id="derive"]')).toBeNull();
  expect(pane.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeNull();
});

it('reports a refused removal beside the composer controls instead of inside More', async () => {
  const { context, pane, view, state, button } = setup({ removeReference: vi.fn().mockRejectedValue(new Error('Reference unavailable')) });
  view.update({ ...state, draft: { ...state.draft, references: [reference] } });
  button('Remove Shared title').click();
  await vi.waitFor(() => expect(pane.textContent).toContain('Reference unavailable'));
  const status = pane.querySelector<HTMLElement>('.zchatgpt-workspace-status')!;
  expect(context.contains(status)).toBe(true);
  expect(pane.querySelector('.zchatgpt-workspace-settings')).toBeNull();
});


it('loads a chat with a legacy persisted per-chat profile value without a profile control or error', () => {
  const { context, pane, view, state } = setup();
  expect(() => view.update({ ...state, draft: { ...state.draft, profileId: 'math' } })).not.toThrow();
  // The legacy value stays in the draft (the presenter still applies it) but exposes no UI here.
  expect(context.querySelector('[data-zchatgpt-profile]')).toBeNull();
  expect(context.querySelector('[data-zchatgpt-chat-scope]')).toBeNull();
  expect(pane.querySelector('[data-zchatgpt-workspace-chips]')?.children).toHaveLength(0);
  expect(pane.textContent).not.toContain('Mathematics');
  // The status slot that reports refusals from the remaining scoped controls still exists.
  expect(context.contains(pane.querySelector<HTMLElement>('.zchatgpt-workspace-status'))).toBe(true);
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
  expect(pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!.hidden).toBe(false);
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

it('opens the skill chooser from the composer shortcut as well as the slash trigger', async () => {
  const { pane, input, view, actions } = setup();
  view.openSkills();
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  expect(menu.hidden).toBe(false);
  // The shortcut lands on the '/'-scope: a skill chooser, never a reference search.
  expect(menu.dataset.zchatgptCommandKind).toBe('commands');
  expect(menu.querySelector('.zchatgpt-command-heading')?.textContent).toBe('Installed skills');
  expect([...menu.querySelectorAll('[role="option"]')].map(node => node.textContent).join(' ')).toContain('/Derive');
  expect(actions.searchReferences).not.toHaveBeenCalled();
  // Like the reference shortcut it only picks a scope: the draft and the caret are untouched.
  expect(input.value).toBe('');
  expect(input.ownerDocument.activeElement).toBe(input);
  // And choosing from it runs that skill for this chat.
  input.dispatchEvent(new input.ownerDocument.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
});

it('supports explicit @chat and /skill entrypoints in the same composer', async () => {
  const { type, key, actions } = setup();
  type('@chat recent');
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenLastCalledWith('recent', 'chat', expect.any(AbortSignal)));
  type('/skill Der'); key('Enter');
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
});

it('opens the reference chooser from the composer plus shortcut without a visible @ button', async () => {
  const { pane, input, leading, actions, view } = setup();
  // The composer's single plus button is the only attachment/context trigger; no '@' control is mounted here.
  expect([...leading.querySelectorAll('button')]).toHaveLength(0);
  expect([...pane.querySelectorAll('button')].some(node => node.textContent?.trim() === '@')).toBe(false);
  view.openCommands();
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenCalledWith('', 'all', expect.any(AbortSignal)));
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  expect(menu.hidden).toBe(false);
  expect(menu.textContent).toContain('References');
  // The chooser carries its own search field, so opening it from the popover puts the caret where
  // the query is typed instead of showing an empty query as though the library had no matches.
  const search = pane.querySelector<HTMLInputElement>('.zchatgpt-workspace-search')!;
  expect(search.hidden).toBe(false);
  expect(search.type).toBe('search');
  expect(input.ownerDocument.activeElement).toBe(search);
  // The shortcut never rewrites the draft: it only chooses the search scope.
  expect(input.value).toBe('');
});

it('settles the chooser on empty results, an honest failure or a late abandoned answer', async () => {
  const searches: Array<{ resolve: (value: ReaderReference[]) => void; reject: (error: unknown) => void }> = [];
  const search = vi.fn(() => new Promise<ReaderReference[]>((resolve, reject) => { searches.push({ resolve, reject }); }));
  const { pane, view, input, key } = setup({ searchReferences: search });
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;

  // An empty query asks for a query instead of claiming the library holds no matches.
  view.openCommands();
  expect(menu.textContent).toContain('Searching…');
  searches[0]!.resolve([]);
  await vi.waitFor(() => expect(menu.textContent).toContain('Type a title, author or year to search.'));
  expect(menu.textContent).not.toContain('Searching…');

  // A refused host search is reported verbatim instead of leaving the spinner running.
  view.openCommands();
  expect(menu.textContent).toContain('Searching…');
  searches[1]!.reject(new Error('Library unavailable'));
  await vi.waitFor(() => expect(menu.textContent).toContain('Library unavailable'));
  expect(menu.textContent).not.toContain('Searching…');

  // Escape closes while a request is unanswered; the reopened chooser owns its own newest request.
  view.openCommands();
  key('Escape');
  expect(menu.hidden).toBe(true);
  expect(menu.textContent).toContain('Searching…');
  view.openCommands(); input.focus();
  expect(menu.hidden).toBe(false);
  searches[2]!.resolve([]); await Promise.resolve(); await Promise.resolve();
  expect(menu.textContent).not.toContain('No matches');
  searches[3]!.resolve([reference]);
  await vi.waitFor(() => expect(menu.textContent).toContain('Shared title'));
});

it('keeps the reopened chooser on its own request when an abandoned search settles late', async () => {
  const searches: Array<(value: ReaderReference[]) => void> = [];
  const { pane, view, input, key } = setup({ searchReferences: vi.fn(() => new Promise<ReaderReference[]>(resolve => { searches.push(resolve); })) });
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  view.openCommands();
  key('Escape');
  expect(menu.hidden).toBe(true);
  view.openCommands(); input.focus();
  // The abandoned request settles after the reopen: its result must not reach the new chooser.
  searches[0]!([{ ...reference, label: 'Abandoned source' }]);
  await Promise.resolve(); await Promise.resolve();
  expect(menu.textContent).not.toContain('Abandoned source');
  searches[1]!([reference]);
  await vi.waitFor(() => expect(menu.textContent).toContain('Shared title'));
});

it('searches from the chooser field itself and never lets it fight the composer', async () => {
  const { document, pane, input, actions, type, view } = setup();
  const menu = pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  const search = pane.querySelector<HTMLInputElement>('.zchatgpt-workspace-search')!;
  const searchType = (value: string) => { search.value = value; search.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true })); };
  const searchKey = (value: string) => search.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));

  // The field is the chooser's own query, and the caret stays in it for as long as it is used.
  view.openCommands();
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenCalledWith('', 'all', expect.any(AbortSignal)));
  expect(document.activeElement).toBe(search);
  searchType('Shared');
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenLastCalledWith('Shared', 'all', expect.any(AbortSignal)));
  await vi.waitFor(() => expect(menu.querySelector('[role="option"]')?.textContent).toContain('Shared title'));
  expect(document.activeElement).toBe(search);

  // Enter in the field chooses the active result, and the chooser still never rewrites the draft.
  searchKey('Enter');
  await vi.waitFor(() => expect(actions.addReference).toHaveBeenCalledWith(reference));
  expect(input.value).toBe('');

  // A query that matched nothing keeps the reference chooser's own empty state, unchanged.
  const empty = setup({ searchReferences: vi.fn().mockResolvedValue([]) });
  const emptyMenu = empty.pane.querySelector<HTMLElement>('.zchatgpt-command-menu')!;
  const emptySearch = empty.pane.querySelector<HTMLInputElement>('.zchatgpt-workspace-search')!;
  empty.view.openCommands();
  emptySearch.value = 'nothing';
  emptySearch.dispatchEvent(new empty.document.defaultView!.Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(emptyMenu.textContent).toContain('No matches'));

  // Typing '@' in the composer still owns the caret: the field mirrors the query rather than taking it.
  // The query differs from the one typed above, so this fails if the field is not actually mirrored.
  type('Compare @Ada');
  await vi.waitFor(() => expect(actions.searchReferences).toHaveBeenLastCalledWith('Ada', 'all', expect.any(AbortSignal)));
  await vi.waitFor(() => expect(search.value).toBe('Ada'));
  expect(document.activeElement).toBe(input);

  // The skills scope keeps the field hidden: that query belongs to the '/'-menu, not to this one.
  view.openSkills();
  expect(search.hidden).toBe(true);
});
