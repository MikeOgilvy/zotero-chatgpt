/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { RuntimeFailure, type ManagedProcess, type ReaderClient, type StoragePort } from '../../packages/contracts/src/runtime.ts';
import { RuntimeSupervisor, type SupervisorDependencies } from '../../packages/zotero/src/runtime/supervisor.ts';
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const process: ManagedProcess = { stdout: { async *[Symbol.asyncIterator]() { yield await Promise.resolve(''); } }, writeStdin: () => Promise.resolve(), wait: () => Promise.resolve({ exitCode: 0 }), terminate: vi.fn(() => Promise.resolve()) };
  const client: ReaderClient = { snapshot: () => ({ revision: 0, runtime: "ready", account: { state: "signedOut" }, login: null, models: [], error: null }), observe: () => () => undefined, refreshAccount: vi.fn(() => Promise.resolve()), startLogin: () => Promise.reject(new Error()), cancelLogin: () => Promise.resolve(), current: () => Promise.reject(new Error()), newConversation: () => Promise.reject(new Error()), list: () => Promise.resolve([]), get: () => Promise.reject(new Error()), select: () => Promise.reject(new Error()), send: () => Promise.reject(new Error()), request: () => Promise.reject(new Error()), cancel: () => Promise.reject(new Error()), diagnostics: () => Promise.reject(new Error()), subscribe: () => () => undefined, close: vi.fn(() => Promise.resolve()) };
  const storage: StoragePort = { read: () => Promise.resolve(null), writeAtomic: () => Promise.resolve(), append: () => Promise.resolve() };
  const prepared = { spec: { executable: '/private/codex', args: ['app-server'], cwd: '/private/scratch', env: { CODEX_HOME: '/private/account' } as Record<string, string> }, codexVersion: '0.144.1', storage };
  const dependencies: SupervisorDependencies = { prepare: vi.fn(() => Promise.resolve(prepared)), process: { spawn: vi.fn(() => Promise.resolve(process)) }, connect: vi.fn(() => Promise.resolve(client)), uuid: () => 'uuid' };
  return { dependencies, process, client, prepared };
}
it('shares one startup and restores account before exposing the service', async () => {
  const f = fixture(); const account = deferred<void>(); f.client.refreshAccount = vi.fn(() => account.promise);
  const supervisor = new RuntimeSupervisor(f.dependencies); const a = supervisor.ensureStarted(); const b = supervisor.ensureStarted();
  let ready = false; void a.then(() => { ready = true; }, () => undefined); await new Promise(r => setTimeout(r, 0)); expect(ready).toBe(false);
  account.resolve(); expect(await a).toBe(f.client); expect(await b).toBe(f.client); expect(await supervisor.ensureStarted()).toBe(f.client);
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1); expect(f.client.refreshAccount).toHaveBeenCalledTimes(1);
  await supervisor.stop(); expect(f.client.close).toHaveBeenCalledTimes(1); expect(f.process.terminate).toHaveBeenCalledTimes(1);
});
it('stop during extraction prevents any spawn and further start', async () => {
  const f = fixture(); const prepared = deferred<typeof f.prepared>(); f.dependencies.prepare = () => prepared.promise;
  const supervisor = new RuntimeSupervisor(f.dependencies); const start = supervisor.ensureStarted(); const rejection = expect(start).rejects.toThrow('Runtime stopped');
  const stop = supervisor.stop(); prepared.resolve(f.prepared); await rejection; await stop;
  expect(f.dependencies.process.spawn).not.toHaveBeenCalled(); await expect(supervisor.ensureStarted()).rejects.toThrow('Runtime stopped');
});
it('stop during handshake terminates its handle and closes a late client exactly once', async () => {
  const f = fixture(); const connected = deferred<ReaderClient>(); f.dependencies.connect = () => connected.promise;
  const supervisor = new RuntimeSupervisor(f.dependencies); const start = supervisor.ensureStarted(); const rejection = expect(start).rejects.toThrow('Runtime stopped');
  await new Promise(r => setTimeout(r, 0)); const stop = supervisor.stop(); connected.resolve(f.client); await stop; await rejection;
  expect(f.process.terminate).toHaveBeenCalledTimes(1); expect(f.client.close).toHaveBeenCalledTimes(1); expect(f.client.refreshAccount).not.toHaveBeenCalled();
});
it('failed startup cleans the owned process and permits an explicit retry', async () => {
  const f = fixture(); let attempts = 0; f.dependencies.connect = () => ++attempts === 1 ? Promise.reject(new Error('raw authentication secret')) : Promise.resolve(f.client);
  const supervisor = new RuntimeSupervisor(f.dependencies); await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to initialize bundled Codex');
  expect(f.process.terminate).toHaveBeenCalledTimes(1); expect(await supervisor.ensureStarted()).toBe(f.client); await supervisor.stop();
});
it('failed account restoration closes both client and process before failing startup', async () => {
  const f = fixture(); f.client.refreshAccount = () => Promise.reject(new Error('raw account response'));
  const supervisor = new RuntimeSupervisor(f.dependencies); await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to initialize bundled Codex');
  expect(f.client.close).toHaveBeenCalledTimes(1); expect(f.process.terminate).toHaveBeenCalledTimes(1);
});
it('keeps ownership of a process whose termination failed and retries termination instead of spawning', async () => {
  const f = fixture(); let attempts = 0; f.dependencies.connect = () => ++attempts === 1 ? Promise.reject(new Error('handshake')) : Promise.resolve(f.client);
  let kills = 0; f.process.terminate = vi.fn(() => ++kills < 3 ? Promise.reject(new Error('raw kill failure')) : Promise.resolve());
  const supervisor = new RuntimeSupervisor(f.dependencies);
  await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to initialize bundled Codex');
  await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to stop the previous Codex process');
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1); expect(f.process.terminate).toHaveBeenCalledTimes(2);
  expect(await supervisor.ensureStarted()).toBe(f.client);
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(2); expect(f.process.terminate).toHaveBeenCalledTimes(3); await supervisor.stop();
});
it('failed cleanup of an errored runtime blocks replacement, keeps the handle for stop and never spawns twice', async () => {
  const f = fixture(); const supervisor = new RuntimeSupervisor(f.dependencies); await supervisor.ensureStarted();
  f.client.snapshot = () => ({ revision: 1, runtime: "error", account: { state: "signedOut" }, login: null, models: [], error: "Connection ended" });
  f.process.terminate = vi.fn(() => Promise.reject(new Error('raw kill failure')));
  await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to stop the previous Codex process');
  expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(1); expect(f.client.close).toHaveBeenCalledTimes(1);
  await expect(supervisor.stop()).rejects.toThrow('Unable to stop owned Codex process');
  expect(f.process.terminate).toHaveBeenCalledTimes(2);
});
it('surfaces deliberate runtime failures from the core and keeps other errors generic', async () => {
  const f = fixture(); f.dependencies.connect = () => Promise.reject(new RuntimeFailure('Reader policy unavailable: a managed or project configuration layer is active'));
  const supervisor = new RuntimeSupervisor(f.dependencies);
  await expect(supervisor.ensureStarted()).rejects.toThrow('Reader policy unavailable: a managed or project configuration layer is active');
  f.dependencies.prepare = () => Promise.reject(new Error('/Users/private/profile: EACCES'));
  await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to prepare the bundled Codex runtime');
});
it('forwards the dedicated account directory so the core can verify the runtime home', async () => {
  const f = fixture(); const supervisor = new RuntimeSupervisor(f.dependencies); await supervisor.ensureStarted();
  expect(f.dependencies.connect).toHaveBeenCalledWith(f.process, f.prepared.storage, expect.objectContaining({ codexHome: '/private/account', cwd: '/private/scratch' }));
  await supervisor.stop();
});
it('never spawns a runtime that lacks a dedicated account directory', async () => {
  const f = fixture(); f.prepared.spec = { ...f.prepared.spec, env: { HOME: '/private/home' } };
  const supervisor = new RuntimeSupervisor(f.dependencies);
  await expect(supervisor.ensureStarted()).rejects.toThrow('Unable to prepare the bundled Codex runtime');
  expect(f.dependencies.process.spawn).not.toHaveBeenCalled();
});
it('explicit retry after a process failure replaces the dead client without submitting a turn', async () => {
  const f = fixture(); const supervisor = new RuntimeSupervisor(f.dependencies); await supervisor.ensureStarted();
  f.client.snapshot = () => ({ revision: 1, runtime: "error", account: { state: "signedOut" }, login: null, models: [], error: "Connection ended" });
  const replacement = { ...fixture().client, send: vi.fn(() => Promise.reject(new Error())) }; f.dependencies.connect = () => Promise.resolve(replacement);
  expect(await supervisor.ensureStarted()).toBe(replacement); expect(f.dependencies.process.spawn).toHaveBeenCalledTimes(2);
  expect(f.client.close).toHaveBeenCalledTimes(1); expect(replacement.send).not.toHaveBeenCalled(); await supervisor.stop();
});
