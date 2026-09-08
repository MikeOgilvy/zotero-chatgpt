import type { ManagedProcess, ProcessPort, ProcessSpec, S2Client, StoragePort } from '../../../contracts/src/runtime.ts';
export interface PreparedRuntime { spec: ProcessSpec; storage: StoragePort; codexVersion: string }
export interface SupervisorDependencies {
  prepare(): Promise<PreparedRuntime>;
  process: ProcessPort;
  connect(process: ManagedProcess, storage: StoragePort, options: { codexVersion: string; cwd: string; uuid: () => string }): Promise<S2Client>;
  uuid(): string;
}
interface OwnedRuntime { process: ManagedProcess | null; client: S2Client | null; termination: Promise<void> | null; closing: Promise<void> | null }
export class RuntimeSupervisor {
  private starting: Promise<S2Client> | null = null;
  private owned: OwnedRuntime | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  constructor(private dependencies: SupervisorDependencies) {}
  ensureStarted(): Promise<S2Client> {
    if (this.stopped) return Promise.reject(new Error('Runtime stopped'));
    if (this.starting) return this.starting;
    if (this.owned?.client?.snapshot().runtime === 'ready') return Promise.resolve(this.owned.client);
    const previous = this.owned;
    const owned: OwnedRuntime = { process: null, client: null, termination: null, closing: null }; this.owned = owned;
    const start = (async () => { if (previous) await this.cleanup(previous); return this.start(owned); })();
    this.starting = start.then(client => { this.starting = null; return client; }, error => { this.starting = null; if (this.owned === owned) this.owned = null; throw error; });
    return this.starting;
  }
  private checkRunning() { if (this.stopped) throw new Error('Runtime stopped'); }
  private async start(owned: OwnedRuntime): Promise<S2Client> {
    try {
      const prepared = await this.dependencies.prepare(); this.checkRunning();
      owned.process = await this.dependencies.process.spawn(prepared.spec); this.checkRunning();
      owned.client = await this.dependencies.connect(owned.process, prepared.storage, { codexVersion: prepared.codexVersion, cwd: prepared.spec.cwd, uuid: () => this.dependencies.uuid() });
      this.checkRunning(); await owned.client.refreshAccount(); this.checkRunning();
      return owned.client;
    } catch {
      await this.cleanup(owned).catch(() => undefined);
      throw new Error(this.stopped ? 'Runtime stopped' : 'Unable to initialize bundled Codex');
    }
  }
  private terminate(owned: OwnedRuntime): Promise<void> {
    if (!owned.process) return Promise.resolve();
    owned.termination ??= owned.process.terminate(); return owned.termination;
  }
  private async cleanup(owned: OwnedRuntime): Promise<void> {
    try { if (owned.client) { owned.closing ??= owned.client.close(); await owned.closing; } }
    finally { await this.terminate(owned); }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.stopping = (async () => {
      // A pending protocol handshake must be interrupted before waiting for startup.
      if (this.starting && this.owned) await this.terminate(this.owned);
      await this.starting?.catch(() => undefined);
      if (this.owned) await this.cleanup(this.owned);
      this.owned = null;
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
