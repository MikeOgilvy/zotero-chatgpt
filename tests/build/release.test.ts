import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const script = path.join(repositoryRoot, 'scripts/release.mjs');
const temporaryDirectories: string[] = [];

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr;
  if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
  if (error instanceof Error) return error.message;
  return String(error);
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

describe('release dry-run without publishing', () => {
  it('refuses GitHub publish flags', async () => {
    await expect(execFileAsync(process.execPath, [script, '--publish'], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /GitHub Release is not authorized/i.test(failureMessage(error)));
    await expect(execFileAsync(process.execPath, [script, '--gh-release'], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /GitHub Release is not authorized/i.test(failureMessage(error)));
  });

  it('writes a local dry-run plan with no GitHub URL', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'zchatgpt-release-'));
    temporaryDirectories.push(directory);
    const output = path.join(directory, 'release-plan.json');
    const { stdout } = await execFileAsync(process.execPath, [script, '--dry-run', '--out', output, '--json'], { cwd: repositoryRoot });
    const result = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.githubRelease).toBeNull();
    expect(result.published).toBe(false);
    const plan = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/zotero/manifest.json'), 'utf8')) as { version: string };
    expect(plan.tag).toBe(`v${manifest.version}`);
    expect(plan.githubRelease).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/github\.com\/.+\/releases/i);
  });
});
