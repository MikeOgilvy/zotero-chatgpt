import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { ReaderReference, ReaderSkill, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import { mountWorkspaceView, type WorkspaceViewActions, type WorkspaceViewState } from '../../../packages/zotero/src/chat/workspace-view.ts';

const skill: ReaderSkill = { id: 'derive', name: 'Derive', description: 'Derive the selected equation', version: '1.0', revision: 'one', markdown: '# Derive', origin: 'user', enabled: true, workflow: 'read', permissions: [], unsupportedDependencies: [] };
const preferences: WorkspaceSettings['preferences'] = { language: 'English', detail: 'standard', mathematics: 'auto', background: '', citationStyle: '', annotationStyle: '' };
const settings: WorkspaceSettings = { schemaVersion: 1, preferences, profiles: [], skills: [skill], uiLanguage: 'en', textScale: 1 };
const reference: ReaderReference = { id: 'paper-one', kind: 'article', label: 'Shared title', identity: { title: 'Shared title', authors: ['Ada'], year: '2026' }, text: 'Reference evidence', capturedAt: '2026-09-12T00:00:00Z' };

/**
 * The composer's two triggers are separate affordances: '@' mentions context (articles and
 * unarchived chats), '/' runs an installed workflow for this chat. These tests pin that they
 * cannot reach each other's candidates, filters or empty states.
 */
function setup(overrides: Partial<WorkspaceViewActions> = {}) {
  const document = new Window().document as unknown as Document;
  const pane = document.createElement('section'); pane.dataset.zcrSidebar = '';
  const context = document.createElement('div'); const input = document.createElement('textarea'); const leading = document.createElement('div');
  pane.append(context, input, leading); document.body.append(pane);
  const actions: WorkspaceViewActions = {
    searchReferences: vi.fn().mockResolvedValue([reference]), previewReference: vi.fn().mockResolvedValue(reference),
    addReference: vi.fn().mockResolvedValue(undefined), removeReference: vi.fn().mockResolvedValue(undefined),
    selectSkill: vi.fn().mockResolvedValue(undefined), selectProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = mountWorkspaceView({ input, context, leading }, actions);
  const state: WorkspaceViewState = { settings: structuredClone(settings), draft: { references: [], skillId: null, profileId: null } };
  view.update(state);
  const type = (value: string) => { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new document.defaultView!.Event('input', { bubbles: true })); };
  const key = (name: string) => input.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  const menu = () => pane.querySelector<HTMLElement>('.zcr-command-menu')!;
  const toolbar = () => menu().querySelector<HTMLElement>('.zcr-command-toolbar')!;
  const status = () => menu().querySelector<HTMLElement>('.zcr-command-status')!;
  const options = () => [...menu().querySelectorAll<HTMLElement>('[role="option"]')].map(node => node.textContent ?? '');
  const filterButton = (label: string) => toolbar().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { document, pane, context, input, leading, actions, view, state, type, key, menu, toolbar, status, options, filterButton };
}

it('keeps @ on context references so it cannot reach or filter workflows', async () => {
  const { type, menu, options, filterButton } = setup();
  type('@');
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
  expect(menu().querySelector('.zcr-command-heading')!.textContent).toBe('References');
  expect(menu().dataset.zcrCommandKind).toBe('references');
  expect(options().join(' ')).toContain('Shared title');
  expect(options().join(' ')).not.toContain('/Derive');
  expect(filterButton('All')).not.toBeNull();
  expect(filterButton('Articles')).not.toBeNull();
  expect(filterButton('Chats')).not.toBeNull();
  expect(filterButton('Workflows')).toBeNull();
});

it('keeps / on installed workflows so it can neither list nor filter context references', async () => {
  const { type, menu, toolbar, options, filterButton } = setup();
  type('/');
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
  expect(menu().querySelector('.zcr-command-heading')!.textContent).toBe('Installed skills');
  expect(menu().dataset.zcrCommandKind).toBe('commands');
  expect(options().join(' ')).toContain('/Derive');
  expect(options().join(' ')).not.toContain('Shared title');
  // A workflow chooser has no reference-type axis: its filter row is not usable.
  expect(toolbar().style.display).toBe('none');
  expect(filterButton('Workflows')).toBeNull();
});

it('shows an honest workflow empty state for / without inventing candidates', () => {
  const { type, status, options } = setup();
  type('/nope');
  expect(options()).toHaveLength(0);
  expect(status().hidden).toBe(false);
  expect(status().textContent).toBe('No matching skills');
});

it('states that no skills are installed when the workspace has none', () => {
  const { view, state, type, status, options } = setup();
  view.update({ ...state, settings: { ...state.settings, skills: [] } });
  type('/');
  expect(options()).toHaveLength(0);
  expect(status().textContent).toBe('No skills installed.');
});

it('keeps the reference empty state distinct from the workflow one', async () => {
  const { type, status } = setup({ searchReferences: vi.fn().mockResolvedValue([]) });
  type('@nope');
  await vi.waitFor(() => expect(status().textContent).toBe('No matches'));
  expect(status().textContent).not.toBe('No skills installed.');
  expect(status().textContent).not.toBe('No matching skills');
});

it('routes each trigger to its own action and never the other', async () => {
  const { input, type, key, actions, options } = setup();
  type('@Shared');
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
  key('Enter');
  await vi.waitFor(() => expect(actions.addReference).toHaveBeenCalledWith(reference));
  // Let the '@' choice finish so its pending-guard cannot swallow the next Enter.
  await vi.waitFor(() => expect(input.value).toBe(''));
  expect(actions.selectSkill).not.toHaveBeenCalled();
  type('/Der'); key('Enter');
  await vi.waitFor(() => expect(actions.selectSkill).toHaveBeenCalledWith('derive'));
  expect(actions.addReference).toHaveBeenCalledTimes(1);
});

it('does not let a typed prefix cross into the other candidate source', async () => {
  const { type, status, options } = setup();
  type('@skill Der');
  await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
  expect(options().join(' ')).not.toContain('/Derive');
  type('/article Shared');
  expect(options()).toHaveLength(0);
  expect(status().textContent).toBe('No matching skills');
});

it('does not open either chooser for @ or / inside a word', () => {
  const { type, menu } = setup();
  type('compare foo@bar'); expect(menu().hidden).toBe(true);
  type('see path/segment'); expect(menu().hidden).toBe(true);
});

it('preserves listbox semantics and keyboard selection for both choosers', () => {
  const { type, menu, key } = setup();
  type('/');
  expect(menu().querySelector('[role="listbox"]')).not.toBeNull();
  expect(menu().querySelector('[role="option"][aria-selected="true"]')!.textContent).toContain('/Derive');
  key('ArrowDown');
  expect(menu().querySelector('[aria-selected="true"]')!.textContent).toContain('/Derive');
  key('Escape');
  expect(menu().hidden).toBe(true);
});
