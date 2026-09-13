import type { HistoryAction, HistoryEntry, HistoryFilterScope, HistoryListing, HistoryMutationReport } from '../../../contracts/src/workspace.ts';
import { filterHistory, historyCounts, historyPapers, isHistoryListing, isHistoryReport } from '../../../core/src/workspace/history.ts';

/**
 * The History section of the native Zotero Preferences pane.
 *
 * It renders one listing from the workspace store (the pane never reads transcript files itself),
 * keeps filtering client-side over that single listing, and treats archiving as the reversible
 * toggle it already is. Only deleting is destructive, and every delete goes through an explicit
 * confirmation that names what is removed. Nothing is ever pruned on open.
 *
 * Copy is authored in both languages here because `chat/ui-locale.ts` is owned by the sidebar chat
 * work; the strings mirror that dictionary's wording so moving them into it later is mechanical.
 */
export interface HistorySectionHost {
  readHistory(query: string): Promise<unknown>;
  setHistoryArchived(ids: string[], archived: boolean): Promise<unknown>;
  deleteHistory(ids: string[]): Promise<unknown>;
}
export interface HistorySection {
  readonly element: HTMLElement;
  setLanguage(language: 'en' | 'zh'): void;
  setBusy(busy: boolean): void;
  refresh(): Promise<void>;
  dispose(): void;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SEARCH_DEBOUNCE_MS = 200;
/**
 * The pane never builds an unbounded list of rows or paper options: a store may hold thousands of
 * chats, and rendering them all would block the Preferences window. The counts always state the
 * true totals, and the truncation is said out loud instead of being silently hidden.
 */
const ROW_LIMIT = 200;
const PAPER_LIMIT = 200;

interface Copy {
  legend: string;
  intro: string;
  search: string;
  show: string;
  scope: Record<HistoryFilterScope, string>;
  paper: string;
  allPapers: string;
  archiveSelected: string;
  restoreSelected: string;
  deleteSelected: string;
  empty: string;
  archiveRow: string;
  restoreRow: string;
  deleteRow: string;
  unfinished: string;
  archivedBadge: string;
  cancel: string;
  confirmDelete: string;
  confirmDeleteOne(title: string): string;
  confirmDeleteMany(count: number): string;
  listFailed: string;
  actionFailed: string;
  /** Shown when only the newest slice of a long list is rendered; names both numbers. */
  showing(shown: number, total: number): string;
  /** Appended to the paper filter when the store holds more papers than the pane will render. */
  morePapers(count: number): string;
  /** Why a chat with a running answer cannot be deleted, shown instead of arming a confirmation. */
  refusedUnfinished: string;
  stored(total: number, archived: number): string;
  matching(total: number, archived: number): string;
  messages(count: number): string;
  tasks(count: number): string;
  outcome(action: HistoryAction, changed: number, requested: number, failed: number): string;
}

const COPY: Record<'en' | 'zh', Copy> = {
  en: {
    legend: 'Chat history',
    intro: 'Chats stored on this computer. Archiving is reversible; deleting is not. Nothing is removed until you confirm it.',
    search: 'Search chats…',
    show: 'Show',
    scope: { all: 'All', active: 'Active', archived: 'Archived' },
    paper: 'Paper',
    allPapers: 'All papers',
    archiveSelected: 'Archive selected',
    restoreSelected: 'Restore selected',
    deleteSelected: 'Delete selected',
    empty: 'No saved chats match this search.',
    archiveRow: 'Archive chat',
    restoreRow: 'Restore chat',
    deleteRow: 'Delete chat',
    unfinished: 'work in progress',
    archivedBadge: 'archived',
    cancel: 'Cancel',
    confirmDelete: 'Delete permanently',
    confirmDeleteOne: title => `Delete “${title}”? This permanently removes the chat, its messages and its unsent draft from this computer. Native task outputs and exported files are not undone. This cannot be undone.`,
    confirmDeleteMany: count => `Delete ${count} chats? This permanently removes those chats, their messages and their unsent drafts from this computer. Native task outputs and exported files are not undone. This cannot be undone.`,
    listFailed: 'The saved chat list could not be read. Nothing was changed.',
    actionFailed: 'The change could not be confirmed. Reopen this section to see what is actually stored.',
    showing: (shown, total) => `Showing the ${shown} most recent of ${total} matching chats. Narrow the search or the paper filter to see the rest.`,
    morePapers: count => `…and ${count} more papers — search to narrow`,
    refusedUnfinished: 'A chat with an unfinished answer or native task was skipped: finish or cancel it before deleting.',
    stored: (total, archived) => `${total} stored ${total === 1 ? 'chat' : 'chats'} · ${archived} archived`,
    matching: (total, archived) => `${total} matching ${total === 1 ? 'chat' : 'chats'} · ${archived} archived`,
    messages: count => `${count} ${count === 1 ? 'message' : 'messages'}`,
    tasks: count => `${count} ${count === 1 ? 'task' : 'tasks'}`,
    outcome: (action, changed, requested, failed) => {
      const verb = action === 'delete' ? 'Deleted' : action === 'archive' ? 'Archived' : 'Restored';
      const head = `${verb} ${changed} of ${requested} ${requested === 1 ? 'chat' : 'chats'}.`;
      return failed ? `${head} ${failed} could not be changed.` : head;
    },
  },
  zh: {
    legend: '对话历史',
    intro: '保存在此电脑上的对话。归档可以恢复，删除无法恢复；在你确认之前不会移除任何内容。',
    search: '搜索对话…',
    show: '显示',
    scope: { all: '全部', active: '活动', archived: '已归档' },
    paper: '文献',
    allPapers: '全部文献',
    archiveSelected: '归档所选项',
    restoreSelected: '恢复所选项',
    deleteSelected: '删除所选项',
    empty: '没有匹配的已保存对话。',
    archiveRow: '归档对话',
    restoreRow: '恢复对话',
    deleteRow: '删除对话',
    unfinished: '有未完成的工作',
    archivedBadge: '已归档',
    cancel: '取消',
    confirmDelete: '永久删除',
    confirmDeleteOne: title => `删除“${title}”？将从此电脑永久移除该对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`,
    confirmDeleteMany: count => `删除 ${count} 个对话？将从此电脑永久移除这些对话、其中的消息及其未发送的草稿。原生任务的输出和已导出的文件不会被撤销。此操作无法撤销。`,
    listFailed: '无法读取已保存的对话列表，未做任何更改。',
    actionFailed: '无法确认更改结果。请重新打开此部分以查看实际保存的内容。',
    showing: (shown, total) => `仅显示最近匹配的 ${total} 个对话中的 ${shown} 个。请缩小搜索范围或更改文献筛选以查看其余内容。`,
    morePapers: count => `……还有 ${count} 篇文献，请用搜索缩小范围`,
    refusedUnfinished: '已跳过包含未完成回答或原生任务的对话：请先完成或取消，再删除。',
    stored: (total, archived) => `已保存 ${total} 个对话 · ${archived} 个已归档`,
    matching: (total, archived) => `匹配 ${total} 个对话 · ${archived} 个已归档`,
    messages: count => `${count} 条消息`,
    tasks: count => `${count} 个任务`,
    outcome: (action, changed, requested, failed) => {
      const verb = action === 'delete' ? '删除' : action === 'archive' ? '归档' : '恢复';
      const head = `已${verb} ${requested} 个对话中的 ${changed} 个。`;
      return failed ? `${head}有 ${failed} 个未能更改。` : head;
    },
  },
};

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML_NS, tag) as unknown as HTMLElementTagNameMap[K];
  if (text) node.textContent = text;
  return node;
}
function reason(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
/** UTC, minute precision, sortable and identical on every machine; identical to the stored value. */
function stamp(iso: string): string { return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`; }

export function createHistorySection(doc: Document, host: HistorySectionHost, initial: 'en' | 'zh'): HistorySection {
  let language = initial;
  let copy = COPY[language];
  let current: HistoryListing | null = null;
  const selected = new Set<string>();
  let pending: string[] | null = null;
  let query = '';
  let scope: HistoryFilterScope = 'active';
  let paper: string | null = null;
  let busy = false;
  let disposed = false;
  let seq = 0;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const listeners: Array<{ element: Element; type: string; handler: (event: Event) => void }> = [];
  const listen = <T extends Element>(element: T, type: string, handler: (event: Event) => void): T => {
    element.addEventListener(type, handler);
    listeners.push({ element, type, handler });
    return element;
  };

  const box = el(doc, 'fieldset');
  box.dataset.zcrPref = 'history';
  const legend = el(doc, 'legend');
  const intro = el(doc, 'p');
  intro.className = 'zcr-preferences-muted';
  const counts = el(doc, 'p');
  counts.className = 'zcr-preferences-muted';
  counts.dataset.zcrHistory = 'counts';
  counts.hidden = true;

  const searchLabel = el(doc, 'label');
  const searchText = doc.createTextNode('');
  const search = el(doc, 'input');
  search.type = 'search';
  search.dataset.zcrHistory = 'search';
  searchLabel.append(searchText, search);

  const scopeLabel = el(doc, 'label');
  const scopeText = doc.createTextNode('');
  const scopeSelect = el(doc, 'select');
  scopeSelect.dataset.zcrHistory = 'scope';
  scopeLabel.append(scopeText, scopeSelect);

  const paperLabel = el(doc, 'label');
  const paperText = doc.createTextNode('');
  const paperSelect = el(doc, 'select');
  paperSelect.dataset.zcrHistory = 'paper';
  paperLabel.append(paperText, paperSelect);

  const filters = el(doc, 'div');
  filters.className = 'zcr-preferences-history-filters';
  filters.append(searchLabel, scopeLabel, paperLabel);

  const list = el(doc, 'div');
  list.dataset.zcrHistory = 'list';
  const truncated = el(doc, 'p');
  truncated.className = 'zcr-preferences-muted';
  truncated.dataset.zcrHistory = 'truncated';
  truncated.hidden = true;
  const empty = el(doc, 'p');
  empty.className = 'zcr-preferences-muted';
  empty.dataset.zcrHistory = 'empty';
  empty.hidden = true;
  const failure = el(doc, 'p');
  failure.dataset.zcrHistory = 'error';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const status = el(doc, 'p');
  status.dataset.zcrHistory = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const actions = el(doc, 'div');
  actions.className = 'zcr-preferences-actions';
  const archiveSelected = el(doc, 'button');
  archiveSelected.type = 'button';
  archiveSelected.dataset.zcrHistory = 'archive-selected';
  const deleteSelected = el(doc, 'button');
  deleteSelected.type = 'button';
  deleteSelected.dataset.zcrHistory = 'delete-selected';
  actions.append(archiveSelected, deleteSelected);

  const confirm = el(doc, 'div');
  confirm.dataset.zcrHistory = 'confirm-actions';
  confirm.hidden = true;
  const confirmText = el(doc, 'p');
  confirmText.dataset.zcrHistory = 'confirm-text';
  const confirmButtons = el(doc, 'div');
  confirmButtons.className = 'zcr-preferences-actions';
  const confirmDelete = el(doc, 'button');
  confirmDelete.type = 'button';
  confirmDelete.dataset.zcrHistory = 'confirm';
  const cancel = el(doc, 'button');
  cancel.type = 'button';
  cancel.dataset.zcrHistory = 'cancel';
  confirmButtons.append(confirmDelete, cancel);
  confirm.append(confirmText, confirmButtons);

  box.append(legend, intro, counts, filters, list, truncated, empty, failure, status, actions, confirm);

  /** Drop listeners whose element is no longer part of the section, so refreshes cannot leak them. */
  function pruneListeners(): void {
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      const entry = listeners[index]!;
      if (box.contains(entry.element)) continue;
      entry.element.removeEventListener(entry.type, entry.handler);
      listeners.splice(index, 1);
    }
  }
  function lock(node: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, locked: boolean): void {
    if (locked) node.dataset.zcrHistoryLocked = 'true'; else delete node.dataset.zcrHistoryLocked;
    node.disabled = locked || busy;
  }
  function applyBusy(): void {
    for (const node of box.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
      node.disabled = busy || node.dataset.zcrHistoryLocked === 'true';
    }
  }
  function clearMessages(): void { status.textContent = ''; status.hidden = true; failure.textContent = ''; failure.hidden = true; }
  function showStatus(text: string): void { clearMessages(); status.textContent = text; status.hidden = false; }
  function showFailure(text: string): void { clearMessages(); failure.textContent = text; failure.hidden = false; }

  function visibleEntries(): HistoryEntry[] {
    return filterHistory(current?.entries ?? [], { scope, paperId: paper });
  }
  function entryById(id: string): HistoryEntry | null {
    return current?.entries.find(entry => entry.id === id) ?? null;
  }
  function metaOf(entry: HistoryEntry): string[] {
    const parts = [entry.identity.title || entry.title, stamp(entry.updatedAt), copy.messages(entry.messageCount)];
    if (entry.taskCount) parts.push(copy.tasks(entry.taskCount));
    if (entry.unfinishedWork) parts.push(copy.unfinished);
    if (entry.archivedAt) parts.push(copy.archivedBadge);
    return parts;
  }

  function renderRows(): void {
    const entries = visibleEntries();
    // The listing is already sorted newest first, so the slice is the newest chats, not an arbitrary set.
    const shown = entries.slice(0, ROW_LIMIT);
    const rows = shown.map(entry => {
      const row = el(doc, 'div');
      row.className = 'zcr-preferences-history-row';
      row.dataset.zcrHistoryId = entry.id;

      const selectLabel = el(doc, 'label');
      const toggle = el(doc, 'input');
      toggle.type = 'checkbox';
      toggle.dataset.zcrHistorySelect = entry.id;
      toggle.checked = selected.has(entry.id);
      listen(toggle, 'change', () => { if (toggle.checked) selected.add(entry.id); else selected.delete(entry.id); renderActions(); });
      const title = el(doc, 'strong', entry.title || entry.identity.title);
      // Titles and previews are the owner's content, never UI copy: keep them out of the localizer.
      title.dataset.zcrUi = 'false';
      selectLabel.append(toggle, title);

      const meta = el(doc, 'p');
      meta.className = 'zcr-preferences-muted';
      meta.dataset.zcrUi = 'false';
      meta.textContent = metaOf(entry).join(' · ');
      row.append(selectLabel, meta);
      if (entry.preview) {
        const preview = el(doc, 'p');
        preview.className = 'zcr-preferences-muted';
        preview.dataset.zcrUi = 'false';
        preview.textContent = entry.preview;
        row.append(preview);
      }

      const archive = el(doc, 'button', entry.archivedAt ? copy.restoreRow : copy.archiveRow);
      archive.type = 'button';
      archive.dataset.zcrHistoryArchive = entry.id;
      listen(archive, 'click', () => { void apply(entry.archivedAt ? 'restore' : 'archive', [entry.id]); });
      const remove = el(doc, 'button', copy.deleteRow);
      remove.type = 'button';
      remove.dataset.zcrHistoryDelete = entry.id;
      if (entry.unfinishedWork) { remove.dataset.zcrHistoryLocked = 'true'; remove.title = copy.unfinished; }
      listen(remove, 'click', () => requestDelete([entry.id]));
      const rowActions = el(doc, 'div');
      rowActions.className = 'zcr-preferences-actions';
      rowActions.append(archive, remove);
      row.append(rowActions);
      return row;
    });
    list.replaceChildren(...rows);
    // Rows rebuilt above are detached; their listeners would otherwise pile up on every refresh.
    pruneListeners();
    truncated.textContent = entries.length > shown.length ? copy.showing(shown.length, entries.length) : '';
    truncated.hidden = entries.length <= shown.length;
    empty.textContent = copy.empty;
    empty.hidden = entries.length > 0 || !current;
    applyBusy();
  }

  function renderActions(): void {
    const chosen = [...selected].map(entryById).filter((entry): entry is HistoryEntry => !!entry);
    const restorable = chosen.length > 0 && chosen.every(entry => !!entry.archivedAt);
    archiveSelected.textContent = restorable ? copy.restoreSelected : copy.archiveSelected;
    lock(archiveSelected, chosen.length === 0);
    lock(deleteSelected, chosen.length === 0);
    applyBusy();
  }

  function renderFilters(): void {
    const all = el(doc, 'option', copy.scope.all); all.value = 'all';
    const active = el(doc, 'option', copy.scope.active); active.value = 'active';
    const archived = el(doc, 'option', copy.scope.archived); archived.value = 'archived';
    for (const option of [all, active, archived]) option.selected = option.value === scope;
    scopeSelect.replaceChildren(all, active, archived);
    const papers = historyPapers(current?.entries ?? []);
    if (paper !== null && !papers.some(option => option.id === paper)) paper = null;
    const any = el(doc, 'option', copy.allPapers); any.value = '';
    // A long library would otherwise build a select with thousands of options, all at once.
    const shown = papers.slice(0, PAPER_LIMIT);
    const chosen = paper === null ? null : papers.find(option => option.id === paper) ?? null;
    if (chosen && !shown.includes(chosen)) shown.push(chosen);
    const options = shown.map(option => { const node = el(doc, 'option', option.label); node.value = option.id; node.dataset.zcrUi = 'false'; return node; });
    if (papers.length > shown.length) {
      const more = el(doc, 'option', copy.morePapers(papers.length - shown.length));
      more.disabled = true; more.dataset.zcrUi = 'false';
      options.push(more);
    }
    paperSelect.replaceChildren(any, ...options);
    paperSelect.value = paper ?? '';
  }

  function renderCopy(): void {
    legend.textContent = copy.legend;
    intro.textContent = copy.intro;
    searchText.data = copy.search;
    search.placeholder = copy.search;
    search.setAttribute('aria-label', copy.search);
    scopeText.data = copy.show;
    paperText.data = copy.paper;
    deleteSelected.textContent = copy.deleteSelected;
    cancel.textContent = copy.cancel;
    confirmDelete.textContent = copy.confirmDelete;
    empty.textContent = copy.empty;
    renderFilters();
    renderRows();
    renderActions();
    renderConfirm();
  }

  function renderCounts(): void {
    if (!current) { counts.textContent = ''; counts.hidden = true; return; }
    const totals = historyCounts(current.entries);
    counts.textContent = query ? copy.matching(totals.total, totals.archived) : copy.stored(totals.total, totals.archived);
    counts.hidden = false;
  }

  function renderConfirm(): void {
    if (!pending) { confirm.hidden = true; confirmText.textContent = ''; return; }
    const entries = pending.map(entryById).filter((entry): entry is HistoryEntry => !!entry);
    confirmText.textContent = entries.length === 1
      ? copy.confirmDeleteOne(entries[0]!.title || entries[0]!.identity.title)
      : copy.confirmDeleteMany(pending.length);
    confirm.hidden = false;
  }

  function requestDelete(ids: string[]): void {
    if (busy || disposed || !ids.length) return;
    // Never arm a confirmation for a chat the store will refuse: say which chat was skipped instead.
    const blocked = ids.filter(id => entryById(id)?.unfinishedWork);
    const eligible = blocked.length ? ids.filter(id => !blocked.includes(id)) : ids;
    if (blocked.length) showFailure(copy.refusedUnfinished);
    if (!eligible.length) return;
    pending = [...eligible];
    renderConfirm();
  }

  async function apply(action: HistoryAction, ids: string[]): Promise<void> {
    if (busy || disposed || !ids.length) return;
    if (action === 'delete' && ids.some(id => entryById(id)?.unfinishedWork)) { showFailure(copy.refusedUnfinished); return; }
    busy = true; clearMessages(); applyBusy();
    let outcome: { text: string; failure: boolean } | null = null;
    try {
      const raw = action === 'delete' ? await host.deleteHistory(ids) : await host.setHistoryArchived(ids, action === 'archive');
      if (disposed) return;
      if (!isHistoryReport(raw)) {
        // The call returned something unusable: re-read rather than claim any result.
        outcome = { text: copy.actionFailed, failure: true };
      } else {
        const report: HistoryMutationReport = raw;
        for (const id of report.changed) selected.delete(id);
        outcome = { text: copy.outcome(report.action, report.changed.length, report.requested, report.failed.length), failure: report.partial || report.failed.length > 0 || report.warnings.length > 0 };
      }
    } catch (caught) {
      if (!disposed) outcome = { text: reason(caught), failure: true };
    } finally {
      busy = false;
      if (!disposed) applyBusy();
    }
    if (disposed || !outcome) return;
    // Re-read first so the reported outcome cannot be overwritten by the refresh's own status reset.
    await refresh();
    if (disposed) return;
    if (outcome.failure) showFailure(outcome.text); else showStatus(outcome.text);
  }

  async function refresh(): Promise<void> {
    const token = ++seq;
    try {
      const raw = await host.readHistory(query);
      if (disposed || token !== seq) return;
      if (!isHistoryListing(raw)) {
        current = null;
        list.replaceChildren();
        counts.textContent = ''; counts.hidden = true;
        empty.hidden = true;
        renderActions();
        showFailure(copy.listFailed);
        return;
      }
      current = raw;
      const known = new Set(current.entries.map(entry => entry.id));
      for (const id of [...selected]) if (!known.has(id)) selected.delete(id);
      clearMessages();
      renderCounts();
      renderFilters();
      renderRows();
      renderActions();
      renderConfirm();
    } catch (caught) {
      if (disposed || token !== seq) return;
      current = null;
      list.replaceChildren();
      counts.textContent = ''; counts.hidden = true;
      empty.hidden = true;
      renderActions();
      showFailure(reason(caught));
    }
  }

  listen(search, 'input', () => {
    query = search.value;
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => { timer = null; void refresh(); }, SEARCH_DEBOUNCE_MS);
  });
  listen(scopeSelect, 'change', () => { scope = scopeSelect.value as HistoryFilterScope; renderRows(); renderCounts(); });
  listen(paperSelect, 'change', () => { paper = paperSelect.value || null; renderRows(); renderCounts(); });
  listen(archiveSelected, 'click', () => {
    const chosen = [...selected].map(entryById).filter((entry): entry is HistoryEntry => !!entry);
    if (!chosen.length) return;
    void apply(chosen.every(entry => !!entry.archivedAt) ? 'restore' : 'archive', chosen.map(entry => entry.id));
  });
  listen(deleteSelected, 'click', () => requestDelete([...selected]));
  listen(confirmDelete, 'click', () => { const ids = pending; pending = null; renderConfirm(); if (ids) void apply('delete', ids); });
  listen(cancel, 'click', () => { pending = null; renderConfirm(); });

  renderCopy();

  return {
    element: box,
    setLanguage(next: 'en' | 'zh'): void {
      if (next === language || disposed) return;
      language = next; copy = COPY[language];
      renderCopy(); renderCounts(); renderRows(); renderActions(); renderConfirm();
    },
    setBusy(next: boolean): void { busy = next; if (!disposed) applyBusy(); },
    refresh,
    dispose(): void {
      disposed = true;
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      for (const { element, type, handler } of listeners) element.removeEventListener(type, handler);
      listeners.length = 0;
      box.remove();
    },
  };
}
