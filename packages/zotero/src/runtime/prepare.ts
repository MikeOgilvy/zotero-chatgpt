import { PINNED_RUNTIME } from '../../../../runtime/manifest.ts';
import { codexLaunchArgs } from '../../../core/src/codex/reader-policy.ts';
import type { ProcessSpec, StoragePort } from '../../../contracts/src/runtime.ts';
import { ensureBundledRuntime, type AssetHost, type RuntimeManifest } from './bundled.ts';
import { GeckoStorage, privateDirectory } from './storage.ts';
export interface RuntimeHost extends AssetHost { profileDir: string }
export interface PreparedRuntime { spec: ProcessSpec; storage: StoragePort; codexVersion: string }
/**
 * The private runtime paths, computed without touching the filesystem.
 *
 * The shared reader client needs the scratch `cwd` at construction, but must not create the Codex
 * runtime directories or extract the bundled executable until Agent work actually starts. These are
 * therefore pure path strings; `prepareRuntime` is what creates the directories, and only lazily.
 */
export interface RuntimePaths { root: string; home: string; account: string; cwd: string; temporary: string; records: string; config: string; cache: string; data: string }
export function runtimePaths(host: RuntimeHost): RuntimePaths {
  // `PathUtils.join` requires each component to be a single path segment, so the tree is joined stepwise.
  const root = host.join(host.join(host.profileDir, 'zotero-chatgpt'), 'v1');
  const home = host.join(root, 'home');
  return {
    root,
    home,
    account: host.join(root, 'account'),
    cwd: host.join(root, 'scratch'),
    temporary: host.join(root, 'tmp'),
    records: host.join(root, 'records'),
    config: host.join(home, 'config'),
    cache: host.join(home, 'cache'),
    data: host.join(home, 'data'),
  };
}
/** Creates the private runtime environment and the bundled executable. Agent-only; never at bootstrap. */
export async function prepareRuntime(host: RuntimeHost, rootURI: string, manifest: RuntimeManifest = PINNED_RUNTIME): Promise<PreparedRuntime> {
  if (host.os !== 'Darwin' || !/^(aarch64|arm64)-/u.test(host.abi)) throw new Error('Unsupported runtime platform: macOS Apple Silicon is required');
  const paths = runtimePaths(host);
  const root = await privateDirectory(host, host.profileDir, 'zotero-chatgpt/v1');
  // The computed paths and the created ones must be the same directory tree.
  if (root !== paths.root) throw new Error('Runtime path mismatch');
  const home = await privateDirectory(host, root, 'home');
  const account = await privateDirectory(host, root, 'account');
  const cwd = await privateDirectory(host, root, 'scratch');
  const temporary = await privateDirectory(host, root, 'tmp');
  const records = await privateDirectory(host, root, 'records');
  const config = await privateDirectory(host, home, 'config');
  const cache = await privateDirectory(host, home, 'cache');
  const data = await privateDirectory(host, home, 'data');
  const settings = new GeckoStorage(host, account);
  // This account directory is exclusively ours. Never inspect or copy auth files.
  await settings.writeAtomic('config.toml', new Uint8Array());
  // Empty execution environment catalog removes built-in file and command tools.
  await settings.writeAtomic('environments.toml', new TextEncoder().encode('include_local = false\n'));
  const executable = await ensureBundledRuntime(host, rootURI, root, manifest);
  return {
    codexVersion: manifest.codexVersion,
    storage: new GeckoStorage(host, records),
    spec: { executable, args: codexLaunchArgs(), cwd, env: { HOME: home, CODEX_HOME: account, TMPDIR: temporary + '/', XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache, XDG_DATA_HOME: data, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', CODEX_EXEC_SERVER_URL: 'none', CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' } },
  };
}
