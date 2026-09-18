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

// A deliberately synthetic, never-created local path. The two cases below fail during argument
// validation *before* any XPI file is opened:
//   - the GitHub-URL case throws inside `requireLocalXpi` on the *upgrade* argument, and
//   - the missing-pairing case throws on the `--upgrade-xpi`/`--rollback-xpi` check.
// So the counterpart path is never stat'ed. It used to point at the real
// `dist/zotero-chatgpt-0.3.0a1-dev.xpi`, which no longer exists (the a1 XPI bytes were deleted
// and are only regenerable from the `v0.3.0a1` tag); the tests passed solely because the URL/pairing
// rejection happened first. Using a clearly-synthetic path makes that intent explicit and removes
// the hidden dependency on a deleted artifact. File-existence validation is still covered by the
// different-versions case below, which builds two real fixture XPIs.
const SYNTHETIC_MISSING_LOCAL_XPI = '/synthetic/zchatgpt-s6-nonexistent-0.3.0a1-dev.xpi';

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr;
  if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function packageFixture(version: string): Promise<string> {
  const source = await mkdtemp(path.join(tmpdir(), 'zchatgpt-s6-upgrade-src-'));
  const output = await mkdtemp(path.join(tmpdir(), 'zchatgpt-s6-upgrade-xpi-'));
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
      'https://github.com/example/zotero-chatgpt/releases/download/v0.1.0/plugin.xpi',
      '--rollback-xpi',
      SYNTHETIC_MISSING_LOCAL_XPI,
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /GitHub Release download is not authorized/i.test(failureMessage(error)));
  });

  it('requires upgrade and rollback XPIs together', async () => {
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s6',
      '--upgrade-xpi',
      SYNTHETIC_MISSING_LOCAL_XPI,
    ], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /both --upgrade-xpi and --rollback-xpi/i.test(failureMessage(error)));
  });

  it('refuses --upgrade-xpi without --s6', async () => {
    await expect(execFileAsync(process.execPath, [
      prepare,
      '--s5',
      '--upgrade-xpi',
      '/tmp/zchatgpt-newer.xpi',
      '--rollback-xpi',
      '/tmp/zchatgpt-older.xpi',
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
