import type { S2Client, S2Snapshot } from '../../../contracts/src/runtime.ts';
export interface AccountViewState { connection: 'starting' | 'ready' | 'error'; snapshot: S2Snapshot | null; message: string | null }
export interface AccountViewServices { ensureStarted(): Promise<S2Client>; openAuthorization(url: string): void; uuid(): string }
/** View ownership ends on dispose; the plugin owns the client and accepted requests. */
export class AccountController {
  private disposed = false;
  private client: S2Client | undefined;
  private connecting: Promise<S2Client> | undefined;
  private loggingIn: Promise<void> | undefined;
  private unsubscribe: (() => void) | undefined;
  private state: AccountViewState = { connection: 'starting', snapshot: null, message: null };
  constructor(private services: AccountViewServices, private render: (state: AccountViewState) => void) {}
  private update(patch: Partial<AccountViewState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.render(this.state);
  }
  private async getClient(): Promise<S2Client> {
    if (this.client?.snapshot().runtime === 'ready') return this.client;
    if (this.connecting) return this.connecting;
    this.update({ connection: 'starting', message: null });
    this.connecting = this.services.ensureStarted().then(client => {
      this.client = client;
      if (!this.disposed) {
        this.unsubscribe?.();
        this.unsubscribe = client.subscribe(snapshot => this.update({ snapshot, connection: snapshot.runtime === 'ready' ? 'ready' : 'error', message: snapshot.error }));
      }
      return client;
    });
    try { return await this.connecting; }
    catch (error) { this.update({ connection: 'error', message: this.errorText(error) }); throw error; }
    finally { this.connecting = undefined; }
  }
  private errorText(error: unknown): string { return error instanceof Error ? error.message : 'Codex could not complete this action.'; }
  private async action(work: (client: S2Client) => Promise<void>): Promise<void> {
    if (this.disposed) return;
    try { const client = await this.getClient(); if (!this.disposed) { this.update({ message: null }); await work(client); } }
    catch (error) { this.update({ message: this.errorText(error) }); }
  }
  async connect(): Promise<void> { await this.action(async () => {}); }
  async login(): Promise<void> {
    if (this.loggingIn) return this.loggingIn;
    this.loggingIn = this.action(async client => {
      if (client.snapshot().account.state === 'signedIn') return;
      const flow = await client.startLogin();
      const url = new URL(flow.authorizationUrl);
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
        || !['auth.openai.com', 'chatgpt.com'].includes(url.hostname)) throw new Error('Codex returned an unsupported login address.');
      if (!this.disposed) this.services.openAuthorization(url.href);
    });
    try { await this.loggingIn; } finally { this.loggingIn = undefined; }
  }
  async cancelLogin(): Promise<void> { await this.action(client => client.cancelLogin()); }
  async runTest(): Promise<void> { await this.action(client => client.runSynthetic(this.services.uuid())); }
  async stopRequest(): Promise<void> { await this.action(client => client.cancelRequest()); }
  dispose(): void { this.disposed = true; this.unsubscribe?.(); this.unsubscribe = undefined; }
}
