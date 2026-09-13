import type { ReaderReference, ReaderSkill, ReferenceInput, WorkflowKind, WorkspaceDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { mountCommandMenu } from './command-menu.ts';

export type ReferenceFilter = 'all' | 'article' | 'chat';
export interface SkillEdit { id: string | null; name: string; description: string; version: string; workflow: WorkflowKind; markdown: string; enabled: boolean; revision?: string }
export interface WorkspaceViewState { settings: WorkspaceSettings; draft: Pick<WorkspaceDraft, 'references' | 'skillId' | 'profileId'> }
export interface WorkspaceViewActions {
  searchReferences: (query: string, kind: ReferenceFilter, signal: AbortSignal) => Promise<ReaderReference[]>;
  previewReference: (reference: ReaderReference, signal: AbortSignal) => Promise<ReferenceInput>;
  addReference: (reference: ReaderReference) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
  selectSkill: (id: string | null) => Promise<void>;
  selectProfile: (id: string | null) => Promise<void>;
  saveSkill: (edit: SkillEdit) => Promise<ReaderSkill>;
  duplicateSkill: (id: string) => Promise<ReaderSkill>;
  deleteSkill: (id: string) => Promise<void>;
  importSkill: () => Promise<ReaderSkill | null>;
  exportSkill: (id: string) => Promise<void>;
  setReferenceRange?: (id: string, range: [number, number] | null) => Promise<void>;
}
export interface WorkspaceMounts { input: HTMLTextAreaElement; context: HTMLElement; leading: HTMLElement; settings: HTMLElement }

function failure(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
/** Reconcile keyed children in place so open rows and scroll survive unrelated updates. */
function placeChildren(parent: HTMLElement, nodes: HTMLElement[]): void {
  const wanted = new Set(nodes);
  for (const child of [...parent.children]) if (!wanted.has(child as HTMLElement)) child.remove();
  let cursor = parent.firstElementChild;
  for (const node of nodes) { if (node !== cursor) parent.insertBefore(node, cursor); cursor = node.nextElementSibling; }
}
function referenceDetail(reference: ReaderReference): string {
  return [reference.identity?.authors.join(', '), reference.identity?.year, reference.kind === 'chat' ? 'Chat snapshot' : reference.kind, reference.paper?.attachmentKey].filter(Boolean).join(' · ');
}

/** Scoped controls only. Persistence, library reads and workflow execution stay in explicit ports. */
export function mountWorkspaceView(mounts: WorkspaceMounts, actions: WorkspaceViewActions): { openCommands(): void; update(state: WorkspaceViewState): void; dispose(): void } {
  const { input } = mounts; const doc = input.ownerDocument; const container = input.parentElement ?? mounts.context;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.textContent = text; node.className = className; return node; };
  const chips = create('div', '', 'zcr-workspace-chips'); chips.dataset.zcrWorkspaceChips = ''; mounts.context.append(chips);
  const advanced = create('div', '', 'zcr-workspace-settings'); advanced.dataset.zcrWorkspaceSettings = ''; mounts.settings.append(advanced);
  const status = create('p', '', 'zcr-workspace-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const preview = create('div', '', 'zcr-workspace-preview'); preview.setAttribute('role', 'dialog'); preview.setAttribute('aria-label', 'Reference preview'); preview.hidden = true; container.append(preview);
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
    const node = create('button', text, 'zcr-workspace-control'); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label;
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
      if (!skill || !skill.enabled || skill.unsupportedDependencies.length) throw new Error('This workflow is not available.');
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
    for (const [kind, control] of filterControls) control.setAttribute('aria-pressed', String(kind === (mode === 'skills' ? 'skills' : filter)));
    if (mode === 'skills') {
      const needle = query.toLocaleLowerCase();
      menu.update({ heading: 'Installed workflows', items: state.settings.skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)).map(skill => ({
        id: `skill:${skill.id}`, label: `/${skill.name}`, description: [skill.description, `${skill.origin} · v${skill.version}`, !skill.enabled ? 'Disabled' : '', ...skill.unsupportedDependencies].filter(Boolean).join(' · '), disabled: !skill.enabled || !!skill.unsupportedDependencies.length,
      })) });
      return;
    }
    const controller = new AbortController(); searchController = controller;
    menu.update({ heading: 'References', items: [], loading: true });
    void actions.searchReferences(query, filter, controller.signal).then(results => {
      if (disposed || controller.signal.aborted || current !== querySerial || !menu.isOpen()) return;
      references.clear();
      const items = results.filter(reference => (reference.kind === 'article' || reference.kind === 'chat') && (filter === 'all' || reference.kind === filter));
      for (const reference of items) references.set(`reference:${reference.id}`, reference);
      menu.update({ heading: 'References', items: items.map(reference => ({ id: `reference:${reference.id}`, label: reference.label, description: referenceDetail(reference) })) });
    }).catch(error => {
      if (!disposed && !controller.signal.aborted && current === querySerial && menu.isOpen()) menu.update({ heading: 'References', items: [], error: failure(error) });
    });
  };
  const filterControls = new Map<ReferenceFilter | 'skills', HTMLButtonElement>();
  for (const [kind, label] of [['all', 'All'], ['article', 'Articles'], ['chat', 'Chats'], ['skills', 'Workflows']] as const) {
    const control = button(label, () => { mode = kind === 'skills' ? 'skills' : 'references'; if (kind !== 'skills') filter = kind; search(); input.focus(); });
    filterControls.set(kind, control); menu.toolbar.append(control);
  }
  /** The composer's single plus button routes here; no visible '@' trigger is mounted. */
  const openCommands = () => { trigger = null; query = ''; mode = 'references'; search(); input.focus(); };
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
  const previewRow = create('div', '', 'zcr-workspace-preview-title');
  const previewHeading = create('strong'); const previewDetail = create('p', '', 'zcr-workspace-muted'); const previewBody = create('pre');
  const previewClose = button('Close preview', closePreview, '×');
  const previewRange = create('div', '', 'zcr-workspace-actions'); previewRange.hidden = true;
  previewRow.append(previewHeading, previewClose); preview.append(previewRow, previewDetail, previewRange, previewBody);
  const showPreview = (title: string, text: string, detail = '') => {
    const opening = preview.hidden;
    previewRange.hidden = true;
    previewHeading.textContent = title; previewDetail.textContent = detail;
    previewBody.textContent = text.length > 16000 ? `${text.slice(0, 16000)}\n\nPreview limited to 16,000 characters.` : text;
    preview.hidden = false;
    menu.close();
    if (opening) previewClose.focus();
    const pane = input.closest<HTMLElement>('[data-zcr-sidebar]');
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
      const row = create('div', '', 'zcr-workspace-chip');
      const removeButton = button(removeLabel, () => { void run(async () => { await remove(); if (!disposed) input.focus(); }, removeButton); }, '×');
      row.append(button(previewLabel, open, label), removeButton); nodes.push(row);
    };
    for (const reference of state.draft.references) chip(`${reference.label}${reference.range ? ` · pp.${reference.range[0]}–${reference.range[1]}` : ''}`, `Preview ${reference.label}`, () => { void openReference(reference); }, `Remove ${reference.label}`, () => actions.removeReference(reference.id));
    const selectedSkill = state.settings.skills.find(skill => skill.id === state!.draft.skillId);
    if (selectedSkill) chip(`/${selectedSkill.name}`, `Preview workflow ${selectedSkill.name}`, () => showPreview(selectedSkill.name, selectedSkill.markdown, `${selectedSkill.origin} · v${selectedSkill.version}`), `Remove workflow ${selectedSkill.name}`, () => actions.selectSkill(null));
    const selectedProfile = state.settings.profiles.find(profile => profile.id === state!.draft.profileId);
    if (selectedProfile) chip(selectedProfile.name, `Preview profile ${selectedProfile.name}`, () => showPreview(selectedProfile.name, Object.entries(selectedProfile.preferences).map(([name, value]) => `${name}: ${value}`).join('\n')), `Remove profile ${selectedProfile.name}`, () => actions.selectProfile(null));
    chips.replaceChildren(...nodes);
  };

  const profileLabel = create('label', 'Research profile for this chat');
  const profile = create('select'); profile.dataset.zcrProfile = ''; profileLabel.append(profile); advanced.append(profileLabel);
  profile.addEventListener('change', () => {
    const selected = profile.value || null;
    void run(async () => {
      try { await actions.selectProfile(selected); }
      catch (error) { profile.value = state?.draft.profileId ?? ''; throw error; }
    }, profile);
  });
  // Global answer preferences, research profiles and workflow availability live in Zotero's own
  // Preferences window; this pane only chooses what applies to the current chat.
  const globalHint = create('p', "Answer preferences, research profiles and workflow availability are in Zotero's Preferences window.", 'zcr-workspace-muted');
  globalHint.dataset.zcrGlobalHint = '';
  advanced.append(globalHint);
  const labeled = (parent: HTMLElement, name: string, title: string, kind: 'input' | 'textarea' | 'select', choices?: Array<[string, string]>) => {
    const label = create('label', title); const control = create(kind); control.name = name;
    if (control.tagName === 'SELECT') for (const [value, title] of choices ?? []) { const option = create('option', title); option.value = value; control.append(option); }
    label.append(control); parent.append(label); return control;
  };

  const skillsDetails = create('details'); skillsDetails.append(create('summary', 'Installed workflows'));
  const skillActions = create('div', '', 'zcr-workspace-actions'); const skillList = create('div'); const editor = create('div');
  skillsDetails.append(skillActions, editor, skillList); advanced.append(skillsDetails, status);
  const openEditor = (skill: ReaderSkill | null) => {
    editor.replaceChildren(); editor.className = 'zcr-workspace-editor'; editor.dataset.zcrSkillEditor = ''; skillsDetails.open = true;
    editor.append(create('strong', skill ? `Edit ${skill.name}` : 'Create workflow'));
    const name = labeled(editor, 'name', 'Name', 'input'); name.value = skill?.name ?? '';
    const description = labeled(editor, 'description', 'Description', 'input'); description.value = skill?.description ?? '';
    const version = labeled(editor, 'version', 'Version', 'input'); version.value = skill?.version ?? '1.0.0';
    const workflow = labeled(editor, 'workflow', 'Workflow', 'select', [['read', 'Read and explain'], ['annotate', 'Review annotations'], ['acquire', 'Acquire literature'], ['diagram', 'Create diagram']]); workflow.value = skill?.workflow ?? 'read';
    const markdown = labeled(editor, 'markdown', 'SKILL.md content', 'textarea'); markdown.value = skill?.markdown ?? '';
    const enabledLabel = create('label', 'Enabled', 'zcr-workspace-check'); const enabled = create('input'); enabled.type = 'checkbox'; enabled.checked = skill?.enabled ?? true; enabledLabel.prepend(enabled); editor.append(enabledLabel);
    if (skill) editor.append(create('p', [`Source: ${skill.origin}`, `Permissions: ${skill.permissions.join(', ') || 'none'}`, `Unsupported dependencies: ${skill.unsupportedDependencies.join(', ') || 'none'}`].join('\n'), 'zcr-workspace-muted'));
    const save = button('Save workflow', () => {
      const missing = [name, version, markdown].find(field => !field.value.trim());
      if (missing) { status.textContent = 'Name, version and SKILL.md content are required.'; status.hidden = false; missing.focus(); return; }
      const kind = workflow.value; if (kind !== 'read' && kind !== 'annotate' && kind !== 'acquire' && kind !== 'diagram') return;
      const edit: SkillEdit = { id: skill?.id ?? null, name: name.value.trim(), description: description.value, version: version.value.trim(), workflow: kind, markdown: markdown.value, enabled: enabled.checked, ...(skill ? { revision: skill.revision } : {}) };
      void run(async () => {
        const fields = [name, description, version, workflow, markdown, enabled];
        for (const field of fields) field.disabled = true;
        try { await actions.saveSkill(edit); editor.replaceChildren(); editor.removeAttribute('data-zcr-skill-editor'); status.textContent = 'Workflow saved.'; status.hidden = false; }
        finally { for (const field of fields) field.disabled = false; }
      }, save);
    });
    editor.append(save, button('Cancel editing', () => { editor.replaceChildren(); editor.removeAttribute('data-zcr-skill-editor'); })); name.focus();
  };
  const createSkill = button('Create workflow', () => openEditor(null));
  const importSkill = button('Import workflow', () => { void run(async () => { const imported = await actions.importSkill(); if (imported && !disposed) openEditor(imported); }, importSkill); });
  skillActions.append(createSkill, importSkill);
  let skillsKey = ''; let chipsKey = ''; let profilesKey = '';
  const skillRows = new Map<string, { node: HTMLDetailsElement; update(skill: ReaderSkill): void }>();
  const skillRow = (initial: ReaderSkill) => {
    let skill = initial;
    const row = create('details'); row.dataset.zcrSkillId = skill.id;
    const summary = create('summary'); const description = create('p', '', 'zcr-workspace-muted');
    const unsupported = create('p', '', 'zcr-workspace-muted');
    const controls = create('div', '', 'zcr-workspace-actions');
    const duplicate = button('Duplicate', () => { void run(async () => { const copy = await actions.duplicateSkill(skill.id); if (!disposed) openEditor(copy); }, duplicate); }, 'Duplicate');
    const exportSkill = button('Export', () => { void run(() => actions.exportSkill(skill.id), exportSkill); }, 'Export');
    const trySkill = button('Try in draft', () => { void run(async () => { await actions.selectSkill(skill.id); input.focus(); }, trySkill); }, 'Try in draft');
    const confirm = create('div', '', 'zcr-workspace-actions'); confirm.hidden = true;
    const remove = button('Delete', () => { void run(async () => { await actions.deleteSkill(skill.id); confirm.hidden = true; }, remove); }, 'Delete');
    const prompt = create('span'); const edit = button('Edit', () => openEditor(skill), 'Edit'); const askDelete = button('Delete', () => { confirm.hidden = false; }, 'Delete'); const cancel = button('Cancel', () => { confirm.hidden = true; }, 'Cancel');
    confirm.append(prompt, remove, cancel);
    controls.append(trySkill, duplicate, exportSkill);
    row.append(summary, description, unsupported, controls, confirm);
    const update = (next: ReaderSkill) => {
      skill = next;
      summary.textContent = next.name;
      description.textContent = `${next.description}\n${next.origin} · v${next.version} · ${next.workflow}`;
      unsupported.textContent = next.unsupportedDependencies.length ? `Unavailable: ${next.unsupportedDependencies.join(', ')}` : '';
      unsupported.hidden = !next.unsupportedDependencies.length;
      trySkill.disabled = !next.enabled || !!next.unsupportedDependencies.length;
      duplicate.setAttribute('aria-label', `Duplicate ${next.name}`); exportSkill.setAttribute('aria-label', `Export ${next.name}`);
      trySkill.setAttribute('aria-label', `Try ${next.name} in draft`); prompt.textContent = `Delete ${next.name}?`;
      remove.setAttribute('aria-label', `Confirm delete ${next.name}`); edit.setAttribute('aria-label', `Edit ${next.name}`);
      askDelete.setAttribute('aria-label', `Delete ${next.name}`); cancel.setAttribute('aria-label', `Cancel delete ${next.name}`);
      if (next.origin !== 'builtin') controls.append(edit, askDelete);
      else { edit.remove(); askDelete.remove(); }
    };
    update(initial);
    return { node: row, update };
  };
  const renderSkills = () => {
    if (!state) return;
    const wanted = new Set(state.settings.skills.map(skill => skill.id));
    for (const [id, entry] of skillRows) if (!wanted.has(id)) { entry.node.remove(); skillRows.delete(id); }
    const nodes = state.settings.skills.map(skill => {
      let entry = skillRows.get(skill.id);
      if (!entry) { entry = skillRow(skill); skillRows.set(skill.id, entry); } else entry.update(skill);
      return entry.node;
    });
    placeChildren(skillList, nodes);
    if (!nodes.length) skillList.append(create('p', 'No workflows installed.', 'zcr-workspace-muted'));
  };
  return { openCommands, update: next => {
    if (disposed) return; state = next;
    const nextChips = JSON.stringify([next.draft, next.settings.skills.map(skill => [skill.id, skill.name, skill.revision]), next.settings.profiles]);
    if (nextChips !== chipsKey) { chipsKey = nextChips; renderChips(); }
    const nextProfiles = JSON.stringify(next.settings.profiles);
    if (nextProfiles !== profilesKey) {
      profilesKey = nextProfiles; const none = create('option', 'Global preferences'); none.value = '';
      profile.replaceChildren(none, ...next.settings.profiles.map(item => { const option = create('option', item.name); option.value = item.id; return option; }));
    }
    profile.value = next.draft.profileId ?? '';
    const nextSkills = JSON.stringify(next.settings.skills);
    if (nextSkills !== skillsKey) { skillsKey = nextSkills; renderSkills(); if (menu.isOpen() && mode === 'skills') search(); }
  }, dispose: () => {
    if (disposed) return; disposed = true; searchController?.abort(); previewController?.abort(); querySerial++;
    input.removeEventListener('input', onInput); input.removeEventListener('click', onInput); input.removeEventListener('keyup', onCaretKey); input.removeEventListener('compositionstart', onStart); input.removeEventListener('compositionend', onEnd);
    doc.removeEventListener('pointerdown', outsidePreview); menu.dispose(); preview.remove(); chips.remove(); advanced.remove();
  } };
}
