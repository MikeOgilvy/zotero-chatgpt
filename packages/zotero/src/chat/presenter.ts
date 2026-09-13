import type { ReaderClient, RuntimeSnapshot } from '../../../contracts/src/runtime.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { advanceRequestTiming, ReaderError, paperId, type Citation, type ContextReport, type Conversation, type DocumentContext, type GenerationSettings, type ImageAttachment, type Message, type PaperIdentity, type PaperScope, type ReaderEvent, type SendInput } from '../../../contracts/src/index.ts';
import type { HistoryEntry, LibraryReferencePort, Personalization, ReaderReference, ReaderSkill, ReaderWorkspace, ReferenceInput, ResearchProfile, SavedDraft, WorkflowSnapshot, WorkspaceDraft, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import type { AgentTaskChoices, AgentTaskRecord, AgentTasks, AnnotationProposal } from '../../../contracts/src/tasks.ts';
import type { NativeCollectionTarget, NativeItemRef } from '../../../contracts/src/agent.ts';
import { validatePreferences, validateReference, validateReferenceInput, validateWorkflow } from '../../../contracts/src/workspace-validation.ts';
import { LIMITS, validateImageAttachment, validateOutputImage } from '../../../contracts/src/validation.ts';
import { buildContextBudget, type ContextBudget } from '../../../core/src/codex/model-capabilities.ts';
import { PAPER_THREAD_POLICY, readingInput } from '../../../core/src/codex/reader-policy.ts';
import { planContext, type ContextPlan } from '../../../core/src/context/planner.ts';
import type { ReadingCoordinator, ReadingJob } from '../../../core/src/context/coordinator.ts';
import { parseAnnotationCandidates } from '../../../core/src/tasks/controller.ts';
import { PREFERENCES_EXPORT_NAME, preferencesExportText } from '../../../core/src/workspace/export.ts';
import { addCitation, addImage, makeAsk, makeExplain, moveImage, removeCitation, removeImage, workspaceDraft } from './draft.ts';
import { alignSettings, catalogDefaultSettings } from './generation-settings.ts';
export interface DocumentServices {
  prepare(signal: AbortSignal, progress: (p: { done: number; total: number }) => void, range?: readonly [number, number]): Promise<DocumentContext>;
  validate(document: DocumentContext): Promise<void>;
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
  needsDisclosure?(): boolean;
  acknowledge?(): void;
}
export type PresenterReading = Pick<ReadingCoordinator, 'start' | 'enqueue' | 'list' | 'get' | 'subscribe' | 'cancel' | 'reconcile'>;
export interface PresenterServices {
  ensureStarted(): Promise<ReaderClient>; openAuthorization(url: string): void; uuid(): string; now(): string; document?: DocumentServices;
  getWorkspace?(): Promise<ReaderWorkspace>; library?: LibraryReferencePort; getTasks?(): Promise<AgentTasks>; getReading?(client?: ReaderClient): Promise<PresenterReading>;
  openHistory?(paper: PaperScope, conversationId: string): Promise<void>;
  openCitation?(citation: Citation): Promise<void>; openItem?(item: NativeItemRef): Promise<void>;
  contextBudget?(input: SendInput, conversation: Conversation): ContextBudget;
}
export type PresenterDependencies = PresenterServices;
export type PresenterSkillEdit = Pick<ReaderSkill, 'name' | 'description' | 'version' | 'workflow' | 'markdown' | 'enabled'> & { id: string | null; revision?: string };
type RequestContext = { enabled: boolean; range: [number, number] | null; acquisitionTarget?: NativeCollectionTarget | null };
export interface PresenterState {
  connection: 'idle' | 'starting' | 'ready' | 'error';
  runtime: RuntimeSnapshot | null;
  conversation: Conversation | null;
  conversations: Conversation[];
  draft: WorkspaceDraft;
  pendingExplain: Citation | null;
  message: string | null;
  generating: boolean;
  /** Incremented when the view should move focus into the question input. */
  focusToken: number;
  paperTitle: string;
  workspace: WorkspaceSettings | null;
  history: HistoryEntry[];
  scrollTop: number;
  persistence: 'session' | 'loading' | 'saving' | 'saved' | 'error';
  tasks: AgentTaskRecord[];
  readingJobs: ReadingJob[];
  contextReport: ContextReport | null;
  queueing: boolean;
  messageFocus: { messageId: string; token: number } | null;
  acquisitionTarget: NativeCollectionTarget | null;
  collectionOptions: Array<NativeCollectionTarget & { name: string }>;
  document: { enabled: boolean; disclosure: boolean; phase: 'idle' | 'preparing' | 'ready' | 'error'; prepared: DocumentContext | null; progress: { done: number; total: number }; range: [number, number] | null; error: string | null };
}
const LOGIN_HOSTS = ['auth.openai.com', 'chatgpt.com'];
const UNCERTAIN_ISOLATION = 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.';
function bytes(value: unknown): number { return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length; }
function unfinishedReading(job: ReadingJob): boolean { return !['completed', 'cancelled', 'failed'].includes(job.status); }
function activeReading(job: ReadingJob): boolean { return ['reserved', 'submitting', 'running', 'cancelling'].includes(job.status); }
function aborted(signal: AbortSignal): void { if (signal.aborted) throw new ReaderError('INVALID_REQUEST', 'Request preparation cancelled. Your draft is kept.'); }
async function waitPreparation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  aborted(signal); let stop = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { stop = () => reject(new ReaderError('INVALID_REQUEST', 'Request preparation cancelled. Your draft is kept.')); signal.addEventListener('abort', stop, { once: true }); })]); }
  finally { signal.removeEventListener('abort', stop); }
}
/**
 * One presenter per attachment for the plugin lifetime. It owns the unsent draft and the view's copy
 * of the conversation; the runtime keeps generating whether or not a view is bound.
 */
export class ConversationPresenter {
  private state: PresenterState;
  private renders = new Set<(state: PresenterState) => void>();
  private client: ReaderClient | null = null;
  private connecting: Promise<ReaderClient> | null = null;
  private unobserve: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeClient: ReaderClient | null = null;
  private buffered: ReaderEvent[] = [];
  private syncing = false;
  private syncGeneration = 0;
  private submissions = new Map<string, AbortController>();
  private get submitting(): boolean { return this.submissions.size > 0; }
  private explainFlights = new Map<string, Promise<void>>();
  private continuing = false;
  private drafts = new Map<string, WorkspaceDraft>();
  private positions = new Map<string, { scrollTop: number; range: [number, number] | null }>();
  private sendFlights = new Map<string, Promise<void>>();
  private queueFlight: Promise<void> | null = null;
  private draftVersion = 0;
  private workspace: ReaderWorkspace | null = null;
  private workspaceFlight: Promise<ReaderWorkspace> | null = null;
  private localFlight: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSaves = new Map<string, SavedDraft>();
  private saveFlight: Promise<void> | null = null;
  private navigation = 0;
  private historySearch = 0;
  private taskPort: AgentTasks | null = null;
  private taskFlight: Promise<AgentTasks> | null = null;
  private untasks: (() => void) | null = null;
  private readingPort: PresenterReading | null = null;
  private readingClient: ReaderClient | null = null;
  private unreading: (() => void) | null = null;
  private readingDescriptions = new Map<string, { question: string; scopeLabel: string }>();
  private planningAnnotations = new Set<string>();
  private disposed = false;
  private documentJob: { controller: AbortController; range: string; promise: Promise<DocumentContext>; consumers: number } | null = null;
  constructor(readonly paper: PaperScope, private title: string, private services: PresenterServices, private identity: PaperIdentity = { title, authors: [] }) {
    this.state = { connection: 'idle', runtime: null, conversation: null, conversations: [], draft: workspaceDraft({ settings: null, paper, question: '', citations: [], images: [] }), pendingExplain: null, message: null, generating: false, focusToken: 0, paperTitle: title,
      workspace: null, history: [], scrollTop: 0, persistence: services.getWorkspace ? 'loading' : 'session', tasks: [], readingJobs: [], contextReport: null, queueing: false, messageFocus: null, acquisitionTarget: null, collectionOptions: [],
      document: { enabled: services.document?.readEnabled() ?? false, disclosure: services.document?.needsDisclosure?.() ?? false, phase: 'idle', prepared: null, progress: { done: 0, total: 0 }, range: null, error: null } };
  }
  private paperIdentity(): PaperIdentity {
    const title = this.identity.title.trim() || this.title.trim() || this.state.conversation?.title || '';
    return { title, authors: this.identity.authors, ...(this.identity.year ? { year: this.identity.year } : {}), ...(this.identity.doi ? { doi: this.identity.doi } : {}) };
  }
  /** Ask in sidechat: the citation is already in the draft; the view should focus the question input. */
  focusInput(): void { this.update({ focusToken: this.state.focusToken + 1 }); }
  snapshot(): PresenterState { return clone(this.state); }
  /** Views are read-only; they must not mutate this object. External callers still use snapshot(). */
  private render(render: (state: PresenterState) => void): void {
    // A failing view must never stop propagation to the other views (or abort the caller).
    try { render(this.state); } catch { /* the view reports its own failure; state stays authoritative */ }
  }
  private notify(): void { for (const render of this.renders) this.render(render); }
  /** A view binds to receive state; unbinding releases only the view, never the runtime or the draft. */
  bind(render: (state: PresenterState) => void): () => void {
    this.renders.add(render); this.render(render);
    if (this.client && this.state.conversation) void this.sync();
    return () => { this.renders.delete(render); if (!this.renders.size) void this.flushDraft().catch(() => {}); };
  }
  private update(patch: Partial<PresenterState>): void {
    this.state = { ...this.state, ...patch };
    this.state.generating = !!this.state.conversation && (this.submissions.has(this.state.conversation.id) || !!this.state.conversation.activeRequestId || this.state.readingJobs.some(activeReading));
    this.notify();
  }
  private errorText(error: unknown): string { return error instanceof Error && error.message ? error.message : 'Codex could not complete this action.'; }
  private signedIn(): boolean { return this.state.runtime?.account.state === 'signedIn' && (this.state.runtime?.models.length ?? 0) > 0; }
  private currentSettings(): GenerationSettings | null {
    const models = this.state.runtime?.models ?? [];
    const current = this.state.draft.settings ?? this.state.conversation?.settings ?? catalogDefaultSettings(models);
    if (!current) return null;
    return models.length ? alignSettings(models, current) : current;
  }
  private draftKey(): string { return this.state.conversation?.id ?? 'unbound'; }
  private emptyDraft(settings: GenerationSettings | null = this.currentSettings()): WorkspaceDraft {
    return workspaceDraft({ settings, paper: this.paper, question: '', citations: [], images: [] });
  }
  private getWorkspace(): Promise<ReaderWorkspace> {
    if (this.workspace) return Promise.resolve(this.workspace);
    if (!this.services.getWorkspace) return Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Saved workspace controls are unavailable.'));
    if (!this.workspaceFlight) this.workspaceFlight = this.services.getWorkspace().then(workspace => { this.workspace = workspace; return workspace; }).catch(error => { this.workspaceFlight = null; throw error; });
    return this.workspaceFlight;
  }
  private captureWorkspace(): Promise<WorkspaceSettings | null> {
    const previous = this.state.workspace;
    const captured = this.services.getWorkspace ? this.getWorkspace().then(workspace => workspace.settings()).then(settings => { if (this.state.workspace === previous && !this.disposed) this.update({ workspace: settings }); return clone(settings); }) : Promise.resolve(null);
    // A queued request can wait behind preparation while this snapshot finishes.
    void captured.catch(() => {}); return captured;
  }
  private loadLocal(): Promise<void> {
    if (!this.services.getWorkspace) return Promise.resolve();
    if (this.localFlight) return this.localFlight;
    const version = this.draftVersion;
    this.localFlight = (async () => {
      const workspace = await this.getWorkspace();
      const [settings, current] = await Promise.all([workspace.settings(), workspace.currentConversation(this.paper)]);
      if (this.disposed) return;
      this.update({ workspace: settings });
      if (!this.state.conversation && current && paperId(current.paper) === paperId(this.paper)) this.update({ conversation: current, conversations: [current], draft: { ...this.state.draft, settings: this.state.draft.settings ?? current.settings } });
      const id = this.state.conversation?.id ?? null;
      const saved = await workspace.readDraft(this.paper, id) ?? (id ? await workspace.readDraft(this.paper, null) : null);
      if (this.disposed) return;
      if (saved && this.draftVersion === version) {
        this.update({ draft: workspaceDraft(saved.draft), scrollTop: saved.scrollTop, document: { ...this.state.document, range: clone(saved.pageRange), prepared: null, phase: 'idle', error: null } });
      } else if (this.draftVersion !== version && id) {
        this.pendingSaves.delete('unbound'); this.stageDraft();
      }
      this.stashDraft(); this.update({ persistence: this.pendingSaves.size ? 'saving' : 'saved' });
      void this.searchHistory('').catch(error => this.reportError(this.errorText(error)));
    })().catch(error => { this.update({ persistence: 'error', message: this.errorText(error) }); throw error; });
    return this.localFlight;
  }
  private stageDraft(): void {
    this.stashDraft();
    if (!this.services.getWorkspace || this.disposed) return;
    const key = this.draftKey();
    this.pendingSaves.set(key, { schemaVersion: 1, paper: clone(this.paper), conversationId: this.state.conversation?.id ?? null, draft: clone(this.state.draft), scrollTop: this.state.scrollTop, pageRange: clone(this.state.document.range), updatedAt: this.services.now() });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flushDraft().catch(() => {}); }, 150);
  }
  /** Await this barrier during plugin shutdown; closing a view only schedules the same safe flush. */
  async flushDraft(): Promise<void> {
    if (!this.services.getWorkspace) return;
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.saveFlight) { await this.saveFlight; if (!this.pendingSaves.size) return; }
    this.saveFlight = (async () => {
      await this.loadLocal(); const workspace = await this.getWorkspace();
      while (this.pendingSaves.size) {
        const [key, saved] = this.pendingSaves.entries().next().value!; this.pendingSaves.delete(key);
        this.update({ persistence: 'saving' });
        try { await workspace.saveDraft(saved); }
        catch (error) { if (!this.pendingSaves.has(key)) this.pendingSaves.set(key, saved); this.update({ persistence: 'error', message: this.errorText(error) }); throw error; }
      }
      this.update({ persistence: 'saved' });
    })().finally(() => { this.saveFlight = null; });
    return this.saveFlight;
  }
  setScrollTop(scrollTop: number): void {
    if (!Number.isFinite(scrollTop) || scrollTop < 0 || this.state.scrollTop === scrollTop) return;
    this.update({ scrollTop }); this.stageDraft();
  }
  reportError(message: string): void { this.update({ message }); }
  private changeDraft(draft: WorkspaceDraft): void {
    if (draft === this.state.draft) return;
    this.draftVersion++; this.update({ draft, message: null }); this.stageDraft();
  }
  async searchHistory(query: string): Promise<HistoryEntry[]> {
    const search = ++this.historySearch;
    const results = this.services.getWorkspace ? await (await this.getWorkspace()).history(query) : this.state.conversations.filter(conversation => `${conversation.title} ${conversation.messages.map(message => message.text).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(conversation => ({ id: conversation.id, paper: conversation.paper, title: conversation.title, identity: conversation.paperIdentity ?? { title: conversation.title, authors: [] }, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt, messageCount: conversation.messages.length, preview: conversation.messages.at(-1)?.text ?? '', hasDraft: !!this.drafts.get(conversation.id)?.question.trim(), activeRequestId: conversation.activeRequestId }));
    if (search === this.historySearch && !this.disposed) this.update({ history: results }); return clone(results);
  }
  async openHistoryEntry(id: string): Promise<void> {
    const conversation = this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await (await this.connect()).get(id);
    if (paperId(conversation.paper) === paperId(this.paper)) { await this.openConversation(id); return; }
    if (!this.services.openHistory) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Opening another article from history is unavailable.');
    await this.flushDraft(); await this.services.openHistory(conversation.paper, id);
  }
  async searchReferences(query: string, kind: 'all' | 'article' | 'chat' = 'all', signal = new AbortController().signal): Promise<ReaderReference[]> {
    aborted(signal); const results: ReaderReference[] = [];
    if (kind !== 'chat' && this.services.library) results.push(...await this.services.library.search(query));
    if (kind !== 'article' && this.services.getWorkspace) {
      const entries = await (await this.getWorkspace()).history(query);
      results.push(...entries.map(entry => ({ id: `chat-${entry.id}`, kind: 'chat' as const, label: entry.title, paper: entry.paper, identity: entry.identity, conversationId: entry.id, capturedAt: this.services.now() })));
    }
    aborted(signal); return results.map(validateReference);
  }
  async previewReference(reference: ReaderReference, signal = new AbortController().signal): Promise<ReferenceInput> {
    const frozen = validateReference(reference); aborted(signal);
    if (frozen.kind === 'chat') return frozen.text !== undefined ? frozen : (await this.getWorkspace()).snapshotChat(frozen.conversationId!, frozen.messageIds);
    if (!this.services.library) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native reference reading is unavailable.');
    return validateReferenceInput(await this.services.library.read(frozen, signal));
  }
  async addReference(reference: ReaderReference): Promise<void> {
    const key = this.draftKey(); let frozen = validateReference(reference);
    if (frozen.kind === 'chat') {
      if (!frozen.conversationId) throw new ReaderError('INVALID_REQUEST', 'Choose a saved chat snapshot.');
      frozen = validateReference(await (await this.getWorkspace()).snapshotChat(frozen.conversationId, frozen.messageIds));
    }
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while adding this reference. Choose it again.');
    if (this.state.draft.references.some(item => item.id === frozen.id)) return;
    if (this.state.draft.references.length >= 16) throw new ReaderError('PAYLOAD_TOO_LARGE', 'Choose at most 16 references for a message.');
    this.changeDraft({ ...this.state.draft, references: [...this.state.draft.references, frozen] });
  }
  removeReference(id: string): Promise<void> { this.changeDraft({ ...this.state.draft, references: this.state.draft.references.filter(reference => reference.id !== id) }); return Promise.resolve(); }
  setReferenceRange(id: string, range: [number, number] | null): Promise<void> {
    const reference = this.state.draft.references.find(reference => reference.id === id);
    if (!reference || reference.kind !== 'article') throw new ReaderError('NOT_FOUND', 'Choose an attached article before setting its page range.');
    const next = { ...reference }; if (range) next.range = [...range]; else delete next.range;
    const checked = validateReference(next);
    this.changeDraft({ ...this.state.draft, references: this.state.draft.references.map(reference => reference.id === id ? checked : reference) });
    return Promise.resolve();
  }
  async selectSkill(id: string | null): Promise<void> {
    await this.loadLocal();
    if (id !== null) { const skill = this.state.workspace?.skills.find(skill => skill.id === id); if (!skill || !skill.enabled || skill.unsupportedDependencies.length) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Choose an enabled workflow with supported dependencies.'); }
    this.changeDraft({ ...this.state.draft, skillId: id });
  }
  async selectProfile(id: string | null): Promise<void> {
    await this.loadLocal(); if (id !== null && !this.state.workspace?.profiles.some(profile => profile.id === id)) throw new ReaderError('NOT_FOUND', 'This research profile is unavailable.');
    this.changeDraft({ ...this.state.draft, profileId: id });
  }
  setOverrides(overrides: Partial<Personalization>): void { this.changeDraft({ ...this.state.draft, overrides: validatePreferences(overrides) }); }
  private async editWorkspace(edit: (settings: WorkspaceSettings) => WorkspaceSettings): Promise<void> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings(); await workspace.saveSettings(edit(settings));
    this.update({ workspace: await workspace.settings() });
  }
  savePreferences(preferences: Personalization): Promise<void> { return this.editWorkspace(settings => ({ ...settings, preferences: { ...settings.preferences, ...validatePreferences(preferences) } })); }
  saveAppearance(value: { uiLanguage?: 'en' | 'zh'; textScale?: number }): Promise<void> {
    if (value.uiLanguage !== undefined && value.uiLanguage !== 'en' && value.uiLanguage !== 'zh') return Promise.reject(new ReaderError('INVALID_REQUEST', 'Choose a supported interface language.'));
    if (value.textScale !== undefined && (!Number.isFinite(value.textScale) || value.textScale < 0.5 || value.textScale > 3)) return Promise.reject(new ReaderError('INVALID_REQUEST', 'Choose a chat text scale from 0.5 to 3.'));
    return this.editWorkspace(settings => ({ ...settings, ...value }));
  }
  async saveProfile(value: { id: string | null; name: string; preferences: Partial<Personalization> }): Promise<ResearchProfile> {
    const profile = { id: value.id ?? `profile-${this.services.uuid()}`, name: value.name.trim(), preferences: validatePreferences(value.preferences) };
    if (!profile.name) throw new ReaderError('INVALID_REQUEST', 'Name this research profile.');
    await this.editWorkspace(settings => ({ ...settings, profiles: [...settings.profiles.filter(item => item.id !== profile.id), profile] })); return clone(profile);
  }
  async deleteProfile(id: string): Promise<void> {
    await this.editWorkspace(settings => ({ ...settings, profiles: settings.profiles.filter(profile => profile.id !== id) }));
    if (this.state.draft.profileId === id) await this.selectProfile(null);
  }
  async saveSkill(edit: PresenterSkillEdit): Promise<ReaderSkill> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings();
    const prior = edit.id ? settings.skills.find(skill => skill.id === edit.id) : undefined;
    if (edit.id && !prior) throw new ReaderError('NOT_FOUND', 'The workflow is no longer installed.');
    const visible = edit.id ? this.state.workspace?.skills.find(skill => skill.id === edit.id) : undefined;
    if (prior && (edit.revision ?? visible?.revision) !== prior.revision) throw new ReaderError('REQUEST_CONFLICT', 'This workflow changed after editing began. Reopen it before saving.');
    const id = prior?.id ?? `user-${this.services.uuid()}`;
    const saved = await workspace.saveSkill({ ...(prior ?? { id, revision: '', origin: 'user' as const, permissions: [], unsupportedDependencies: [] }), ...edit, id, description: edit.description.trim() || edit.name });
    this.update({ workspace: await workspace.settings() }); return saved;
  }
  async duplicateSkill(id: string): Promise<ReaderSkill> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings(); const prior = settings.skills.find(skill => skill.id === id);
    if (!prior) throw new ReaderError('NOT_FOUND', 'The workflow is no longer installed.');
    const saved = await workspace.saveSkill({ ...clone(prior), id: `user-${this.services.uuid()}`, name: `${prior.name} copy`, origin: 'user', revision: '' });
    this.update({ workspace: await workspace.settings() }); return saved;
  }
  async setSkillEnabled(id: string, enabled: boolean): Promise<void> {
    const workspace = await this.getWorkspace(); const settings = await workspace.settings(); const skill = settings.skills.find(skill => skill.id === id);
    if (!skill) throw new ReaderError('NOT_FOUND', 'The workflow is no longer installed.');
    await workspace.saveSkill({ ...skill, enabled }); this.update({ workspace: await workspace.settings() });
    if (!enabled && this.state.draft.skillId === id) await this.selectSkill(null);
  }
  async deleteSkill(id: string): Promise<void> { const workspace = await this.getWorkspace(); await workspace.deleteSkill(id); this.update({ workspace: await workspace.settings() }); if (this.state.draft.skillId === id) await this.selectSkill(null); }
  async importSkill(): Promise<ReaderSkill | null> {
    if (!this.services.library?.pickSkill) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Workflow import is unavailable.');
    const text = await this.services.library.pickSkill(); if (text === null) return null;
    const workspace = await this.getWorkspace(); const skill = await workspace.importSkill(text); this.update({ workspace: await workspace.settings() }); return skill;
  }
  async exportSkill(id: string): Promise<void> {
    if (!this.services.library?.exportText) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Workflow export is unavailable.');
    const skill = (await (await this.getWorkspace()).settings()).skills.find(skill => skill.id === id);
    if (!skill) throw new ReaderError('NOT_FOUND', 'The workflow is no longer installed.'); await this.services.library.exportText(`${skill.name}.md`, skill.markdown);
  }
  async exportPreferences(): Promise<void> {
    if (!this.services.library?.exportText) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Preference export is unavailable.');
    const settings = await (await this.getWorkspace()).settings();
    await this.services.library.exportText(PREFERENCES_EXPORT_NAME, preferencesExportText(settings));
  }
  async pickImages(): Promise<void> {
    if (!this.services.library?.pickImages) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native image selection is unavailable.');
    const key = this.draftKey(); const images = await this.services.library.pickImages();
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while choosing images. Choose them again.');
    if (this.state.draft.images.length + images.length > LIMITS.imagesPerRequest) throw new ReaderError('PAYLOAD_TOO_LARGE', `Attach at most ${LIMITS.imagesPerRequest} images per message.`);
    for (const image of images) this.addImage(image);
  }
  async captureRegion(citation = this.state.draft.citations.at(-1)): Promise<void> {
    if (!this.services.library?.captureRegion) throw new ReaderError('UNSUPPORTED_INTERACTION', 'PDF region capture is unavailable.');
    const key = this.draftKey(); const image = await this.services.library.captureRegion(citation ? clone(citation) : undefined);
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while capturing the PDF. Capture it again.');
    if (image) this.addImage(image);
  }
  async capturePage(pageIndex: number): Promise<void> {
    if (!this.services.library?.capturePage) throw new ReaderError('UNSUPPORTED_INTERACTION', 'PDF page capture is unavailable.');
    const key = this.draftKey(); const image = await this.services.library.capturePage(clone(this.paper), pageIndex);
    if (key !== this.draftKey()) throw new ReaderError('INVALID_REQUEST', 'The chat changed while capturing the PDF. Capture it again.');
    if (image) this.addImage(image);
  }
  async exportImage(image: ImageAttachment): Promise<void> {
    if (!this.services.library?.exportImage) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native image export is unavailable.');
    await this.services.library.exportImage(clone(image));
  }
  async collections(): Promise<Array<NativeCollectionTarget & { name: string }>> {
    if (!this.services.library?.collections) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native collection selection is unavailable.');
    const options = await this.services.library.collections(); this.update({ collectionOptions: options }); return clone(options);
  }
  setAcquisitionTarget(target: NativeCollectionTarget | null): void {
    if (target && !this.state.collectionOptions.some(option => option.clientId === target.clientId && option.libraryId === target.libraryId && option.collectionKey === target.collectionKey)) throw new ReaderError('INVALID_REQUEST', 'Choose an editable collection from this Zotero profile.');
    this.update({ acquisitionTarget: target ? clone(target) : null });
  }
  private getTasks(): Promise<AgentTasks> {
    if (this.taskPort) return Promise.resolve(this.taskPort);
    if (!this.services.getTasks) return Promise.reject(new ReaderError('UNSUPPORTED_INTERACTION', 'Native task review is unavailable.'));
    if (!this.taskFlight) this.taskFlight = this.services.getTasks().then(tasks => { this.taskPort = tasks; this.untasks = tasks.subscribe(task => this.acceptTask(task)); return tasks; }).catch(error => { this.taskFlight = null; throw error; });
    return this.taskFlight;
  }
  private acceptTask(task: AgentTaskRecord): void {
    if (this.disposed || task.conversationId !== this.state.conversation?.id) return;
    const prior = this.state.tasks.find(item => item.id === task.id); if (prior && prior.revision > task.revision) return;
    this.update({ tasks: [...this.state.tasks.filter(item => item.id !== task.id), clone(task)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  }
  private async getReading(client?: ReaderClient): Promise<PresenterReading> {
    if (this.readingPort && this.readingClient === (client ?? null)) return this.readingPort;
    if (!this.services.getReading) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Multi-pass reading is unavailable. Choose a smaller explicit source range.');
    const reading = await this.services.getReading(client); this.unreading?.(); this.readingPort = reading; this.readingClient = client ?? null;
    this.unreading = reading.subscribe(job => this.acceptReading(job)); return reading;
  }
  private acceptReading(job: ReadingJob): void {
    if (this.disposed || job.conversationId !== this.state.conversation?.id) return;
    const prior = this.state.readingJobs.find(item => item.id === job.id); if (prior && prior.revision > job.revision) return;
    this.update({ readingJobs: [...this.state.readingJobs.filter(item => item.id !== job.id), clone(job)].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
  }
  private async refreshTaskState(): Promise<void> {
    const id = this.state.conversation?.id; if (!id) return;
    if (this.services.getTasks) { const tasks = await (await this.getTasks()).list(id); if (this.state.conversation?.id === id) this.update({ tasks }); }
    if (this.services.getReading) { const jobs = await (await this.getReading(this.client ?? undefined)).list(id); if (this.state.conversation?.id === id) this.update({ readingJobs: jobs }); }
  }
  async approveTask(id: string, selected: string[], choices: AgentTaskChoices = {}): Promise<void> { this.acceptTask(await (await this.getTasks()).approve(id, [...selected], clone(choices))); }
  async cancelTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).cancel(id)); }
  async reconcileTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).reconcile(id)); }
  async undoTask(id: string): Promise<void> { this.acceptTask(await (await this.getTasks()).undo(id)); }
  async planAnnotations(candidates: AnnotationProposal[], question = this.state.draft.question, revision = this.state.document.prepared?.revision, modelRequestId?: string): Promise<AgentTaskRecord> {
    const conversation = this.state.conversation ?? await this.ensureConversation();
    if (!revision) throw new ReaderError('INVALID_REQUEST', 'Prepare the selected PDF before planning annotations.');
    const task = await (await this.getTasks()).planAnnotations({ conversationId: conversation.id, paper: clone(this.paper), revision: clone(revision), question, candidates: clone(candidates), ...(modelRequestId ? { modelRequestId } : {}) });
    this.acceptTask(task); return task;
  }
  async planAcquisition(identifiers: string[], question = this.state.draft.question, target = this.state.acquisitionTarget): Promise<AgentTaskRecord> {
    if (!target) throw new ReaderError('INVALID_REQUEST', 'Choose a target collection before acquiring articles.');
    const conversation = this.state.conversation ?? await this.ensureConversation();
    const task = await (await this.getTasks()).planAcquisition({ conversationId: conversation.id, target: clone(target), question, identifiers: [...identifiers] }); this.acceptTask(task); return task;
  }
  private async planReturnedAnnotations(requestId: string, conversation = this.state.conversation): Promise<void> {
    if (!conversation || paperId(conversation.paper) !== paperId(this.paper)) return;
    const key = `${conversation.id}:${requestId}`;
    if (!this.services.getTasks || this.planningAnnotations.has(key)) return;
    const user = conversation.messages.find(message => message.requestId === requestId && message.role === 'user');
    if (user?.workflow?.skill?.workflow !== 'annotate' || user.batch?.phase === 'map') return;
    const answer = conversation.messages.filter(message => message.requestId === requestId && message.role === 'assistant' && message.status === 'completed' && message.phase !== 'commentary').at(-1);
    if (!answer?.text.trim()) return;
    const origin = user.document ?? (user.batch ? conversation.messages.find(message => message.role === 'user' && message.batch?.id === user.batch?.id && message.document)?.document : undefined);
    if (!origin) throw new ReaderError('INVALID_REQUEST', 'Annotation proposals have no frozen PDF version. Prepare the PDF and try again.');
    this.planningAnnotations.add(key);
    try {
      const tasks = await this.getTasks();
      if ((await tasks.list(conversation.id)).some(task => task.kind === 'annotations' && task.modelRequestId === requestId)) return;
      const candidates = parseAnnotationCandidates(answer.text);
      const task = await tasks.planAnnotations({ conversationId: conversation.id, paper: clone(conversation.paper), revision: clone(origin.revision), question: user.batch?.question ?? user.text, candidates, modelRequestId: requestId }); this.acceptTask(task);
    } finally { this.planningAnnotations.delete(key); }
  }
  private async recoverAnnotationPlans(conversation: Conversation): Promise<void> {
    if (!this.services.getTasks || !this.client || this.disposed) return;
    const requests = new Set(conversation.messages.filter(message => message.role === 'user' && message.workflow?.skill?.workflow === 'annotate' && message.batch?.phase !== 'map').map(message => message.requestId));
    for (const requestId of requests) {
      if (conversation.activeRequestId === requestId || !conversation.messages.some(message => message.requestId === requestId && message.role === 'assistant' && message.status === 'completed')) continue;
      try {
        if ((await this.client.request(conversation.id, requestId)).state !== 'completed') continue;
        await this.planReturnedAnnotations(requestId, conversation);
      } catch (error) {
        if (error instanceof ReaderError && error.code === 'NOT_FOUND') continue;
        if (this.state.conversation?.id === conversation.id) this.reportError(this.errorText(error));
      }
    }
  }
  async openTaskSource(id: string, itemId: string): Promise<void> {
    if (!this.services.openCitation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native source navigation is unavailable.');
    const task = await (await this.getTasks()).get(id); const item = task.items.find(item => item.id === itemId);
    if (task.kind !== 'annotations' || item?.kind !== 'annotation' || item.resolution?.status !== 'resolved') throw new ReaderError('NOT_FOUND', 'This candidate has no resolved source.');
    const source = item.resolution.candidate; const position = source.position;
    await this.services.openCitation({ id: this.services.uuid(), paper: clone(task.paper), title: paperId(task.paper) === paperId(this.paper) ? this.title : task.paper.attachmentKey, authors: [], text: source.text, pageLabel: source.pageLabel, positions: [{ pageIndex: position.pageIndex, rects: clone(position.rects) }], capturedAt: this.services.now(), contextScope: 'selection', documentRevision: clone(task.documentRevision) });
  }
  async openTaskOutput(id: string, itemId: string): Promise<void> {
    const task = await (await this.getTasks()).get(id); const item = task.items.find(item => item.id === itemId);
    if (!item || item.status === 'undone') throw new ReaderError('NOT_FOUND', 'This task has no available recorded output.');
    if (item.kind === 'annotation' && item.annotation) { await this.openTaskSource(id, itemId); return; }
    if (item.kind === 'acquisition' && item.item) {
      if (item.acquisition?.status === 'attached' && !item.attachmentUndone && this.services.library) {
        const attachment = item.acquisition.attachment; await this.services.library.open({ clientId: attachment.clientId, libraryId: attachment.libraryId, attachmentKey: attachment.key }); return;
      }
      if (!this.services.openItem) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Native item navigation is unavailable.');
      await this.services.openItem({ clientId: item.item.clientId, libraryId: item.item.libraryId, key: item.item.key }); return;
    }
    throw new ReaderError('NOT_FOUND', 'No native output was recorded for this item.');
  }
  async cancelReading(id: string): Promise<void> { const reading = await this.getReading(await this.connect()); this.acceptReading(await reading.cancel(id)); }
  async reconcileReading(id: string): Promise<void> { const reading = await this.getReading(await this.connect()); this.acceptReading(await reading.reconcile(id)); await this.sync(); }
  async openReadingOutput(id: string, stepIndex: number): Promise<void> {
    const job = await (await this.getReading(await this.connect())).get(id); const result = job.steps.find(step => step.index === stepIndex)?.result;
    if (!result?.messageIds.length) throw new ReaderError('NOT_FOUND', 'This reading pass has no stored answer.');
    if (job.conversationId !== this.state.conversation?.id) await this.openHistoryEntry(job.conversationId);
    await this.sync(); const messageId = result.messageIds.find(id => this.state.conversation?.messages.some(message => message.id === id));
    if (!messageId) throw new ReaderError('NOT_FOUND', 'The stored answer could not be located in this chat.');
    this.update({ messageFocus: { messageId, token: (this.state.messageFocus?.token ?? 0) + 1 } });
  }
  async describeReading(id: string): Promise<{ question: string; scopeLabel: string } | null> {
    const saved = this.readingDescriptions.get(id); if (saved) return clone(saved);
    const job = this.state.readingJobs.find(job => job.id === id); if (!job) return null;
    const conversation = job.conversationId === this.state.conversation?.id ? this.state.conversation : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(job.conversationId) : null;
    const user = conversation?.messages.find(message => message.role === 'user' && message.requestId === job.id); if (!user) return null;
    return { question: user.batch?.question ?? user.text, scopeLabel: [user.document ? user.paper?.title || this.title : '', ...(user.references ?? []).map(reference => reference.label)].filter(Boolean).join(' · ') || 'Recorded source scope is shown by the completed passes.' };
  }
  private contextOptions(): RequestContext {
    // Recheck the shared opt-out at the request boundary, including an already-open second view.
    const enabled = this.state.document.enabled && (this.services.document?.readEnabled() ?? false);
    if (enabled !== this.state.document.enabled) this.update({ document: { ...this.state.document, enabled } });
    return { enabled, range: clone(this.state.document.range), acquisitionTarget: this.state.acquisitionTarget ? clone(this.state.acquisitionTarget) : null };
  }
  /** Draft only: never edits an in-flight or already-submitted message snapshot. */
  setSettings(settings: GenerationSettings): void {
    const models = this.state.runtime?.models ?? [];
    const next = models.length ? alignSettings(models, settings) : { model: settings.model, serviceTier: settings.serviceTier, effort: settings.effort };
    this.changeDraft({ ...this.state.draft, settings: next });
  }
  // ---- runtime ----------------------------------------------------------------------------------
  async activate(): Promise<void> {
    try { await this.loadLocal(); } catch { /* Preserve unreadable records and report the local failure. */ }
    if (this.state.document.enabled && this.state.document.phase === 'idle') void this.prepareContext().catch(() => {});
    try { await this.connect(); if (this.state.runtime?.models.length) { await this.ensureConversation(); await this.sync(); await this.refreshList(); } }
    catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); }
    await this.refreshTaskState().catch(error => this.reportError(this.errorText(error)));
  }
  setDocumentEnabled(enabled: boolean): void {
    this.services.document?.writeEnabled(enabled);
    this.update({ document: { ...this.state.document, enabled } });
    if (!enabled && !this.submitting) this.documentJob?.controller.abort();
    if (enabled && !this.submitting) void this.prepareContext().catch(() => {});
  }
  setDocumentRange(first: number | null, last: number | null): void {
    const bound = (value: number | null) => value !== null && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
    const low = bound(first); const high = bound(last);
    const range: [number, number] | null = low === null && high === null ? null
      : low === null ? [high!, high!] : high === null ? [low, low] : low <= high ? [low, high] : [high, low];
    this.update({ document: { ...this.state.document, range, prepared: null, phase: 'idle', error: null } });
    this.draftVersion++; this.stageDraft();
    if (!this.submitting) { this.documentJob?.controller.abort(); if (this.state.document.enabled) void this.prepareContext().catch(() => {}); }
  }
  acknowledgeContext(): void {
    this.services.document?.acknowledge?.();
    this.update({ document: { ...this.state.document, disclosure: false } });
    const pending = this.state.pendingExplain;
    if (pending) { this.update({ pendingExplain: null }); void this.explain(pending); }
  }
  prepareContext(): Promise<DocumentContext> { return this.prepareDocument(this.state.document.range); }
  private prepareDocument(range: readonly [number, number] | null): Promise<DocumentContext> {
    const key = JSON.stringify(range);
    if (this.documentJob?.range === key && !this.documentJob.controller.signal.aborted) return this.documentJob.promise;
    const controller = new AbortController();
    const job = { controller, range: key, promise: Promise.resolve(null as unknown as DocumentContext), consumers: 0 };
    this.documentJob = job;
    this.update({ document: { ...this.state.document, phase: 'preparing', error: null, progress: { done: 0, total: 0 } } });
    job.promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      const service = this.services.document;
      if (!service) throw new Error('Current PDF context is unavailable.');
      const document = await service.prepare(controller.signal, progress => {
        if (this.documentJob === job) this.update({ document: { ...this.state.document, progress } });
      }, range ?? undefined);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      await service.validate(document);
      if (controller.signal.aborted) throw new Error('PDF preparation cancelled. Your question is kept.');
      if (this.documentJob === job) this.update({ document: { ...this.state.document, prepared: document, phase: 'ready', error: null } });
      return document;
    }).catch(error => {
      if (this.documentJob === job) this.update({ document: { ...this.state.document, phase: 'error', error: this.errorText(error) } });
      throw error;
    }).finally(() => { if (this.documentJob === job) this.documentJob = null; });
    return job.promise;
  }
  private async requestDocument(range: readonly [number, number] | null, signal: AbortSignal): Promise<DocumentContext> {
    const prepared = this.prepareDocument(range); const job = this.documentJob;
    if (job) job.consumers++;
    try { return await waitPreparation(prepared, signal); }
    finally { if (job) { job.consumers--; if (signal.aborted && job.consumers === 0) job.controller.abort(); } }
  }
  async retry(): Promise<void> { this.client = null; this.unobserve?.(); this.unobserve = null; if (this.state.persistence === 'error') this.localFlight = null; await this.activate(); }
  private connect(): Promise<ReaderClient> {
    if (this.client && this.client.snapshot().runtime === 'ready') return Promise.resolve(this.client);
    if (this.connecting) return this.connecting;
    this.update({ connection: 'starting', message: null });
    this.connecting = this.services.ensureStarted().then(client => {
      this.client = client;
      this.unobserve?.(); this.unobserve = client.observe(snapshot => this.onRuntime(snapshot));
      return client;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private onRuntime(snapshot: RuntimeSnapshot): void {
    if (this.disposed) return;
    let draft = this.state.draft;
    if (snapshot.models.length && draft.settings) {
      const aligned = alignSettings(snapshot.models, draft.settings);
      if (aligned.model !== draft.settings.model || aligned.serviceTier !== draft.settings.serviceTier || aligned.effort !== draft.settings.effort) {
        draft = { ...draft, settings: aligned };
      }
    }
    this.update({ runtime: snapshot, draft, connection: snapshot.runtime === 'ready' ? 'ready' : 'error', message: snapshot.error ?? this.state.message });
    if (this.signedIn() && !this.continuing) { this.continuing = true; void this.continueAfterLogin().finally(() => { this.continuing = false; }); }
  }
  /** After a login the conversation is loaded; a single pending More details resumes exactly once. */
  private async continueAfterLogin(): Promise<void> {
    try {
      const conversation = await this.ensureConversation();
      const pending = this.state.pendingExplain;
      if (pending && !this.state.document.disclosure) {
        this.update({ pendingExplain: null });
        await this.submit(conversation, makeExplain(pending, conversation.id, this.services.uuid(), this.currentSettings() ?? conversation.settings, this.paperIdentity()), this.contextOptions(), { ...clone(this.state.draft), skillId: null, references: [] }, await this.captureWorkspace());
      }
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private async ensureConversation(): Promise<Conversation> {
    const client = await this.connect();
    if (this.state.conversation) return this.state.conversation;
    const conversation = await client.current(this.paper, this.title, this.currentSettings() ?? undefined);
    this.update({ conversation, draft: { ...this.state.draft, settings: this.state.draft.settings ?? conversation.settings }, connection: 'ready', message: await this.isolationNote(client, conversation) });
    await this.sync();
    await this.refreshList();
    return conversation;
  }
  private async isolationNote(client: ReaderClient, conversation: Conversation): Promise<string | null> {
    if (conversation.messages.some(entry => entry.status === 'uncertain')) return UNCERTAIN_ISOLATION;
    const ids = new Set<string>();
    for (const entry of conversation.messages) {
      if (entry.status === 'pending' || entry.status === 'streaming') ids.add(entry.requestId);
      else if (entry.role === 'user' && !conversation.messages.some(message => message.requestId === entry.requestId && message.role === 'assistant' && (message.status === 'completed' || message.status === 'cancelled' || message.status === 'failed'))) {
        ids.add(entry.requestId);
      }
    }
    if (conversation.activeRequestId) ids.add(conversation.activeRequestId);
    for (const requestId of ids) {
      try { if ((await client.request(conversation.id, requestId)).state === 'uncertain') return UNCERTAIN_ISOLATION; }
      catch { /* missing request ids are ignored */ }
    }
    return null;
  }
  private stashDraft(): void {
    const id = this.draftKey(); this.drafts.set(id, clone(this.state.draft));
    this.positions.set(id, { scrollTop: this.state.scrollTop, range: clone(this.state.document.range) });
  }
  private async refreshList(): Promise<void> {
    if (!this.client) return;
    this.update({ conversations: await this.client.list(this.paper) });
  }
  // ---- events -----------------------------------------------------------------------------------
  private listen(client: ReaderClient): void {
    // A restarted runtime yields a new per-instance listener set; the old subscription would
    // never deliver another event, so re-subscribe whenever the client identity changes.
    if (this.unsubscribe && this.unsubscribeClient === client) return;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeClient = client;
    this.unsubscribe = client.subscribe(event => {
      if (!this.state.conversation || event.conversationId !== this.state.conversation.id) {
        const known = this.state.conversations.some(conversation => conversation.id === event.conversationId) || this.drafts.has(event.conversationId);
        if (known && event.type === 'completed' && this.services.getTasks) void client.get(event.conversationId).then(conversation => {
          if (this.disposed || conversation.id !== event.conversationId || paperId(conversation.paper) !== paperId(this.paper)) return;
          return this.planReturnedAnnotations(event.requestId, conversation);
        }).catch(error => { if (this.state.conversation?.id === event.conversationId) this.reportError(this.errorText(error)); });
        return;
      }
      if (this.syncing) { this.buffered.push(event); return; }
      this.apply(event);
    });
  }
  /** Subscribe first, then read a consistent snapshot, then apply only newer buffered events. */
  private async sync(): Promise<void> {
    const client = this.client; const id = this.state.conversation?.id;
    if (!client || !id) return;
    const generation = ++this.syncGeneration;
    this.listen(client);
    this.syncing = true; this.buffered = [];
    try {
      const conversation = await client.get(id);
      if (generation !== this.syncGeneration) return;
      if (this.state.conversation?.id !== id) { this.syncing = false; this.buffered = []; return; }
      const buffered = this.buffered; this.buffered = []; this.syncing = false;
      this.update({ conversation });
      for (const event of buffered) if (event.seq > conversation.lastSeq) this.apply(event);
      await this.recoverAnnotationPlans(conversation);
    } catch (error) { if (generation !== this.syncGeneration) return; this.syncing = false; this.buffered = []; this.update({ message: this.errorText(error) }); }
  }
  private apply(event: ReaderEvent): void {
    const conversation = this.state.conversation;
    if (!conversation || event.seq <= conversation.lastSeq) return;
    // Spread alone keeps the stale timing, which would let a settled request keep ticking: every
    // event advances the honest accept/first-text/settle stamps the view renders.
    const next: Conversation = { ...conversation, messages: conversation.messages.map(m => ({ ...m })), lastSeq: event.seq, requestTiming: advanceRequestTiming(conversation.requestTiming, event) };
    const settleMessages = (status: Message['status']) => { for (const m of next.messages) if (m.requestId === event.requestId && m.role === 'assistant' && (m.status === 'streaming' || m.status === 'pending')) m.status = status; };
    let message = this.state.message;
    switch (event.type) {
      case 'accepted': next.activeRequestId = event.requestId; break;
      case 'delta': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text += event.text; break;
      }
      case 'messageCompleted': {
        let target = next.messages.find(m => m.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        target.text = event.finalText; target.phase = event.phase; target.status = 'completed'; break;
      }
      case 'completed': settleMessages('completed'); next.activeRequestId = null; break;
      case 'cancelled': settleMessages('cancelled'); next.activeRequestId = null; break;
      case 'failed': settleMessages('failed'); next.activeRequestId = null; message = event.message; break;
      case 'uncertain': settleMessages('uncertain'); next.activeRequestId = null; message = event.message; break;
      case 'usage': next.usage = clone(event.usage); break;
      case 'image': {
        let target = next.messages.find(item => item.id === event.messageId);
        if (!target) { target = { id: event.messageId, requestId: event.requestId, role: 'assistant', phase: null, settings: next.settings, text: '', citations: [], status: 'streaming' }; next.messages.push(target); }
        const image = validateOutputImage(event.image);
        if (!target.generatedImages?.some(item => item.id === image.id)) target.generatedImages = [...(target.generatedImages ?? []), image];
        break;
      }
    }
    this.update({ conversation: next, message });
    if (event.type === 'completed') void this.planReturnedAnnotations(event.requestId).catch(error => this.reportError(this.errorText(error)));
  }
  // ---- draft ------------------------------------------------------------------------------------
  addCitation(citation: Citation): void { this.changeDraft(addCitation(this.state.draft, citation)); }
  removeCitation(citationId: string): void { this.changeDraft(removeCitation(this.state.draft, citationId)); }
  addImage(image: ImageAttachment): void { this.changeDraft(addImage(this.state.draft, validateImageAttachment(image))); }
  removeImage(imageId: string): void { this.changeDraft(removeImage(this.state.draft, imageId)); }
  moveImage(id: string, delta: number): void { this.changeDraft(moveImage(this.state.draft, id, delta)); }
  setQuestion(question: string): void {
    if (this.state.draft.question === question) return;
    this.changeDraft({ ...this.state.draft, question });
  }
  // ---- requests ---------------------------------------------------------------------------------
  /** More details: one explain request per click; when signed out the citation waits for the official login. */
  explain(citation: Citation): Promise<void> {
    const key = `${this.draftKey()}:${citation.id}`;
    const existing = this.explainFlights.get(key); if (existing) return existing;
    const context = this.contextOptions(); const frozenSettings = this.currentSettings();
    const draft = { ...clone(this.state.draft), skillId: null, references: [] }; const workspace = this.captureWorkspace(); const target = this.state.conversation;
    if (context.enabled && this.state.document.disclosure) { this.update({ pendingExplain: clone(citation) }); return Promise.resolve(); }
    const flight = (async () => {
      const kept = clone(citation);
      try {
        await this.loadLocal();
        const configuration = await workspace; if (this.disposed) return;
        await this.connect();
        if (!this.signedIn()) { this.update({ pendingExplain: kept, message: null }); await this.login(); return; }
        const conversation = target ?? await this.ensureConversation();
        await this.submit(conversation, makeExplain(kept, conversation.id, this.services.uuid(), frozenSettings ?? conversation.settings, this.paperIdentity()), context, draft, configuration);
      } catch (error) { this.update({ message: this.errorText(error) }); }
    })().finally(() => { this.explainFlights.delete(key); });
    this.explainFlights.set(key, flight);
    return flight;
  }
  send(): Promise<void> {
    const key = this.draftKey(); const existing = this.sendFlights.get(key); if (existing) return existing;
    if (!this.state.draft.question.trim()) { this.update({ message: 'Enter a question first.' }); return Promise.resolve(); }
    const draft = clone(this.state.draft); const version = this.draftVersion;
    const settings = this.currentSettings(); const document = this.contextOptions();
    const workspace = this.captureWorkspace(); const target = this.state.conversation;
    if (document.enabled) { this.services.document?.acknowledge?.(); this.update({ document: { ...this.state.document, disclosure: false } }); }
    const flight = this.sendDraft(draft, version, settings, document, workspace, target).finally(() => { this.sendFlights.delete(key); }); this.sendFlights.set(key, flight);
    return flight;
  }
  queueDraft(): Promise<void> {
    if (this.queueFlight) return this.queueFlight;
    if (!this.state.draft.question.trim()) { this.reportError('Enter a question first.'); return Promise.resolve(); }
    const draft = clone(this.state.draft); const version = this.draftVersion; const settings = this.currentSettings(); const document = this.contextOptions();
    const workspace = this.captureWorkspace(); const target = this.state.conversation; const sending = this.sendFlights.get(this.draftKey());
    this.update({ queueing: true });
    this.queueFlight = (async () => { await sending; await this.sendDraft(draft, version, settings, document, workspace, target, true); })().finally(() => { this.queueFlight = null; this.update({ queueing: false }); });
    return this.queueFlight;
  }
  private async sendDraft(draft: WorkspaceDraft, version: number, settings: GenerationSettings | null, document: RequestContext, workspace: Promise<WorkspaceSettings | null>, target: Conversation | null, queued = false): Promise<void> {
    try {
      await this.loadLocal();
      const configuration = await workspace; if (this.disposed) return;
      await this.connect();
      if (!this.signedIn()) { this.update({ message: 'Sign in with ChatGPT first.' }); await this.login(); return; }
      const conversation = target ?? await this.ensureConversation();
      const input = makeAsk(draft, conversation.id, this.services.uuid(), settings ?? conversation.settings, this.paperIdentity());
      await this.submit(conversation, input, document, draft, configuration, queued);
      const active = this.state.conversation?.id === conversation.id;
      const stored = active ? this.state.draft : this.drafts.get(conversation.id);
      const position = active ? { scrollTop: this.state.scrollTop, range: this.state.document.range } : this.positions.get(conversation.id);
      const unchanged = active && this.draftVersion === version || !!stored && JSON.stringify(stored) === JSON.stringify(draft) && JSON.stringify(position?.range ?? null) === JSON.stringify(document.range);
      if (stored && unchanged) {
        const cleared = { ...stored, question: '', citations: [], images: [], references: [] };
        if (active) this.changeDraft(cleared);
        else {
          this.drafts.set(conversation.id, cleared);
          if (this.services.getWorkspace) {
            this.pendingSaves.set(conversation.id, { schemaVersion: 1, paper: clone(this.paper), conversationId: conversation.id, draft: cleared, scrollTop: position?.scrollTop ?? 0, pageRange: clone(position?.range ?? null), updatedAt: this.services.now() });
            if (this.saveTimer) clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flushDraft().catch(() => {}); }, 150);
          }
        }
      }
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private frozenWorkflow(draft: WorkspaceDraft, settings: WorkspaceSettings | null): WorkflowSnapshot | undefined {
    if (!settings) return undefined;
    const profile = draft.profileId ? settings.profiles.find(profile => profile.id === draft.profileId) : undefined;
    if (draft.profileId && !profile) throw new ReaderError('NOT_FOUND', 'The selected research profile is unavailable. Choose another profile.');
    const skill = draft.skillId ? settings.skills.find(skill => skill.id === draft.skillId) : null;
    if (draft.skillId && (!skill || !skill.enabled)) throw new ReaderError('UNSUPPORTED_INTERACTION', 'The selected workflow is unavailable or disabled.');
    return validateWorkflow({ skill: skill ?? null, profileId: draft.profileId, preferences: { ...settings.preferences, ...profile?.preferences, ...draft.overrides } });
  }
  private estimateBudget(input: SendInput, conversation: Conversation): ContextBudget {
    if (this.services.contextBudget) return this.services.contextBudget(input, conversation);
    const bare: SendInput = { ...input, question: '' }; delete bare.document; delete bare.workflow;
    if (input.references) bare.references = input.references.map(reference => { const metadata = { ...reference }; delete metadata.document; return metadata; });
    const sources = new Map<string, number>(); let history = 0;
    for (const message of conversation.messages) {
      history += bytes({ role: message.role, text: message.text, citations: message.citations, references: message.references, workflow: message.workflow });
      history += (message.images?.length ?? 0) * 16384;
      if (message.document) sources.set(message.document.id, message.document.textBytes);
      for (const reference of message.referenceDocuments ?? []) sources.set(reference.document.id, reference.document.textBytes);
    }
    history += [...sources.values()].reduce((sum, value) => sum + value, 0);
    const usage = conversation.usage?.model === input.settings.model ? conversation.usage : undefined;
    return buildContextBudget({ modelId: input.settings.model, reportedWindow: usage?.contextWindow ?? null, historyTokens: history, instructionBytes: bytes(PAPER_THREAD_POLICY.baseInstructions + PAPER_THREAD_POLICY.developerInstructions) + bytes(readingInput(bare)), workflowBytes: input.workflow ? bytes(input.workflow) : 0, imageCount: input.images?.length ?? 0, questionBytes: bytes(input.question) });
  }
  private async planInput(input: SendInput, conversation: Conversation): Promise<ContextPlan | null> {
    const documents = [input.document, ...(input.references ?? []).map(reference => reference.document)].filter((document): document is DocumentContext => !!document);
    if (!documents.length) return null;
    const budget = this.estimateBudget(input, conversation);
    const primary = input.document ?? documents[0]!;
    if (budget.accuracy === 'unknown' || budget.textBudgetTokens === null) {
      input.contextReport = { mode: 'full', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: null, selectedPages: primary.pages.map(page => page.pageIndex), totalPages: primary.totalPages, reason: 'All authorized source text is included. Model capacity or retained history is unknown; fit was not asserted.' }; return null;
    }
    if (!budget.textBudgetTokens) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The context budget leaves no room for PDF text. Start a new chat or narrow the supplied context.');
    const total = documents.reduce((sum, document) => sum + bytes(document), 0);
    if (total <= budget.textBudgetTokens) {
      input.contextReport = { mode: 'full', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: primary.pages.map(page => page.pageIndex), totalPages: primary.totalPages, reason: 'All authorized text fits the conservative context estimate. Extraction gaps and image costs remain explicit.' }; return null;
    }
    const perSource = { ...budget, textBudgetTokens: Math.floor(budget.textBudgetTokens / documents.length) };
    const plans = await Promise.all(documents.map(document => planContext({ document, question: input.question, citations: input.citations, budget: perSource })));
    const all = plans.flatMap(plan => plan.documents);
    if (all.length > 256) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This scope needs more than 256 reading passes. Choose a smaller explicit scope.');
    if (plans.every(plan => plan.mode !== 'multi-pass') && all.reduce((sum, document) => sum + bytes(document), 0) <= budget.textBudgetTokens) {
      const substitute = (document: DocumentContext) => all.find(fragment => paperId(fragment.paper) === paperId(document.paper) && (fragment.sourceId ?? fragment.id) === (document.sourceId ?? document.id)) ?? document;
      if (input.document) input.document = substitute(input.document);
      if (input.references) input.references = input.references.map(reference => reference.document ? { ...reference, document: substitute(reference.document) } : reference);
      const selected = input.document ?? all[0]!;
      input.contextReport = { mode: 'focused', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: selected.pages.map(page => page.pageIndex), totalPages: selected.totalPages, reason: 'Question-focused source fragments are supplied; unselected pages were not sent.' }; return null;
    }
    const first = plans[0]!;
    const plan: ContextPlan = { mode: 'multi-pass', documents: all, budget, coverage: { ...first.coverage, reason: `The authorized sources require ${all.length} reading passes followed by synthesis. Per-source coverage is recorded on each completed pass.` } };
    input.contextReport = { mode: 'multi-pass', capacity: budget.capacity, provenance: budget.provenance, reservedTokens: budget.reservations.total, textBudgetTokens: budget.textBudgetTokens, selectedPages: first.coverage.selectedPages, totalPages: first.coverage.totalPages, reason: plan.coverage.reason }; return plan;
  }
  private async submit(conversation: Conversation, input: SendInput, context: RequestContext, draft: WorkspaceDraft, configuration: WorkspaceSettings | null, queued = false): Promise<void> {
    if (this.submissions.has(conversation.id)) throw new ReaderError('BUSY', 'This chat is already preparing a request.');
    const client = await this.connect();
    if (queued && !client.enqueue) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Durable request queuing is unavailable. Your draft is kept.');
    const current = await client.get(conversation.id);
    if (current.id !== conversation.id || paperId(current.paper) !== paperId(this.paper)) throw new ReaderError('INVALID_REQUEST', 'The request conversation changed.');
    if (!queued && (current.activeRequestId || current.queuedRequestIds?.length)) throw new ReaderError('BUSY', 'This conversation is still answering. Use Queue or start a new chat.');
    const controller = new AbortController(); this.submissions.set(conversation.id, controller); this.update({ message: null });
    try {
      const workflow = this.frozenWorkflow(draft, configuration ?? this.state.workspace);
      if (workflow) input.workflow = workflow;
      if (workflow?.skill?.workflow === 'acquire') {
        if (queued) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Acquisition previews use task review, not the model request queue. Your draft is kept.');
        if (!context.acquisitionTarget) throw new ReaderError('INVALID_REQUEST', 'Choose a target collection before acquiring articles.');
        const identifiers = [...new Set((input.question.match(/https?:\/\/[^\s<>"']+|\b10\.\d{4,9}\/[^\s<>"']+/giu) ?? []).map(value => value.replace(/[.,;，。；]+$/u, '')))];
        if (!identifiers.length) throw new ReaderError('INVALID_REQUEST', 'Provide explicit DOI identifiers or article URLs for acquisition.');
        const task = await (await this.getTasks()).planAcquisition({ conversationId: conversation.id, target: clone(context.acquisitionTarget), question: input.question, identifiers }); this.acceptTask(task); return;
      }
      if (workflow?.skill?.workflow === 'diagram' && this.state.runtime?.capabilities?.imageGeneration !== true) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Image generation is unavailable in this runtime.');
      if (context.enabled) input.document = await this.requestDocument(context.range, controller.signal);
      const references: ReferenceInput[] = [];
      for (const reference of draft.references) {
        aborted(controller.signal);
        references.push(reference.kind === 'chat' ? validateReference(reference) : await this.previewReference(reference, controller.signal));
      }
      if (references.length) input.references = references;
      if (input.document && !input.document.pages.some(page => page.status === 'text') && !input.images?.length) throw new ReaderError('INVALID_REQUEST', 'No extractable text was found in this range. Attach the relevant page image or select a readable range.');
      const modalities = this.state.runtime?.models.find(model => model.id === input.settings.model)?.inputModalities;
      if (input.images?.length && modalities && !modalities.includes('image')) throw new ReaderError('MODEL_UNAVAILABLE', 'The selected model does not accept image input.');
      const plan = await this.planInput(input, current); aborted(controller.signal);
      if (this.state.conversation?.id === conversation.id) this.update({ contextReport: input.contextReport ?? null });
      if (plan) {
        const reading = await this.getReading(client);
        this.readingDescriptions.set(input.requestId, { question: input.question, scopeLabel: [input.document ? input.paper?.title || this.title : '', ...(input.references ?? []).map(reference => reference.label)].filter(Boolean).join(' · ') });
        this.acceptReading(await (queued ? reading.enqueue(input, plan) : reading.start(input, plan)));
      } else if (queued) await client.enqueue!(input);
      else await client.send(input);
      if (this.state.conversation?.id === conversation.id) await this.sync();
      await this.refreshList();
    }
    finally { this.submissions.delete(conversation.id); this.update({}); }
  }
  async cancel(): Promise<void> {
    const client = this.client; const conversation = this.state.conversation;
    const reading = this.state.readingJobs.find(activeReading); if (reading) { await this.cancelReading(reading.id); return; }
    if (!conversation) return;
    if (!conversation.activeRequestId) { this.submissions.get(conversation.id)?.abort(); return; }
    if (!client) { this.reportError('Reconnect before stopping this saved request.'); return; }
    try { await client.cancel(conversation.id, conversation.activeRequestId); } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async cancelQueuedRequest(requestId: string): Promise<void> {
    const conversation = this.state.conversation; if (!conversation?.queuedRequestIds?.includes(requestId)) throw new ReaderError('NOT_FOUND', 'This request is not queued in the current chat.');
    await (await this.connect()).cancel(conversation.id, requestId); await this.sync();
  }
  private conversationHasContent(conversation: Conversation): boolean {
    const draft = this.drafts.get(conversation.id);
    const pendingDraft = !!draft && (draft.question.trim().length > 0 || draft.citations.length > 0 || draft.images.length > 0
      || draft.references.length > 0 || !!draft.skillId || !!draft.profileId || Object.keys(draft.overrides ?? {}).length > 0);
    return conversation.messages.length > 0 || !!conversation.activeRequestId || !!conversation.queuedRequestIds?.length || pendingDraft;
  }
  async newConversation(): Promise<void> {
    try {
      await this.loadLocal(); const navigation = ++this.navigation;
      const client = await this.connect();
      this.stageDraft();
      // Never stack duplicate empty chats: adopt the open one, or the most recent idle empty one.
      // The cached list can lag the live conversation, so the open one always wins by id.
      const byId = new Map([...this.state.conversations]
        .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
        .map(entry => [entry.id, entry] as const));
      if (this.state.conversation) byId.set(this.state.conversation.id, this.state.conversation);
      const idle = [...byId.values()].find(entry => paperId(entry.paper) === paperId(this.paper) && !this.conversationHasContent(entry));
      if (idle) {
        if (idle.id !== this.state.conversation?.id) await this.openConversation(idle.id);
        else this.update({ message: null, pendingExplain: null, contextReport: null });
        return;
      }
      const conversation = await client.newConversation(this.paper, this.title, this.currentSettings() ?? undefined);
      if (navigation !== this.navigation) return;
      this.stageDraft(); this.draftVersion++;
      this.update({ conversation, draft: this.emptyDraft(conversation.settings), scrollTop: 0, message: null, pendingExplain: null, contextReport: null, tasks: [], readingJobs: [], acquisitionTarget: null, messageFocus: null, document: { ...this.state.document, range: null, prepared: null, phase: 'idle' } });
      this.stageDraft(); await this.sync(); await this.refreshList(); await this.refreshTaskState();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async deleteConversation(id: string): Promise<void> {
    try {
      const client = await this.connect();
      const target = this.state.conversation?.id === id ? this.state.conversation : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await client.get(id);
      if (target.id !== id) throw new ReaderError('NOT_FOUND', 'The selected chat could not be located.');
      if (this.services.getTasks) {
        const tasks = await (await this.getTasks()).list(id);
        if (tasks.some(task => ['preparing', 'review', 'running', 'uncertain'].includes(task.state) || task.items.some(item => ['writing', 'undoing', 'uncertain'].includes(item.status)))) throw new ReaderError('BUSY', 'Cancel or reconcile this chat’s unfinished native tasks before deleting it. Existing native outputs will not be undone.');
      }
      if (this.services.getReading && (await (await this.getReading(client)).list(id)).some(unfinishedReading)) throw new ReaderError('BUSY', 'Cancel or reconcile this chat’s unfinished reading task before deleting it.');
      this.stageDraft(); await this.flushDraft();
      const conversation = await client.deleteConversation(target.paper, id);
      this.drafts.delete(id); this.positions.delete(id); this.pendingSaves.delete(id);
      if (this.services.getWorkspace) await (await this.getWorkspace()).deleteDraft(target.paper, id);
      if (this.state.conversation?.id === id) await this.restoreConversation(conversation, false);
      await this.sync();
      await this.refreshList(); await this.refreshTaskState();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async openConversation(id: string): Promise<void> {
    if (this.state.conversation?.id === id) return;
    try {
      await this.loadLocal(); const navigation = ++this.navigation; this.stageDraft();
      const client = this.client;
      const conversation = client && this.state.connection === 'ready' ? await client.select(this.paper, id) : this.services.getWorkspace ? await (await this.getWorkspace()).readConversation(id) : await (await this.connect()).select(this.paper, id);
      if (navigation !== this.navigation) return;
      if (paperId(conversation.paper) !== paperId(this.paper)) { await this.openHistoryEntry(id); return; }
      await this.restoreConversation(conversation); if (this.state.connection === 'ready') await this.sync();
      await this.refreshList(); await this.refreshTaskState();
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  private async restoreConversation(conversation: Conversation, stash = true, override?: WorkspaceDraft): Promise<void> {
    let draft = override ?? this.drafts.get(conversation.id); let position = this.positions.get(conversation.id);
    if (!draft && this.services.getWorkspace) {
      const saved = await (await this.getWorkspace()).readDraft(this.paper, conversation.id);
      if (saved) { draft = saved.draft; position = { scrollTop: saved.scrollTop, range: saved.pageRange }; }
    }
    if (stash) this.stageDraft(); this.draftVersion++;
    this.update({ conversation, draft: draft ? workspaceDraft(draft) : this.emptyDraft(conversation.settings), scrollTop: position?.scrollTop ?? 0, message: null, pendingExplain: null, tasks: [], readingJobs: [], contextReport: conversation.messages.filter(message => message.role === 'user').at(-1)?.contextReport ?? null, messageFocus: null, acquisitionTarget: null,
      document: { ...this.state.document, range: clone(position?.range ?? null), prepared: null, phase: 'idle', error: null } });
    if (this.client) this.update({ message: await this.isolationNote(this.client, conversation) });
    this.stageDraft();
  }
  async renameConversation(id: string, title: string): Promise<void> {
    const client = await this.connect(); if (!client.renameConversation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Chat renaming is unavailable.');
    const renamed = await client.renameConversation(id, title.trim());
    if (this.state.conversation?.id === id) this.update({ conversation: renamed });
    await this.refreshList(); await this.searchHistory('');
  }
  async branchConversation(messageId: string, question?: string): Promise<void> {
    const original = this.state.conversation; if (!original) throw new ReaderError('NOT_FOUND', 'Open a chat before editing a previous message.');
    const anchor = original.messages.find(message => message.id === messageId);
    const user = anchor?.role === 'user' ? anchor : original.messages.find(message => message.role === 'user' && message.requestId === anchor?.requestId);
    if (!user) throw new ReaderError('NOT_FOUND', 'The original question could not be found.');
    const client = await this.connect(); if (!client.branchConversation) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Branching chat history is unavailable.');
    const navigation = ++this.navigation; this.stageDraft(); await this.flushDraft();
    const branch = await client.branchConversation(original.id, messageId);
    if (branch.id === original.id || paperId(branch.paper) !== paperId(this.paper)) throw new ReaderError('INVALID_REQUEST', 'The core did not create an independent chat branch.');
    if (navigation !== this.navigation) return;
    const draft: WorkspaceDraft = { ...this.emptyDraft(user.settings), question: question ?? user.text, citations: clone(user.citations), images: clone(user.images ?? []), references: clone(user.references ?? []), skillId: user.workflow?.skill?.id ?? null, profileId: user.workflow?.profileId ?? null, overrides: {} };
    await this.restoreConversation(branch, true, draft); this.focusInput(); await this.refreshList(); await this.refreshTaskState();
  }
  // ---- account ----------------------------------------------------------------------------------
  async login(): Promise<void> {
    try {
      const client = await this.connect();
      if (client.snapshot().account.state === 'signedIn') return;
      const flow = await client.startLogin();
      const url = new URL(flow.authorizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !LOGIN_HOSTS.includes(url.hostname)) throw new Error('Codex returned an unsupported login address.');
      this.services.openAuthorization(url.href);
    } catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async cancelLogin(): Promise<void> { try { await this.client?.cancelLogin(); } catch (error) { this.update({ message: this.errorText(error) }); } }
  /** Copies whitelist JSON only. The view uses the host clipboard hook; this method never reads files. */
  async copyDiagnostics(): Promise<string | null> {
    try {
      const client = await this.connect();
      const id = this.state.conversation?.id;
      if (!id) { this.update({ message: 'There is no shareable conversation diagnostic.' }); return null; }
      const text = JSON.stringify(await client.diagnostics(id));
      this.update({ message: 'Copied shareable diagnostics. They do not include paper text, account details, or paths.' });
      return text;
    } catch (error) { this.update({ message: this.errorText(error) }); return null; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.stageDraft(); void this.flushDraft().catch(() => {}); this.disposed = true;
    this.documentJob?.controller.abort(); for (const controller of this.submissions.values()) controller.abort();
    this.renders.clear(); this.unsubscribe?.(); this.unsubscribe = null; this.unsubscribeClient = null; this.unobserve?.(); this.unobserve = null; this.untasks?.(); this.unreading?.();
  }
}
