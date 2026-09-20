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
  /**
   * Reads and renders the listing. Only `listed` means this call read the store and put a listing on
   * screen; `superseded` means a newer read owns the pane now, and `failed` means the store could not
   * be read at all.
   */
  refresh(): Promise<HistoryRefresh>;
  dispose(): void;
}
/** @see HistorySection.refresh */
export type HistoryRefresh = 'listed' | 'superseded' | 'failed';

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
/**
 * Two distinct empty states, so the section never claims a search that was not made: a filtered
 * listing (a search or paper filter is active) matched nothing, versus a store with no chats at all.
 */
const EMPTY_FILTERED = 'No saved chats match this search.';
const EMPTY_STORE = 'No saved chats yet.';
/**
 * A deletion the pane submitted but could not subsequently confirm from the store. Distinct from
 * `LIST_FAILED`, which says nothing was changed — that would be false after a successful delete.
 */
const DELETE_UNCONFIRMED = 'The chats were submitted for removal, but the saved chat list could not be re-read. Reopen this section to see what is stored.';

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
  box.dataset.zchatgptPref = 'history';
  const legend = el(doc, 'legend');
  // The Preferences section is data management, not a daily chat workspace. The descriptive line
  // says exactly what is deleted (local records) and what is not (official conversations, annotations).
  const intro = el(doc, 'p', 'Manage the conversations this plugin saved on this computer. Deleting a local chat never deletes the official ChatGPT conversation, and never undoes a native annotation.');
  intro.className = 'zchatgpt-preferences-muted';
  intro.dataset.zchatgptHistory = 'intro';
  const counts = el(doc, 'p');
  counts.className = 'zchatgpt-preferences-muted';
  counts.dataset.zchatgptHistory = 'counts';
  counts.hidden = true;

  // The search box carries its own accessible name; there is no second visible "Search chats…" label.
  const search = el(doc, 'input');
  search.type = 'search';
  search.dataset.zchatgptHistory = 'search';

  const paperLabel = el(doc, 'label');
  const paperText = doc.createTextNode('');
  const paperSelect = el(doc, 'select');
  paperSelect.dataset.zchatgptHistory = 'paper';
  paperLabel.append(paperText, paperSelect);

  const filters = el(doc, 'div');
  filters.className = 'zchatgpt-preferences-history-filters';
  filters.append(search, paperLabel);

  // Bulk actions appear only when something is selected; the select-all row states the real count.
  const bulk = el(doc, 'div');
  bulk.className = 'zchatgpt-preferences-history-bulk';
  bulk.dataset.zchatgptHistory = 'bulk';
  bulk.hidden = true;
  const selectAllLabel = el(doc, 'label');
  const selectAll = el(doc, 'input');
  selectAll.type = 'checkbox';
  selectAll.dataset.zchatgptHistory = 'select-all';
  const selectAllText = doc.createTextNode('');
  selectAllLabel.append(selectAll, selectAllText);
  const selectedText = el(doc, 'span');
  selectedText.className = 'zchatgpt-preferences-muted';
  selectedText.dataset.zchatgptHistory = 'selected-count';
  const deleteSelected = el(doc, 'button');
  deleteSelected.type = 'button';
  deleteSelected.dataset.zchatgptHistory = 'delete-selected';
  const actions = el(doc, 'div');
  actions.className = 'zchatgpt-preferences-actions';
  actions.append(deleteSelected);
  bulk.append(selectAllLabel, selectedText, actions);

  const list = el(doc, 'div');
  list.dataset.zchatgptHistory = 'list';
  const truncated = el(doc, 'p');
  truncated.className = 'zchatgpt-preferences-muted';
  truncated.dataset.zchatgptHistory = 'truncated';
  truncated.hidden = true;
  const empty = el(doc, 'p');
  empty.className = 'zchatgpt-preferences-muted';
  empty.dataset.zchatgptHistory = 'empty';
  empty.hidden = true;
  const failure = el(doc, 'p');
  failure.dataset.zchatgptHistory = 'error';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const status = el(doc, 'p');
  status.dataset.zchatgptHistory = 'status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  const confirm = el(doc, 'div');
  confirm.dataset.zchatgptHistory = 'confirm-actions';
  confirm.hidden = true;
  const confirmText = el(doc, 'p');
  confirmText.dataset.zchatgptHistory = 'confirm-text';
  const confirmButtons = el(doc, 'div');
  confirmButtons.className = 'zchatgpt-preferences-actions';
  const confirmDelete = el(doc, 'button');
  confirmDelete.type = 'button';
  confirmDelete.dataset.zchatgptHistory = 'confirm';
  const cancel = el(doc, 'button');
  cancel.type = 'button';
  cancel.dataset.zchatgptHistory = 'cancel';
  confirmButtons.append(confirmDelete, cancel);
  confirm.append(confirmText, confirmButtons);

  box.append(legend, intro, counts, filters, bulk, list, truncated, empty, failure, status, confirm);

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
    if (locked) node.dataset.zchatgptHistoryLocked = 'true'; else delete node.dataset.zchatgptHistoryLocked;
    node.disabled = locked || busy;
  }
  function applyBusy(): void {
    for (const node of box.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button')) {
      node.disabled = busy || node.dataset.zchatgptHistoryLocked === 'true';
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

  /**
   * The meta line as fresh nodes. The paper title is only repeated when it differs from the chat
   * title; the timestamp, counts and status phrases are each their own text node so the localizer
   * can translate them individually. Chat and paper titles are the owner's data, never copy.
   */
  function metaNodes(entry: HistoryEntry): Array<Text | HTMLElement> {
    const nodes: Array<Text | HTMLElement> = [];
    const showPaper = Boolean(entry.identity.title) && entry.identity.title !== entry.title;
    metaOf(entry, showPaper).forEach(([text, content], index) => {
      if (index) nodes.push(doc.createTextNode(' · '));
      if (content) {
        const node = el(doc, 'span', text);
        node.dataset.zchatgptUi = 'false';
        nodes.push(node);
      } else nodes.push(doc.createTextNode(text));
    });
    return nodes;
  }

  /**
   * One row per chat, reused across refreshes and updated in place. Rebuilding a row (or the whole
   * list) on every read would detach the control the keyboard is on and throw away the browser's
   * scroll anchoring, which is what made deleting a chat jump; only the text nodes change here.
   */
  function historyRow(entry: HistoryEntry): { readonly row: HTMLElement; update(entry: HistoryEntry): void } {
    const row = el(doc, 'div');
    row.className = 'zchatgpt-preferences-history-row';
    row.dataset.zchatgptHistoryId = entry.id;

    const selectLabel = el(doc, 'label');
    const toggle = el(doc, 'input');
    toggle.type = 'checkbox';
    toggle.dataset.zchatgptHistorySelect = entry.id;
    listen(toggle, 'change', () => { if (toggle.checked) selected.add(entry.id); else selected.delete(entry.id); renderBulk(); });
    // The chat title appears exactly once, on the row that selects it.
    const title = el(doc, 'strong');
    title.dataset.zchatgptUi = 'false';
    selectLabel.append(toggle, title);

    const meta = el(doc, 'p');
    meta.className = 'zchatgpt-preferences-muted';
    const preview = el(doc, 'p');
    preview.className = 'zchatgpt-preferences-muted';
    preview.dataset.zchatgptUi = 'false';

    const remove = el(doc, 'button', 'Delete chat');
    remove.type = 'button';
    remove.dataset.zchatgptHistoryDelete = entry.id;
    listen(remove, 'click', () => requestDelete([entry.id]));
    const rowActions = el(doc, 'div');
    rowActions.className = 'zchatgpt-preferences-actions';
    rowActions.append(remove);

    row.append(selectLabel, meta, preview, rowActions);

    const update = (next: HistoryEntry): void => {
      toggle.checked = selected.has(next.id);
      title.textContent = next.title || next.identity.title;
      meta.replaceChildren(...metaNodes(next));
      if (next.preview) { preview.textContent = next.preview; preview.hidden = false; } else { preview.textContent = ''; preview.hidden = true; }
      if (next.unfinishedWork) { remove.dataset.zchatgptHistoryLocked = 'true'; remove.title = UNFINISHED; } else { delete remove.dataset.zchatgptHistoryLocked; remove.removeAttribute('title'); }
    };
    update(entry);
    return { row, update };
  }

  const historyRows = new Map<string, { readonly row: HTMLElement; update(entry: HistoryEntry): void }>();

  /**
   * Puts the desired rows into the list, keeping every node that is already in the right position
   * untouched: a `replaceChildren` (or any re-insertion) of a focused node moves focus to the body.
   */
  function reconcileRows(nodes: HTMLElement[]): void {
    const desired = new Set(nodes);
    for (const child of [...list.children] as HTMLElement[]) if (!desired.has(child)) child.remove();
    let index = 0;
    for (const node of nodes) {
      if (list.children[index] === node) { index += 1; continue; }
      list.insertBefore(node, list.children[index] ?? null);
      index += 1;
    }
  }

  /** The empty state distinguishes "nothing was searched" from "the active search matched nothing". */
  function renderEmpty(): void {
    if (!current) { empty.textContent = ''; empty.hidden = true; return; }
    const filtered = query !== '' || paper !== null;
    empty.textContent = filtered ? EMPTY_FILTERED : EMPTY_STORE;
    empty.hidden = visibleEntries().length > 0;
  }

  function renderRows(): void {
    const entries = visibleEntries();
    // The listing is already sorted newest first, so the slice is the newest chats, not an arbitrary set.
    const shown = entries.slice(0, ROW_LIMIT);
    const rendered = new Set(shown.map(entry => entry.id));
    for (const id of [...selected]) if (!rendered.has(id)) selected.delete(id);
    for (const [id, cached] of historyRows) if (!rendered.has(id)) { cached.row.remove(); historyRows.delete(id); }
    const nodes = shown.map(entry => {
      let cached = historyRows.get(entry.id);
      if (!cached) { cached = historyRow(entry); historyRows.set(entry.id, cached); }
      cached.update(entry);
      return cached.row;
    });
    reconcileRows(nodes);
    // Rows removed above are detached; their listeners would otherwise pile up on every refresh.
    pruneListeners();
    truncated.textContent = entries.length > shown.length ? showing(shown.length, entries.length) : '';
    truncated.hidden = entries.length <= shown.length;
    renderEmpty();
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
    const options = shown.map(option => { const node = el(doc, 'option', option.label); node.value = option.id; node.dataset.zchatgptUi = 'false'; return node; });
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
    legend.textContent = 'Local data';
    search.placeholder = 'Search chats…';
    search.setAttribute('aria-label', 'Search chats…');
    paperText.data = 'Paper';
    selectAllText.data = 'Select all';
    deleteSelected.textContent = 'Delete selected';
    cancel.textContent = 'Cancel';
    confirmDelete.textContent = 'Delete permanently';
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

  /**
   * Where the keyboard was when a delete started, so the focus the removed row took with it can be
   * put back on the row that replaces it. Only an interaction that started inside the section moves
   * focus; a mouse-only visit is never yanked into the list.
   */
  let focusAnchorIndex = -1;
  let focusInsideSection = false;
  function beginDeleteFocus(ids: string[]): void {
    const active = doc.activeElement as HTMLElement | null;
    focusInsideSection = Boolean(active) && box.contains(active);
    const order = ([...list.children] as HTMLElement[]).map(node => node.dataset.zchatgptHistoryId ?? '');
    const indices = ids.map(id => order.indexOf(id)).filter(index => index >= 0);
    focusAnchorIndex = indices.length ? Math.min(...indices) : 0;
  }
  function settleFocus(): void {
    const inside = focusInsideSection; const anchor = focusAnchorIndex;
    focusInsideSection = false; focusAnchorIndex = -1;
    if (!inside) return;
    const nodes = [...list.querySelectorAll<HTMLElement>('[data-zchatgpt-history-id]')];
    if (!nodes.length) { search.focus(); return; }
    // The row that took the deleted one's place first, then the rows above it; a locked row is skipped.
    const start = Math.min(Math.max(anchor, 0), nodes.length - 1);
    for (const node of [...nodes.slice(start), ...nodes.slice(0, start).reverse()]) {
      const button = node.querySelector<HTMLButtonElement>('[data-zchatgpt-history-delete]');
      if (button && !button.disabled) { button.focus(); return; }
    }
    search.focus();
  }

  async function apply(ids: string[]): Promise<void> {
    if (busy || disposed || !ids.length) return;
    if (ids.some(id => entryById(id)?.unfinishedWork)) { showFailure(REFUSED_UNFINISHED); return; }
    beginDeleteFocus(ids);
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
    const listed = await refresh();
    if (disposed) return;
    settleFocus();
    if (listed === 'superseded') {
      // A newer read owns the pane now — it is about to render, or already has. The store's own
      // report is still the authoritative statement of what this delete did, so it is what stands;
      // claiming the list "could not be re-read" here would be false.
      if (result.failure) showFailure(result.text); else showStatus(result.text);
      return;
    }
    if (listed === 'failed') {
      // The store deleted nothing we could then show: never print a success the pane cannot back up,
      // and never reuse the "nothing was changed" copy after a change did go through.
      showFailure(result.failure ? result.text : DELETE_UNCONFIRMED);
      return;
    }
    if (result.failure) showFailure(result.text); else showStatus(result.text);
  }

  /** @see HistorySection.refresh — returns how the read ended, never a bare success. */
  async function refresh(): Promise<HistoryRefresh> {
    const token = ++seq;
    try {
      const raw = await host.readHistory(query);
      if (disposed || token !== seq) return 'superseded';
      if (!isHistoryListing(raw)) {
        current = null;
        list.replaceChildren();
        historyRows.clear();
        pruneListeners();
        counts.textContent = ''; counts.hidden = true;
        empty.textContent = ''; empty.hidden = true;
        renderBulk();
        showFailure(LIST_FAILED);
        return 'failed';
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
      return 'listed';
    } catch (caught) {
      if (disposed || token !== seq) return 'superseded';
      current = null;
      list.replaceChildren();
      historyRows.clear();
      pruneListeners();
      counts.textContent = ''; counts.hidden = true;
      empty.textContent = ''; empty.hidden = true;
      renderBulk();
      showFailure(reason(caught));
      return 'failed';
    }
  }

  /**
   * The sidebar can delete a chat while this window is open, and this listing is a snapshot read.
   * Zotero hands the plugin no cross-window notification channel, so the pane re-verifies when its
   * own window regains focus — the pushed invalidation covers Settings → sidebar, and this is the
   * documented fallback for the reverse direction. It only re-reads; it never prunes or writes.
   */
  const win = doc.defaultView;
  const onWindowFocus = (): void => { if (!disposed && !busy) void refresh(); };
  win?.addEventListener('focus', onWindowFocus);

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
      win?.removeEventListener('focus', onWindowFocus);
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      for (const { element, type, handler } of listeners) element.removeEventListener(type, handler);
      listeners.length = 0;
      historyRows.clear();
      box.remove();
    },
  };
}
