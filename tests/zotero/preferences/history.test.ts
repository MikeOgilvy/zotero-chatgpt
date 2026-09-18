import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { PaperScope } from '../../../packages/contracts/src/index.ts';
import type { HistoryEntry, HistoryListing, HistoryMutationReport, WorkspaceSettings } from '../../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../../packages/core/src/workspace/skills.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../../packages/zotero/src/preferences/pane.ts';
import { paperA, paperB } from '../../contracts/factories.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const copy = <T>(value: T): T => structuredClone(value);
const id = (suffix: number) => `12345678-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

function entry(suffix: number, title: string, options: { paper?: PaperScope; archived?: boolean; paperTitle?: string; preview?: string } = {}): HistoryEntry {
  return {
    id: id(suffix), paper: copy(options.paper ?? paperA), title, identity: { title: options.paperTitle ?? title, authors: ['Author'] },
    updatedAt: NOW, createdAt: NOW, messageCount: 2, preview: options.preview ?? `${title} preview`, hasDraft: false, activeRequestId: null,
    ...(options.archived ? { archivedAt: NOW } : {}),
  };
}

function listingOf(entries: HistoryEntry[], query = ''): HistoryListing {
  const search = query.normalize('NFKC').toLowerCase().trim();
  const matched = entries.filter(item => !search || `${item.title} ${item.identity.title} ${item.preview}`.normalize('NFKC').toLowerCase().includes(search));
  return { entries: copy(matched), activeCount: matched.filter(item => !item.archivedAt).length, archivedCount: matched.filter(item => !!item.archivedAt).length };
}

function report(action: HistoryMutationReport['action'], changed: string[], failed: HistoryMutationReport['failed'] = []): HistoryMutationReport {
  return { action, requested: changed.length + failed.length, changed, failed, warnings: [], partial: failed.length > 0 };
}

/** A pane host whose history methods mutate an in-memory listing; archive is gone from the surface. */
function fixture(initialEntries: HistoryEntry[], overrides: Partial<PreferencesPaneHost> = {}) {
  const state = { entries: copy(initialEntries) };
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'en', textScale: 1 };
  const readHistory = vi.fn<NonNullable<PreferencesPaneHost['readHistory']>>((query: string) => Promise.resolve(listingOf(state.entries, query)));
  const deleteHistory = vi.fn<NonNullable<PreferencesPaneHost['deleteHistory']>>((ids: string[]) => {
    const changed: string[] = []; const failed: HistoryMutationReport['failed'] = [];
    for (const target of ids) {
      if (!state.entries.some(item => item.id === target)) { failed.push({ id: target, message: 'The chat is no longer stored.' }); continue; }
      state.entries = state.entries.filter(item => item.id !== target); changed.push(target);
    }
    return Promise.resolve(report('delete', changed, failed));
  });
  const base: PreferencesPaneHost = {
    read: () => Promise.resolve(copy(settings)),
    save: vi.fn<PreferencesPaneHost['save']>(value => { Object.assign(settings, copy(value)); return Promise.resolve(); }),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
    readHistory, deleteHistory,
  };
  return { host: { ...base, ...overrides }, readHistory, deleteHistory, settings, state };
}

function mount(host: PreferencesPaneHost) {
  const window = new Window({ url: 'https://test.invalid' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = '<vbox/>';
  const root = document.body.firstElementChild!;
  const pane = createPreferencesPane(host);
  const ready = pane.mount(root);
  const find = <T extends Element>(selector: string): T => { const found = root.querySelector<T>(selector); if (!found) throw new Error(`Missing ${selector}`); return found; };
  const change = (element: Element) => element.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
  const input = (element: Element) => element.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
  const rows = () => [...root.querySelectorAll<HTMLElement>('[data-zchatgpt-history-id]')].map(row => row.dataset.zchatgptHistoryId!);
  return { document, root, pane, ready, find, change, input, rows };
}

it('lists every stored chat as an ordinary row, including one a previous build archived', async () => {
  const active = entry(1, 'Bayesian notes');
  const archived = entry(2, 'Old discussion', { archived: true });
  const { host, deleteHistory } = fixture([active, archived]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([active.id, archived.id]));

  // There is no archive surface at all: no section, no toggle, no archive/restore action, no badge.
  const panel = find('[data-zchatgpt-pref="history"]');
  expect(panel.querySelector('[data-zchatgpt-archived]')).toBeNull();
  expect(panel.querySelector('[data-zchatgpt-action="toggle-archived"]')).toBeNull();
  expect(panel.querySelector('[data-zchatgpt-history-archive]')).toBeNull();
  expect(panel.textContent).not.toMatch(/Archived|归档/u);
  // The legacy record keeps its timestamp on disk and is listed exactly once, as an ordinary chat.
  expect(host.readHistory).toHaveBeenCalledWith('');
  expect(find(`[data-zchatgpt-history-id="${archived.id}"]`).querySelector('strong')?.textContent).toBe('Old discussion');

  // And it can be deleted like any other chat: archive no longer partitions what can be removed.
  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${archived.id}"]`).click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledWith([archived.id]));
  await vi.waitFor(() => expect(rows()).toEqual([active.id]));
});

it('renders each chat title exactly once and names every control', async () => {
  const chat = entry(1, 'Bayesian notes');
  const { host } = fixture([chat]);
  const { ready, find } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find(`[data-zchatgpt-history-id="${chat.id}"]`).textContent).toContain('Bayesian notes'));
  const row = find(`[data-zchatgpt-history-id="${chat.id}"]`);
  expect([...row.querySelectorAll('strong')].map(node => node.textContent)).toEqual(['Bayesian notes']);

  // The search box is named by its aria-label (no second visible "Search chats…" label).
  const search = find<HTMLInputElement>('[data-zchatgpt-history="search"]');
  expect(search.getAttribute('aria-label')).toBe('Search chats…');
  expect(search.placeholder).toBe('Search chats…');
  expect(search.closest('label')).toBeNull();
  // Every other history control is still associated with a label.
  for (const control of find('[data-zchatgpt-pref="history"]').querySelectorAll('input, select')) {
    if (control === search) continue;
    expect(control.closest('label'), control.tagName).not.toBeNull();
  }
  // A short list is fully rendered, so nothing claims to be hidden.
  expect(find<HTMLElement>('[data-zchatgpt-history="truncated"]').hidden).toBe(true);
});

it('hides bulk actions until something is selected, then shows the count actually selected', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second'); const third = entry(3, 'Third');
  const { host } = fixture([first, second, third]);
  const { ready, find, change } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="bulk"]').hidden).toBe(true));

  const select = (target: string) => { const box = find<HTMLInputElement>(`[data-zchatgpt-history-select="${target}"]`); box.checked = true; change(box); };
  select(first.id);
  expect(find<HTMLElement>('[data-zchatgpt-history="bulk"]').hidden).toBe(false);
  expect(find('[data-zchatgpt-history="selected-count"]').textContent).toBe('1 selected');
  expect(find<HTMLInputElement>('[data-zchatgpt-history="select-all"]').checked).toBe(false);
  select(second.id);
  expect(find('[data-zchatgpt-history="selected-count"]').textContent).toBe('2 selected');
});

it('selects every rendered row with select-all and clears them again', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second');
  const { host } = fixture([first, second]);
  const { ready, find, change } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find('[data-zchatgpt-history-id]')).toBeTruthy());

  const selectAll = find<HTMLInputElement>('[data-zchatgpt-history="select-all"]');
  selectAll.checked = true; change(selectAll);
  await vi.waitFor(() => expect(find('[data-zchatgpt-history="selected-count"]').textContent).toBe('2 selected'));
  expect([...find('[data-zchatgpt-pref="history"]').querySelectorAll<HTMLInputElement>('[data-zchatgpt-history-select]')].every(box => box.checked)).toBe(true);

  selectAll.checked = false; change(selectAll);
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="bulk"]').hidden).toBe(true));
});

it('selects only the rows the 200-row bound rendered and says the list is truncated', async () => {
  const many = Array.from({ length: 205 }, (_, index) => entry(index + 1, `Chat ${index + 1}`));
  const { host } = fixture(many);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(200));
  expect(rows()[0]).toBe(many[0]!.id);
  expect(rows()[199]).toBe(many[199]!.id);
  // The counts state the true total and the truncation is said out loud, never silently hidden.
  expect(find('[data-zchatgpt-history="counts"]').textContent).toContain('205');
  const note = find<HTMLElement>('[data-zchatgpt-history="truncated"]');
  expect(note.hidden).toBe(false);
  expect(note.textContent).toContain('200');
  expect(note.textContent).toContain('205');
  // Select-all covers exactly the rendered rows, and the count matches that bound, not the total.
  const selectAll = find<HTMLInputElement>('[data-zchatgpt-history="select-all"]');
  selectAll.checked = true; change(selectAll);
  await vi.waitFor(() => expect(find('[data-zchatgpt-history="selected-count"]').textContent).toBe('200 selected'));
});

it('requires a confirmation naming the count for bulk removal and does nothing on cancel', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second'); const third = entry(3, 'Third');
  const { host, deleteHistory } = fixture([first, second, third]);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(3));

  const select = (target: string) => { const box = find<HTMLInputElement>(`[data-zchatgpt-history-select="${target}"]`); box.checked = true; change(box); };
  select(first.id); select(second.id);
  find<HTMLButtonElement>('[data-zchatgpt-history="delete-selected"]').click();
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(find('[data-zchatgpt-history="confirm-text"]').textContent).toContain('2');
  expect(find('[data-zchatgpt-history="confirm-text"]').textContent).toMatch(/permanent/iu);

  find<HTMLButtonElement>('[data-zchatgpt-history="cancel"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="confirm-actions"]').hidden).toBe(true));
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(rows()).toHaveLength(3);

  find<HTMLButtonElement>('[data-zchatgpt-history="delete-selected"]').click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledTimes(1));
  expect([...deleteHistory.mock.calls[0]![0]].sort()).toEqual([first.id, second.id].sort());
  await vi.waitFor(() => expect(rows()).toEqual([third.id]));
});

it('deletes exactly the target chat after an explicit confirmation and keeps the others', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second');
  const { host, deleteHistory } = fixture([first, second]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id]));

  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${first.id}"]`).click();
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(find<HTMLElement>('[data-zchatgpt-history="confirm-actions"]').hidden).toBe(false);
  expect(find('[data-zchatgpt-history="confirm-text"]').textContent).toMatch(/cannot be undone/iu);

  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledWith([first.id]));
  await vi.waitFor(() => expect(rows()).toEqual([second.id]));
});

it('skips an unfinished chat in bulk removal and says so instead of arming a delete for it', async () => {
  const idle = entry(1, 'Idle');
  const running = { ...entry(2, 'Running'), unfinishedWork: true as const };
  const { host, deleteHistory } = fixture([idle, running]);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([idle.id, running.id]));
  expect(find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${running.id}"]`).disabled).toBe(true);
  expect(find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${running.id}"]`).title).toBe('work in progress');

  const select = (target: string) => { const box = find<HTMLInputElement>(`[data-zchatgpt-history-select="${target}"]`); box.checked = true; change(box); };
  select(idle.id); select(running.id);
  find<HTMLButtonElement>('[data-zchatgpt-history="delete-selected"]').click();

  // The confirmation names only the chat that can be deleted, and the skipped chat is explained.
  expect(find('[data-zchatgpt-history="confirm-text"]').textContent).toContain('Idle');
  expect(find('[data-zchatgpt-history="confirm-text"]').textContent).not.toContain('Running');
  expect(find('[data-zchatgpt-history="error"]').textContent).toMatch(/unfinished/iu);

  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledWith([idle.id]));
  await vi.waitFor(() => expect(rows()).toEqual([running.id]));
});

it('reports a partly failed removal with the store\'s own counts and never claims full success', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second');
  const { host } = fixture([first, second], {
    deleteHistory: vi.fn<NonNullable<PreferencesPaneHost['deleteHistory']>>(() => Promise.resolve(
      report('delete', [first.id], [{ id: second.id, message: 'The chat is no longer stored.' }]),
    )),
  });
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id]));

  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${first.id}"]`).click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="error"]').hidden).toBe(false));
  // The failure restates the store's own numbers, and no success status contradicts it.
  expect(find('[data-zchatgpt-history="error"]').textContent).toBe('Deleted 1 of 2 chats. 1 could not be changed.');
  expect(find<HTMLElement>('[data-zchatgpt-history="status"]').hidden).toBe(true);
});

it('searches through the store, filters by paper, and states an empty result honestly', async () => {
  const alpha = entry(1, 'Alpha', { paper: paperA, preview: 'alpha content' });
  const beta = entry(2, 'Beta', { paper: paperB, paperTitle: 'Beta paper', preview: 'beta content' });
  const archived = entry(3, 'Gamma', { archived: true, paper: paperA, preview: 'gamma content' });
  const { host, readHistory } = fixture([alpha, beta, archived]);
  const { ready, find, change, input, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([alpha.id, beta.id, archived.id]));

  const search = find<HTMLInputElement>('[data-zchatgpt-history="search"]');
  search.value = 'beta content'; input(search);
  await vi.waitFor(() => expect(readHistory).toHaveBeenLastCalledWith('beta content'));
  await vi.waitFor(() => expect(rows()).toEqual([beta.id]));

  search.value = ''; input(search);
  await vi.waitFor(() => expect(rows()).toHaveLength(3));
  const paper = find<HTMLSelectElement>('[data-zchatgpt-history="paper"]');
  paper.value = JSON.stringify([paperA.clientId, paperA.libraryId, paperA.attachmentKey]); change(paper);
  await vi.waitFor(() => expect(rows()).toEqual([alpha.id, archived.id]));

  const emptySearch = find<HTMLInputElement>('[data-zchatgpt-history="search"]');
  emptySearch.value = 'nothing matches this'; input(emptySearch);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  const empty = find<HTMLElement>('[data-zchatgpt-history="empty"]');
  expect(empty.hidden).toBe(false);
  expect(empty.textContent).toMatch(/no saved chats/iu);
});

it('does not build a paper filter longer than it will render', async () => {
  const papers = Array.from({ length: 205 }, (_, index) => entry(index + 1, `Chat ${index + 1}`, {
    paper: { ...copy(paperA), attachmentKey: `K${String(index + 1).padStart(7, '0')}` },
  }));
  const { host } = fixture(papers);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(200));

  const paper = find<HTMLSelectElement>('[data-zchatgpt-history="paper"]');
  expect(paper.options).toHaveLength(202);
  const more = paper.options[201]!;
  expect(more.disabled).toBe(true);
  expect(more.textContent).toContain('5');
});

it('reports a malformed listing without half-rendering history or hiding the rest of the pane', async () => {
  const { host } = fixture([], { readHistory: vi.fn(() => Promise.resolve({ entries: 'nope' } as unknown as HistoryListing)) });
  const { ready, find } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="error"]').hidden).toBe(false));
  expect(find('[data-zchatgpt-history="error"]').textContent).toMatch(/could not be read/iu);
  expect(find('[data-zchatgpt-pref="history"]').querySelectorAll('[data-zchatgpt-history-id]')).toHaveLength(0);
  // The workspace settings form stays mounted and usable.
  expect(find('[data-zchatgpt-pref="save-preferences"]')).toBeTruthy();
});

it('renders no history section at all when the host offers no history management', async () => {
  const noHistory: PreferencesPaneHost = {
    read: () => Promise.resolve({ ...defaultSettings(), uiLanguage: 'en', textScale: 1 }),
    save: vi.fn<PreferencesPaneHost['save']>(() => Promise.resolve()),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
  };
  const { ready, root } = mount(noHistory);
  await ready;
  expect(root.querySelector('[data-zchatgpt-pref="history"]')).toBeNull();
});

it('no longer renders a storage block or a size action', async () => {
  const chat = entry(1, 'Bayesian notes');
  const { host } = fixture([chat]);
  const { ready, find } = mount(host);
  await ready;
  const panel = find('[data-zchatgpt-pref="history"]');
  for (const selector of ['[data-zchatgpt-history="storage"]', '[data-zchatgpt-history="measure"]', '[data-zchatgpt-history="storage-size"]', '[data-zchatgpt-history="storage-scope"]']) {
    expect(panel.querySelector(selector), selector).toBeNull();
  }
  expect(panel.textContent).not.toMatch(/Calculate size|Storage|计算占用空间/u);
});

it('renders the history copy in the stored UI language', async () => {
  const chat = entry(1, 'Bayesian notes');
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'zh', textScale: 1 };
  const { host } = fixture([chat], { read: () => Promise.resolve(settings) });
  const { ready, find } = mount(host);
  await ready;
  const legend = find<HTMLElement>('[data-zchatgpt-pref="history"]').querySelector('legend');
  expect(legend?.textContent).toBe('对话历史');
  expect(find('[data-zchatgpt-history="search"]').getAttribute('aria-label')).toBe('搜索对话…');
  expect(find<HTMLButtonElement>('[data-zchatgpt-history="delete-selected"]').textContent).toBe('删除所选项');

  const toggle = find<HTMLInputElement>(`[data-zchatgpt-history-select="${chat.id}"]`);
  toggle.checked = true;
  toggle.dispatchEvent(new (find('[data-zchatgpt-pref="history"]').ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(find('[data-zchatgpt-history="selected-count"]').textContent).toBe('已选择 1 个'));
  find<HTMLButtonElement>('[data-zchatgpt-history="delete-selected"]').click();
  await vi.waitFor(() => expect(find('[data-zchatgpt-history="confirm-text"]').textContent).toContain('无法撤销'));
  expect(find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').textContent).toBe('永久删除');
  expect(find<HTMLButtonElement>('[data-zchatgpt-history="cancel"]').textContent).toBe('取消');
  find<HTMLButtonElement>('[data-zchatgpt-history="cancel"]').click();
});

it('states an empty history without claiming a search that was never made', async () => {
  const { host } = fixture([]);
  const { ready, find } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find('[data-zchatgpt-history="counts"]').textContent).toBe('0 stored chats'));
  const empty = find<HTMLElement>('[data-zchatgpt-history="empty"]');
  expect(empty.hidden).toBe(false);
  // Nothing was searched and no paper is selected: the empty state must not claim a search.
  expect(empty.textContent).not.toMatch(/match this search/iu);
  expect(empty.textContent).toMatch(/no saved chats/iu);
});

it('keeps counts, empty state and status in agreement after deleting the last chat', async () => {
  const only = entry(1, 'Only chat');
  const { host } = fixture([only]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([only.id]));

  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${only.id}"]`).click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(rows()).toEqual([]));

  // All four surfaces describe the same, real state: no chats stored, nothing to search, success.
  expect(find('[data-zchatgpt-history="counts"]').textContent).toBe('0 stored chats');
  const empty = find<HTMLElement>('[data-zchatgpt-history="empty"]');
  expect(empty.hidden).toBe(false);
  expect(empty.textContent).not.toMatch(/match this search/iu);
  expect(find('[data-zchatgpt-history="status"]').textContent).toBe('Deleted 1 of 1 chat.');
  expect(find<HTMLElement>('[data-zchatgpt-history="error"]').hidden).toBe(true);
});

it('says a search matched nothing only while a search is actually active', async () => {
  const chat = entry(1, 'Bayesian notes');
  const { host } = fixture([chat]);
  const { ready, find, input, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  const search = find<HTMLInputElement>('[data-zchatgpt-history="search"]');
  search.value = 'nothing matches this'; input(search);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(find('[data-zchatgpt-history="empty"]').textContent).toBe('No saved chats match this search.');

  search.value = ''; input(search);
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));
  expect(find<HTMLElement>('[data-zchatgpt-history="empty"]').hidden).toBe(true);
});

it('keeps focus on a surviving chat after deleting the row the keyboard was on', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second'); const third = entry(3, 'Third');
  const { host } = fixture([first, second, third]);
  const { ready, find, rows, document, root } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id, third.id]));

  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${second.id}"]`).click();
  const confirm = find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]');
  confirm.focus();
  expect(document.activeElement).toBe(confirm);
  confirm.click();
  await vi.waitFor(() => expect(rows()).toEqual([first.id, third.id]));

  // Focus must not fall back to the document body: it lands on the row that took the deleted one's
  // place, so a keyboard user can keep deleting without tabbing back through the whole pane.
  const active = document.activeElement as HTMLElement | null;
  expect(active).not.toBe(document.body);
  expect(active?.closest('[data-zchatgpt-history-id]')?.getAttribute('data-zchatgpt-history-id')).toBe(third.id);
  expect(root.contains(active)).toBe(true);
});

it('updates the surviving rows in place instead of rebuilding the whole list', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second'); const third = entry(3, 'Third');
  const { host } = fixture([first, second, third]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id, third.id]));
  const survivor = find(`[data-zchatgpt-history-id="${third.id}"]`);

  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${second.id}"]`).click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(rows()).toEqual([first.id, third.id]));

  // The same element survives, so scroll anchoring and any focus inside it are not thrown away.
  expect(find(`[data-zchatgpt-history-id="${third.id}"]`)).toBe(survivor);
});

it('never claims a delete succeeded when the list cannot be re-read afterwards', async () => {
  const only = entry(1, 'Only chat');
  const { host, readHistory } = fixture([only]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([only.id]));

  readHistory.mockRejectedValueOnce(new Error('The workspace is stopping.'));
  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${only.id}"]`).click();
  find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zchatgpt-history="error"]').hidden).toBe(false));

  // The honest failure stays visible and no success status contradicts it.
  expect(find<HTMLElement>('[data-zchatgpt-history="status"]').hidden).toBe(true);
  expect(find('[data-zchatgpt-history="error"]').textContent).toMatch(/could not be re-read|workspace is stopping/iu);
  // Counts are not left behind claiming a state nobody could read.
  expect(find<HTMLElement>('[data-zchatgpt-history="counts"]').hidden).toBe(true);
});

it('lets a newer read own the pane instead of claiming the delete could not be re-read', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second');
  const { host, readHistory, state } = fixture([first, second]);
  const { ready, find, input, rows, document } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id]));

  // Hold the delete's own re-read open so a search can start a newer read over it.
  let release!: () => void;
  readHistory.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(listingOf(state.entries, '')); }));
  find<HTMLButtonElement>(`[data-zchatgpt-history-delete="${second.id}"]`).click();
  const confirm = find<HTMLButtonElement>('[data-zchatgpt-history="confirm"]');
  // Focus sits on the confirmation, so the delete's own focus restore proves the flow finished.
  confirm.focus(); confirm.click();
  await vi.waitFor(() => expect(readHistory).toHaveBeenCalledTimes(2));

  const search = find<HTMLInputElement>('[data-zchatgpt-history="search"]');
  search.value = 'First'; input(search);
  await vi.waitFor(() => expect(readHistory).toHaveBeenCalledTimes(3));

  release();
  await vi.waitFor(() => expect(document.activeElement).not.toBe(confirm));
  // The newer read owns the pane, so the older one must not overwrite it with a claim that the store
  // could not be re-read; the delete's own authoritative report is what stands.
  expect(find<HTMLElement>('[data-zchatgpt-history="error"]').hidden).toBe(true);
  expect(find('[data-zchatgpt-history="status"]').textContent).toBe('Deleted 1 of 1 chat.');
});
