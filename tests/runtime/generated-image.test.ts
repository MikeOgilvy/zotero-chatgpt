import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGeneratedImageLoader, type GeneratedImageCodec } from '../../packages/zotero/src/runtime/generated-image.ts';
import { validateOutputImage } from '../../packages/contracts/src/validation.ts';
import { nodeFiles } from './files-fixture.ts';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Kz0AAAAASUVORK5CYII=';
const codec: GeneratedImageCodec = { decode: value => new Uint8Array(Buffer.from(value, 'base64')), encode: bytes => Buffer.from(bytes).toString('base64') };
const roots: string[] = [];
async function setup() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'zcr-image-output-'))); roots.push(root);
  const allowed = path.join(root, 'scratch'); await mkdir(allowed);
  const host = nodeFiles(); const reads: string[] = []; const read = host.io.read.bind(host.io);
  host.io.read = value => { reads.push(value); return read(value); };
  return { root, allowed, host, reads, load: createGeneratedImageLoader({ host, allowedOutputDirectories: [allowed], codec }) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function item(result = PNG, savedPath?: string) { return { type: 'imageGeneration', id: 'image-result-1', status: 'completed', result, ...(savedPath ? { savedPath } : {}) }; }
it('decodes a completed native base64 output with generated provenance and no filesystem reads', async () => {
  const f = await setup(); const result = await f.load(item(), 'gpt-image-example');
  expect(result).toMatchObject({ mime: 'image/png', dataUrl: `data:image/png;base64,${PNG}`, origin: { kind: 'generated', model: 'gpt-image-example' } });
  expect(validateOutputImage(result)).toEqual(result); expect(f.reads).toEqual([]);
});
it('accepts an inline data URL only when its declared MIME agrees with the bytes', async () => {
  const f = await setup(); expect((await f.load(item(`data:image/png;base64,${PNG}`), 'model')).mime).toBe('image/png');
  await expect(f.load(item(`data:image/jpeg;base64,${PNG}`), 'model')).rejects.toThrow();
});
it('recognizes JPEG and WebP magic without changing decoded bytes', async () => {
  const f = await setup();
  const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
  const webp = new Uint8Array([82, 73, 70, 70, 12, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 0, 0, 0, 0]);
  for (const [bytes, mime] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']] as const) {
    const encoded = codec.encode(bytes); const result = await f.load(item(encoded), 'model');
    expect(result.mime).toBe(mime); expect(codec.decode(result.dataUrl.split(',')[1]!)).toEqual(bytes);
  }
});
it('loads an image only from the explicit output directory and does not expose its path', async () => {
  const f = await setup(); const output = path.join(f.allowed, 'render.png'); await writeFile(output, codec.decode(PNG));
  const image = await f.load(item('', output), 'model');
  expect(image.dataUrl).toBe(`data:image/png;base64,${PNG}`); expect(f.reads).toEqual([output]); expect(JSON.stringify(image)).not.toContain(f.root);
});
it('rejects traversal, URI paths, sibling roots, and non-image extensions before reading', async () => {
  const f = await setup();
  const paths = [path.join(f.root, 'outside.png'), f.allowed + '-sibling/file.png', f.allowed + '/../secret.png', f.allowed + '/./file.png', f.allowed + '//file.png', 'file://' + f.allowed + '/file.png', 'https://example.com/image.png', f.allowed + '/credentials.json', f.allowed + '/file.pdf', f.allowed + '/%2e%2e/secret.png'];
  for (const value of paths) {
    await expect(f.load(item('', value), 'model')).rejects.toThrow();
  }
  expect(f.reads).toEqual([]);
});
it('rejects leaf, intermediate, and allowed-root symlinks before reading', async () => {
  const f = await setup(); const outside = path.join(f.root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'image.png'), codec.decode(PNG));
  await symlink(path.join(outside, 'image.png'), path.join(f.allowed, 'leaf.png')); await symlink(outside, path.join(f.allowed, 'folder'));
  for (const value of [path.join(f.allowed, 'leaf.png'), path.join(f.allowed, 'folder', 'image.png')]) await expect(f.load(item('', value), 'model')).rejects.toThrow();
  const rootLink = path.join(f.root, 'linked-root'); await symlink(outside, rootLink);
  const load = createGeneratedImageLoader({ host: f.host, allowedOutputDirectories: [rootLink], codec });
  await expect(load(item('', path.join(rootLink, 'image.png')), 'model')).rejects.toThrow(); expect(f.reads).toEqual([]);
});
it('rejects a corrupt file with an image suffix and checks its size before reading', async () => {
  const f = await setup(); const file = path.join(f.allowed, 'bad.png'); await writeFile(file, 'This is a synthetic non-image');
  await expect(f.load(item('', file), 'model')).rejects.toThrow();
  f.reads.length = 0; const stat = f.host.io.stat.bind(f.host.io); f.host.io.stat = async value => value === file ? { type: 'regular', size: 16 * 1024 * 1024 + 1, permissions: 0o600 } : stat(value);
  await expect(f.load(item('', file), 'model')).rejects.toThrow(); expect(f.reads).toEqual([]);
});
it('keeps valid outputs larger than the 2MiB input limit without shrinking them and caps at16MiB', async () => {
  const f = await setup(); const bytes = new Uint8Array(2 * 1024 * 1024 + 1); bytes.set(codec.decode(PNG));
  const result = await f.load(item(codec.encode(bytes)), 'model'); expect(codec.decode(result.dataUrl.split(',')[1]!)).toEqual(bytes);
  const tooBig = new Uint8Array(16 * 1024 * 1024 + 1); tooBig.set(codec.decode(PNG));
  await expect(f.load(item(codec.encode(tooBig)), 'model')).rejects.toThrow();
});
it('fails closed on remote, malformed, ambiguous, non-final, and unknown result encodings', async () => {
  const f = await setup();
  const results = ['https://example.com/image.png', 'not an image', PNG + '\n', PNG.slice(0, -1), 'AA=A', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh'];
  for (const value of results) await expect(f.load(item(value), 'model')).rejects.toThrow();
  await expect(f.load({ ...item(), status: 'inProgress' }, 'model')).rejects.toThrow();
  await expect(f.load({ ...item(), arbitraryPath: '/private/secret' }, 'model')).rejects.toThrow();
  await expect(f.load(item(PNG, path.join(f.allowed, 'image.png')), 'model')).rejects.toThrow(); expect(f.reads).toEqual([]);
});
it('reports constant failures without including raw path, model output, or host errors', async () => {
  const f = await setup(); const marker = 'private-output-marker';
  for (const value of [item(marker), item('', path.join(f.root, marker + '.png'))]) {
    const error: unknown = await f.load(value, 'model').catch(error => error as unknown);
    expect(error).toBeInstanceOf(Error); expect(String(error)).not.toContain(marker); expect(String(error)).not.toContain(f.root);
  }
});
