import type { Citation, DocumentContext, Draft, ImageAttachment, PaperIdentity, PaperScope } from './index.ts';

export type WorkflowKind = 'read' | 'annotate' | 'acquire' | 'diagram';
export interface Personalization {
  language: string;
  detail: 'brief' | 'standard' | 'detailed';
  mathematics: 'auto' | 'intuition-first' | 'formal';
  background: string;
  citationStyle: string;
  annotationStyle: string;
}
export interface ResearchProfile { id: string; name: string; preferences: Partial<Personalization> }
/**
 * One model the composer may offer. `id` is the exact runtime model id; `name` is a local display
 * label derived from that id (the pinned catalog carries no display names), never a live entitlement
 * report. See `core/workspace/allowed-models.ts` for the default set and the resolver.
 */
export interface AllowedModel { id: string; name: string }
export interface ReaderSkill {
  id: string; name: string; description: string; version: string; revision: string;
  markdown: string; origin: 'builtin' | 'user' | 'imported'; enabled: boolean;
  workflow: WorkflowKind; permissions: string[]; unsupportedDependencies: string[];
}
export interface WorkspaceSettings {
  schemaVersion: 1;
  preferences: Personalization;
  profiles: ResearchProfile[];
  skills: ReaderSkill[];
  uiLanguage: 'en' | 'zh';
  textScale: number;
  /**
   * The models the composer may offer. Absent in records written before this setting existed and then
   * treated as `defaultAllowedModels()` by the store and the pane; the store refuses to persist or
   * load an explicitly empty list, so the picker can never be emptied. Additive to schemaVersion 1:
   * older builds already safe-reject a settings file that carries an unknown key.
   */
  allowedModels?: AllowedModel[];
}
/** References contain a bounded snapshot, never recursively nested conversations. */
export interface ReaderReference {
  id: string;
  kind: 'article' | 'chat' | 'collection' | 'note' | 'annotation';
  label: string;
  paper?: PaperScope;
  identity?: PaperIdentity;
  conversationId?: string;
  messageIds?: string[];
  text?: string;
  range?: [number, number];
  capturedAt: string;
}
export interface WorkflowSnapshot {
  skill: ReaderSkill | null;
  preferences: Personalization;
  profileId: string | null;
}
export interface ReferenceInput extends ReaderReference { document?: DocumentContext }
export interface WorkspaceDraft extends Draft {
  references: ReaderReference[];
  skillId: string | null;
  profileId: string | null;
  overrides: Partial<Personalization>;
}
export interface SavedDraft {
  schemaVersion: 1; paper: PaperScope; conversationId: string | null;
  draft: WorkspaceDraft; scrollTop: number; pageRange: [number, number] | null; updatedAt: string;
}
export interface HistoryEntry {
  id: string; paper: PaperScope; title: string; identity: PaperIdentity;
  updatedAt: string; createdAt: string; messageCount: number; preview: string;
  hasDraft: boolean; activeRequestId: string | null;
  taskCount?: number;
  /**
   * True while the chat owns an in-flight or queued answer, or an unfinished native task. The
   * Preferences pane refuses to delete such a chat for the same reason the sidebar does.
   */
  unfinishedWork?: boolean;
  /** Present only on an archived chat; echoes {@link import('./index.ts').Conversation.archivedAt}. */
  archivedAt?: string;
}
/**
 * `history` partitions every listed chat into exactly one scope. The default scope is unarchived;
 * `{ archived: true }` returns only archived chats. A chat that appears in one never appears in the
 * other. An empty query lists everything in that scope.
 */
export interface HistoryScope { archived?: boolean }
/** The scope switch the History management UI offers, including "no scope filter". */
export type HistoryFilterScope = 'all' | 'active' | 'archived';
export interface HistoryFilter { scope: HistoryFilterScope; paperId: string | null }
/** A distinct paper among listed chats, used to build the paper filter without a second query. */
export interface HistoryPaperOption { id: string; label: string; paper: PaperScope }
/** One chat that could not be changed or confirmed, with the reason shown to the owner. */
export interface HistoryFailed { id: string; message: string }
/**
 * What the History section renders. Counts are for `entries` (the current query), so filtering
 * narrows the list and the counts together instead of reporting a total the list does not show.
 */
export interface HistoryListing { entries: HistoryEntry[]; activeCount: number; archivedCount: number }
export type HistoryAction = 'archive' | 'restore' | 'delete';
/**
 * The honest outcome of a History mutation. `changed` lists exactly the chats the store confirmed;
 * `failed` names every chat that was not changed and why; `warnings` records non-fatal surprises
 * (for example a mutation that succeeded but whose re-verification could not be read). `partial` is
 * true whenever fewer chats changed than were requested.
 */
export interface HistoryMutationReport {
  action: HistoryAction; requested: number; changed: string[]; failed: HistoryFailed[]; warnings: string[]; partial: boolean;
}
/**
 * The subset of the workspace the History management logic needs. `ReaderWorkspace` satisfies it.
 * The two mutators are optional: a build whose store cannot change stored chats omits them and the
 * Preferences pane degrades to listing, filtering and archiving nothing.
 */
export interface HistorySource {
  history(query?: string, scope?: HistoryScope): Promise<HistoryEntry[]>;
  setConversationArchived?(id: string, archived: boolean): Promise<void>;
  removeConversation?(paper: PaperScope, id: string): Promise<void>;
}
export interface ReaderWorkspace {
  settings(): Promise<WorkspaceSettings>;
  saveSettings(value: WorkspaceSettings): Promise<void>;
  saveSkill(value: ReaderSkill): Promise<ReaderSkill>;
  importSkill(markdown: string): Promise<ReaderSkill>;
  deleteSkill(id: string): Promise<void>;
  saveDraft(value: SavedDraft): Promise<void>;
  readDraft(paper: PaperScope, conversationId: string | null): Promise<SavedDraft | null>;
  deleteDraft(paper: PaperScope, conversationId: string | null): Promise<void>;
  history(query?: string, scope?: HistoryScope): Promise<HistoryEntry[]>;
  readConversation(id: string): Promise<import('./index.ts').Conversation>;
  currentConversation(paper: PaperScope): Promise<import('./index.ts').Conversation | null>;
  snapshotChat(conversationId: string, messageIds?: string[]): Promise<ReaderReference>;
  /**
   * Reversible archive/restore of one stored chat. The record keeps its identity and content; only
   * the scope it appears in changes. Optional so older stores stay source-compatible.
   */
  setConversationArchived?(id: string, archived: boolean): Promise<void>;
  /**
   * Explicit removal of one stored chat and its bound draft, leaving shared assets and native task
   * ledgers in place. Optional for the same reason; never invoked implicitly.
   */
  removeConversation?(paper: PaperScope, id: string): Promise<void>;
}
export interface LibraryReferencePort {
  collections?(): Promise<Array<import('./agent.ts').NativeCollectionTarget & { name: string }>>;
  search(query: string): Promise<ReaderReference[]>;
  read(reference: ReaderReference, signal: AbortSignal): Promise<ReferenceInput>;
  open(paper: PaperScope): Promise<void>;
  pickImages?(): Promise<ImageAttachment[]>;
  pickSkill?(): Promise<string | null>;
  exportText?(name: string, text: string): Promise<void>;
  captureRegion?(citation?: Citation): Promise<ImageAttachment | null>;
  capturePage?(paper: PaperScope, pageIndex: number): Promise<ImageAttachment | null>;
  exportImage?(image: ImageAttachment): Promise<void>;
}
