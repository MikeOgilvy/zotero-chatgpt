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
  history(query?: string): Promise<HistoryEntry[]>;
  readConversation(id: string): Promise<import('./index.ts').Conversation>;
  currentConversation(paper: PaperScope): Promise<import('./index.ts').Conversation | null>;
  snapshotChat(conversationId: string, messageIds?: string[]): Promise<ReaderReference>;
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
