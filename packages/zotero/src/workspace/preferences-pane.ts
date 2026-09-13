import type { Personalization, ReaderSkill, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { CHAT_TEXT_SCALE_MAX, CHAT_TEXT_SCALE_MIN, clampChatTextScale } from '../chat/text-scale.ts';
import { mountUILocale } from '../chat/ui-locale.ts';

/**
 * Native Zotero Preferences pane for the global workspace settings.
 *
 * The pane is a thin, keyboard-operable form over the existing workspace store: every write is a
 * full validated snapshot (or a single supported skill), the store keeps its atomic writes and
 * revision conflicts, and the pane re-reads after every write so it never shows a state the store
 * refused. Per-chat overrides stay in the sidebar and are never written from here.
 *
 * Copy follows the stored UI language through the same localizer the sidebar uses. Profile names,
 * skill names, ids, versions and file paths are never translated.
 */
export interface PreferencesPaneHost {
  read(): Promise<WorkspaceSettings>;
  save(value: WorkspaceSettings): Promise<void>;
  setSkillEnabled(id: string, enabled: boolean): Promise<void>;
  exportPreferences(): Promise<void>;
  /** A fresh, valid profile id; minted in the plugin sandbox, never in the pane. */
  profileId(): string;
  /** The shared automatic-PDF-text opt-out (`extensions.zcr.automaticPdfText`), never a store copy. */
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
}
export interface PreferencesPane {
  mount(root: Element): Promise<void>;
  dispose(): void;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const PREFERENCE_FIELDS: ReadonlyArray<{ key: keyof Personalization; title: string; kind: 'input' | 'textarea' | 'select'; choices?: ReadonlyArray<readonly [string, string]> }> = [
  { key: 'language', title: 'Answer language', kind: 'input' },
  { key: 'detail', title: 'Answer detail', kind: 'select', choices: [['brief', 'Brief'], ['standard', 'Standard'], ['detailed', 'Detailed']] },
  { key: 'mathematics', title: 'Mathematical explanation', kind: 'select', choices: [['auto', 'Automatic'], ['intuition-first', 'Intuition first'], ['formal', 'Formal derivation']] },
  { key: 'background', title: 'Research background', kind: 'textarea' },
  { key: 'citationStyle', title: 'Citation style', kind: 'input' },
  { key: 'annotationStyle', title: 'Annotation style', kind: 'input' },
];

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
  return value.skills.every(skill => isRecord(skill) && typeof skill.id === 'string' && typeof skill.name === 'string' && typeof skill.enabled === 'boolean' && Array.isArray(skill.unsupportedDependencies));
}

export function createPreferencesPane(host: PreferencesPaneHost): PreferencesPane {
  let root: Element | null = null;
  let current: WorkspaceSettings | null = null;
  let selectedProfileId: string | null = null;
  let busy = false;
  let disposed = false;
  let frame: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let error: HTMLElement | null = null;
  let localizer: ReturnType<typeof mountUILocale> | null = null;
  const listeners: Array<{ element: Element; type: string; handler: (event: Event) => void }> = [];
  const skillRows = new Map<string, { row: HTMLElement; update(skill: ReaderSkill): void; setDisabled(disabled: boolean): void }>();

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
    preferences: Map<keyof Personalization, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
    savePreferences: HTMLButtonElement;
    exportPreferences: HTMLButtonElement;
    profile: HTMLSelectElement;
    profileName: HTMLInputElement;
    saveProfile: HTMLButtonElement;
    updateProfile: HTMLButtonElement;
    deleteProfile: HTMLButtonElement;
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

    const chat = fieldset(doc, container, 'Chat');
    const language = labelled(doc, chat, 'Interface language', 'uiLanguage', 'select', [['en', 'English'], ['zh', '中文']]);
    const uiLanguage = language.querySelector('select') as HTMLSelectElement;
    const scaleLabel = labelled(doc, chat, `Chat text scale (${CHAT_TEXT_SCALE_MIN}–${CHAT_TEXT_SCALE_MAX})`, 'textScale', 'input');
    const textScale = scaleLabel.querySelector('input') as HTMLInputElement;
    textScale.type = 'number'; textScale.min = String(CHAT_TEXT_SCALE_MIN); textScale.max = String(CHAT_TEXT_SCALE_MAX); textScale.step = '0.05';

    // The automatic-PDF-text opt-out is a plugin preference, not a workspace field: the pane reads
    // and writes `extensions.zcr.automaticPdfText` directly so it is the single source of truth for
    // every reader, including an already-open sidebar.
    const automaticPdfLabel = element(doc, 'label', 'Use current PDF text automatically');
    const automaticPdfText = element(doc, 'input');
    automaticPdfText.type = 'checkbox'; automaticPdfText.dataset.zcrPref = 'automatic-pdf-text';
    automaticPdfLabel.append(automaticPdfText);
    const automaticPdfNote = element(doc, 'p', 'Changes affect future requests. Earlier text remains in this chat; start a new chat to exclude it.');
    automaticPdfNote.className = 'zcr-preferences-muted';
    chat.append(automaticPdfLabel, automaticPdfNote);

    const research = fieldset(doc, container, 'Research preferences');
    const preferences = new Map<keyof Personalization, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    for (const field of PREFERENCE_FIELDS) {
      const label = labelled(doc, research, field.title, `preference-${field.key}`, field.kind, field.choices);
      const control = label.querySelector(field.kind) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      preferences.set(field.key, control);
    }
    const savePreferences = element(doc, 'button', 'Save preferences');
    savePreferences.type = 'button'; savePreferences.dataset.zcrPref = 'save-preferences';
    const exportPreferences = element(doc, 'button', 'Export preferences');
    exportPreferences.type = 'button'; exportPreferences.dataset.zcrPref = 'export-preferences';
    research.append(savePreferences, exportPreferences);

    const profiles = fieldset(doc, container, 'Research profiles');
    const editing = labelled(doc, profiles, 'Profile being edited', 'profile', 'select');
    const profile = editing.querySelector('select') as HTMLSelectElement;
    const nameLabel = labelled(doc, profiles, 'Research profile name', 'profile-name', 'input');
    const profileName = nameLabel.querySelector('input') as HTMLInputElement;
    const actions = element(doc, 'div');
    actions.className = 'zcr-preferences-actions';
    const saveProfile = element(doc, 'button', 'Save as new profile');
    const updateProfile = element(doc, 'button', 'Update selected profile');
    const deleteProfile = element(doc, 'button', 'Delete selected profile');
    for (const [button, pref] of [[saveProfile, 'save-profile'], [updateProfile, 'update-profile'], [deleteProfile, 'delete-profile']] as const) {
      button.type = 'button'; button.dataset.zcrPref = pref;
    }
    actions.append(saveProfile, updateProfile, deleteProfile);
    profiles.append(actions);

    const workflows = fieldset(doc, container, 'Installed workflows');
    const skills = element(doc, 'div');
    skills.dataset.zcrPref = 'skills';
    workflows.append(skills);

    return { form: container, uiLanguage, textScale, automaticPdfText, preferences, savePreferences, exportPreferences, profile, profileName, saveProfile, updateProfile, deleteProfile, skills };
  }

  let controls: Controls | null = null;

  function formPreferences(settings: WorkspaceSettings): Personalization {
    const next = { ...settings.preferences } as Record<keyof Personalization, string>;
    for (const field of PREFERENCE_FIELDS) {
      const control = controls?.preferences.get(field.key);
      if (!control) continue;
      next[field.key] = control.value;
    }
    return next as unknown as Personalization;
  }

  function selectedProfile(settings: WorkspaceSettings): { id: string; name: string; preferences: Partial<Personalization> } | null {
    return settings.profiles.find(profile => profile.id === selectedProfileId) ?? null;
  }

  function syncSkills(settings: WorkspaceSettings): void {
    const wanted = new Set(settings.skills.map(skill => skill.id));
    for (const [id, entry] of skillRows) if (!wanted.has(id)) { entry.row.remove(); skillRows.delete(id); }
    const nodes = settings.skills.map(skill => {
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

  /** Disabled state only: values stay exactly as the user left them while a write is in flight. */
  function refreshDisabled(): void {
    if (!controls || !current) return;
    const profile = selectedProfile(current);
    for (const control of [controls.uiLanguage, controls.textScale, controls.automaticPdfText, controls.savePreferences, controls.exportPreferences, controls.saveProfile, controls.profileName, controls.profile, ...controls.preferences.values()]) control.disabled = busy;
    controls.updateProfile.disabled = busy || !profile;
    controls.deleteProfile.disabled = busy || !profile;
    for (const [id, entry] of skillRows) entry.setDisabled(busy || (current.skills.find(skill => skill.id === id)?.unsupportedDependencies.length ?? 0) > 0);
  }

  function sync(): void {
    if (!controls || !current) return;
    controls.uiLanguage.value = current.uiLanguage;
    controls.textScale.value = String(current.textScale);
    // Always re-read the pref: another reader may have changed what this checkbox shows.
    controls.automaticPdfText.checked = host.readAutomaticPdfText();
    const profile = selectedProfile(current);
    const shown = profile ? { ...current.preferences, ...profile.preferences } : current.preferences;
    for (const field of PREFERENCE_FIELDS) {
      const control = controls.preferences.get(field.key)!;
      control.value = shown[field.key] ?? '';
    }
    const none = element((root as Element).ownerDocument, 'option', 'No profile selected');
    none.value = '';
    controls.profile.replaceChildren(none, ...current.profiles.map(item => {
      const option = element((root as Element).ownerDocument, 'option', item.name);
      option.value = item.id;
      return option;
    }));
    controls.profile.value = profile?.id ?? '';
    if (profile) controls.profileName.value = profile.name;
    controls.profile.disabled = busy;
    syncSkills(current);
    // Language changes and every re-read both land here, so the copy follows the stored setting.
    // Runs after the skill rows exist so one pass covers the whole pane deterministically.
    localizer?.update(current.uiLanguage);
    refreshDisabled();
  }

  async function reload(report: boolean): Promise<void> {
    try {
      const value = await host.read();
      if (disposed) return;
      if (!isSettings(value)) { current = null; hardFailure('The stored preferences could not be read.'); return; }
      current = value;
      if (selectedProfileId && !value.profiles.some(profile => profile.id === selectedProfileId)) selectedProfileId = null;
      sync();
    } catch (caught) {
      if (!disposed && report) hardFailure(message(caught));
    }
  }

  function hardFailure(text: string): void {
    frame?.remove();
    frame = null;
    controls = null;
    skillRows.clear();
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
      preferences: new Map(PREFERENCE_FIELDS.map(field => [field.key, form.querySelector(`[data-zcr-pref="preference-${field.key}"]`) as HTMLInputElement])),
      savePreferences: form.querySelector('[data-zcr-pref="save-preferences"]') as HTMLButtonElement,
      exportPreferences: form.querySelector('[data-zcr-pref="export-preferences"]') as HTMLButtonElement,
      profile: form.querySelector('[data-zcr-pref="profile"]') as HTMLSelectElement,
      profileName: form.querySelector('[data-zcr-pref="profile-name"]') as HTMLInputElement,
      saveProfile: form.querySelector('[data-zcr-pref="save-profile"]') as HTMLButtonElement,
      updateProfile: form.querySelector('[data-zcr-pref="update-profile"]') as HTMLButtonElement,
      deleteProfile: form.querySelector('[data-zcr-pref="delete-profile"]') as HTMLButtonElement,
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
    listen(controls.exportPreferences, 'click', () => {
      if (busy || disposed) return;
      busy = true; clear(error); refreshDisabled();
      void host.exportPreferences()
        .then(() => { if (!disposed) show(status, 'Preferences exported.'); })
        .catch((caught: unknown) => { if (!disposed) fail(message(caught)); })
        .finally(() => { busy = false; if (!disposed) sync(); });
    });
    listen(controls.profile, 'change', () => {
      selectedProfileId = controls!.profile.value || null;
      sync();
    });
    listen(controls.saveProfile, 'click', () => {
      if (!current) return;
      const name = controls!.profileName.value.trim();
      if (!name) { fail('Name this research profile.'); controls!.profileName.focus(); return; }
      const preferences = formPreferences(current);
      const id = host.profileId();
      void commit(settings => ({ ...settings, profiles: [...settings.profiles.filter(profile => profile.id !== id), { id, name, preferences }] }), 'Research profile saved.').then(saved => {
        if (!saved || disposed) return;
        selectedProfileId = id;
        sync();
      });
    });
    listen(controls.updateProfile, 'click', () => {
      if (!current) return;
      const profile = selectedProfile(current);
      if (!profile) return;
      const preferences = formPreferences(current);
      void commit(settings => ({ ...settings, profiles: settings.profiles.map(item => (item.id === profile.id ? { ...item, preferences } : item)) }), 'Research profile updated.');
    });
    listen(controls.deleteProfile, 'click', () => {
      if (!current) return;
      const profile = selectedProfile(current);
      if (!profile) return;
      selectedProfileId = null;
      void commit(settings => ({ ...settings, profiles: settings.profiles.filter(item => item.id !== profile.id) }), 'Research profile deleted.');
    });

    await reload(true);
  }

  return {
    mount,
    dispose(): void {
      disposed = true;
      localizer?.dispose();
      localizer = null;
      for (const { element: target, type, handler } of listeners) target.removeEventListener(type, handler);
      listeners.length = 0;
      skillRows.clear();
      controls = null;
      current = null;
      frame?.remove();
      frame = null;
    },
  };
}
