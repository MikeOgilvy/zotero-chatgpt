import { RuntimeFailure, type ManagedProcess, type ProcessPort, type ProcessSpec, type S2Client, type StoragePort } from '../../../contracts/src/runtime.ts';
export interface PreparedRuntime { spec: ProcessSpec; storage: StoragePort; codexVersion: string }
export interface ConnectOptions { codexVersion: string; cwd: string; uuid: () => string; codexHome?: string }
export interface SupervisorDependencies {
  prepare(): Promise<PreparedRuntime>;
  process: ProcessPort;
  connect(process: ManagedProcess, storage: StoragePort, options: ConnectOptions): Promise<S2Client>;
  uuid(): string;
}
/** One owned runtime. It remains owned until its process exit has been confirmed. */
interface OwnedRuntime { process: ManagedProcess | null; client: S2Client | null; usable: boolean; closing: Promise<void> | null; termination: Promise<void> | null }
export class RuntimeSupervisor {
  private starting: Promise<S2Client> | null = null;
  private owned: OwnedRuntime | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  constructor(private dependencies: SupervisorDependencies) {}
  ensureStarted(): Promise<S2Client> {
    if (this.stopped) return Promise.reject(new Error('Runtime stopped'));
    if (this.starting) return this.starting;
    const current = this.owned;
    if (current?.usable && current.client?.snapshot().runtime === 'ready') return Promise.resolve(current.client);
    this.starting = this.restart(current).finally(() => { this.starting = null; });
    return this.starting;
  }
  private checkRunning() { if (this.stopped) throw new Error('Runtime stopped'); }
  private async restart(previous: OwnedRuntime | null): Promise<S2Client> {
    if (previous) {
      // A dead runtime keeps ownership until its exit is confirmed; no replacement before that.
      try { await this.release(previous); }
      catch { throw new Error(this.stopped ? 'Runtime stopped' : 'Unable to stop the previous Codex process; retry to try stopping it again'); }
    }
    this.checkRunning();
    const owned: OwnedRuntime = { process: null, client: null, usable: false, closing: null, termination: null };
    this.owned = owned;
    try {
      const prepared = await this.prepare(); this.checkRunning();
      const codexHome = prepared.spec.env.CODEX_HOME;
      if (!codexHome) throw new RuntimeFailure('Unable to prepare the bundled Codex runtime');
      owned.process = await this.spawn(prepared.spec); this.checkRunning();
      owned.client = await this.dependencies.connect(owned.process, prepared.storage, { codexVersion: prepared.codexVersion, cwd: prepared.spec.cwd, codexHome, uuid: () => this.dependencies.uuid() });
      this.checkRunning(); await owned.client.refreshAccount(); this.checkRunning();
      owned.usable = true; return owned.client;
    } catch (error) {
      await this.release(owned).catch(() => undefined);
      if (this.stopped) throw new Error('Runtime stopped');
      // Core failures carry constant, user-presentable text; anything else stays generic.
      throw error instanceof RuntimeFailure ? error : new Error('Unable to initialize bundled Codex');
    }
  }
  // Native failures may carry private paths; only these constant stage messages are shown.
  private async prepare(): Promise<PreparedRuntime> {
    try { return await this.dependencies.prepare(); } catch { throw new RuntimeFailure('Unable to prepare the bundled Codex runtime'); }
  }
  private async spawn(spec: ProcessSpec): Promise<ManagedProcess> {
    try { return await this.dependencies.process.spawn(spec); } catch { throw new RuntimeFailure('Unable to start bundled Codex'); }
  }
  private terminate(owned: OwnedRuntime): Promise<void> {
    if (!owned.process) return Promise.resolve();
    // A failed attempt is not memoized as a release; the next caller retries termination.
    owned.termination ??= owned.process.terminate().catch(error => { owned.termination = null; throw error; });
    return owned.termination;
  }
  /** Resolves only once the owned process exit is confirmed; ownership is dropped afterwards. */
  private async release(owned: OwnedRuntime): Promise<void> {
    owned.usable = false;
    if (owned.client) { owned.closing ??= owned.client.close().catch(() => undefined); await owned.closing; }
    await this.terminate(owned);
    if (this.owned === owned) this.owned = null;
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      // A pending protocol handshake must be interrupted before waiting for startup.
      if (this.starting && this.owned) await this.terminate(this.owned).catch(() => undefined);
      await this.starting?.catch(() => undefined);
      const owned = this.owned;
      if (owned) { try { await this.release(owned); } catch { throw new Error('Unable to stop owned Codex process'); } }
    })();
    return this.stopping;
  }
}

import { createS2Client } from '../../../core/src/index.ts';
import { GeckoProcessPort } from './process.ts';
import { geckoHost } from './gecko.ts';
import { prepareRuntime } from './prepare.ts';
/** Bootstrap creates one supervisor per plugin lifetime; views borrow its client.
 * Zotero owns the profile lock. No cross-profile singleton or shared CLI is used.
 */
export function createRuntimeSupervisor(rootURI: string): RuntimeSupervisor {
  const { host, subprocess } = geckoHost();
  return new RuntimeSupervisor({ prepare: () => prepareRuntime(host, rootURI), process: new GeckoProcessPort(subprocess), connect: createS2Client, uuid: () => host.uuid() });
}
