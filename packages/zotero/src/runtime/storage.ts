import type { StoragePort } from '../../../contracts/src/runtime.ts';
export interface FileInfo { type: 'regular' | 'directory' | 'other'; size: number; permissions: number }
export interface FileAPI {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array, options: { tmpPath?: string; mode: 'create' | 'overwrite' | 'appendOrCreate'; flush: true }): Promise<number>;
  makeDirectory(path: string, options: { createAncestors: false; ignoreExisting: true; permissions: number }): Promise<void>;
  setPermissions(path: string, mode: number, honorUmask: false): Promise<void>;
  remove(path: string, options: { recursive?: boolean; ignoreAbsent: true }): Promise<void>;
  move(from: string, to: string, options: { noOverwrite: true }): Promise<void>;
  computeHexDigest(path: string, algorithm: 'sha256'): Promise<string>;
}
export interface FileHost { io: FileAPI; join(...paths: string[]): string; isSymlink(path: string): boolean; uuid(): string }
export function relativeParts(path: string): string[] {
  if (!path || path.includes('\\') || path.includes(':') || /[\u0000-\u001f]/u.test(path)) throw new Error('Invalid storage path');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid storage path');
  return parts;
}
export async function checkPath(host: FileHost, path: string, expected: 'regular' | 'directory'): Promise<boolean> {
  if (host.isSymlink(path)) throw new Error('Unsafe storage path');
  if (!await host.io.exists(path)) return false;
  if ((await host.io.stat(path)).type !== expected) throw new Error('Unsafe storage path');
  return true;
}
export async function privateDirectory(host: FileHost, root: string, relative: string): Promise<string> {
  const parts = relativeParts(relative);
  if (!await checkPath(host, root, 'directory')) throw new Error('Storage root unavailable');
  let current = root;
  for (const part of parts) {
    current = host.join(current, part);
    if (!await checkPath(host, current, 'directory')) await host.io.makeDirectory(current, { createAncestors: false, ignoreExisting: true, permissions: 0o700 });
    if (!await checkPath(host, current, 'directory')) throw new Error('Storage directory unavailable');
    await host.io.setPermissions(current, 0o700, false);
  }
  return current;
}
export class GeckoStorage implements StoragePort {
  private queue = Promise.resolve();
  constructor(private host: FileHost, private root: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private async resolve(relative: string, create: boolean): Promise<string | null> {
    const parts = relativeParts(relative); let directory = this.root;
    if (!await checkPath(this.host, directory, 'directory')) throw new Error('Storage root unavailable');
    for (const part of parts.slice(0, -1)) {
      if (create) directory = await privateDirectory(this.host, directory, part);
      else { directory = this.host.join(directory, part); if (!await checkPath(this.host, directory, 'directory')) return null; }
    }
    const target = this.host.join(directory, parts.at(-1)!);
    await checkPath(this.host, target, 'regular');
    return target;
  }
  read(path: string): Promise<Uint8Array | null> {
    return this.serial(async () => {
      try { const target = await this.resolve(path, false); return target && await this.host.io.exists(target) ? await this.host.io.read(target) : null; }
      catch { throw new Error('Storage read failed'); }
    });
  }
  writeAtomic(path: string, bytes: Uint8Array): Promise<void> { return this.write(path, bytes, false); }
  append(path: string, bytes: Uint8Array): Promise<void> { return this.write(path, bytes, true); }
  remove(path: string): Promise<void> {
    return this.serial(async () => {
      try {
        const target = await this.resolve(path, false);
        if (target && await this.host.io.exists(target)) await this.host.io.remove(target, { ignoreAbsent: true });
      } catch { throw new Error('Storage write failed'); }
    });
  }
  private write(path: string, bytes: Uint8Array, append: boolean): Promise<void> {
    const copy = bytes.slice();
    return this.serial(async () => {
      let temporary: string | null = null;
      try {
        const target = (await this.resolve(path, true))!;
        if (!append) {
          const token = this.host.uuid(); if (!/^[a-zA-Z0-9-]+$/u.test(token)) throw new Error('Invalid temporary identifier');
          temporary = target + '.' + token + '.tmp';
          if (await checkPath(this.host, temporary, 'regular')) throw new Error('Temporary file already exists');
        }
        // Gecko PR_SYNC flushes file writes; no containing-directory fsync is promised.
        const written = await this.host.io.write(target, copy, { ...(temporary ? { tmpPath: temporary } : {}), mode: append ? 'appendOrCreate' : 'overwrite', flush: true });
        if (written !== copy.byteLength) throw new Error('Incomplete write');
        await this.host.io.setPermissions(target, 0o600, false);
      } catch { throw new Error('Storage write failed'); }
      finally { if (temporary) await this.host.io.remove(temporary, { ignoreAbsent: true }).catch(() => undefined); }
    });
  }
}
