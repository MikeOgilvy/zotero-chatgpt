import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PINNED_RUNTIME } from '../runtime/manifest.ts';
export const runtimeCache = path.resolve(import.meta.dirname, '../.zcr-dev/runtime-cache');
const licenseDirectory = path.resolve(import.meta.dirname, '../runtime/licenses');
export async function verifyRuntimeFile(file, expected) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.size) throw new Error('size');
    const digest = createHash('sha256'); for await (const bytes of createReadStream(file)) digest.update(bytes);
    if (digest.digest('hex') !== expected.sha256) throw new Error('digest');
  } catch { throw new Error('Bundled runtime missing or integrity check failed. Run node scripts/runtime-prepare.mjs.'); }
}
function validateManifest(manifest) {
  if (manifest.entry !== PINNED_RUNTIME.entry || manifest.archive.entry !== PINNED_RUNTIME.archive.entry || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || !/^[a-f0-9]{64}$/u.test(manifest.sha256) || JSON.stringify(manifest.licenses) !== JSON.stringify(PINNED_RUNTIME.licenses)) throw new Error('Invalid bundled runtime manifest');
}
export async function copyBundledRuntime(outputDirectory, { cacheDirectory = runtimeCache, manifest = PINNED_RUNTIME } = {}) {
  validateManifest(manifest);
  const source = path.join(cacheDirectory, manifest.archive.entry); await verifyRuntimeFile(source, manifest);
  const destination = path.join(outputDirectory, manifest.entry);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { dereference: false });
  await verifyRuntimeFile(destination, manifest);
  await writeFile(path.join(outputDirectory, 'content/runtime/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await mkdir(path.join(outputDirectory, 'content/runtime/licenses'), { recursive: true });
  for (const license of manifest.licenses) await cp(path.join(licenseDirectory, license), path.join(outputDirectory, 'content/runtime/licenses', license));
}
export async function validatePackagedRuntime(sourceDirectory, manifest = PINNED_RUNTIME) {
  validateManifest(manifest);
  const recorded = JSON.parse(await readFile(path.join(sourceDirectory, 'content/runtime/manifest.json'), 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(manifest)) throw new Error('Bundled runtime manifest mismatch');
  await verifyRuntimeFile(path.join(sourceDirectory, manifest.entry), manifest);
  for (const license of manifest.licenses) {
    const source = await readFile(path.join(licenseDirectory, license));
    const packaged = await readFile(path.join(sourceDirectory, 'content/runtime/licenses', license));
    if (!source.equals(packaged)) throw new Error('Bundled runtime license mismatch');
  }
}
export { PINNED_RUNTIME };
