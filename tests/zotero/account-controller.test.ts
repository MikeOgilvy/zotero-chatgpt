import { expect, it, vi } from 'vitest';
import { AccountController, type AccountViewState } from '../../packages/zotero/src/account/controller.ts';
import type { S2Client, S2Snapshot } from '../../packages/contracts/src/runtime.ts';
function fixture() {
  let current: S2Snapshot = { revision: 0, runtime: 'ready', account: { state: 'signedOut' }, login: null, models: [], request: null, error: null };
  const listeners = new Set<(value: S2Snapshot) => void>();
  const client: S2Client = {
    snapshot: () => current,
    subscribe: listener => { listeners.add(listener); listener(current); return () => { listeners.delete(listener); }; },
    refreshAccount: async () => {},
    startLogin: () => Promise.resolve({ loginId: 'login-1', authorizationUrl: 'https://auth.openai.com/authorize?test=1' }),
    cancelLogin: async () => {}, runSynthetic: async () => {}, cancelRequest: async () => {}, close: async () => {},
  };
  const views: AccountViewState[] = [];
  const ensureStarted = vi.fn(() => Promise.resolve(client));
  const openAuthorization = vi.fn();
  const controller = new AccountController({ ensureStarted, openAuthorization, uuid: () => 'request-1' }, state => views.push(state));
  return { client, controller, views, ensureStarted, openAuthorization, listeners,
    publish: (next: S2Snapshot) => { current = next; for (const listener of listeners) listener(next); }, current: () => current };
}
it('shows the shared account state and streams later updates without reconnecting', async () => {
  const f = fixture();
  await Promise.all([f.controller.connect(), f.controller.connect()]);
  expect(f.views.at(-1)?.snapshot?.account.state).toBe('signedOut');
  f.publish({ ...f.current(), account: { state: 'signedIn', displayLabel: 'ChatGPT' }, revision: 1 });
  expect(f.views.at(-1)?.snapshot?.account.state).toBe('signedIn');
  expect(f.ensureStarted).toHaveBeenCalledTimes(1);
  expect(f.listeners.size).toBe(1);
});
it('opening a view does not start login and an explicit login opens the returned official URL', async () => {
  const f = fixture();
  await f.controller.connect(); expect(f.openAuthorization).not.toHaveBeenCalled();
  await f.controller.login();
  expect(f.openAuthorization).toHaveBeenCalledWith('https://auth.openai.com/authorize?test=1');
});
it('closing a view unsubscribes but does not stop the shared runtime', async () => {
  const f = fixture(); const close = vi.spyOn(f.client, 'close');
  await f.controller.connect(); expect(f.listeners.size).toBe(1); const count = f.views.length;
  f.controller.dispose();
  f.publish({ ...f.current(), revision: 1 });
  expect(f.listeners.size).toBe(0); expect(f.views).toHaveLength(count); expect(close).not.toHaveBeenCalled();
});
it('an authorization response arriving after the view closed does not launch a browser', async () => {
  const f = fixture(); let resolve!: (value: { loginId: string; authorizationUrl: string }) => void;
  f.client.startLogin = () => new Promise(done => { resolve = done; });
  await f.controller.connect(); const login = f.controller.login(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  f.controller.dispose(); resolve({ loginId: 'late', authorizationUrl: 'https://auth.openai.com/authorize' }); await login;
  expect(f.openAuthorization).not.toHaveBeenCalled();
});
it('reports a startup failure and allows a later deliberate retry', async () => {
  const f = fixture(); f.ensureStarted.mockRejectedValueOnce(new Error('Runtime asset is missing'));
  await f.controller.connect(); expect(f.views.at(-1)?.connection).toBe('error');
  await f.controller.connect(); expect(f.views.at(-1)?.connection).toBe('ready');
});
it('refuses a non-official authorization URL before invoking the browser', async () => {
  const f = fixture(); f.client.startLogin = () => Promise.resolve({ loginId: 'bad', authorizationUrl: 'javascript:alert(1)' });
  await f.controller.login(); expect(f.openAuthorization).not.toHaveBeenCalled();
  expect(f.views.at(-1)?.message).toBeTruthy();
});
