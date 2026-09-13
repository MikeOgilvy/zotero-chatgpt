import type { HistoryEntry, HistoryListing, HistoryMutationReport } from '../../../contracts/src/workspace.ts';
import { filterHistory, historyPapers, isHistoryListing, isHistoryReport } from '../../../core/src/workspace/history.ts';

/**
 * The History section of the native Zotero Preferences pane.
 *
 * It renders one listing from the workspace store (the pane never reads transcript files itself) and
 * keeps the paper filter client-side over that single listing. Deleting is the only removal path:
 * every delete goes through an explicit confirmation that names how many chats are removed and says
 * the removal is permanent. Nothing is ever pruned on open.
 *
 * Archive is gone from this surface. Chats a previous build archived (a stored `archivedAt`) are
 * listed and behave exactly like ordinary chats here; the field is left on disk untouched.
 *
 * Copy is not authored here: every user-facing string below is an English literal that
 * `chat/ui-locale.ts` translates in place, sharing one dictionary with the sidebar. Parameterised
 * lines are built by the helpers below so the locale's patterns can match them; ids, titles and
 * timestamps are the owner's data and pass through verbatim.
 */
export interface HistorySectionHost {
  readHistory(query: string): Promise<unknown>;
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
 * true totals, and the truncation is said out loud instead of being silently hidden. "Select all"
 * selects exactly the rows this bound rendered, and the truncation note states that more exist.
 */
const ROW_LIMIT = 200;
const PAPER_LIMIT = 200;

function messages(count: number): string { return `${count} ${count === 1 ? 'message' : 'messages'}`; }
function tasks(count: number): string { return `${count} ${count === 1 ? 'task' : 'tasks'}`; }
function stored(total: number): string { return `${total} stored ${total === 1 ? 'chat' : 'chats'}`; }
function matching(total: number): string { return `${total} matching ${total === 1 ? 'chat' : 'chats'}`; }
function showing(shown: number, total: number): string { return `Showing the ${shown} most recent of ${total} matching chats. Narrow the search or the paper filter to see the rest.`; }
function morePapers(count: number): string { return `…and ${count} more papers — search to narrow`; }
function selectedCount(count: number): string { return `${count} selected`; }
function outcome(changed: number, requested: number, failed: number): string {
  const head = `Deleted ${changed} of ${requested} ${requested === 1 ? 'chat' : 'chats'}.`;
  return failed ? `${head} ${failed} could not be changed.` : head;
}
function confirmDeleteOne(title: string): string { return `Delete “${title}”? This permanently removes the chat, its messages and its unsent draft from this computer. Native task outputs and exported files are not undone. This cannot be undone.`; }
function confirmDeleteMany(count: number): string { return `Delete ${count} chats? This permanently removes those chats, their messages and their unsent drafts from this computer. Native task outputs and exported files are not undone. This cannot be undone.`; }
const UNFINISHED = 'work in progress';
const REFUSED_UNFINISHED = 'A chat with an unfinished answer or native task was skipped: finish or cancel it before deleting.';
const LIST_FAILED = 'The saved chat list could not be read. Nothing was changed.';
const ACTION_FAILED = 'The change could not be confirmed. Reopen this section to see what is actually stored.';
const EMPTY = 'No saved chats match this search.';

// Every user-facing string in this section lives in `chat/ui-locale.ts`; nothing is duplicated here.

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
  let current: HistoryListing | null = null;
  const selected = new Set<string>();
  let pending: string[] | null = null;
  let query = '';
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
  const counts = el(doc, 'p');
  counts.className = 'zcr-preferences-muted';
  counts.dataset.zcrHistory = 'counts';
  counts.hidden = true;

  // The search box carries its own accessible name; there is no second visible "Search chats…" label.
  const search = el(doc, 'input');
  search.type = 'search';
  search.dataset.zcrHistory = 'search';

  const paperLabel = el(doc, 'label');
  const paperText = doc.createTextNode('');
  const paperSelect = el(doc, 'select');
  paperSelect.dataset.zcrHistory = 'paper';
  paperLabel.append(paperText, paperSelect);

  const filters = el(doc, 'div');
  filters.className = 'zcr-preferences-history-filters';
  filters.append(search, paperLabel);

  // Bulk actions appear only when something is selected; the select-all row states the real count.
  const bulk = el(doc, 'div');
  bulk.className = 'zcr-preferences-history-bulk';
  bulk.dataset.zcrHistory = 'bulk';
  bulk.hidden = true;
  const selectAllLabel = el(doc, 'label');
  const selectAll = el(doc, 'input');
  selectAll.type = 'checkbox';
  selectAll.dataset.zcrHistory = 'select-all';
  const selectAllText = doc.createTextNode('');
  selectAllLabel.append(selectAll, selectAllText);
  const selectedText = el(doc, 'span');
  selectedText.className = 'zcr-preferences-muted';
  selectedText.dataset.zcrHistory = 'selected-count';
  const deleteSelected = el(doc, 'button');
  deleteSelected.type = 'button';
  deleteSelected.dataset.zcrHistory = 'delete-selected';
  const actions = el(doc, 'div');
  actions.className = 'zcr-preferences-actions';
  actions.append(deleteSelected);
  bulk.append(selectAllLabel, selectedText, actions);

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

  box.append(legend, counts, filters, bulk, list, truncated, empty, failure, status, confirm);

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
    return filterHistory(current?.entries ?? [], { scope: 'all', paperId: paper });
  }
  function entryById(id: string): HistoryEntry | null {
    return current?.entries.find(entry => entry.id === id) ?? null;
  }
  /**
   * The phrases after the chat identity, each rendered as its own text node so the pane's localizer
   * can translate them individually. Chat and paper titles are the owner's data, never copy.
   */
  function metaOf(entry: HistoryEntry, showPaper: boolean): Array<[string, boolean]> {
    const parts: Array<[string, boolean]> = [[stamp(entry.updatedAt), true]];
    if (showPaper) parts.push([entry.identity.title || entry.title, true]);
    parts.push([messages(entry.messageCount), false]);
    if (entry.taskCount) parts.push([tasks(entry.taskCount), false]);
    if (entry.unfinishedWork) parts.push([UNFINISHED, false]);
    return parts;
  }

  function renderRows(): void {
    const entries = visibleEntries();
    // The listing is already sorted newest first, so the slice is the newest chats, not an arbitrary set.
    const shown = entries.slice(0, ROW_LIMIT);
    const rendered = new Set(shown.map(entry => entry.id));
    for (const id of [...selected]) if (!rendered.has(id)) selected.delete(id);
    const rows = shown.map(entry => {
      const row = el(doc, 'div');
      row.className = 'zcr-preferences-history-row';
      row.dataset.zcrHistoryId = entry.id;

      const selectLabel = el(doc, 'label');
      const toggle = el(doc, 'input');
      toggle.type = 'checkbox';
      toggle.dataset.zcrHistorySelect = entry.id;
      toggle.checked = selected.has(entry.id);
      listen(toggle, 'change', () => { if (toggle.checked) selected.add(entry.id); else selected.delete(entry.id); renderBulk(); });
      // The chat title appears exactly once, on the row that selects it.
      const title = el(doc, 'strong', entry.title || entry.identity.title);
      title.dataset.zcrUi = 'false';
      selectLabel.append(toggle, title);

      const meta = el(doc, 'p');
      meta.className = 'zcr-preferences-muted';
      // The paper title is only repeated when it differs from the chat title; the timestamp, counts
      // and status phrases are each their own text node so the localizer can translate them.
      const showPaper = Boolean(entry.identity.title) && entry.identity.title !== entry.title;
      const parts = metaOf(entry, showPaper);
      parts.forEach(([text, content], index) => {
        if (index) meta.append(doc.createTextNode(' · '));
        if (content) {
          const node = el(doc, 'span', text);
          node.dataset.zcrUi = 'false';
          meta.append(node);
        } else meta.append(doc.createTextNode(text));
      });
      row.append(selectLabel, meta);
      if (entry.preview) {
        const preview = el(doc, 'p');
        preview.className = 'zcr-preferences-muted';
        preview.dataset.zcrUi = 'false';
        preview.textContent = entry.preview;
        row.append(preview);
      }

      const remove = el(doc, 'button', 'Delete chat');
      remove.type = 'button';
      remove.dataset.zcrHistoryDelete = entry.id;
      if (entry.unfinishedWork) { remove.dataset.zcrHistoryLocked = 'true'; remove.title = UNFINISHED; }
      listen(remove, 'click', () => requestDelete([entry.id]));
      const rowActions = el(doc, 'div');
      rowActions.className = 'zcr-preferences-actions';
      rowActions.append(remove);
      row.append(rowActions);
      return row;
    });
    list.replaceChildren(...rows);
    // Rows rebuilt above are detached; their listeners would otherwise pile up on every refresh.
    pruneListeners();
    truncated.textContent = entries.length > shown.length ? showing(shown.length, entries.length) : '';
    truncated.hidden = entries.length <= shown.length;
    empty.textContent = EMPTY;
    empty.hidden = entries.length > 0 || !current;
    renderBulk();
  }

  /** The count is the number actually selected, and the all-row is checked only when all are. */
  function renderBulk(): void {
    const visible = visibleEntries().slice(0, ROW_LIMIT);
    const chosen = visible.filter(entry => selected.has(entry.id)).length;
    bulk.hidden = selected.size === 0;
    selectAll.checked = visible.length > 0 && chosen === visible.length;
    selectAll.indeterminate = chosen > 0 && chosen < visible.length;
    selectAll.disabled = busy || visible.length === 0;
    selectedText.textContent = selectedCount(selected.size);
    lock(deleteSelected, selected.size === 0);
    applyBusy();
  }

  function renderFilters(): void {
    const papers = historyPapers(current?.entries ?? []);
    if (paper !== null && !papers.some(option => option.id === paper)) paper = null;
    const any = el(doc, 'option', 'All papers'); any.value = '';
    // A long library would otherwise build a select with thousands of options, all at once.
    const shown = papers.slice(0, PAPER_LIMIT);
    const chosen = paper === null ? null : papers.find(option => option.id === paper) ?? null;
    if (chosen && !shown.includes(chosen)) shown.push(chosen);
    const options = shown.map(option => { const node = el(doc, 'option', option.label); node.value = option.id; node.dataset.zcrUi = 'false'; return node; });
    if (papers.length > shown.length) {
      const more = el(doc, 'option', morePapers(papers.length - shown.length));
      more.disabled = true;
      options.push(more);
    }
    paperSelect.replaceChildren(any, ...options);
    paperSelect.value = paper ?? '';
  }

  /** Static chrome and control copy. Every literal here is a key or pattern in `chat/ui-locale.ts`. */
  function renderChrome(): void {
    legend.textContent = 'Chat history';
    search.placeholder = 'Search chats…';
    search.setAttribute('aria-label', 'Search chats…');
    paperText.data = 'Paper';
    selectAllText.data = 'Select all';
    deleteSelected.textContent = 'Delete selected';
    cancel.textContent = 'Cancel';
    confirmDelete.textContent = 'Delete permanently';
    empty.textContent = EMPTY;
    renderFilters();
    renderRows();
    renderConfirm();
  }

  function renderCounts(): void {
    if (!current) { counts.textContent = ''; counts.hidden = true; return; }
    counts.textContent = query ? matching(current.entries.length) : stored(current.entries.length);
    counts.hidden = false;
  }

  function renderConfirm(): void {
    if (!pending) { confirm.hidden = true; confirmText.textContent = ''; return; }
    const entries = pending.map(entryById).filter((entry): entry is HistoryEntry => !!entry);
    confirmText.textContent = entries.length === 1
      ? confirmDeleteOne(entries[0]!.title || entries[0]!.identity.title)
      : confirmDeleteMany(pending.length);
    confirm.hidden = false;
  }

  function requestDelete(ids: string[]): void {
    if (busy || disposed || !ids.length) return;
    // Never arm a confirmation for a chat the store will refuse: say which chat was skipped instead.
    const blocked = ids.filter(id => entryById(id)?.unfinishedWork);
    const eligible = blocked.length ? ids.filter(id => !blocked.includes(id)) : ids;
    if (blocked.length) showFailure(REFUSED_UNFINISHED);
    if (!eligible.length) return;
    pending = [...eligible];
    renderConfirm();
  }

  async function apply(ids: string[]): Promise<void> {
    if (busy || disposed || !ids.length) return;
    if (ids.some(id => entryById(id)?.unfinishedWork)) { showFailure(REFUSED_UNFINISHED); return; }
    busy = true; clearMessages(); applyBusy();
    let result: { text: string; failure: boolean } | null = null;
    try {
      const raw = await host.deleteHistory(ids);
      if (disposed) return;
      if (!isHistoryReport(raw)) {
        // The call returned something unusable: re-read rather than claim any result.
        result = { text: ACTION_FAILED, failure: true };
      } else {
        const report: HistoryMutationReport = raw;
        for (const id of report.changed) selected.delete(id);
        result = { text: outcome(report.changed.length, report.requested, report.failed.length), failure: report.partial || report.failed.length > 0 || report.warnings.length > 0 };
      }
    } catch (caught) {
      if (!disposed) result = { text: reason(caught), failure: true };
    } finally {
      busy = false;
      if (!disposed) applyBusy();
    }
    if (disposed || !result) return;
    // Re-read first so the reported outcome cannot be overwritten by the refresh's own status reset.
    await refresh();
    if (disposed) return;
    if (result.failure) showFailure(result.text); else showStatus(result.text);
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
        renderBulk();
        showFailure(LIST_FAILED);
        return;
      }
      current = raw;
      const known = new Set(current.entries.map(entry => entry.id));
      for (const id of [...selected]) if (!known.has(id)) selected.delete(id);
      clearMessages();
      renderCounts();
      renderFilters();
      renderRows();
      renderBulk();
      renderConfirm();
    } catch (caught) {
      if (disposed || token !== seq) return;
      current = null;
      list.replaceChildren();
      counts.textContent = ''; counts.hidden = true;
      empty.hidden = true;
      renderBulk();
      showFailure(reason(caught));
    }
  }

  listen(search, 'input', () => {
    query = search.value;
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => { timer = null; void refresh(); }, SEARCH_DEBOUNCE_MS);
  });
  listen(paperSelect, 'change', () => { paper = paperSelect.value || null; renderRows(); renderCounts(); });
  listen(selectAll, 'change', () => {
    const visible = visibleEntries().slice(0, ROW_LIMIT).map(entry => entry.id);
    if (selectAll.checked) for (const id of visible) selected.add(id);
    else for (const id of visible) selected.delete(id);
    renderRows();
  });
  listen(deleteSelected, 'click', () => requestDelete([...selected]));
  listen(confirmDelete, 'click', () => { const ids = pending; pending = null; renderConfirm(); if (ids) void apply(ids); });
  listen(cancel, 'click', () => { pending = null; renderConfirm(); });

  renderChrome();

  return {
    element: box,
    setLanguage(next: 'en' | 'zh'): void {
      if (next === language || disposed) return;
      language = next;
      renderChrome(); renderCounts(); renderRows(); renderConfirm();
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
