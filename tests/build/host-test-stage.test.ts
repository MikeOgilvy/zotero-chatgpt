import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const stageModule = pathToFileURL(path.join(repositoryRoot, 'scripts/host-test-stage.mjs')).href;

async function select(argv: string[]): Promise<{ stage: string; driver: string | null; installDriver: boolean }> {
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import { selectHostStage } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(selectHostStage(${JSON.stringify(argv)})));`,
  ], { cwd: repositoryRoot });
  return JSON.parse(stdout) as { stage: string; driver: string | null; installDriver: boolean };
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') return error.stderr;
  if (error instanceof Error) return error.message;
  return String(error);
}

describe('dedicated host-test stage selection', () => {
  it('isolates full-PDF host validation from every existing profile', async () => {
    await expect(select(['--context'])).resolves.toMatchObject({ stage: 'context', driver: 'tests/host/context-driver.js' });
    const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `import { selectHostTree } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(selectHostTree(['--context'], ${JSON.stringify(repositoryRoot)})));`]);
    expect((JSON.parse(stdout) as { profile: string }).profile).toBe(path.join(repositoryRoot, '.zcr-dev/context/profile'));
  });
  it('can stage the context profile for human use without auto-running tests', async () => {
    await expect(select(['--context', '--acceptance'])).resolves.toEqual({ stage: 'context', driver: null, installDriver: false });
  });
  it('defaults to the S1 driver', async () => {
    await expect(select([])).resolves.toEqual({ stage: 's1', driver: 'tests/host/driver.js', installDriver: true });
  });

  it('selects the S5 restart driver', async () => {
    await expect(select(['--s5'])).resolves.toEqual({ stage: 's5', driver: 'tests/host/s5-driver.js', installDriver: true });
  });

  it('selects the S6 virgin-profile driver', async () => {
    await expect(select(['--s6'])).resolves.toEqual({ stage: 's6', driver: 'tests/host/s6-driver.js', installDriver: true });
  });

  it('stages human acceptance without an auto-running host driver', async () => {
    await expect(select(['--acceptance'])).resolves.toEqual({ stage: 'acceptance', driver: null, installDriver: false });
  });

  it('rejects combining --acceptance with a host-driver stage or --login', async () => {
    await expect(select(['--acceptance', '--s4'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s2, --s3, --s4, --s5, --s6, or --login/.test(failureMessage(error)));
    await expect(select(['--acceptance', '--login'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s2, --s3, --s4, --s5, --s6, or --login/.test(failureMessage(error)));
  });

  it('puts S6 in .zcr-dev/s6-virgin, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zcr-dev/s6-virgin/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zcr-dev/s6-virgin/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zcr-dev/s6-virgin/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zcr-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zcr-dev/data'));
  });

  it('puts S6 two-version upgrade in .zcr-dev/s6-upgrade, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6', '--upgrade-xpi', '/tmp/newer.xpi', '--rollback-xpi', '/tmp/older.xpi'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zcr-dev/s6-upgrade/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zcr-dev/s6-upgrade/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zcr-dev/s6-upgrade/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zcr-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zcr-dev/data'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zcr-dev/s6-virgin/profile'));
  });

  it('puts --acceptance on the signed-in tree, not s6-virgin', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--acceptance'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; pdfPath: string };
    expect(tree.stage).toBe('acceptance');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zcr-dev/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zcr-dev/data'));
    expect(tree.pdfPath).toBe(path.join(repositoryRoot, '.zcr-dev/fixtures/reading.pdf'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zcr-dev/s6-virgin/profile'));
  });

  it('rejects combining exclusive stage flags', async () => {
    await expect(select(['--s4', '--s5'])).rejects.toSatisfy((error: unknown) => /Pass only one of --s2, --s3, --s4, --s5, --s6/.test(failureMessage(error)));
    await expect(select(['--s5', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass only one of --s2, --s3, --s4, --s5, --s6/.test(failureMessage(error)));
  });
});
