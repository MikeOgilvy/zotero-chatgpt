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
}
export interface SyntheticRequest {
  requestId: string;
  state: 'accepted' | 'dispatching' | 'running' | 'completed' | 'cancelled' | 'failed' | 'uncertain';
  question: string;
  model: string;
  output: string;
  error: string | null;
}
export interface S2Snapshot {
  revision: number;
  runtime: 'ready' | 'error' | 'stopped';
  account: AccountStatus;
  login: LoginStatus | null;
  models: ModelOption[];
  request: SyntheticRequest | null;
  error: string | null;
}
/**
 * A deliberate failure whose message is safe to show users: constant text chosen by
 * this project, never upstream output, paths or account data. Adapters may surface
 * its message; any other error is reported generically.
 */
export class RuntimeFailure extends Error {
  constructor(message: string) { super(message); this.name = 'RuntimeFailure'; }
}
export interface S2Client {
  snapshot(): S2Snapshot;
  subscribe(listener: (snapshot: S2Snapshot) => void): () => void;
  refreshAccount(): Promise<void>;
  startLogin(): Promise<LoginFlow>;
  cancelLogin(): Promise<void>;
  runSynthetic(requestId: string): Promise<void>;
  cancelRequest(): Promise<void>;
  close(): Promise<void>;
}
