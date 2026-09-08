import { randomUUID, createHash } from 'node:crypto';
import { access, chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile, open } from 'node:fs/promises';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import type { FileHost, FileAPI } from '../../packages/zotero/src/runtime/storage.ts';
export function nodeFiles(): FileHost & { writes: Array<{ path: string; options: Parameters<FileAPI['write']>[2] }> } {
  const writes: Array<{ path: string; options: Parameters<FileAPI['write']>[2] }> = [];
  const io: FileAPI = {
    exists: async p => { try { await lstat(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } },
    stat: async p => { const s = await stat(p); return { type: s.isDirectory() ? 'directory' : s.isFile() ? 'regular' : 'other', size: s.size, permissions: s.mode & 0o777 }; },
    read: async p => new Uint8Array(await readFile(p)),
    write: async (p, bytes, options) => {
      writes.push({ path: p, options });
      const target = options.tmpPath ?? p;
      const file = await open(target, options.mode === 'appendOrCreate' ? 'a' : options.mode === 'create' ? 'wx' : 'w', 0o600);
      try { await file.writeFile(bytes); if (options.flush) await file.sync(); } finally { await file.close(); }
      if (options.tmpPath) await rename(target, p);
      return bytes.length;
    },
    makeDirectory: async (p, options) => { try { await mkdir(p, { mode: options.permissions }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || !options.ignoreExisting) throw e; } },
    setPermissions: (p, mode) => chmod(p, mode),
    remove: (p, options) => rm(p, { force: options.ignoreAbsent, recursive: options.recursive ?? false }),
    move: async (from, to) => { try { await access(to); } catch { await rename(from, to); return; } throw new Error('exists'); },
    computeHexDigest: async p => createHash('sha256').update(await readFile(p)).digest('hex'),
  };
  return { io, join: path.join, isSymlink: p => { try { return lstatSync(p).isSymbolicLink(); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }, uuid: randomUUID, writes };
}
export { mkdir, writeFile };
