import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import type { PaperScope } from '../../packages/contracts/src/index.ts';
import type { HistoryEntry, HistoryListing, HistoryMutationReport, HistoryStorageReport, WorkspaceSettings } from '../../packages/contracts/src/workspace.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { createPreferencesPane, type PreferencesPaneHost } from '../../packages/zotero/src/workspace/preferences-pane.ts';
import { paperA, paperB } from '../contracts/factories.ts';

const NOW = '2026-09-13T10:00:00.000Z';
const copy = <T>(value: T): T => structuredClone(value);
const id = (suffix: number) => `12345678-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;

function entry(suffix: number, title: string, options: { paper?: PaperScope; archived?: boolean; paperTitle?: string; preview?: string } = {}): HistoryEntry {
  return {
    id: id(suffix), paper: copy(options.paper ?? paperA), title, identity: { title: options.paperTitle ?? `${title} paper`, authors: ['Author'] },
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

function storageReport(overrides: Partial<HistoryStorageReport> = {}): HistoryStorageReport {
  return {
    location: '/tmp/zcr-profile/zotero-codex-reader/v1/records', scope: 'zotero-codex-reader/v1/records',
    bytes: 3072, chatBytes: 2048, draftBytes: 512, otherBytes: 512, files: 7,
    chats: [{ id: id(1), bytes: 2048 }], chatsComplete: true,
    complete: true, stoppedBy: null, limits: { entries: 20_000, bytes: 1 << 30, depth: 4 }, measuredAt: NOW,
    ...overrides,
  };
}

/** A pane host whose history methods mutate an in-memory listing, mirroring the store's two scopes. */
function fixture(initialEntries: HistoryEntry[], overrides: Partial<PreferencesPaneHost> = {}) {
  const state = { entries: copy(initialEntries) };
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'en', textScale: 1 };
  const readHistory = vi.fn<NonNullable<PreferencesPaneHost['readHistory']>>((query: string) => Promise.resolve(listingOf(state.entries, query)));
  const setHistoryArchived = vi.fn<NonNullable<PreferencesPaneHost['setHistoryArchived']>>((ids: string[], archived: boolean) => {
    const changed: string[] = []; const failed: HistoryMutationReport['failed'] = [];
    for (const target of ids) {
      const found = state.entries.find(item => item.id === target);
      if (!found) { failed.push({ id: target, message: 'The chat is no longer stored.' }); continue; }
      if (archived) found.archivedAt = NOW; else delete found.archivedAt;
      changed.push(target);
    }
    return Promise.resolve(report(archived ? 'archive' : 'restore', changed, failed));
  });
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
    exportPreferences: vi.fn<PreferencesPaneHost['exportPreferences']>(() => Promise.resolve()),
    profileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a',
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
    readHistory, setHistoryArchived, deleteHistory,
  };
  return { host: { ...base, ...overrides }, readHistory, setHistoryArchived, deleteHistory, settings, state };
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
  const rows = () => [...root.querySelectorAll<HTMLElement>('[data-zcr-history-id]')].map(row => row.dataset.zcrHistoryId!);
  return { document, root, pane, ready, find, change, input, rows };
}

it('lists active chats by default, archives away from that scope and restores back into it', async () => {
  const chat = entry(1, 'Bayesian notes');
  const { host, setHistoryArchived } = fixture([chat]);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  find<HTMLButtonElement>(`[data-zcr-history-archive="${chat.id}"]`).click();
  await vi.waitFor(() => expect(setHistoryArchived).toHaveBeenCalledWith([chat.id], true));
  // Archiving hides the chat from the default (unarchived) scope without deleting it.
  await vi.waitFor(() => expect(rows()).toEqual([]));

  const scope = find<HTMLSelectElement>('[data-zcr-history="scope"]');
  scope.value = 'archived'; change(scope);
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  find<HTMLButtonElement>(`[data-zcr-history-archive="${chat.id}"]`).click();
  await vi.waitFor(() => expect(setHistoryArchived).toHaveBeenLastCalledWith([chat.id], false));
  await vi.waitFor(() => expect(rows()).toEqual([]));
  scope.value = 'active'; change(scope);
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  // Every history control is reachable by name, like the rest of the pane.
  for (const control of find('[data-zcr-pref="history"]').querySelectorAll('input, select')) {
    expect(control.closest('label'), control.tagName).not.toBeNull();
  }
  // A short list is fully rendered, so nothing claims to be hidden.
  expect(find<HTMLElement>('[data-zcr-history="truncated"]').hidden).toBe(true);
});

it('locks the delete control for a chat with unfinished work while archiving stays available', async () => {
  const chat = { ...entry(1, 'Running'), unfinishedWork: true as const };
  const { host, deleteHistory } = fixture([chat]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  const remove = find<HTMLButtonElement>(`[data-zcr-history-delete="${chat.id}"]`);
  expect(remove.disabled).toBe(true);
  expect(remove.title).toBe('work in progress');
  remove.click();
  expect(deleteHistory).not.toHaveBeenCalled();
  // Archiving is reversible, so an unfinished answer is not a reason to refuse it.
  expect(find<HTMLButtonElement>(`[data-zcr-history-archive="${chat.id}"]`).disabled).toBe(false);
});

it('deletes exactly the target chat after an explicit confirmation and keeps the others', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second');
  const { host, deleteHistory } = fixture([first, second]);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([first.id, second.id]));

  find<HTMLButtonElement>(`[data-zcr-history-delete="${first.id}"]`).click();
  // The first click only arms the action: nothing is deleted until the confirmation is accepted.
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(find<HTMLElement>('[data-zcr-history="confirm-actions"]').hidden).toBe(false);
  expect(find('[data-zcr-history="confirm-text"]').textContent).toMatch(/cannot be undone/iu);

  find<HTMLButtonElement>('[data-zcr-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledWith([first.id]));
  await vi.waitFor(() => expect(rows()).toEqual([second.id]));
});

it('requires a confirmation naming the count for bulk removal and does nothing on cancel', async () => {
  const first = entry(1, 'First'); const second = entry(2, 'Second'); const third = entry(3, 'Third');
  const { host, deleteHistory } = fixture([first, second, third]);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(3));

  const select = (target: string) => { const box = find<HTMLInputElement>(`[data-zcr-history-select="${target}"]`); box.checked = true; change(box); };
  select(first.id); select(second.id);
  find<HTMLButtonElement>('[data-zcr-history="delete-selected"]').click();
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(find('[data-zcr-history="confirm-text"]').textContent).toContain('2');

  find<HTMLButtonElement>('[data-zcr-history="cancel"]').click();
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-history="confirm-actions"]').hidden).toBe(true));
  expect(deleteHistory).not.toHaveBeenCalled();
  expect(rows()).toHaveLength(3);

  find<HTMLButtonElement>('[data-zcr-history="delete-selected"]').click();
  find<HTMLButtonElement>('[data-zcr-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledTimes(1));
  expect([...deleteHistory.mock.calls[0]![0]].sort()).toEqual([first.id, second.id].sort());
  await vi.waitFor(() => expect(rows()).toEqual([third.id]));
});

it('searches through the store, filters by paper, and states an empty result honestly', async () => {
  const alpha = entry(1, 'Alpha', { paper: paperA, preview: 'alpha content' });
  const beta = entry(2, 'Beta', { paper: paperB, paperTitle: 'Beta paper', preview: 'beta content' });
  const archived = entry(3, 'Gamma', { archived: true, paper: paperA, preview: 'gamma content' });
  const { host, readHistory } = fixture([alpha, beta, archived]);
  const { ready, find, change, input, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([alpha.id, beta.id]));

  const search = find<HTMLInputElement>('[data-zcr-history="search"]');
  search.value = 'beta content'; input(search);
  await vi.waitFor(() => expect(readHistory).toHaveBeenLastCalledWith('beta content'));
  await vi.waitFor(() => expect(rows()).toEqual([beta.id]));

  search.value = ''; input(search);
  await vi.waitFor(() => expect(rows()).toHaveLength(2));
  const paper = find<HTMLSelectElement>('[data-zcr-history="paper"]');
  paper.value = JSON.stringify([paperA.clientId, paperA.libraryId, paperA.attachmentKey]); change(paper);
  await vi.waitFor(() => expect(rows()).toEqual([alpha.id]));

  const emptySearch = find<HTMLInputElement>('[data-zcr-history="search"]');
  emptySearch.value = 'nothing matches this'; input(emptySearch);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  const empty = find<HTMLElement>('[data-zcr-history="empty"]');
  expect(empty.hidden).toBe(false);
  expect(empty.textContent).toMatch(/no saved chats/iu);
});

it('reports a malformed listing without half-rendering history or hiding the rest of the pane', async () => {
  const { host } = fixture([], { readHistory: vi.fn(() => Promise.resolve({ entries: 'nope' } as unknown as HistoryListing)) });
  const { ready, find } = mount(host);
  await ready;
  await vi.waitFor(() => expect(find<HTMLElement>('[data-zcr-history="error"]').hidden).toBe(false));
  expect(find('[data-zcr-history="error"]').textContent).toMatch(/could not be read/iu);
  expect(find('[data-zcr-pref="history"]').querySelectorAll('[data-zcr-history-id]')).toHaveLength(0);
  // The workspace settings form stays mounted and usable.
  expect(find('[data-zcr-pref="save-preferences"]')).toBeTruthy();
});

it('renders no history section at all when the host offers no history management', async () => {
  const noHistory: PreferencesPaneHost = {
    read: () => Promise.resolve({ ...defaultSettings(), uiLanguage: 'en', textScale: 1 }),
    save: vi.fn<PreferencesPaneHost['save']>(() => Promise.resolve()),
    setSkillEnabled: vi.fn<PreferencesPaneHost['setSkillEnabled']>(() => Promise.resolve()),
    exportPreferences: vi.fn<PreferencesPaneHost['exportPreferences']>(() => Promise.resolve()),
    profileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a',
    readAutomaticPdfText: () => true,
    writeAutomaticPdfText: vi.fn(),
  };
  const { ready, root } = mount(noHistory);
  await ready;
  expect(root.querySelector('[data-zcr-pref="history"]')).toBeNull();
});

it('renders the history copy in the stored UI language', async () => {
  const chat = entry(1, 'Bayesian notes');
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'zh', textScale: 1 };
  const { host } = fixture([chat], { read: () => Promise.resolve(settings) });
  const { ready, find } = mount(host);
  await ready;
  const legend = find<HTMLElement>('[data-zcr-pref="history"]').querySelector('legend');
  expect(legend?.textContent).toBe('对话历史');
  expect(find('[data-zcr-history="search"]').closest('label')?.firstChild?.textContent).toBe('搜索对话…');
  expect(find<HTMLButtonElement>('[data-zcr-history="archive-selected"]').textContent).toBe('归档所选项');
  expect(find<HTMLButtonElement>('[data-zcr-history="delete-selected"]').textContent).toBe('删除所选项');
});

it('renders the measured storage copy and the delete confirmation in the stored UI language', async () => {
  const chat = entry(1, 'Bayesian notes');
  const settings: WorkspaceSettings = { ...defaultSettings(), uiLanguage: 'zh', textScale: 1 };
  const readStorageReport = vi.fn<NonNullable<PreferencesPaneHost['readStorageReport']>>(() => Promise.resolve(storageReport()));
  const { host } = fixture([chat], { read: () => Promise.resolve(settings), readStorageReport });
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  // The whole storage block is translated by the shared locale, not by copy embedded in the section.
  expect(find('[data-zcr-history="storage"] > strong').textContent).toBe('存储');
  expect(find('[data-zcr-history="storage-scope"]').textContent).toBe('位置：zotero-codex-reader/v1/records');
  expect(find('[data-zcr-history="storage-size"]').textContent).toBe('尚未测量占用空间。');
  const measure = find<HTMLButtonElement>('[data-zcr-history="measure"]');
  expect(measure.textContent).toBe('计算占用空间');

  measure.click();
  await vi.waitFor(() => expect(find('[data-zcr-history="storage-path"]').textContent).toContain('绝对路径：'));
  // The measurement is the point: the numbers, the path and the timestamp are data and stay verbatim.
  expect(find('[data-zcr-history="storage-size"]').textContent).toContain('对话 2.0 KiB');
  expect(find('[data-zcr-history="storage-size"]').textContent).toContain('7 个文件');
  expect(find('[data-zcr-history="storage-note"]').textContent).toMatch(/^测量时间 /u);

  // Deleting still names exactly what is permanently removed, in the stored language.
  const toggle = find<HTMLInputElement>(`[data-zcr-history-select="${chat.id}"]`);
  toggle.checked = true; change(toggle);
  find<HTMLButtonElement>('[data-zcr-history="delete-selected"]').click();
  await vi.waitFor(() => expect(find('[data-zcr-history="confirm-text"]').textContent).toContain('无法撤销'));
  expect(find('[data-zcr-history="confirm-text"]').textContent).toContain('Bayesian notes');
  expect(find<HTMLButtonElement>('[data-zcr-history="confirm"]').textContent).toBe('永久删除');
  expect(find<HTMLButtonElement>('[data-zcr-history="cancel"]').textContent).toBe('取消');
  find<HTMLButtonElement>('[data-zcr-history="cancel"]').click();
});

it('renders only the newest slice of a long listing and says how much it is not showing', async () => {
  const many = Array.from({ length: 205 }, (_, index) => entry(index + 1, `Chat ${index + 1}`));
  const { host } = fixture(many);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(200));
  // The newest chats are the ones kept, and the counts still state the true total.
  expect(rows()[0]).toBe(many[0]!.id);
  expect(rows()[199]).toBe(many[199]!.id);
  expect(find('[data-zcr-history="counts"]').textContent).toContain('205');
  expect(find('[data-zcr-pref="history"]').querySelectorAll('[data-zcr-history-delete]')).toHaveLength(200);
  const note = find<HTMLElement>('[data-zcr-history="truncated"]');
  expect(note.hidden).toBe(false);
  expect(note.textContent).toContain('200');
  expect(note.textContent).toContain('205');
});

it('does not build a paper filter longer than it will render', async () => {
  const papers = Array.from({ length: 205 }, (_, index) => entry(index + 1, `Chat ${index + 1}`, {
    paper: { ...copy(paperA), attachmentKey: `K${String(index + 1).padStart(7, '0')}` },
  }));
  const { host } = fixture(papers);
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toHaveLength(200));

  const paper = find<HTMLSelectElement>('[data-zcr-history="paper"]');
  expect(paper.options).toHaveLength(202);
  const more = paper.options[201]!;
  expect(more.disabled).toBe(true);
  expect(more.textContent).toContain('5');
});

it('skips an unfinished chat in bulk removal and says so instead of arming a delete for it', async () => {
  const idle = entry(1, 'Idle');
  const running = { ...entry(2, 'Running'), unfinishedWork: true as const };
  const { host, deleteHistory } = fixture([idle, running]);
  const { ready, find, change, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([idle.id, running.id]));

  const select = (target: string) => { const box = find<HTMLInputElement>(`[data-zcr-history-select="${target}"]`); box.checked = true; change(box); };
  select(idle.id); select(running.id);
  find<HTMLButtonElement>('[data-zcr-history="delete-selected"]').click();

  // The confirmation names only the chat that can be deleted, and the skipped chat is explained.
  expect(find('[data-zcr-history="confirm-text"]').textContent).toContain('Idle');
  expect(find('[data-zcr-history="confirm-text"]').textContent).not.toContain('Running');
  expect(find('[data-zcr-history="error"]').textContent).toMatch(/unfinished/iu);

  find<HTMLButtonElement>('[data-zcr-history="confirm"]').click();
  await vi.waitFor(() => expect(deleteHistory).toHaveBeenCalledWith([idle.id]));
  await vi.waitFor(() => expect(rows()).toEqual([running.id]));
});

it('measures storage only when the owner asks, then shows the location and the per-chat size', async () => {
  const chat = entry(1, 'Bayesian notes');
  const readStorageReport = vi.fn<NonNullable<PreferencesPaneHost['readStorageReport']>>(() => Promise.resolve(storageReport()));
  const { host, readHistory } = fixture([chat], { readStorageReport });
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));

  // Opening the section lists chats and walks nothing: the size is an owner-triggered action.
  expect(readHistory).toHaveBeenCalled();
  expect(readStorageReport).not.toHaveBeenCalled();
  const size = find<HTMLElement>('[data-zcr-history="storage-size"]');
  expect(size.textContent).toMatch(/not measured yet/iu);
  expect(find<HTMLElement>('[data-zcr-history="storage-path"]').hidden).toBe(true);
  expect(find('[data-zcr-history="storage-scope"]').textContent).toBe('Location: zotero-codex-reader/v1/records');

  find<HTMLButtonElement>('[data-zcr-history="measure"]').click();
  await vi.waitFor(() => expect(readStorageReport).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(size.textContent).toContain('2.0 KiB'));
  expect(size.textContent).toContain('7 files');
  expect(find('[data-zcr-history="storage-path"]').textContent).toBe('Absolute path: /tmp/zcr-profile/zotero-codex-reader/v1/records');
  expect(find('[data-zcr-history="storage-note"]').textContent).toMatch(/^Measured /u);
  expect(find<HTMLElement>('[data-zcr-history="storage-chats"]').hidden).toBe(true);
  // The measured per-chat bytes appear on the row that they belong to.
  expect(find(`[data-zcr-history-id="${chat.id}"]`).textContent).toContain('2.0 KiB');
});

it('states the bound instead of a precise total when the measurement stopped early', async () => {
  const chat = entry(1, 'Bayesian notes');
  const readStorageReport = vi.fn(() => Promise.resolve(storageReport({ complete: false, stoppedBy: 'entries', limits: { entries: 3, bytes: 1 << 30, depth: 4 } })));
  const { host } = fixture([chat], { readStorageReport });
  const { ready, find } = mount(host);
  await ready;
  find<HTMLButtonElement>('[data-zcr-history="measure"]').click();
  await vi.waitFor(() => expect(find('[data-zcr-history="storage-note"]').textContent).toContain('3'));
  expect(find('[data-zcr-history="storage-note"]').textContent).toMatch(/at least/iu);
  expect(find('[data-zcr-history="storage-size"]').textContent).toContain('2.0 KiB');
});

it('reports a malformed storage report honestly instead of showing a number', async () => {
  const chat = entry(1, 'Bayesian notes');
  const readStorageReport = vi.fn(() => Promise.resolve({ bytes: 'nope' }));
  const { host } = fixture([chat], { readStorageReport });
  const { ready, find } = mount(host);
  await ready;
  find<HTMLButtonElement>('[data-zcr-history="measure"]').click();
  await vi.waitFor(() => expect(find('[data-zcr-history="storage-size"]').textContent).toMatch(/could not be measured/iu));
  expect(find('[data-zcr-history="storage-size"]').textContent).toMatch(/nothing was changed/iu);
  expect(find<HTMLElement>('[data-zcr-history="storage-note"]').hidden).toBe(true);
});

it('shows an honest unavailable storage state when the host offers no measurement', async () => {
  const chat = entry(1, 'Bayesian notes');
  const { host } = fixture([chat]);
  const { ready, find } = mount(host);
  await ready;
  expect(find<HTMLButtonElement>('[data-zcr-history="measure"]').hidden).toBe(true);
  expect(find('[data-zcr-history="storage-size"]').textContent).toMatch(/cannot report/iu);
  // The documented location is stated even when nothing can be measured; no number is invented.
  expect(find('[data-zcr-history="storage-scope"]').textContent).toContain('zotero-codex-reader/v1/records');
  expect(find<HTMLElement>('[data-zcr-history="storage-path"]').hidden).toBe(true);
});

it('drops a measured figure after a change instead of presenting it as current', async () => {
  const chat = entry(1, 'Bayesian notes');
  const readStorageReport = vi.fn(() => Promise.resolve(storageReport()));
  const { host } = fixture([chat], { readStorageReport });
  const { ready, find, rows } = mount(host);
  await ready;
  await vi.waitFor(() => expect(rows()).toEqual([chat.id]));
  find<HTMLButtonElement>('[data-zcr-history="measure"]').click();
  await vi.waitFor(() => expect(find('[data-zcr-history="storage-size"]').textContent).toContain('2.0 KiB'));

  find<HTMLButtonElement>(`[data-zcr-history-archive="${chat.id}"]`).click();
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(find('[data-zcr-history="storage-size"]').textContent).toMatch(/not measured yet/iu);
});
