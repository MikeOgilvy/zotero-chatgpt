// Shared business contracts. Runtime validation lives in ./validation.ts and must be applied at
// every boundary; TypeScript types alone are not trusted for input crossing modules.
export type UUID = string;
export type Rect = [number, number, number, number];

export interface PaperScope {
  clientId: UUID;        // persistent random namespace of the Zotero profile
  libraryId: number;     // Zotero local library id; meaningful only inside clientId
  attachmentKey: string; // Zotero attachment item key
}

export function paperId(paper: PaperScope): string {
  return JSON.stringify([paper.clientId, paper.libraryId, paper.attachmentKey]);
}

export interface GenerationSettings {
  model: string;
  serviceTier: string | null; // null: the model's catalog default tier
  effort: string | null;      // null: the model's catalog default reasoning effort
}

export interface Citation {
  id: UUID;
  paper: PaperScope;
  text: string;          // original text, never HTML
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
  pageLabel: string;
  positions: Array<{ pageIndex: number; rects: Rect[] }>;
  capturedAt: string;    // ISO 8601
  contextScope: 'selection';
  sourceRevision?: { size: number; modifiedAt: string };
}

export type RequestState = 'accepted' | 'dispatching' | 'running' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'cancelled' | 'failed' | 'uncertain';

export interface PaperIdentity {
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
}

export interface DocumentRevision { fingerprint: string; size: number; modifiedAt: number }
export interface DocumentPage { pageIndex: number; pageLabel: string; text: string; status: 'text' | 'empty' | 'error'; partial?: true }
/** Locally extracted text. No filesystem path or claim that figures were read. */
export interface DocumentContext {
  id: UUID;
  paper: PaperScope;
  revision: DocumentRevision;
  parserVersion: string;
  totalPages: number;
  pages: DocumentPage[];
}
export interface DocumentSummary {
  id: UUID;
  revision: DocumentRevision;
  parserVersion: string;
  totalPages: number;
  pages: Array<Pick<DocumentPage, 'pageIndex' | 'pageLabel' | 'status' | 'partial'>>;
  textBytes: number;
}

/** User-attached image for `turn/start` UserInput::Image `{ type: "image", url }` (rust-v0.144.1). */
export interface ImageAttachment {
  id: UUID;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  dataUrl: string;
}

export interface Message {
  id: UUID;
  requestId: UUID;
  role: 'user' | 'assistant';
  phase: 'commentary' | 'final' | null;
  settings: GenerationSettings;
  effectiveSettings?: GenerationSettings;
  text: string;
  citations: Citation[];
  status: MessageStatus;
  /** Present on user messages so the view can hide internal explain prompts. */
  action?: 'explain' | 'ask';
  images?: ImageAttachment[];
  document?: DocumentSummary;
  paper?: PaperIdentity;
}

export interface Conversation {
  id: UUID;
  paper: PaperScope;
  title: string;
  settings: GenerationSettings;
  activeRequestId: UUID | null;
  messages: Message[];
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface SendInput {
  requestId: UUID;
  conversationId: UUID;
  action: 'explain' | 'ask';
  question: string;
  citations: Citation[];
  settings: GenerationSettings;
  /** Bibliographic identity of the current paper; required for asks without a citation. */
  paper?: PaperIdentity;
  /** Optional image parts for rust-v0.144.1 `{ type: "image", url: dataUrl }`. */
  images?: ImageAttachment[];
  document?: DocumentContext;
}

export interface SendReceipt {
  requestId: UUID;
  state: RequestState;
  replay: boolean;
}

export type ReaderEvent = {
  seq: number;
  conversationId: UUID;
  requestId: UUID;
  at: string;
} & (
  | { type: 'accepted' }
  | { type: 'delta'; messageId: UUID; text: string }
  | { type: 'messageCompleted'; messageId: UUID; finalText: string; phase: 'commentary' | 'final' | null }
  | { type: 'completed'; messageId: UUID; finalText: string }
  | { type: 'cancelled'; messageId: UUID | null }
  | { type: 'failed'; code: ErrorCode; message: string }
  | { type: 'uncertain'; message: string }
);

export type ErrorCode =
  | 'RUNTIME_UNAVAILABLE' | 'INVALID_REQUEST' | 'PAYLOAD_TOO_LARGE'
  | 'VERSION_UNSUPPORTED' | 'CODEX_NOT_FOUND' | 'AUTH_REQUIRED'
  | 'BUSY' | 'REQUEST_CONFLICT' | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED' | 'CODEX_EXITED' | 'HISTORY_UNAVAILABLE'
  | 'CURSOR_EXPIRED' | 'READER_POLICY_UNAVAILABLE' | 'UNSUPPORTED_INTERACTION'
  | 'NOT_FOUND' | 'INTERNAL_ERROR';

/** Business failure with a stable code and constant, user-presentable text. */
export class ReaderError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly retryable = false) {
    super(message); this.name = 'ReaderError';
  }
  get error(): { code: ErrorCode; message: string; retryable: boolean } { return { code: this.code, message: this.message, retryable: this.retryable }; }
}

export interface Draft {
  settings: GenerationSettings | null;
  paper: PaperScope;
  question: string;
  citations: Citation[];
  images: ImageAttachment[];
}

/** Generic location shown in shareable diagnostics. Never include a username or real path. */
export const SHAREABLE_STORAGE_LOCATION = 'Zotero profile/zotero-codex-reader/v1/records' as const;

/** Whitelist-only report. Must never contain paper text, paths, tokens or account identifiers. */
export interface ShareableDiagnostics {
  pluginVersion: string;
  runtimeVersion: string;
  errorCode: ErrorCode | null;
  requestCount: number;
  states: Partial<Record<RequestState, number>>;
  storageLocation: typeof SHAREABLE_STORAGE_LOCATION;
}
