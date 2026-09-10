import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const prepare = path.join(repositoryRoot, 'scripts/prepare-host-test.mjs');
const temporaryDirectories: string[] = [];

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr;
  if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function packageFixture(version: string): Promise<string> {
  const source = await mkdtemp(path.join(tmpdir(), 'zcr-s6-upgrade-src-'));
  const output = await mkdtemp(path.join(tmpdir(), 'zcr-s6-upgrade-xpi-'));
  temporaryDirectories.push(source, output);
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'build', '--outdir', source], { cwd: repositoryRoot });
  const manifestPath = path.join(source, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const archivePath = path.join(output, `plugin-${version}.xpi`);
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'package', '--source', source, '--output', archivePath], { cwd: repositoryRoot });
  return archivePath;
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

describe('S6 two-version host prepare', () => {
  it('refuses a GitHub Release download as the upgrade XPI', async () => {
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s6',
      '--upgrade-xpi',
      'https://github.com/example/zotero-codex-reader/releases/download/v0.1.0/plugin.xpi',
      '--rollback-xpi',
      path.join(repositoryRoot, 'dist/zotero-codex-reader-0.3.0a1-dev.xpi'),
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /GitHub Release download is not authorized/i.test(failureMessage(error)));
  });

  it('requires upgrade and rollback XPIs together', async () => {
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s6',
      '--upgrade-xpi',
      path.join(repositoryRoot, 'dist/zotero-codex-reader-0.3.0a1-dev.xpi'),
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /both --upgrade-xpi and --rollback-xpi/i.test(failureMessage(error)));
  });

  it('refuses --upgrade-xpi without --s6', async () => {
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s5',
      '--upgrade-xpi',
      '/tmp/zcr-newer.xpi',
      '--rollback-xpi',
      '/tmp/zcr-older.xpi',
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /--upgrade-xpi is only valid with --s6/i.test(failureMessage(error)));
  });

  it('requires upgrade and rollback XPIs to have different versions', async () => {
    const same = await packageFixture('0.3.0a1');
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s6',
      '--upgrade-xpi',
      same,
      '--rollback-xpi',
      same,
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /Upgrade and rollback XPIs must have different versions/i.test(failureMessage(error)));
  });
});
