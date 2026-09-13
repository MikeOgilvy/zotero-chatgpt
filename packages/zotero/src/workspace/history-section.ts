import type { HistoryAction, HistoryEntry, HistoryFilterScope, HistoryListing, HistoryMutationReport, HistoryStorageReport } from '../../../contracts/src/workspace.ts';
import { filterHistory, historyCounts, historyPapers, isHistoryListing, isHistoryReport, isHistoryStorageReport } from '../../../core/src/workspace/history.ts';
import { HISTORY_STORAGE_SCOPE } from './history-storage.ts';

/**
 * The History section of the native Zotero Preferences pane.
 *
 * It renders one listing from the workspace store (the pane never reads transcript files itself),
 * keeps filtering client-side over that single listing, and treats archiving as the reversible
 * toggle it already is. Only deleting is destructive, and every delete goes through an explicit
 * confirmation that names what is removed. Nothing is ever pruned on open.
 *
 * The storage report is measured only when the owner presses "Calculate size": it stats files in the
 * plugin's own records store, reads no contents, and states its bounds when it stops early.
 *
 * Copy is not authored here: every user-facing string below is an English literal that
 * `chat/ui-locale.ts` translates in place, sharing one dictionary with the sidebar. Parameterised
 * lines are built by the helpers below so the locale's patterns can match them; ids, titles, paths
 * and byte figures are the owner's data and pass through verbatim.
 */
export interface HistorySectionHost {
  readHistory(query: string): Promise<unknown>;
  setHistoryArchived(ids: string[], archived: boolean): Promise<unknown>;
  deleteHistory(ids: string[]): Promise<unknown>;
  /** Optional: without it the section still lists chats and says the size is unavailable. */
  readStorageReport?(): Promise<unknown>;
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

/**
 * Copy is written as plain English literals: the pane mounts `chat/ui-locale.ts` over this section,
 * so every string below is translated in one place together with the sidebar. Parameterised lines
 * (counts, sizes, confirmation wording) are matched by that locale's patterns; paper titles, ids,
 * paths and byte figures stay data and pass through verbatim.
 */
function messages(count: number): string { return `${count} ${count === 1 ? 'message' : 'messages'}`; }
function tasks(count: number): string { return `${count} ${count === 1 ? 'task' : 'tasks'}`; }
function stored(total: number, archived: number): string { return `${total} stored ${total === 1 ? 'chat' : 'chats'} · ${archived} archived`; }
function matching(total: number, archived: number): string { return `${total} matching ${total === 1 ? 'chat' : 'chats'} · ${archived} archived`; }
function showing(shown: number, total: number): string { return `Showing the ${shown} most recent of ${total} matching chats. Narrow the search or the paper filter to see the rest.`; }
function morePapers(count: number): string { return `…and ${count} more papers — search to narrow`; }
function outcome(action: HistoryAction, changed: number, requested: number, failed: number): string {
  const verb = action === 'delete' ? 'Deleted' : action === 'archive' ? 'Archived' : 'Restored';
  const head = `${verb} ${changed} of ${requested} ${requested === 1 ? 'chat' : 'chats'}.`;
  return failed ? `${head} ${failed} could not be changed.` : head;
}
function confirmDeleteOne(title: string): string { return `Delete “${title}”? This permanently removes the chat, its messages and its unsent draft from this computer. Native task outputs and exported files are not undone. This cannot be undone.`; }
function confirmDeleteMany(count: number): string { return `Delete ${count} chats? This permanently removes those chats, their messages and their unsent drafts from this computer. Native task outputs and exported files are not undone. This cannot be undone.`; }
function location(scope: string): string { return `Location: ${scope}`; }
function absolutePath(path: string): string { return `Absolute path: ${path}`; }
function sizes(chat: string, draft: string, other: string, files: number): string { return `Chats ${chat} · Drafts ${draft} · Other records ${other} · ${files} files`; }
function measuredAt(when: string): string { return `Measured ${when}.`; }
function stoppedEntries(limit: number): string { return `At least these figures: the measurement stopped at its ${limit}-entry bound.`; }
function stoppedBytes(limit: string): string { return `At least these figures: the measurement stopped at its ${limit} bound.`; }
function stoppedDepth(limit: number): string { return `At least these figures: a directory deeper than ${limit} levels was not measured.`; }
function chatsPartial(shown: number): string { return `Per-chat sizes are shown for the largest ${shown} chats.`; }
const UNFINISHED = 'work in progress';
const ARCHIVED_BADGE = 'Archived';
const REFUSED_UNFINISHED = 'A chat with an unfinished answer or native task was skipped: finish or cancel it before deleting.';
const LIST_FAILED = 'The saved chat list could not be read. Nothing was changed.';
const ACTION_FAILED = 'The change could not be confirmed. Reopen this section to see what is actually stored.';
const STORAGE_INTRO = 'Chats, drafts, workflows and task records live in one plugin-owned folder inside your Zotero profile. Measuring reads file sizes only — never chat text, drafts or credential files — and it never changes anything.';
const STORAGE_UNAVAILABLE = 'This build cannot report how much space stored chats take.';
const STORAGE_FAILED = 'The stored size could not be measured. Nothing was changed.';
const STORAGE_NOT_MEASURED = 'Size not measured yet.';
const STOPPED_ENTRY_TYPE = 'At least these figures: an unexpected entry in the records store was not measured.';
const STOPPED_LISTING = 'The records store could not be listed, so its size is unknown. Nothing was changed.';

// Every user-facing string in this section lives in `chat/ui-locale.ts`; nothing is duplicated here.

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = doc.createElementNS(HTML_NS, tag) as unknown as HTMLElementTagNameMap[K];
  if (text) node.textContent = text;
  return node;
}
function reason(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
/** UTC, minute precision, sortable and identical on every machine; identical to the stored value. */
function stamp(iso: string): string { return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`; }
/**
 * Binary units, one decimal below 100: a size is either exact or the report says it is a lower
 * bound. Never a rounded-up figure presented as exact.
 */
function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024; let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]!}`;
}

export function createHistorySection(doc: Document, host: HistorySectionHost, initial: 'en' | 'zh'): HistorySection {
  let language = initial;
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
  /** Last measurement the owner asked for; cleared whenever a mutation makes it stale. */
  let measured: HistoryStorageReport | null = null;
  let measuring = false;
  /** True when the last measurement could not be trusted; the size line then says exactly that. */
  let storageFailure = false;
  const measuredChats = new Map<string, number>();
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

  const storage = el(doc, 'div');
  storage.dataset.zcrHistory = 'storage';
  const storageHeading = el(doc, 'strong');
  const storageIntro = el(doc, 'p');
  storageIntro.className = 'zcr-preferences-muted';
  const storageScope = el(doc, 'p');
  storageScope.className = 'zcr-preferences-muted';
  storageScope.dataset.zcrHistory = 'storage-scope';
  const storagePath = el(doc, 'p');
  storagePath.className = 'zcr-preferences-muted';
  storagePath.dataset.zcrHistory = 'storage-path';
  storagePath.hidden = true;
  const storageSize = el(doc, 'p');
  storageSize.className = 'zcr-preferences-muted';
  storageSize.dataset.zcrHistory = 'storage-size';
  const storageNote = el(doc, 'p');
  storageNote.className = 'zcr-preferences-muted';
  storageNote.dataset.zcrHistory = 'storage-note';
  storageNote.hidden = true;
  const storageChats = el(doc, 'p');
  storageChats.className = 'zcr-preferences-muted';
  storageChats.dataset.zcrHistory = 'storage-chats';
  storageChats.hidden = true;
  const measure = el(doc, 'button');
  measure.type = 'button';
  measure.dataset.zcrHistory = 'measure';
  storage.append(storageHeading, storageIntro, storageScope, storagePath, storageSize, storageNote, storageChats, measure);

  box.append(legend, intro, counts, filters, list, truncated, empty, failure, status, actions, confirm, storage);

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
  /**
   * The phrases after the paper identity, each rendered as its own text node so the pane's localizer
   * can translate them individually. Paper titles and byte figures are the owner's data, never copy.
   */
  function metaOf(entry: HistoryEntry): Array<[string, boolean]> {
    const parts: Array<[string, boolean]> = [[messages(entry.messageCount), false]];
    if (entry.taskCount) parts.push([tasks(entry.taskCount), false]);
    if (entry.unfinishedWork) parts.push([UNFINISHED, false]);
    if (entry.archivedAt) parts.push([ARCHIVED_BADGE, false]);
    const bytes = measuredChats.get(entry.id);
    if (bytes !== undefined) parts.push([bytesText(bytes), true]);
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
      // The paper identity and timestamp are content; each phrase after it is its own text node so
      // the localizer can translate it without touching the title.
      const identity = el(doc, 'span', `${entry.identity.title || entry.title} · ${stamp(entry.updatedAt)}`);
      identity.dataset.zcrUi = 'false';
      meta.append(identity);
      for (const [text, content] of metaOf(entry)) {
        if (content) {
          const node = el(doc, 'span', ` · ${text}`);
          node.dataset.zcrUi = 'false';
          meta.append(node);
        } else meta.append(doc.createTextNode(' · '), doc.createTextNode(text));
      }
      row.append(selectLabel, meta);
      if (entry.preview) {
        const preview = el(doc, 'p');
        preview.className = 'zcr-preferences-muted';
        preview.dataset.zcrUi = 'false';
        preview.textContent = entry.preview;
        row.append(preview);
      }

      const archive = el(doc, 'button', entry.archivedAt ? 'Restore chat' : 'Archive chat');
      archive.type = 'button';
      archive.dataset.zcrHistoryArchive = entry.id;
      listen(archive, 'click', () => { void apply(entry.archivedAt ? 'restore' : 'archive', [entry.id]); });
      const remove = el(doc, 'button', 'Delete chat');
      remove.type = 'button';
      remove.dataset.zcrHistoryDelete = entry.id;
      if (entry.unfinishedWork) { remove.dataset.zcrHistoryLocked = 'true'; remove.title = UNFINISHED; }
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
    truncated.textContent = entries.length > shown.length ? showing(shown.length, entries.length) : '';
    truncated.hidden = entries.length <= shown.length;
    empty.textContent = 'No saved chats match this search.';
    empty.hidden = entries.length > 0 || !current;
    applyBusy();
  }

  function renderActions(): void {
    const chosen = [...selected].map(entryById).filter((entry): entry is HistoryEntry => !!entry);
    const restorable = chosen.length > 0 && chosen.every(entry => !!entry.archivedAt);
    archiveSelected.textContent = restorable ? 'Restore selected' : 'Archive selected';
    lock(archiveSelected, chosen.length === 0);
    lock(deleteSelected, chosen.length === 0);
    applyBusy();
  }

  function renderFilters(): void {
    const all = el(doc, 'option', 'All'); all.value = 'all';
    const active = el(doc, 'option', 'Active'); active.value = 'active';
    const archived = el(doc, 'option', 'Archived'); archived.value = 'archived';
    for (const option of [all, active, archived]) option.selected = option.value === scope;
    scopeSelect.replaceChildren(all, active, archived);
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
    intro.textContent = 'Chats stored on this computer. Archiving is reversible; deleting is not. Nothing is removed until you confirm it.';
    searchText.data = 'Search chats…';
    search.placeholder = 'Search chats…';
    search.setAttribute('aria-label', 'Search chats…');
    scopeText.data = 'Show';
    paperText.data = 'Paper';
    deleteSelected.textContent = 'Delete selected';
    cancel.textContent = 'Cancel';
    confirmDelete.textContent = 'Delete permanently';
    empty.textContent = 'No saved chats match this search.';
    renderFilters();
    renderStorage();
    renderRows();
    renderActions();
    renderConfirm();
  }

  function renderCounts(): void {
    if (!current) { counts.textContent = ''; counts.hidden = true; return; }
    const totals = historyCounts(current.entries);
    counts.textContent = query ? matching(totals.total, totals.archived) : stored(totals.total, totals.archived);
    counts.hidden = false;
  }

  function storageNoteText(report: HistoryStorageReport): string {
    if (report.complete) return measuredAt(stamp(report.measuredAt));
    switch (report.stoppedBy) {
      case 'entries': return stoppedEntries(report.limits.entries);
      case 'bytes': return stoppedBytes(bytesText(report.limits.bytes));
      case 'depth': return stoppedDepth(report.limits.depth);
      case 'entry-type': return STOPPED_ENTRY_TYPE;
      default: return STOPPED_LISTING;
    }
  }

  /**
   * The report is shown exactly as measured: the location is stated even before measuring, the size
   * is either an exact measured figure, a stated lower bound, or honestly unavailable — never a
   * blank and never a guess.
   */
  function renderStorage(): void {
    storageHeading.textContent = 'Storage';
    storageIntro.textContent = STORAGE_INTRO;
    storageScope.textContent = location(measured ? measured.scope : HISTORY_STORAGE_SCOPE);
    measuredChats.clear();
    if (measured) for (const chat of measured.chats) measuredChats.set(chat.id, chat.bytes);
    measure.hidden = !host.readStorageReport;
    if (!host.readStorageReport) {
      storageSize.textContent = STORAGE_UNAVAILABLE;
      storagePath.hidden = true; storageNote.hidden = true; storageChats.hidden = true;
      return;
    }
    measure.textContent = measuring ? 'Measuring…' : 'Calculate size';
    lock(measure, measuring);
    if (storageFailure) {
      // The block itself reports an untrustworthy measurement; no fake number, no extra banner noise.
      storageSize.textContent = STORAGE_FAILED;
      storagePath.hidden = true; storageNote.hidden = true; storageChats.hidden = true;
      return;
    }
    if (!measured) {
      storageSize.textContent = STORAGE_NOT_MEASURED;
      storagePath.hidden = true; storageNote.hidden = true; storageChats.hidden = true;
      return;
    }
    storageSize.textContent = sizes(bytesText(measured.chatBytes), bytesText(measured.draftBytes), bytesText(measured.otherBytes), measured.files);
    storagePath.textContent = absolutePath(measured.location);
    storagePath.hidden = false;
    storageNote.textContent = storageNoteText(measured);
    storageNote.hidden = false;
    storageChats.textContent = measured.chatsComplete ? '' : chatsPartial(measured.chats.length);
    storageChats.hidden = measured.chatsComplete;
  }

  /** Only the owner's explicit action measures anything; the walk is bounded inside the host port. */
  async function measureStorage(): Promise<void> {
    if (busy || disposed || measuring || !host.readStorageReport) return;
    measuring = true;
    renderStorage();
    try {
      const raw = await host.readStorageReport();
      if (!disposed) { measured = isHistoryStorageReport(raw) ? raw : null; storageFailure = measured === null; }
    } catch {
      if (!disposed) { measured = null; storageFailure = true; }
    } finally {
      measuring = false;
    }
    if (disposed) return;
    renderStorage();
    renderRows();
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

  async function apply(action: HistoryAction, ids: string[]): Promise<void> {
    if (busy || disposed || !ids.length) return;
    if (action === 'delete' && ids.some(id => entryById(id)?.unfinishedWork)) { showFailure(REFUSED_UNFINISHED); return; }
    busy = true; clearMessages(); applyBusy();
    let result: { text: string; failure: boolean } | null = null;
    try {
      const raw = action === 'delete' ? await host.deleteHistory(ids) : await host.setHistoryArchived(ids, action === 'archive');
      if (disposed) return;
      if (!isHistoryReport(raw)) {
        // The call returned something unusable: re-read rather than claim any result.
        result = { text: ACTION_FAILED, failure: true };
      } else {
        const report: HistoryMutationReport = raw;
        for (const id of report.changed) selected.delete(id);
        // The store changed, so a figure measured before it is no longer current. Say so.
        if (report.changed.length) measured = null;
        result = { text: outcome(report.action, report.changed.length, report.requested, report.failed.length), failure: report.partial || report.failed.length > 0 || report.warnings.length > 0 };
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
        renderActions();
        showFailure(LIST_FAILED);
        return;
      }
      current = raw;
      const known = new Set(current.entries.map(entry => entry.id));
      for (const id of [...selected]) if (!known.has(id)) selected.delete(id);
      clearMessages();
      renderCounts();
      renderFilters();
      renderStorage();
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
  listen(measure, 'click', () => { void measureStorage(); });
  listen(confirmDelete, 'click', () => { const ids = pending; pending = null; renderConfirm(); if (ids) void apply('delete', ids); });
  listen(cancel, 'click', () => { pending = null; renderConfirm(); });

  renderChrome();

  return {
    element: box,
    setLanguage(next: 'en' | 'zh'): void {
      if (next === language || disposed) return;
      language = next;
      renderChrome(); renderCounts(); renderRows(); renderActions(); renderConfirm();
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
