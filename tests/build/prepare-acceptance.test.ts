import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const prepare = path.join(repositoryRoot, 'scripts/prepare-host-test.mjs');

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.trim()) return error.stderr;
  if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
  if (error instanceof Error) return error.message;
  return String(error);
}

describe('human-acceptance host prepare', () => {
  it('refuses --acceptance together with a host-driver stage', async () => {
    await expect(execFileAsync(process.execPath, [prepare, '--acceptance', '--s4'], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s2, --s3, --s4, --s5, --s6, or --login/.test(failureMessage(error)));
  });

  it('refuses --acceptance together with --login', async () => {
    await expect(execFileAsync(process.execPath, [prepare, '--acceptance', '--login'], { cwd: repositoryRoot })).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s2, --s3, --s4, --s5, --s6, or --login/.test(failureMessage(error)));
  });
});
