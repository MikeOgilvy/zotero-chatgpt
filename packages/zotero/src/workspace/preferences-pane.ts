import type { AllowedModel, Personalization, ReaderSkill, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { defaultAllowedModels, isOfferableModelId, MODEL_ID, modelChoices, modelLabel, type ModelCandidate } from '../../../core/src/workspace/allowed-models.ts';
import { CHAT_TEXT_SCALE_MAX, CHAT_TEXT_SCALE_MIN, clampChatTextScale } from '../chat/text-scale.ts';
import { mountUILocale } from '../chat/ui-locale.ts';
import { createHistorySection, type HistorySection } from './history-section.ts';

/**
 * Native Zotero Preferences pane for the global workspace settings.
 *
 * The pane is a thin, keyboard-operable form over the existing workspace store: every write is a
 * full validated snapshot (or a single supported skill), the store keeps its atomic writes and
 * revision conflicts, and the pane re-reads after every write so it never shows a state the store
 * refused. Per-chat overrides stay in the sidebar and are never written from here.
 *
 * Copy follows the stored UI language through the same localizer the sidebar uses. Skill names, ids,
 * versions, model ids and file paths are never translated.
 */
export interface PreferencesPaneHost {
  read(): Promise<WorkspaceSettings>;
  save(value: WorkspaceSettings): Promise<void>;
  setSkillEnabled(id: string, enabled: boolean): Promise<void>;
  /** The shared automatic-PDF-text opt-out (`extensions.zcr.automaticPdfText`), never a store copy. */
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
  /**
   * The model ids the running Codex runtime last reported, or null/absent when no live list is
   * available (the runtime is not running, or an older host has no port). Reading it never starts
   * the runtime. Ids the pane does not offer are ignored, and the pane never invents one.
   */
  readLiveModels?(): Promise<unknown>;
  /**
   * History management. Both are optional and versioned by presence: a host that has not been
   * upgraded renders no History section rather than a broken one.
   */
  readHistory?(query: string): Promise<unknown>;
  deleteHistory?(ids: string[]): Promise<unknown>;
}
export interface PreferencesPane {
  mount(root: Element): Promise<void>;
  dispose(): void;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
/**
 * The persisted field that carries the owner's free-text instructions. `background` was the existing
 * free-text preference, so the Codex-shaped instructions box reuses it instead of adding a shape.
 * The other five preference fields stay in the record — still validated and still sent inside the
 * frozen `workflow.preferences` snapshot — but are no longer editable in this pane.
 */
const INSTRUCTIONS_FIELD: keyof Personalization = 'background';
const INSTRUCTIONS_MAX = 4096;

/**
 * The builtin workflows the pane offers. The definitions stay installed and the default path is
 * untouched — an ordinary question carries no workflow at all (`skillId: null`) — so withdrawing a
 * builtin here only removes its row. The owner's own user/imported workflows keep their rows.
 * Reversible: add an id back to this set to list it again. Recorded in `docs/progress.md`.
 */
const OFFERED_BUILTIN_SKILLS = new Set(['builtin-annotate']);
function offeredSkill(skill: ReaderSkill): boolean {
  return skill.origin !== 'builtin' || OFFERED_BUILTIN_SKILLS.has(skill.id);
}

/**
 * Stateful copy for the model fieldset: one line saying where the rows came from. The GPT-5.3 Spark
 * family is named because it is the one family that is not in the bundled catalog and can only
 * arrive from the runtime. Both sentences are exact keys in `chat/ui-locale.ts`.
 */
const MODELS_NOTE_BUNDLED = 'This is the bundled catalog, not your account\'s live entitlements. GPT-5.3-Spark models come from the running runtime and appear only after it reports them. The exact id is what is sent.';
const MODELS_NOTE_LIVE = 'These rows combine the models the running runtime reported with the bundled catalog\'s GPT-6 and GPT-5.6. The exact id is what is sent.';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The action could not be completed.';
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
/** Minimal shape check on store output; an unreadable store is reported, never half-rendered. */
function isSettings(value: unknown): value is WorkspaceSettings {
  if (!isRecord(value) || !isRecord(value.preferences)) return false;
  if (value.uiLanguage !== 'en' && value.uiLanguage !== 'zh') return false;
  if (typeof value.textScale !== 'number' || !Number.isFinite(value.textScale)) return false;
  if (!Array.isArray(value.profiles) || !Array.isArray(value.skills)) return false;
  if (!value.profiles.every(profile => isRecord(profile) && typeof profile.id === 'string' && typeof profile.name === 'string' && isRecord(profile.preferences))) return false;
  // Absent means a pre-allowlist record and is rendered as the default set; present but empty is invalid.
  if (value.allowedModels !== undefined && (!Array.isArray(value.allowedModels) || !value.allowedModels.length || !value.allowedModels.every(model => isRecord(model) && typeof model.id === 'string' && typeof model.name === 'string'))) return false;
  return value.skills.every(skill => isRecord(skill) && typeof skill.id === 'string' && typeof skill.name === 'string' && typeof skill.enabled === 'boolean' && Array.isArray(skill.unsupportedDependencies));
}

export function createPreferencesPane(host: PreferencesPaneHost): PreferencesPane {
  let root: Element | null = null;
  let current: WorkspaceSettings | null = null;
  let busy = false;
  let disposed = false;
  let frame: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let error: HTMLElement | null = null;
  let modelsNote: HTMLElement | null = null;
  /** Non-null only when a runtime has actually reported an offerable id; never a guessed list. */
  let liveModels: string[] | null = null;
  let localizer: ReturnType<typeof mountUILocale> | null = null;
  const listeners: Array<{ element: Element; type: string; handler: (event: Event) => void }> = [];
  const skillRows = new Map<string, { row: HTMLElement; update(skill: ReaderSkill): void; setDisabled(disabled: boolean): void }>();
  const modelRows = new Map<string, { row: HTMLElement; update(checked: boolean, name: string): void; setDisabled(disabled: boolean): void; isChecked(): boolean }>();

  const listen = <T extends Element>(element: T, type: string, handler: (event: Event) => void): T => {
    element.addEventListener(type, handler);
    listeners.push({ element, type, handler });
    return element;
  };
  const show = (element: HTMLElement | null, text: string): void => {
    if (!element) return;
    element.textContent = text;
    element.hidden = false;
    // Messages are authored in English; render them through the stored UI language immediately.
    if (current) localizer?.update(current.uiLanguage);
  };
  const clear = (element: HTMLElement | null): void => { if (!element) return; element.textContent = ''; element.hidden = true; };
  /** A failure replaces any earlier success message: the pane never shows two contradictory outcomes. */
  const fail = (text: string): void => { clear(status); show(error, text); };

  /**
   * The runtime's offerable live model ids, or null when there is no live list to show. A missing
   * port, a null report, an empty report, a failed read and a report whose ids are all outside the
   * offerable families all mean the same thing to the pane — the bundled catalog is all it can show —
   * so none of them can half-render a row, invent an id, or switch the note to a live-list claim the
   * rows do not support.
   */
  async function readLiveModels(): Promise<string[] | null> {
    if (!host.readLiveModels) return null;
    try {
      const raw = await host.readLiveModels();
      if (!Array.isArray(raw)) return null;
      const ids = [...new Set(raw.filter((id): id is string => typeof id === 'string' && MODEL_ID.test(id) && isOfferableModelId(id)))];
      return ids.length ? ids : null;
    } catch {
      return null;
    }
  }

  function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = ''): HTMLElementTagNameMap[K] {
    const node = doc.createElementNS(HTML_NS, tag) as unknown as HTMLElementTagNameMap[K];
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') node.textContent = text;
    return node;
  }
  function labelled(doc: Document, parent: HTMLElement, title: string, pref: string, kind: 'input' | 'textarea' | 'select', choices?: ReadonlyArray<readonly [string, string]>): HTMLElement {
    const label = element(doc, 'label', title);
    const control = element(doc, kind);
    control.dataset.zcrPref = pref;
    if (kind === 'select') {
      for (const [value, choice] of choices ?? []) {
        const option = element(doc, 'option', choice);
        option.value = value;
        control.append(option);
      }
    } else if (kind === 'textarea') {
      (control as HTMLTextAreaElement).rows = 3;
    } else {
      (control as HTMLInputElement).type = 'text';
    }
    label.append(control);
    parent.append(label);
    return label;
  }
  function fieldset(doc: Document, parent: HTMLElement, legend: string): HTMLElement {
    const box = element(doc, 'fieldset');
    box.append(element(doc, 'legend', legend));
    parent.append(box);
    return box;
  }

  interface Controls {
    form: HTMLElement;
    uiLanguage: HTMLSelectElement;
    textScale: HTMLInputElement;
    automaticPdfText: HTMLInputElement;
    /** The one editable preference: the free-text instructions carried by `background`. */
    instructions: HTMLTextAreaElement;
    savePreferences: HTMLButtonElement;
    models: HTMLElement;
    skills: HTMLElement;
  }

  function build(doc: Document): Controls {
    const container = element(doc, 'div');
    container.dataset.zcrPref = 'form';
    container.className = 'zcr-preferences';
    status = element(doc, 'p');
    status.dataset.zcrPref = 'status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.hidden = true;
    error = element(doc, 'p');
    error.dataset.zcrPref = 'error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    // Appearance holds the interface language and the chat text scale; both are about how the reader
    // looks, and neither is a model or research preference.
    const appearance = fieldset(doc, container, 'Appearance');
    const language = labelled(doc, appearance, 'Interface language', 'uiLanguage', 'select', [['en', 'English'], ['zh', '中文']]);
    const uiLanguage = language.querySelector('select') as HTMLSelectElement;
    const scaleLabel = labelled(doc, appearance, `Chat text scale (${CHAT_TEXT_SCALE_MIN}–${CHAT_TEXT_SCALE_MAX})`, 'textScale', 'input');
    const textScale = scaleLabel.querySelector('input') as HTMLInputElement;
    textScale.type = 'number'; textScale.min = String(CHAT_TEXT_SCALE_MIN); textScale.max = String(CHAT_TEXT_SCALE_MAX); textScale.step = '0.05';

    // PDF text holds the automatic-PDF-text opt-out. It is a plugin preference, not a workspace
    // field: the pane reads and writes `extensions.zcr.automaticPdfText` directly so it is the
    // single source of truth for every reader, including an already-open sidebar.
    const pdfText = fieldset(doc, container, 'PDF text');
    const automaticPdfLabel = element(doc, 'label', 'Use current PDF text automatically');
    const automaticPdfText = element(doc, 'input');
    automaticPdfText.type = 'checkbox'; automaticPdfText.dataset.zcrPref = 'automatic-pdf-text';
    automaticPdfLabel.append(automaticPdfText);
    pdfText.append(automaticPdfLabel);

    // The allowlist is a checkbox list, not a multi-select: the pane's existing controls are labels
    // plus checkboxes (skills, automatic PDF text), and a long model list stays keyboard-operable,
    // themeable and readable with name and exact id on every row. The legend names the fieldset's
    // own contents; the note is rewritten by `syncModels` to state where the rows came from.
    const modelsField = fieldset(doc, container, 'Models');
    const note = element(doc, 'p', MODELS_NOTE_BUNDLED);
    note.className = 'zcr-preferences-muted';
    note.dataset.zcrPref = 'models-note';
    modelsNote = note;
    const models = element(doc, 'div');
    models.dataset.zcrPref = 'models';
    modelsField.append(note, models);

    // The Codex shape: a title, one description line and one multi-line instructions box with Save.
    // The single box is the whole section; the instructions persist in `background` and reach every
    // request in the frozen `workflow.preferences` snapshot.
    const research = fieldset(doc, container, 'Codex instructions');
    const instructionNote = element(doc, 'p', 'Give Codex extra instructions and context for all chats.');
    instructionNote.className = 'zcr-preferences-muted';
    research.append(instructionNote);
    const instructionsLabel = labelled(doc, research, 'Instructions', `preference-${INSTRUCTIONS_FIELD}`, 'textarea');
    const instructions = instructionsLabel.querySelector('textarea') as HTMLTextAreaElement;
    instructions.rows = 5;
    instructions.maxLength = INSTRUCTIONS_MAX;
    const savePreferences = element(doc, 'button', 'Save');
    savePreferences.type = 'button'; savePreferences.dataset.zcrPref = 'save-preferences';
    research.append(savePreferences);

    // The builtin list is withdrawn to `annotate` for now (see `OFFERED_BUILTIN_SKILLS`); the
    // definitions stay installed and the owner's own user/imported workflows still list here.
    const workflows = fieldset(doc, container, 'Installed workflows');
    const skills = element(doc, 'div');
    skills.dataset.zcrPref = 'skills';
    workflows.append(skills);

    // History management sits last so listing it never delays the settings form above it.
    if (host.readHistory && host.deleteHistory) {
      historySection = createHistorySection(doc, {
        readHistory: query => host.readHistory!(query),
        deleteHistory: ids => host.deleteHistory!(ids),
      }, current?.uiLanguage ?? 'en');
      container.append(historySection.element);
    }

    return { form: container, uiLanguage, textScale, automaticPdfText, instructions, savePreferences, models, skills };
  }

  let controls: Controls | null = null;
  let historySection: HistorySection | null = null;

  /**
   * The persisted preferences with only the editable instructions replaced. The five fields the pane
   * no longer edits are carried through from the stored record unchanged, so nothing is dropped and
   * the frozen `workflow.preferences` snapshot keeps sending exactly what is stored.
   */
  function formPreferences(settings: WorkspaceSettings): Personalization {
    return { ...settings.preferences, [INSTRUCTIONS_FIELD]: controls?.instructions.value ?? settings.preferences[INSTRUCTIONS_FIELD] };
  }

  function syncSkills(settings: WorkspaceSettings): void {
    const wanted = new Set(settings.skills.filter(offeredSkill).map(skill => skill.id));
    for (const [id, entry] of skillRows) if (!wanted.has(id)) { entry.row.remove(); skillRows.delete(id); }
    const nodes = settings.skills.filter(offeredSkill).map(skill => {
      let entry = skillRows.get(skill.id);
      if (!entry) { entry = skillRow(skill); skillRows.set(skill.id, entry); }
      entry.update(skill);
      entry.setDisabled(busy || skill.unsupportedDependencies.length > 0);
      return entry.row;
    });
    const parent = controls?.skills;
    if (!parent) return;
    for (const node of nodes) parent.append(node);
  }

  function skillRow(skill: ReaderSkill): { row: HTMLElement; update(skill: ReaderSkill): void; setDisabled(disabled: boolean): void } {
    const doc = (root as Element).ownerDocument;
    const row = element(doc, 'div');
    row.className = 'zcr-preferences-skill';
    row.dataset.zcrSkill = skill.id;
    const label = element(doc, 'label');
    const toggle = element(doc, 'input');
    toggle.type = 'checkbox';
    toggle.dataset.zcrSkillEnabled = skill.id;
    const name = element(doc, 'span');
    const detail = element(doc, 'span');
    detail.className = 'zcr-preferences-muted';
    label.append(toggle, name);
    row.append(label, detail);
    listen(toggle, 'change', () => { void toggleSkill(skill.id, toggle.checked); });
    const update = (next: ReaderSkill): void => {
      toggle.checked = next.enabled;
      name.textContent = next.name;
      detail.textContent = [next.origin, `v${next.version}`, next.workflow, next.unsupportedDependencies.length ? `Unavailable: ${next.unsupportedDependencies.join(', ')}` : ''].filter(Boolean).join(' · ');
    };
    update(skill);
    return { row, update, setDisabled: disabled => { toggle.disabled = disabled; } };
  }

  /**
   * Rows are the offerable families only: the pinned-catalog candidates, plus any runtime-reported
   * offerable id and any offerable id the owner saved that neither source lists right now, so a saved
   * Spark choice stays visible once seen. A stored id from an excluded family is not a row; it is
   * carried through a save by `saveAllowedModels` and reported by `allowedModelIds`, never offered.
   */
  function syncModels(settings: WorkspaceSettings): void {
    const allowed = new Set((settings.allowedModels ?? defaultAllowedModels()).map(model => model.id));
    // A runtime-reported offerable id (a GPT-5.3 Spark model) joins the rows; an excluded family the
    // runtime also reports never does, and a saved Spark id the runtime is not reporting right now
    // stays visible so the owner's stored choice is not silently dropped.
    const wanted = modelChoices(settings.allowedModels, liveModels ?? []);
    const wantedIds = new Set(wanted.map(candidate => candidate.id));
    for (const [id, entry] of modelRows) if (!wantedIds.has(id)) { entry.row.remove(); modelRows.delete(id); }
    const nodes = wanted.map(candidate => {
      let entry = modelRows.get(candidate.id);
      if (!entry) { entry = modelRow(candidate); modelRows.set(candidate.id, entry); }
      entry.update(allowed.has(candidate.id), candidate.name);
      entry.setDisabled(busy);
      return entry.row;
    });
    if (modelsNote) modelsNote.textContent = liveModels ? MODELS_NOTE_LIVE : MODELS_NOTE_BUNDLED;
    const parent = controls?.models;
    if (!parent) return;
    for (const node of nodes) parent.append(node);
  }

  function modelRow(candidate: ModelCandidate): { row: HTMLElement; update(checked: boolean, name: string): void; setDisabled(disabled: boolean): void; isChecked(): boolean } {
    const doc = (root as Element).ownerDocument;
    const row = element(doc, 'div');
    row.className = 'zcr-preferences-model';
    row.dataset.zcrModel = candidate.id;
    const label = element(doc, 'label');
    const toggle = element(doc, 'input');
    toggle.type = 'checkbox';
    toggle.dataset.zcrModelAllowed = candidate.id;
    const name = element(doc, 'span');
    label.append(toggle, name);
    // The label above is a local, id-derived display name; the exact id is what gets sent, so it is
    // always shown verbatim, on its own line and in monospace. It is never translated or hidden.
    const idLine = element(doc, 'div');
    idLine.className = 'zcr-preferences-muted';
    idLine.dataset.zcrUi = 'false';
    idLine.append(element(doc, 'code', candidate.id));
    row.append(label, idLine);
    listen(toggle, 'change', () => { void saveAllowedModels(); });
    return {
      row,
      update: (checked, text) => { toggle.checked = checked; name.textContent = text; },
      setDisabled: disabled => { toggle.disabled = disabled; },
      isChecked: () => toggle.checked,
    };
  }

  /** Disabled state only: values stay exactly as the user left them while a write is in flight. */
  function refreshDisabled(): void {
    if (!controls || !current) return;
    for (const control of [controls.uiLanguage, controls.textScale, controls.automaticPdfText, controls.instructions, controls.savePreferences]) control.disabled = busy;
    for (const [id, entry] of skillRows) entry.setDisabled(busy || (current.skills.find(skill => skill.id === id)?.unsupportedDependencies.length ?? 0) > 0);
    for (const entry of modelRows.values()) entry.setDisabled(busy);
    historySection?.setBusy(busy);
  }

  function sync(): void {
    if (!controls || !current) return;
    controls.uiLanguage.value = current.uiLanguage;
    controls.textScale.value = String(current.textScale);
    // Always re-read the pref: another reader may have changed what this checkbox shows.
    controls.automaticPdfText.checked = host.readAutomaticPdfText();
    controls.instructions.value = current.preferences[INSTRUCTIONS_FIELD] ?? '';
    syncSkills(current);
    syncModels(current);
    // Language changes and every re-read both land here, so the copy follows the stored setting.
    // Runs after the skill rows exist so one pass covers the whole pane deterministically.
    localizer?.update(current.uiLanguage);
    historySection?.setLanguage(current.uiLanguage);
    refreshDisabled();
  }

  async function reload(report: boolean, refreshHistory = false): Promise<void> {
    try {
      const value = await host.read();
      if (disposed) return;
      // Read the live list on every store read: a runtime that started while this window was open is
      // picked up here. This never starts the runtime itself and never blocks the form on failure.
      liveModels = await readLiveModels();
      if (disposed) return;
      if (!isSettings(value)) { current = null; hardFailure('The stored preferences could not be read.'); return; }
      current = value;
      sync();
      // The history listing is a separate, lazy read: a slow or unreadable history never blocks the form.
      if (refreshHistory) void historySection?.refresh();
    } catch (caught) {
      if (!disposed && report) hardFailure(message(caught));
    }
  }

  function hardFailure(text: string): void {
    historySection?.dispose();
    historySection = null;
    frame?.remove();
    frame = null;
    controls = null;
    skillRows.clear();
    modelRows.clear();
    modelsNote = null;
    const doc = root?.ownerDocument;
    if (!doc || !root) return;
    const box = element(doc, 'div');
    box.className = 'zcr-preferences';
    const heading = element(doc, 'p');
    heading.dataset.zcrPref = 'error';
    heading.setAttribute('role', 'alert');
    heading.textContent = text;
    box.append(heading);
    root.append(box);
    frame = box;
    error = heading;
  }

  async function commit(mutate: (settings: WorkspaceSettings) => WorkspaceSettings, message_: string): Promise<boolean> {
    if (busy || disposed || !current) return false;
    busy = true; clear(error); refreshDisabled();
    try {
      await host.save(mutate(current));
      await reload(false);
      if (disposed) return true;
      show(status, message_);
      return true;
    } catch (caught) {
      // Report the store's own message, then re-read so the form matches what was actually stored.
      if (!disposed) { fail(message(caught)); await reload(false); }
      return false;
    } finally {
      busy = false;
      if (!disposed) sync();
    }
  }

  async function toggleSkill(id: string, enabled: boolean): Promise<void> {
    if (busy || disposed || !current) return;
    busy = true; clear(error); refreshDisabled();
    try {
      await host.setSkillEnabled(id, enabled);
      await reload(false);
      if (!disposed) show(status, 'Workflow updated.');
    } catch (caught) {
      if (!disposed) { fail(message(caught)); await reload(false); }
    } finally {
      busy = false;
      if (!disposed) sync();
    }
  }

  /**
   * Saves the allowlist as one snapshot. Unchecking every model is refused locally and the previous
   * selection is restored, because an empty allowlist would blank the composer's model picker; the
   * store independently safe-rejects an empty list as a second line of defence.
   *
   * Stored names are kept where the id is unchanged, so a preserved unknown id keeps the label the
   * user last saw; catalog candidates use this module's derived label.
   *
   * Rows are only the offerable families. A stored id this build can no longer offer has no row, so
   * it is carried through in its stored order instead of being silently dropped from the record — the
   * same guarantee `allowedModelIds` and the store already document. It is never offered and never
   * sent; an id the owner actually unchecked does have a row and is removed.
   */
  async function saveAllowedModels(): Promise<void> {
    if (busy || disposed || !current) return;
    const selected = [...modelRows.entries()].filter(([, entry]) => entry.isChecked()).map(([id]) => id);
    if (!selected.length) {
      fail('At least one model must stay available. The previous selection was kept.');
      sync();
      return;
    }
    const names = new Map<string, string>([
      ...(current.allowedModels ?? defaultAllowedModels()).map(model => [model.id, model.name] as const),
      ...modelChoices(current.allowedModels, liveModels ?? []).map(candidate => [candidate.id, candidate.name] as const),
    ]);
    const rendered = new Set(modelRows.keys());
    const carried = [...new Set((current.allowedModels ?? []).map(model => model.id))].filter(id => !rendered.has(id));
    const allowedModels: AllowedModel[] = [...selected, ...carried].map(id => ({ id, name: names.get(id) ?? modelLabel(id) }));
    await commit(settings => ({ ...settings, allowedModels }), 'Allowed models saved.');
  }

  /**
   * The pref is written synchronously through the host, so this is not a store commit: there is no
   * snapshot to re-read. A refused write reports the host's own message and sync() restores the
   * checkbox to the value the pref actually holds, never to what the user clicked.
   */
  function saveAutomaticPdfText(enabled: boolean): void {
    if (disposed) return;
    clear(error);
    try {
      host.writeAutomaticPdfText(enabled);
      show(status, enabled ? 'Automatic PDF text preparation is on.' : 'Automatic PDF text preparation is off.');
    } catch (caught) {
      fail(message(caught));
    } finally {
      if (!disposed) sync();
    }
  }

  async function mount(next: Element): Promise<void> {
    root = next;
    root.setAttribute('data-zcr-pref-pane', '');
    const doc = next.ownerDocument;
    frame = build(doc).form;
    controls = null;
    const form = frame;
    // The pane owns its root: the fragment's placeholder goes away once the form is real.
    next.replaceChildren(form);
    // Status and error live above the form and survive a hard failure.
    form.prepend(error!, status!);
    controls = {
      form,
      uiLanguage: form.querySelector('[data-zcr-pref="uiLanguage"]') as HTMLSelectElement,
      textScale: form.querySelector('[data-zcr-pref="textScale"]') as HTMLInputElement,
      automaticPdfText: form.querySelector('[data-zcr-pref="automatic-pdf-text"]') as HTMLInputElement,
      instructions: form.querySelector(`[data-zcr-pref="preference-${INSTRUCTIONS_FIELD}"]`) as HTMLTextAreaElement,
      savePreferences: form.querySelector('[data-zcr-pref="save-preferences"]') as HTMLButtonElement,
      models: form.querySelector('[data-zcr-pref="models"]') as HTMLElement,
      skills: form.querySelector('[data-zcr-pref="skills"]') as HTMLElement,
    };
    localizer = mountUILocale(root);

    listen(controls.uiLanguage, 'change', () => {
      const uiLanguage = controls!.uiLanguage.value === 'zh' ? 'zh' : 'en';
      void commit(settings => ({ ...settings, uiLanguage }), 'Interface language saved.');
    });
    listen(controls.textScale, 'change', () => {
      const requested = Number(controls!.textScale.value);
      if (!Number.isFinite(requested) || requested < CHAT_TEXT_SCALE_MIN || requested > CHAT_TEXT_SCALE_MAX) {
        fail(`Choose a chat text scale from ${CHAT_TEXT_SCALE_MIN} to ${CHAT_TEXT_SCALE_MAX}.`);
        if (current) controls!.textScale.value = String(current.textScale);
        return;
      }
      void commit(settings => ({ ...settings, textScale: clampChatTextScale(requested) }), 'Chat text scale saved.');
    });
    listen(controls.automaticPdfText, 'change', () => { saveAutomaticPdfText(controls!.automaticPdfText.checked); });
    listen(controls.savePreferences, 'click', () => {
      if (!current) return;
      const preferences = formPreferences(current);
      void commit(settings => ({ ...settings, preferences }), 'Preferences saved.');
    });

    await reload(true, true);
  }

  return {
    mount,
    dispose(): void {
      disposed = true;
      localizer?.dispose();
      localizer = null;
      historySection?.dispose();
      historySection = null;
      for (const { element: target, type, handler } of listeners) target.removeEventListener(type, handler);
      listeners.length = 0;
      skillRows.clear();
      modelRows.clear();
      controls = null;
      current = null;
      frame?.remove();
      frame = null;
    },
  };
}
