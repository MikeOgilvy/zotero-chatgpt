import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRuntime, runtimePaths, type RuntimeHost } from '../../packages/zotero/src/runtime/prepare.ts';
import { PINNED_RUNTIME } from '../../runtime/manifest.ts';
import { nodeFiles } from './files-fixture.ts';
import type { FileHost } from '../../packages/zotero/src/runtime/storage.ts';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
/**
 * `PathUtils.join` refuses a component that contains a separator with
 * `NS_ERROR_FILE_UNRECOGNIZED_PATH`, while Node's `path.join` silently flattens one. The private
 * runtime tree is described in multi-segment relative paths, so the strict host contract — not the
 * lenient Node fixture — is what must be asserted here.
 */
function strictJoin<T extends FileHost>(host: T): T {
  return {
    ...host,
    join: (...parts: string[]) => {
      // The first component is the base path and may be absolute; every later component is appended
      // and must therefore be a single name.
      for (const part of parts.slice(1)) if (part.includes('/')) throw new Error('PathUtils.join: Could not append to path: NS_ERROR_FILE_UNRECOGNIZED_PATH');
      return host.join(...parts);
    },
  };
}
it('builds every private runtime path from single-segment components the host can join', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-join-')); roots.push(profile);
  const host = strictJoin({ ...nodeFiles(), os: 'Darwin', abi: 'aarch64-gcc3', profileDir: profile, load: () => Promise.resolve(new TextEncoder().encode('abc')) });
  const paths = runtimePaths(host);
  expect(paths.root).toBe(path.join(profile, 'zotero-chatgpt/v1'));
  expect(paths.cwd).toBe(path.join(paths.root, 'scratch'));
  expect(paths.config).toBe(path.join(paths.home, 'config'));
  const manifest = { codexVersion: PINNED_RUNTIME.codexVersion, platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  expect(prepared.spec.cwd).toBe(paths.cwd);
  expect(prepared.spec.env.CODEX_HOME).toBe(paths.account);
});
it('prepares only private profile state and resets executable environments before every spawn', async () => {
  const profile = await mkdtemp(path.join(tmpdir(), 'zchatgpt-私有 profile-')); roots.push(profile);
  const host: RuntimeHost = { ...nodeFiles(), os: 'Darwin', abi: 'aarch64-gcc3', profileDir: profile, load: () => Promise.resolve(new TextEncoder().encode('abc')) };
  const manifest = { codexVersion: PINNED_RUNTIME.codexVersion, platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
  const prepared = await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  const { env, cwd, executable } = prepared.spec; const privateRoot = path.join(profile, 'zotero-chatgpt/v1');
  expect(cwd).toBe(path.join(privateRoot, 'scratch')); expect(executable.startsWith(privateRoot + '/runtime/')).toBe(true);
  expect(env).toEqual({ HOME: path.join(privateRoot, 'home'), CODEX_HOME: path.join(privateRoot, 'account'), TMPDIR: path.join(privateRoot, 'tmp') + '/', XDG_CONFIG_HOME: path.join(privateRoot, 'home/config'), XDG_CACHE_HOME: path.join(privateRoot, 'home/cache'), XDG_DATA_HOME: path.join(privateRoot, 'home/data'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CODEX_EXEC_SERVER_URL: 'none', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' });
  expect(await readFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'utf8')).toBe('include_local = false\n');
  await writeFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'include_local = true\n');
  await writeFile(path.join(env.CODEX_HOME!, 'config.toml'), 'mcp_servers.bad = {}\n');
  await writeFile(path.join(env.CODEX_HOME!, 'auth.json'), 'synthetic credentials marker');
  await prepareRuntime(host, 'jar:file:///extension.xpi!/', manifest);
  expect(await readFile(path.join(env.CODEX_HOME!, 'environments.toml'), 'utf8')).toBe('include_local = false\n');
  expect(await readFile(path.join(env.CODEX_HOME!, 'config.toml'), 'utf8')).toBe('');
  expect(await readFile(path.join(env.CODEX_HOME!, 'auth.json'), 'utf8')).toBe('synthetic credentials marker');
  await prepared.storage.writeAtomic('s2-requests.json', new Uint8Array([1]));
  expect(await readdir(path.join(privateRoot, 'records'))).toEqual(['s2-requests.json']);
});
