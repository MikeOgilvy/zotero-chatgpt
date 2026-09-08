import { PINNED_RUNTIME } from '../../../../runtime/manifest.ts';
import { checkPath, privateDirectory, type FileHost } from './storage.ts';
export interface RuntimeManifest { codexVersion: string; platform: string; architecture: string; entry: string; size: number; sha256: string }
export interface AssetHost extends FileHost { os: string; abi: string; load(url: string): Promise<Uint8Array> }
export async function ensureBundledRuntime(host: AssetHost, rootURI: string, privateRoot: string, manifest: RuntimeManifest = PINNED_RUNTIME): Promise<string> {
  if (host.os !== 'Darwin' || !/^(aarch64|arm64)-/u.test(host.abi)) throw new Error('Unsupported runtime platform: macOS Apple Silicon is required');
  if (manifest.codexVersion !== PINNED_RUNTIME.codexVersion || manifest.platform !== 'darwin' || manifest.architecture !== 'arm64' || manifest.entry !== PINNED_RUNTIME.entry || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/u.test(manifest.sha256)) throw new Error('Invalid bundled runtime manifest');
  // rootURI comes only from Zotero's installed add-on, never from UI or storage.
  if (!rootURI.endsWith('/') || !/^(jar:file:|file:)/u.test(rootURI)) throw new Error('Invalid extension resource root');
  let staging: string | null = null;
  try {
    const directory = await privateDirectory(host, privateRoot, `runtime/${manifest.codexVersion}-darwin-arm64/${manifest.sha256}`);
    const target = host.join(directory, 'codex');
    const verify = async (file: string) => {
      if (!await checkPath(host, file, 'regular')) throw new Error('Missing executable');
      if ((await host.io.stat(file)).size !== manifest.size || await host.io.computeHexDigest(file, 'sha256') !== manifest.sha256) throw new Error('Runtime integrity mismatch');
    };
    if (await checkPath(host, target, 'regular')) { await verify(target); await host.io.setPermissions(target, 0o700, false); }
    else {
      const token = host.uuid(); if (!/^[a-zA-Z0-9-]+$/u.test(token)) throw new Error('Invalid temporary identifier');
      staging = await privateDirectory(host, directory, `staging-${token}`);
      const file = host.join(staging, 'codex');
      const bytes = await host.load(rootURI + manifest.entry);
      if (bytes.byteLength !== manifest.size) throw new Error('Runtime size mismatch');
      const written = await host.io.write(file, bytes, { mode: 'create', flush: true });
      if (written !== bytes.byteLength) throw new Error('Incomplete runtime write');
      await verify(file);
      await host.io.setPermissions(file, 0o700, false);
      await host.io.move(file, target, { noOverwrite: true });
    }
    if ((await host.io.stat(target)).permissions !== 0o700) throw new Error('Runtime permission mismatch');
    return target;
  } catch { throw new Error('Bundled runtime preparation failed; reinstall the matching complete XPI'); }
  finally { if (staging) await host.io.remove(staging, { recursive: true, ignoreAbsent: true }).catch(() => undefined); }
}
