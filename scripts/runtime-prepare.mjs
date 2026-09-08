import { execFile } from 'node:child_process';
import { mkdir, lstat, mkdtemp, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { PINNED_RUNTIME, runtimeCache, verifyRuntimeFile } from './runtime-assets.mjs';
const execute = promisify(execFile);
if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 is required');
await mkdir(runtimeCache, { recursive: true, mode: 0o700 });
if ((await lstat(runtimeCache)).isSymbolicLink()) throw new Error('Runtime cache must be a real directory');
const archivePath = path.join(runtimeCache, PINNED_RUNTIME.archive.filename);
let archivePresent = true;
try { await lstat(archivePath); }
catch (error) { if (error.code !== 'ENOENT') throw error; archivePresent = false; }
if (!archivePresent) {
  const partial = archivePath + '.partial';
  const file = await open(partial, 'wx', 0o600);
  try {
    const response = await fetch(PINNED_RUNTIME.archive.url);
    if (!response.ok || !response.body) throw new Error('Official runtime download failed');
    let size = 0;
    for await (const bytes of response.body) {
      size += bytes.byteLength; if (size > PINNED_RUNTIME.archive.size) throw new Error('Official runtime download size exceeded');
      await file.writeFile(bytes);
    }
    await file.sync(); await file.close();
    await verifyRuntimeFile(partial, PINNED_RUNTIME.archive); await rename(partial, archivePath);
  } finally { await file.close().catch(() => undefined); await rm(partial, { force: true }); }
}
await verifyRuntimeFile(archivePath, PINNED_RUNTIME.archive);
const staging = await mkdtemp(path.join(runtimeCache, 'extract-'));
try {
  // The archive digest is pinned before tar reads it; extract exactly one fixed entry.
  await execute('/usr/bin/tar', ['-xzf', archivePath, '-C', staging, PINNED_RUNTIME.archive.entry]);
  const binary = path.join(staging, PINNED_RUNTIME.archive.entry); await verifyRuntimeFile(binary, PINNED_RUNTIME);
  if (process.platform === 'darwin') await execute('/usr/bin/codesign', ['--verify', '--strict', binary]);
  await rename(binary, path.join(runtimeCache, PINNED_RUNTIME.archive.entry));
} finally { await rm(staging, { recursive: true, force: true }); }
console.log(`Verified bundled Codex ${PINNED_RUNTIME.codexVersion} (${PINNED_RUNTIME.platform}/${PINNED_RUNTIME.architecture}) prepared.`);
