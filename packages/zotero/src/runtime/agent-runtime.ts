import { RuntimeFailure, type ManagedProcess, type ProcessPort, type ProcessSpec } from '../../../contracts/src/runtime.ts';
import { openCodexConnection, type CodexConnection } from '../../../core/src/codex/connection.ts';
import { GeckoProcessPort } from './process.ts';
import { geckoHost } from './gecko.ts';
import { prepareRuntime } from './prepare.ts';

export interface PreparedRuntime { spec: ProcessSpec; codexVersion: string }
export interface ConnectOptions { codexVersion: string; cwd: string; codexHome: string }
export interface AgentRuntimeDependencies {
  prepare(): Promise<PreparedRuntime>;
  process: ProcessPort;
  connect(process: ManagedProcess, options: ConnectOptions): Promise<CodexConnection>;
}
/** One owned Codex process. It remains owned until its exit has been confirmed. */
interface OwnedRuntime { process: ManagedProcess | null; connection: CodexConnection | null; usable: boolean; closing: Promise<void> | null; termination: Promise<void> | null }
/**
 * Owns the bundled Codex process and opens its protocol channel **lazily**.
 *
 * `connection()` is the only call that prepares the private runtime directory, spawns Codex or
 * performs the handshake. Nothing in the sidebar bootstrap calls it: the shared reader client is
 * built with this class as its connector, so opening the reader or staying in Chat never starts
 * Codex. Agent actions (an explicit Agent readiness request, the first Agent send, login) do.
 */
export class AgentRuntime {
  private starting: Promise<CodexConnection> | null = null;
  private owned: OwnedRuntime | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  constructor(private dependencies: AgentRuntimeDependencies) {}
  /** Opens Codex on first use and reuses the live channel afterwards. */
  connection(): Promise<CodexConnection> {
    if (this.stopped) return Promise.reject(new Error('Agent runtime stopped'));
    if (this.starting) return this.starting;
    const current = this.owned;
    if (current?.usable && current.connection) return Promise.resolve(current.connection);
    this.starting = this.restart(current).finally(() => { this.starting = null; });
    return this.starting;
  }
  /** The live channel of the runtime this owner currently holds, or null. Read-only: never starts. */
  currentConnection(): CodexConnection | null {
    const current = this.owned;
    return current?.usable && current.connection ? current.connection : null;
  }
  private checkRunning() { if (this.stopped) throw new Error('Agent runtime stopped'); }
  private async restart(previous: OwnedRuntime | null): Promise<CodexConnection> {
    if (previous) {
      // A dead runtime keeps ownership until its exit is confirmed; no replacement before that.
      try { await this.release(previous); }
      catch { throw new Error(this.stopped ? 'Agent runtime stopped' : 'Unable to stop the previous Codex process; retry to try stopping it again'); }
    }
    this.checkRunning();
    const owned: OwnedRuntime = { process: null, connection: null, usable: false, closing: null, termination: null };
    this.owned = owned;
    try {
      const prepared = await this.prepare(); this.checkRunning();
      const codexHome = prepared.spec.env.CODEX_HOME;
      if (!codexHome) throw new RuntimeFailure('Unable to prepare the bundled Codex runtime');
      owned.process = await this.spawn(prepared.spec); this.checkRunning();
      owned.connection = await this.dependencies.connect(owned.process, { codexVersion: prepared.codexVersion, cwd: prepared.spec.cwd, codexHome });
      this.checkRunning();
      // A channel that dies must not be handed out again. Termination stays with `release`, which the
      // next `connection()` or `stop()` performs — a fire-and-forget kill here would race that release.
      owned.connection.onFailure(() => { owned.usable = false; });
      owned.usable = true;
      return owned.connection;
    } catch (error) {
      await this.release(owned).catch(() => undefined);
      if (this.stopped) throw new Error('Agent runtime stopped');
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
    if (owned.connection) { owned.closing ??= owned.connection.close().catch(() => undefined); await owned.closing; }
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
    })().catch(error => { this.stopping = null; throw error; });
    return this.stopping;
  }
}
/**
 * The production agent runtime: the real process port and the real handshake. `prepareRuntime` is
 * only reached from `connection()`, so this factory itself does no work.
 */
export function createAgentRuntime(rootURI: string, pluginVersion?: string): AgentRuntime {
  const { host, subprocess } = geckoHost();
  return new AgentRuntime({
    prepare: async () => {
      const prepared = await prepareRuntime(host, rootURI);
      return { spec: prepared.spec, codexVersion: prepared.codexVersion };
    },
    process: new GeckoProcessPort(subprocess),
    // `codexHome` is deliberately not forwarded: the reader policy already requires the runtime to
    // report the dedicated account directory, and comparing a host-side path would reject a valid
    // process whose report differs only by symlink resolution.
    connect: (process, options) => openCodexConnection(process, {
      codexVersion: options.codexVersion,
      cwd: options.cwd,
      ...(pluginVersion ? { pluginVersion } : {}),
    }),
  });
}
