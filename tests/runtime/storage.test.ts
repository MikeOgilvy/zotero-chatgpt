import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GeckoStorage, privateDirectory } from '../../packages/zotero/src/runtime/storage.ts';
import { nodeFiles } from './files-fixture.ts';
const roots: string[] = [];
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'zchatgpt-storage-')); roots.push(root); const host = nodeFiles(); return { root, host, storage: new GeckoStorage(host, root) }; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('private Gecko storage', () => {
  it('lists only direct regular files and rejects traversal or symlink directories', async () => {
    const { root, storage, host } = await setup();
    await storage.writeAtomic('records/a.json', new Uint8Array([1]));
    await storage.writeAtomic('records/sub/b.json', new Uint8Array([2]));
    expect(await storage.list('records')).toEqual(['a.json']);
    expect(await storage.list('missing')).toEqual([]);
    await expect(storage.list('../escape')).rejects.toThrow();
    await symlink(root, path.join(root, 'link'));
    await expect(storage.list('link')).rejects.toThrow();
    await expect(new GeckoStorage(host, path.join(root, 'link')).list('records')).rejects.toThrow();
  });
  it('persists atomic replacement and ordered append with explicit flush and private permissions', async () => {
    const { root, host, storage } = await setup(); const bytes = new TextEncoder();
    await storage.writeAtomic('nested/state.json', bytes.encode('first'));
    await storage.writeAtomic('nested/state.json', bytes.encode('second'));
    await Promise.all([storage.append('events.jsonl', bytes.encode('a\n')), storage.append('events.jsonl', bytes.encode('b\n'))]);
    expect(new TextDecoder().decode((await storage.read('nested/state.json'))!)).toBe('second');
    expect(await readFile(path.join(root, 'events.jsonl'), 'utf8')).toBe('a\nb\n');
    expect(await storage.read('absent')).toBeNull();
    expect(host.writes.every(w => w.options.flush)).toBe(true);
    expect(host.writes[0]?.options.tmpPath && path.dirname(host.writes[0].options.tmpPath)).toBe(path.join(root, 'nested'));
    expect((await stat(path.join(root, 'nested'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'nested/state.json'))).mode & 0o777).toBe(0o600);
  });
  it('rejects absolute, ambiguous and traversal paths before access', async () => {
    const { storage } = await setup();
    for (const invalid of ['', '/tmp/secret', '../escape', 'a/../escape', 'a//b', './state', 'C:\\state', 'a\\b', 'a/./b', 'a/']) {
      await expect(storage.read(invalid)).rejects.toThrow();
      await expect(storage.writeAtomic(invalid, new Uint8Array([1]))).rejects.toThrow();
      await expect(storage.append(invalid, new Uint8Array([1]))).rejects.toThrow();
    }
  });
  it('rejects directory and leaf symlinks and refuses to write outside the root', async () => {
    const { root, storage } = await setup(); const outside = await mkdtemp(path.join(tmpdir(), 'zchatgpt-outside-')); roots.push(outside);
    await symlink(outside, path.join(root, 'escape'));
    await symlink(path.join(outside, 'missing'), path.join(root, 'leaf'));
    await expect(storage.writeAtomic('escape/leak', new Uint8Array([1]))).rejects.toThrow();
    await expect(storage.append('leaf', new Uint8Array([1]))).rejects.toThrow();
    await expect(readFile(path.join(outside, 'leak'))).rejects.toThrow();
  });
  it('propagates failed writes without replacing the previous record or returning receipt', async () => {
    const { host, storage } = await setup(); await storage.writeAtomic('state', new Uint8Array([1]));
    host.io.write = () => Promise.reject(new Error('private raw detail'));
    await expect(storage.writeAtomic('state', new Uint8Array([2]))).rejects.toThrow('Storage write failed');
    expect(await storage.read('state')).toEqual(new Uint8Array([1]));
  });
  it('removes a stored file without replacing it with empty bytes', async () => {
    const { storage } = await setup();
    await storage.writeAtomic('conversations/gone.json', new TextEncoder().encode('{"keep":false}'));
    await storage.remove('conversations/gone.json');
    expect(await storage.read('conversations/gone.json')).toBeNull();
    await expect(storage.remove('../escape')).rejects.toThrow();
  });
  it('creates separate private service directories', async () => {
    const { host, root } = await setup(); const result = await privateDirectory(host, root, 'zotero-chatgpt/v1/account');
    expect(result).toBe(path.join(root, 'zotero-chatgpt/v1/account')); expect((await stat(result)).mode & 0o777).toBe(0o700);
  });
});
