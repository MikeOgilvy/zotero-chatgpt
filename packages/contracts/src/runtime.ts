import type { Conversation, GenerationSettings, PaperScope, ReaderEvent, SendInput, SendReceipt, ShareableDiagnostics } from './index.ts';
export interface ProcessSpec {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
}
export interface ManagedProcess {
  stdout: AsyncIterable<string>;
  writeStdin(chunk: string): Promise<void>;
  wait(): Promise<{ exitCode: number | null }>;
  terminate(): Promise<void>;
}
export interface ProcessPort { spawn(spec: ProcessSpec): Promise<ManagedProcess> }
export interface StoragePort {
  read(relativePath: string): Promise<Uint8Array | null>;
  writeAtomic(relativePath: string, bytes: Uint8Array): Promise<void>;
  append(relativePath: string, bytes: Uint8Array): Promise<void>;
  /** Deletes a stored relative path. Must fail rather than overwrite the file with empty bytes. */
  remove(relativePath: string): Promise<void>;
  /** Bare regular-file names in a plugin-owned directory; never absolute paths. */
  list?(relativeDirectory: string): Promise<string[]>;
}
export interface AccountStatus {
  state: 'signedOut' | 'signingIn' | 'signedIn' | 'expired';
  displayLabel?: string;
}
export interface LoginFlow { loginId: string; authorizationUrl: string }
export interface LoginStatus {
  loginId: string;
  state: 'pending' | 'succeeded' | 'cancelled' | 'failed';
  message?: string;
}
export interface ModelOption {
  id: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{ id: string; description: string }>;
  defaultReasoningEffort: string | null;
  serviceTiers: Array<{ id: string; name: string; description: string }>;
  defaultServiceTier: string | null;
  inputModalities?: Array<'text' | 'image'>;
}
/** Reactive runtime/account state shared by every view; conversations use ReaderEvent instead. */
export interface RuntimeSnapshot {
  revision: number;
  runtime: 'ready' | 'error' | 'stopped';
  account: AccountStatus;
  login: LoginStatus | null;
  models: ModelOption[];
  error: string | null;
  capabilities?: { imageGeneration: boolean; namespaceTools: boolean; webSearch: boolean };
  rateLimits?: Array<{ label: string; usedPercent: number; resetsAt: number | null; windowMinutes: number | null }>;
}
/**
 * A deliberate failure whose message is safe to show users: constant text chosen by
 * this project, never upstream output, paths or account data. Adapters may surface
 * its message; any other error is reported generically.
 */
export class RuntimeFailure extends Error {
  constructor(message: string) { super(message); this.name = 'RuntimeFailure'; }
}
/**
 * In-process reader API used by the sidebar. Views borrow it from the plugin-wide supervisor and
 * never receive pipes, file handles or credentials. Business failures are ReaderError instances.
 */
export interface ReaderClient {
  snapshot(): RuntimeSnapshot;
  observe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  refreshAccount(): Promise<void>;
  startLogin(): Promise<LoginFlow>;
  cancelLogin(): Promise<void>;
  /** The attachment's current conversation, creating one when none is stored yet. */
  current(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation>;
  /** The attachment's current conversation, or null; never creates or writes anything. */
  peekCurrent(paper: PaperScope): Promise<Conversation | null>;
  newConversation(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation>;
  list(paper: PaperScope): Promise<Conversation[]>;
  get(conversationId: string): Promise<Conversation>;
  select(paper: PaperScope, conversationId: string): Promise<Conversation>;
  send(input: SendInput): Promise<SendReceipt>;
  enqueue?(input: SendInput): Promise<SendReceipt>;
  releaseBatch?(conversationId: string, batchId: string): Promise<void>;
  request(conversationId: string, requestId: string): Promise<SendReceipt>;
  cancel(conversationId: string, requestId: string): Promise<SendReceipt>;
  /** Deletes the chat and returns the attachment's remaining current chat, or null when none is left. */
  deleteConversation(paper: PaperScope, conversationId: string): Promise<Conversation | null>;
  renameConversation?(conversationId: string, title: string): Promise<Conversation>;
  branchConversation?(conversationId: string, messageId: string): Promise<Conversation>;
  diagnostics(conversationId: string): Promise<ShareableDiagnostics>;
  subscribe(listener: (event: ReaderEvent) => void): () => void;
  close(): Promise<void>;
}
