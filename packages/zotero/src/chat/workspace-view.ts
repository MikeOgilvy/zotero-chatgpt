import type { ReaderReference, ReferenceInput, WorkspaceDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { mountCommandMenu } from './command-menu.ts';

export type ReferenceFilter = 'all' | 'article' | 'chat';
export interface WorkspaceViewState { settings: WorkspaceSettings; draft: Pick<WorkspaceDraft, 'references' | 'skillId' | 'profileId'> }
export interface WorkspaceViewActions {
  searchReferences: (query: string, kind: ReferenceFilter, signal: AbortSignal) => Promise<ReaderReference[]>;
  previewReference: (reference: ReaderReference, signal: AbortSignal) => Promise<ReferenceInput>;
  addReference: (reference: ReaderReference) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
  selectSkill: (id: string | null) => Promise<void>;
  setReferenceRange?: (id: string, range: [number, number] | null) => Promise<void>;
}
export interface WorkspaceMounts { input: HTMLTextAreaElement; context: HTMLElement }

function failure(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
function referenceDetail(reference: ReaderReference): string {
  return [reference.identity?.authors.join(', '), reference.identity?.year, reference.kind === 'chat' ? 'Chat snapshot' : reference.kind, reference.paper?.attachmentKey].filter(Boolean).join(' · ');
}

/**
 * Scoped, per-chat controls only. Persistence, library reads and skill execution stay in explicit
 * ports, and installed-skill authoring lives in Zotero's own Preferences window: here the reader
 * only chooses a skill for this chat through the `/` chooser.
 */
export function mountWorkspaceView(mounts: WorkspaceMounts, actions: WorkspaceViewActions): { openCommands(): void; openSkills(): void; update(state: WorkspaceViewState): void; dispose(): void } {
  const { input } = mounts; const doc = input.ownerDocument; const container = input.parentElement ?? mounts.context;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.textContent = text; node.className = className; return node; };
  const chips = create('div', '', 'zchatgpt-workspace-chips'); chips.dataset.zchatgptWorkspaceChips = ''; mounts.context.append(chips);
  const status = create('p', '', 'zchatgpt-workspace-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const preview = create('div', '', 'zchatgpt-workspace-preview'); preview.setAttribute('role', 'dialog'); preview.setAttribute('aria-label', 'Reference preview'); preview.hidden = true; container.append(preview);
  let state: WorkspaceViewState | null = null; let disposed = false; let composing = false;
  let searchController: AbortController | null = null; let previewController: AbortController | null = null; let querySerial = 0;
  let filter: ReferenceFilter = 'all'; let mode: 'references' | 'skills' = 'references'; let query = '';
  let trigger: { start: number; end: number; original: string } | null = null;
  const references = new Map<string, ReaderReference>();
  const run = async (action: () => Promise<void>, control?: HTMLButtonElement | HTMLInputElement | HTMLSelectElement) => {
    if (control?.disabled || disposed) return;
    if (control) control.disabled = true;
    status.hidden = true;
    try { await action(); }
    catch (error) { if (!disposed) { status.textContent = failure(error); status.hidden = false; } }
    finally { if (control?.isConnected) control.disabled = false; }
  };
  const button = (label: string, action: () => void, text = label) => {
    const node = create('button', text, 'zchatgpt-workspace-control'); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label;
    node.addEventListener('click', action); return node;
  };
  const clearTrigger = (selected: typeof trigger, original: string) => {
    if (disposed || input.value !== original) return;
    if (selected) {
      input.setRangeText('', selected.start, selected.end, 'end');
      input.dispatchEvent(new doc.defaultView!.Event('input', { bubbles: true }));
    }
    menu.close(); input.focus();
  };
  const menu = mountCommandMenu(input, container, async id => {
    const selected = trigger ? { ...trigger } : null; const original = input.value;
    if (id.startsWith('skill:')) {
      const skill = state?.settings.skills.find(item => `skill:${item.id}` === id);
      if (!skill || !skill.enabled || skill.unsupportedDependencies.length) throw new Error('This skill is not available.');
      await actions.selectSkill(skill.id);
    } else {
      const reference = references.get(id); if (!reference) throw new Error('Choose a current search result.');
      await actions.addReference(reference);
    }
    clearTrigger(selected, original);
  });
  const search = () => {
    if (disposed || !state) return;
    searchController?.abort(); const current = ++querySerial;
    for (const [kind, control] of filterControls) control.setAttribute('aria-pressed', String(kind === filter));
    // The field is the reference chooser's own; the skills scope is still driven by the composer.
    searchField.hidden = mode !== 'references';
    if (doc.activeElement !== searchField && searchField.value !== query) searchField.value = query;
    if (mode === 'skills') {
      const needle = query.toLocaleLowerCase();
      const installed = state.settings.skills;
      menu.update({ kind: 'commands', heading: 'Installed skills', empty: installed.length ? 'No matching skills' : 'No skills installed.', items: installed.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)).map(skill => ({
        id: `skill:${skill.id}`, label: `/${skill.name}`, description: [skill.description, `${skill.origin} · v${skill.version}`, !skill.enabled ? 'Disabled' : '', ...skill.unsupportedDependencies].filter(Boolean).join(' · '), disabled: !skill.enabled || !!skill.unsupportedDependencies.length,
      })) });
      return;
    }
    const controller = new AbortController(); searchController = controller;
    menu.update({ kind: 'references', heading: 'References', items: [], loading: true });
    void actions.searchReferences(query, filter, controller.signal).then(results => {
      if (disposed || controller.signal.aborted || current !== querySerial || !menu.isOpen()) return;
      references.clear();
      const items = results.filter(reference => (reference.kind === 'article' || reference.kind === 'chat') && (filter === 'all' || reference.kind === filter));
      for (const reference of items) references.set(`reference:${reference.id}`, reference);
      menu.update({ kind: 'references', heading: 'References', items: items.map(reference => ({ id: `reference:${reference.id}`, label: reference.label, description: referenceDetail(reference) })), empty: query ? 'No matches' : 'Type a title, author or year to search.' });
    }).catch(error => {
      if (!disposed && !controller.signal.aborted && current === querySerial && menu.isOpen()) menu.update({ kind: 'references', heading: 'References', items: [], error: failure(error) });
    });
  };
  // Only reference-type filters live here. Installed skills are the '/'-menu's own scope,
  // reached by typing '/', not by crossing over from an '@' reference search.
  const filterControls = new Map<ReferenceFilter, HTMLButtonElement>();
  for (const [kind, label] of [['all', 'All'], ['article', 'Articles'], ['chat', 'Chats']] as const) {
    const control = button(label, () => { mode = 'references'; filter = kind; search(); input.focus(); });
    filterControls.set(kind, control); menu.toolbar.append(control);
  }
  /**
   * The reference chooser opened from the plus popover has no '@' trigger to type after, so the menu
   * carries this field itself: without it the popover could only ever show the empty-query state.
   * Typing here runs exactly the search the '@' route runs. The field only mirrors the query while
   * the composer owns the caret, so the two routes never fight over the same text, and the menu's own
   * key handling already covers Arrow/Enter/Escape for anything focused inside it.
   */
  const searchField = create('input', '', 'zchatgpt-workspace-search');
  searchField.type = 'search'; searchField.hidden = true;
  searchField.placeholder = 'Search references…'; searchField.setAttribute('aria-label', 'Search references');
  searchField.addEventListener('input', () => {
    if (disposed) return;
    mode = 'references'; query = searchField.value.trim(); search();
  });
  menu.toolbar.append(searchField);
  /** The composer's plus popover routes here for references; no visible '@' trigger is mounted. */
  const openCommands = () => { trigger = null; query = ''; mode = 'references'; search(); searchField.focus(); };
  /**
   * The Skill row in the same popover opens the `/` chooser directly, so choosing a skill for this
   * chat no longer requires the reader to know the slash syntax. It keeps the same "never rewrite the
   * draft" contract as the reference shortcut: only the menu's own scope changes.
   */
  const openSkills = () => { trigger = null; query = ''; mode = 'skills'; search(); input.focus(); };
  const onInput = () => {
    if (composing) return;
    const end = input.selectionStart; const prefix = input.value.slice(0, end);
    if (end !== input.selectionEnd) { trigger = null; searchController?.abort(); querySerial++; menu.close(); return; }
    const match = /(?:^|\s)([@/])([^@/\n]*)$/u.exec(prefix);
    if (!match) { trigger = null; searchController?.abort(); querySerial++; menu.close(); return; }
    const symbol = match[1]!;
    trigger = { start: match.index + match[0].indexOf(symbol), end, original: input.value };
    query = match[2] ?? ''; mode = symbol === '/' ? 'skills' : 'references';
    if (mode === 'skills') query = query.replace(/^skills?(?:\s+|$)/iu, '');
    else {
      const typedFilter = /^(articles?|chats?)(?:\s+|$)/iu.exec(query);
      if (typedFilter) { filter = typedFilter[1]!.toLocaleLowerCase().startsWith('chat') ? 'chat' : 'article'; query = query.slice(typedFilter[0].length); }
    }
    search();
  };
  const onCaretKey = (event: KeyboardEvent) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) onInput(); };
  const onStart = () => { composing = true; }; const onEnd = () => { composing = false; onInput(); };
  input.addEventListener('input', onInput); input.addEventListener('click', onInput); input.addEventListener('keyup', onCaretKey); input.addEventListener('compositionstart', onStart); input.addEventListener('compositionend', onEnd);

  const closePreview = () => { previewController?.abort(); preview.hidden = true; input.focus(); };
  const previewRow = create('div', '', 'zchatgpt-workspace-preview-title');
  const previewHeading = create('strong'); const previewDetail = create('p', '', 'zchatgpt-workspace-muted'); const previewBody = create('pre');
  const previewClose = button('Close preview', closePreview, '×');
  const previewRange = create('div', '', 'zchatgpt-workspace-actions'); previewRange.hidden = true;
  previewRow.append(previewHeading, previewClose); preview.append(previewRow, previewDetail, previewRange, previewBody);
  const showPreview = (title: string, text: string, detail = '') => {
    const opening = preview.hidden;
    previewRange.hidden = true;
    previewHeading.textContent = title; previewDetail.textContent = detail;
    previewBody.textContent = text.length > 16000 ? `${text.slice(0, 16000)}\n\nPreview limited to 16,000 characters.` : text;
    preview.hidden = false;
    menu.close();
    if (opening) previewClose.focus();
    const pane = input.closest<HTMLElement>('[data-zchatgpt-sidebar]');
    const bounds = pane?.getBoundingClientRect(); const anchor = container.getBoundingClientRect();
    if (bounds?.height && anchor.height) preview.style.maxHeight = `${Math.max(0, Math.min(280, anchor.top - bounds.top - 6))}px`;
  };
  const openReference = async (reference: ReaderReference) => {
    previewController?.abort(); const controller = new AbortController(); previewController = controller;
    showPreview(reference.label, 'Loading preview…', referenceDetail(reference));
    try {
      const resolved = await actions.previewReference(reference, controller.signal);
      if (!disposed && !controller.signal.aborted) {
        showPreview(reference.label, resolved.text ?? resolved.document?.pages.map(page => `p. ${page.pageLabel}\n${page.text}`).join('\n\n') ?? 'No text is available in this snapshot.', referenceDetail(reference));
        if (reference.kind === 'article' && resolved.document && actions.setReferenceRange) {
          const first = create('input'); const last = create('input');
          for (const [field, label, value] of [[first, 'Reference first PDF page', reference.range?.[0] ?? 1], [last, 'Reference last PDF page', reference.range?.[1] ?? resolved.document.totalPages]] as const) { field.type = 'number'; field.min = '1'; field.max = String(resolved.document.totalPages); field.value = String(value); field.setAttribute('aria-label', label); field.style.width = '64px'; }
          const apply = async (range: [number, number] | null) => {
            await actions.setReferenceRange!(reference.id, range); const updated = { ...reference }; if (range) updated.range = range; else delete updated.range; await openReference(updated);
          };
          previewRange.replaceChildren(first, last, button('Use reference pages', () => { void run(() => apply([Number(first.value), Number(last.value)])); }), button('Use entire reference', () => { void run(() => apply(null)); })); previewRange.hidden = false;
        }
      }
    } catch (error) { if (!disposed && !controller.signal.aborted) showPreview(reference.label, failure(error), referenceDetail(reference)); }
  };
  preview.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopPropagation(); closePreview(); } });
  const outsidePreview = (event: Event) => { if (!preview.hidden && !preview.contains(event.target as Node | null) && !chips.contains(event.target as Node | null)) { previewController?.abort(); preview.hidden = true; } };
  doc.addEventListener('pointerdown', outsidePreview);
  const renderChips = () => {
    if (!state) return;
    const nodes: HTMLElement[] = [];
    const chip = (label: string, previewLabel: string, open: () => void, removeLabel: string, remove: () => Promise<void>) => {
      const row = create('div', '', 'zchatgpt-workspace-chip');
      const removeButton = button(removeLabel, () => { void run(async () => { await remove(); if (!disposed) input.focus(); }, removeButton); }, '×');
      row.append(button(previewLabel, open, label), removeButton); nodes.push(row);
    };
    for (const reference of state.draft.references) chip(`${reference.label}${reference.range ? ` · pp.${reference.range[0]}–${reference.range[1]}` : ''}`, `Preview ${reference.label}`, () => { void openReference(reference); }, `Remove ${reference.label}`, () => actions.removeReference(reference.id));
    const selectedSkill = state.settings.skills.find(skill => skill.id === state!.draft.skillId);
    if (selectedSkill) chip(`/${selectedSkill.name}`, `Preview skill ${selectedSkill.name}`, () => showPreview(selectedSkill.name, selectedSkill.markdown, `${selectedSkill.origin} · v${selectedSkill.version}`), `Remove skill ${selectedSkill.name}`, () => actions.selectSkill(null));
    chips.replaceChildren(...nodes);
  };

  // Per-chat research profiles are gone from the composer: profiles are configured in Zotero's own
  // Preferences window, and a request uses those global preferences. A draft saved before this
  // removal still carries `profileId` and keeps applying at send time (see presenter's profile
  // resolution), so the field stays in the data model but has no control here.
  /** The status slot reports refusals from the scoped controls (reference and skill chips). */
  mounts.context.append(status);
  let chipsKey = '';
  return { openCommands, openSkills, update: next => {
    if (disposed) return; state = next;
    const nextChips = JSON.stringify([next.draft, next.settings.skills.map(skill => [skill.id, skill.name, skill.revision])]);
    if (nextChips !== chipsKey) { chipsKey = nextChips; renderChips(); }
  }, dispose: () => {
    if (disposed) return; disposed = true; searchController?.abort(); previewController?.abort(); querySerial++;
    input.removeEventListener('input', onInput); input.removeEventListener('click', onInput); input.removeEventListener('keyup', onCaretKey); input.removeEventListener('compositionstart', onStart); input.removeEventListener('compositionend', onEnd);
    doc.removeEventListener('pointerdown', outsidePreview); menu.dispose(); preview.remove(); chips.remove(); status.remove();
  } };
}
