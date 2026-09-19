// The execution boundary between the two conversation experiences. Chat and Agent are siblings:
// they share the conversation, the document context and the model presentation, and they never share
// an execution lifecycle. `ExecutionMode` is the single value that selects which executor runs a
// request; see `core/src/conversation/execution-router.ts` for the only place that selection happens.
//
// Chat is a plain conversational completion. It has no tools, no tasks, no approvals, no persistent
// native sessions and no turn/thread reconciliation. The concrete ChatGPT transport is an unresolved
// platform integration boundary, so it is a port here (`ChatTransport`); this package must not
// pretend a transport exists.
import type { Citation, ContextReport, DocumentContext, ErrorCode, GenerationSettings, ImageAttachment, PaperIdentity, RequestMode, SendInput } from './index.ts';
import type { ReferenceInput } from './workspace.ts';

/**
 * How one conversation request is executed. It is the same frozen value as `RequestMode` (the
 * persisted routing field) seen from the execution side; the alias keeps one meaning, not two.
 */
export type ExecutionMode = RequestMode;

/** One turn of conversational history. Chat sends the conversation; the executor never reads the store. */
export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly Citation[];
}

/**
 * The document context a Chat completion may use. It is the shared, read-only context built by the
 * reader layer; Chat does not read Zotero, the PDF or the store to obtain it.
 */
export interface ChatContext {
  /** Bibliographic identity of the current paper, when one is open. */
  readonly paper: PaperIdentity | null;
  /** Locally extracted PDF text for the frozen revision, or null before a read completes. */
  readonly document: DocumentContext | null;
  /** Frozen selections carried by this request. */
  readonly citations: readonly Citation[];
  /** Explicitly referenced sources supplied with this request. */
  readonly references: readonly ReferenceInput[];
  readonly images: readonly ImageAttachment[];
  readonly contextReport: ContextReport | null;
}

/** Everything one Chat completion needs, frozen before the transport is called. */
export interface ChatRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly messages: readonly ChatMessage[];
  readonly context: ChatContext;
  readonly modelConfig: GenerationSettings;
}

/**
 * The Chat-only event stream. These are response lifecycle events, not Agent lifecycle: there is no
 * turn, task, tool or approval here, and a consumer of this stream must not need any of them.
 */
export type ChatStreamEvent =
  | { readonly type: 'chat.started' }
  | { readonly type: 'chat.delta'; readonly text: string }
  | { readonly type: 'chat.completed'; readonly text: string }
  | { readonly type: 'chat.failed'; readonly code: ErrorCode; readonly message: string }
  | { readonly type: 'chat.cancelled' };

/**
 * The one abstraction in front of a real ChatGPT chat backend. Implementations must be tool-free and
 * must not be a renamed Codex session: a builder that reaches for `core/src/codex`, `core/src/sessions`,
 * `core/src/tasks` or the reading coordinator is not a valid Chat transport. Until a supported
 * ChatGPT chat transport is integrated, only the honest `unavailableChatTransport` implementation
 * exists (see `core/src/chat/chat-transport.ts`).
 */
export interface ChatTransport {
  /** False when no supported ChatGPT chat transport is integrated in this build. */
  readonly available: boolean;
  /** Streams exactly one completion for `request`. Cancellation is signalled through `signal`. */
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
  /** Cancels a request started by this transport. Unknown ids are a no-op. */
  cancel(requestId: string): Promise<void>;
}

/** The Chat executor surface the router hands back. */
export interface ChatExecutorPort {
  readonly mode: 'chat';
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
  cancel(requestId: string): Promise<void>;
}

/** One frozen Agent request as the shared session recorded it. */
export interface AgentExecutionRequest {
  readonly requestId: string;
  readonly conversationId: string;
  /** The request exactly as accepted (the same object the shared session persists). */
  readonly input: SendInput;
}

/**
 * The Agent executor surface. It owns the Codex execution lifecycle (persistent threads/turns,
 * resume and reconciliation); the shared conversation controller owns persistence and event
 * publication, so `execute` returns once the native turn has been submitted.
 */
export interface AgentExecutorPort {
  readonly mode: 'agent';
  execute(request: AgentExecutionRequest): Promise<void>;
}

/** What `ExecutionRouter.select` returns: one of the two sibling executors, never both. */
export type ConversationExecutor = ChatExecutorPort | AgentExecutorPort;
