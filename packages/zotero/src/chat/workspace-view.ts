import type { Personalization, ReaderReference, ReaderSkill, ReferenceInput, ResearchProfile, WorkflowKind, WorkspaceDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { mountCommandMenu } from './command-menu.ts';

export type ReferenceFilter = 'all' | 'article' | 'chat';
export interface SkillEdit { id: string | null; name: string; description: string; version: string; workflow: WorkflowKind; markdown: string; enabled: boolean; revision?: string }
export interface WorkspaceViewState { settings: WorkspaceSettings; draft: Pick<WorkspaceDraft, 'references' | 'skillId' | 'profileId'> & { overrides?: Partial<Personalization> } }
export interface WorkspaceViewActions {
  searchReferences: (query: string, kind: ReferenceFilter, signal: AbortSignal) => Promise<ReaderReference[]>;
  previewReference: (reference: ReaderReference, signal: AbortSignal) => Promise<ReferenceInput>;
  addReference: (reference: ReaderReference) => Promise<void>;
  removeReference: (id: string) => Promise<void>;
  selectSkill: (id: string | null) => Promise<void>;
  selectProfile: (id: string | null) => Promise<void>;
  savePreferences: (preferences: Personalization) => Promise<void>;
  saveSkill: (edit: SkillEdit) => Promise<ReaderSkill>;
  duplicateSkill: (id: string) => Promise<ReaderSkill>;
  setSkillEnabled: (id: string, enabled: boolean) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  importSkill: () => Promise<ReaderSkill | null>;
  exportSkill: (id: string) => Promise<void>;
  saveProfile?: (value: { id: string | null; name: string; preferences: Partial<Personalization> }) => Promise<ResearchProfile>;
  deleteProfile?: (id: string) => Promise<void>;
  setOverrides?: (value: Partial<Personalization>) => void;
  setReferenceRange?: (id: string, range: [number, number] | null) => Promise<void>;
  exportPreferences?: () => Promise<void>;
}
export interface WorkspaceMounts { input: HTMLTextAreaElement; context: HTMLElement; leading: HTMLElement; settings: HTMLElement }

function failure(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }
function referenceDetail(reference: ReaderReference): string {
  return [reference.identity?.authors.join(', '), reference.identity?.year, reference.kind === 'chat' ? 'Chat snapshot' : reference.kind, reference.paper?.attachmentKey].filter(Boolean).join(' · ');
}

/** Scoped controls only. Persistence, library reads and workflow execution stay in explicit ports. */
export function mountWorkspaceView(mounts: WorkspaceMounts, actions: WorkspaceViewActions): { update(state: WorkspaceViewState): void; dispose(): void } {
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
  const add = button('Add references or workflows', () => { trigger = null; query = ''; mode = 'references'; search(); input.focus(); }, '@'); mounts.leading.append(add);
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
  const preferenceDetails = create('details'); preferenceDetails.append(create('summary', 'Global preferences'));
  const preferenceForm = create('div'); preferenceDetails.append(preferenceForm); advanced.append(preferenceDetails);
  const preferenceControls = new Map<keyof Personalization, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  const labeled = (parent: HTMLElement, name: string, title: string, kind: 'input' | 'textarea' | 'select', choices?: Array<[string, string]>) => {
    const label = create('label', title); const control = create(kind); control.name = name;
    if (control.tagName === 'SELECT') for (const [value, title] of choices ?? []) { const option = create('option', title); option.value = value; control.append(option); }
    label.append(control); parent.append(label); return control;
  };
  preferenceControls.set('language', labeled(preferenceForm, 'language', 'Answer language', 'input'));
  preferenceControls.set('detail', labeled(preferenceForm, 'detail', 'Answer detail', 'select', [['brief', 'Brief'], ['standard', 'Standard'], ['detailed', 'Detailed']]));
  preferenceControls.set('mathematics', labeled(preferenceForm, 'mathematics', 'Mathematical explanation', 'select', [['auto', 'Automatic'], ['intuition-first', 'Intuition first'], ['formal', 'Formal derivation']]));
  preferenceControls.set('background', labeled(preferenceForm, 'background', 'Research background', 'textarea'));
  preferenceControls.set('citationStyle', labeled(preferenceForm, 'citationStyle', 'Citation style', 'input'));
  preferenceControls.set('annotationStyle', labeled(preferenceForm, 'annotationStyle', 'Annotation style', 'input'));
  let preferencesDirty = false;
  preferenceForm.addEventListener('input', () => { preferencesDirty = true; }); preferenceForm.addEventListener('change', () => { preferencesDirty = true; });
  const formPreferences = (): Personalization => {
    const next = { ...state!.settings.preferences };
    next.language = preferenceControls.get('language')!.value.trim(); next.background = preferenceControls.get('background')!.value;
    next.citationStyle = preferenceControls.get('citationStyle')!.value; next.annotationStyle = preferenceControls.get('annotationStyle')!.value;
    const detail = preferenceControls.get('detail')!.value; if (detail === 'brief' || detail === 'standard' || detail === 'detailed') next.detail = detail;
    const mathematics = preferenceControls.get('mathematics')!.value; if (mathematics === 'auto' || mathematics === 'intuition-first' || mathematics === 'formal') next.mathematics = mathematics;
    return next;
  };
  const savePreferences = button(actions.saveProfile ? 'Save global preferences' : 'Save preferences', () => {
    if (!state) return;
    const next = formPreferences();
    void run(async () => {
      for (const control of preferenceControls.values()) control.disabled = true;
      try { await actions.savePreferences(next); preferencesDirty = false; status.textContent = 'Preferences saved.'; status.hidden = false; }
      finally { for (const control of preferenceControls.values()) control.disabled = false; }
    }, savePreferences);
  }); preferenceForm.append(savePreferences);
  if (actions.exportPreferences) preferenceForm.append(button('Export preferences', () => { void run(() => actions.exportPreferences!()); }));
  const profileName = actions.saveProfile ? labeled(preferenceForm, 'profile-name', 'Research profile name', 'input') : null;
  if (actions.saveProfile && profileName) {
    const save = (replace: boolean) => {
      if (!state || !profileName.value.trim()) { profileName.focus(); return; }
      const value = { id: replace ? state.draft.profileId : null, name: profileName.value.trim(), preferences: formPreferences() };
      void run(async () => { const saved = await actions.saveProfile!(value); await actions.selectProfile(saved.id); preferencesDirty = false; status.textContent = 'Research profile saved.'; status.hidden = false; });
    };
    preferenceForm.append(button('Save as new profile', () => save(false)), button('Update selected profile', () => { if (state?.draft.profileId) save(true); }));
    if (actions.deleteProfile) preferenceForm.append(button('Delete selected profile', () => { const id = state?.draft.profileId; if (id) void run(async () => { await actions.deleteProfile!(id); await actions.selectProfile(null); }); }));
  }
  const overrideControls = new Map<keyof Personalization, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  if (actions.setOverrides) {
    const overrides = create('details'); overrides.append(create('summary', 'Chat overrides'));
    overrideControls.set('language', labeled(overrides, 'override-language', 'Answer language for this chat', 'input'));
    overrideControls.set('detail', labeled(overrides, 'override-detail', 'Answer detail for this chat', 'select', [['', 'Inherit'], ['brief', 'Brief'], ['standard', 'Standard'], ['detailed', 'Detailed']]));
    overrideControls.set('mathematics', labeled(overrides, 'override-mathematics', 'Mathematics for this chat', 'select', [['', 'Inherit'], ['auto', 'Automatic'], ['intuition-first', 'Intuition first'], ['formal', 'Formal derivation']]));
    for (const [field, control] of overrideControls) control.addEventListener('change', () => {
      const next: Partial<Personalization> = { ...state?.draft.overrides };
      const value = control.value.trim();
      if (!value) delete next[field];
      else if (field === 'language') next.language = value;
      else if (field === 'detail' && (value === 'brief' || value === 'standard' || value === 'detailed')) next.detail = value;
      else if (field === 'mathematics' && (value === 'auto' || value === 'intuition-first' || value === 'formal')) next.mathematics = value;
      actions.setOverrides!(next);
    });
    overrides.append(button('Clear chat overrides', () => actions.setOverrides!({}))); advanced.append(overrides);
  }

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
  const renderSkills = () => {
    if (!state) return;
    skillList.replaceChildren(...state.settings.skills.map(skill => {
      const row = create('details'); row.append(create('summary', skill.name));
      row.append(create('p', `${skill.description}\n${skill.origin} · v${skill.version} · ${skill.workflow}`, 'zcr-workspace-muted'));
      if (skill.unsupportedDependencies.length) row.append(create('p', `Unavailable: ${skill.unsupportedDependencies.join(', ')}`, 'zcr-workspace-muted'));
      const enabledLabel = create('label', 'Enabled', 'zcr-workspace-check'); const enabled = create('input'); enabled.type = 'checkbox'; enabled.checked = skill.enabled; enabled.dataset.zcrSkillEnabled = skill.id; enabledLabel.prepend(enabled); row.append(enabledLabel);
      enabled.addEventListener('change', () => {
        const next = enabled.checked;
        void run(async () => {
          try {
            await actions.setSkillEnabled(skill.id, next);
            [...skillList.querySelectorAll<HTMLInputElement>('[data-zcr-skill-enabled]')].find(control => control.dataset.zcrSkillEnabled === skill.id)?.focus();
          } catch (error) { enabled.checked = state?.settings.skills.find(item => item.id === skill.id)?.enabled ?? skill.enabled; throw error; }
        }, enabled);
      });
      const controls = create('div', '', 'zcr-workspace-actions');
      const duplicate = button(`Duplicate ${skill.name}`, () => { void run(async () => { const copy = await actions.duplicateSkill(skill.id); if (!disposed) openEditor(copy); }, duplicate); }, 'Duplicate');
      const exportSkill = button(`Export ${skill.name}`, () => { void run(() => actions.exportSkill(skill.id), exportSkill); }, 'Export');
      const trySkill = button(`Try ${skill.name} in draft`, () => { void run(async () => { await actions.selectSkill(skill.id); input.focus(); }, trySkill); }, 'Try in draft');
      trySkill.disabled = !skill.enabled || !!skill.unsupportedDependencies.length;
      const confirm = create('div', '', 'zcr-workspace-actions'); confirm.hidden = true;
      const remove = button(`Confirm delete ${skill.name}`, () => { void run(async () => { await actions.deleteSkill(skill.id); confirm.hidden = true; }, remove); }, 'Delete');
      confirm.append(create('span', `Delete ${skill.name}?`), remove, button(`Cancel delete ${skill.name}`, () => { confirm.hidden = true; }, 'Cancel'));
      controls.append(trySkill, duplicate, exportSkill);
      if (skill.origin !== 'builtin') controls.append(button(`Edit ${skill.name}`, () => openEditor(skill), 'Edit'), button(`Delete ${skill.name}`, () => { confirm.hidden = false; }, 'Delete'));
      row.append(controls, confirm); return row;
    }));
    if (!state.settings.skills.length) skillList.append(create('p', 'No workflows installed.', 'zcr-workspace-muted'));
  };
  return { update: next => {
    if (disposed) return; state = next;
    const nextChips = JSON.stringify([next.draft, next.settings.skills.map(skill => [skill.id, skill.name, skill.revision]), next.settings.profiles]);
    if (nextChips !== chipsKey) { chipsKey = nextChips; renderChips(); }
    const nextProfiles = JSON.stringify(next.settings.profiles);
    if (nextProfiles !== profilesKey) {
      profilesKey = nextProfiles; const none = create('option', 'Global preferences'); none.value = '';
      profile.replaceChildren(none, ...next.settings.profiles.map(item => { const option = create('option', item.name); option.value = item.id; return option; }));
    }
    profile.value = next.draft.profileId ?? '';
    const selectedProfile = next.settings.profiles.find(item => item.id === next.draft.profileId);
    if (profileName && doc.activeElement !== profileName) profileName.value = selectedProfile?.name ?? '';
    for (const [field, control] of overrideControls) if (doc.activeElement !== control) control.value = next.draft.overrides?.[field] ?? '';
    if (!preferencesDirty) for (const [name, control] of preferenceControls) control.value = actions.saveProfile && selectedProfile ? { ...next.settings.preferences, ...selectedProfile.preferences }[name] : next.settings.preferences[name];
    const nextSkills = JSON.stringify(next.settings.skills);
    if (nextSkills !== skillsKey) { skillsKey = nextSkills; renderSkills(); if (menu.isOpen() && mode === 'skills') search(); }
  }, dispose: () => {
    if (disposed) return; disposed = true; searchController?.abort(); previewController?.abort(); querySerial++;
    input.removeEventListener('input', onInput); input.removeEventListener('click', onInput); input.removeEventListener('keyup', onCaretKey); input.removeEventListener('compositionstart', onStart); input.removeEventListener('compositionend', onEnd);
    doc.removeEventListener('pointerdown', outsidePreview); menu.dispose(); preview.remove(); chips.remove(); advanced.remove(); add.remove();
  } };
}
