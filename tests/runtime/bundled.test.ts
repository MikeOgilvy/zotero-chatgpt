/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBundledRuntime, type AssetHost, type RuntimeManifest } from '../../packages/zotero/src/runtime/bundled.ts';
import { nodeFiles } from './files-fixture.ts';
const roots: string[] = [];
const manifest: RuntimeManifest = { codexVersion: '0.144.1', platform: 'darwin', architecture: 'arm64', entry: 'content/runtime/codex-aarch64-apple-darwin', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' };
async function setup() { const root = await mkdtemp(path.join(tmpdir(), 'zcr-bundle-')); roots.push(root); const host: AssetHost = { ...nodeFiles(), os: 'Darwin', abi: 'aarch64-gcc3', load: vi.fn(() => Promise.resolve(new TextEncoder().encode('abc'))) }; return { root, host }; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('extracts verified bytes from only the fixed packaged resource and rechecks the cached executable', async () => {
  const { root, host } = await setup(); const target = await ensureBundledRuntime(host, 'jar:file:///extension.xpi!/', root, manifest);
  expect(await readFile(target, 'utf8')).toBe('abc'); expect((await stat(target)).mode & 0o777).toBe(0o700);
  expect(host.load).toHaveBeenCalledWith('jar:file:///extension.xpi!/content/runtime/codex-aarch64-apple-darwin');
  expect(await ensureBundledRuntime(host, 'jar:file:///extension.xpi!/', root, manifest)).toBe(target); expect(host.load).toHaveBeenCalledTimes(1);
});
it('repairs a corrupt cached executable from the packaged copy while retaining the corrupt bytes as evidence', async () => {
  const { root, host } = await setup(); const target = await ensureBundledRuntime(host, 'jar:file:///extension.xpi!/', root, manifest);
  await writeFile(target, 'bad');
  expect(await ensureBundledRuntime(host, 'jar:file:///extension.xpi!/', root, manifest)).toBe(target);
  expect(await readFile(target, 'utf8')).toBe('abc'); expect((await stat(target)).mode & 0o777).toBe(0o700); expect(host.load).toHaveBeenCalledTimes(2);
  const retained = (await readdir(path.dirname(target))).filter(name => name.startsWith('corrupt-'));
  expect(retained).toHaveLength(1); expect(await readFile(path.join(path.dirname(target), retained[0]!), 'utf8')).toBe('bad');
  // A corrupt packaged copy cannot repair anything and must not replace the retained evidence with a broken runtime.
  await writeFile(target, 'bad'); host.load = () => Promise.resolve(new TextEncoder().encode('wrong'));
  await expect(ensureBundledRuntime(host, 'jar:file:///extension.xpi!/', root, manifest)).rejects.toThrow('Bundled runtime preparation failed');
  expect((await readdir(path.dirname(target))).some(name => name.includes('staging-'))).toBe(false);
});
it('rejects unsupported platform, architecture and arbitrary asset paths before loading', async () => {
  const { root, host } = await setup();
  for (const candidate of [{ ...host, os: 'Linux' }, { ...host, abi: 'x86_64-gcc3' }]) await expect(ensureBundledRuntime(candidate, 'jar:file:///x!/', root, manifest)).rejects.toThrow('Unsupported runtime platform');
  await expect(ensureBundledRuntime(host, 'jar:file:///x!/', root, { ...manifest, entry: '../escape' })).rejects.toThrow('Invalid bundled runtime manifest');
  expect(host.load).not.toHaveBeenCalled();
});
it('cleans failed staging on missing asset, size mismatch and digest mismatch', async () => {
  for (const failure of ['missing', 'size', 'digest']) {
    const { root, host } = await setup(); host.load = failure === 'missing' ? () => Promise.reject(new Error('raw private path')) : () => Promise.resolve(new TextEncoder().encode(failure === 'size' ? 'abcd' : 'bad'));
    await expect(ensureBundledRuntime(host, 'jar:file:///x!/', root, manifest)).rejects.toThrow('Bundled runtime preparation failed');
    const paths = await readdir(root, { recursive: true }); expect(paths.some(p => p.includes('staging-') || p.endsWith('/codex'))).toBe(false);
  }
});
it('refuses a symlink cached executable and cleans staging after a write failure', async () => {
  const { root, host } = await setup(); const target = await ensureBundledRuntime(host, 'jar:file:///x!/', root, manifest);
  await rm(target); await symlink('/bin/sh', target); await expect(ensureBundledRuntime(host, 'jar:file:///x!/', root, manifest)).rejects.toThrow();
  await rm(target); host.io.write = () => Promise.reject(new Error('write failed'));
  await expect(ensureBundledRuntime(host, 'jar:file:///x!/', root, manifest)).rejects.toThrow();
  expect((await readdir(root, { recursive: true })).some(p => p.includes('staging-'))).toBe(false);
});
