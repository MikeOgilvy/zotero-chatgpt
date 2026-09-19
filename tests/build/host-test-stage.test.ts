import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
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
    expect((JSON.parse(stdout) as { profile: string }).profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/context/profile'));
  });
  it('can stage the context profile for human use without auto-running tests', async () => {
    await expect(select(['--context', '--acceptance'])).resolves.toEqual({ stage: 'context', driver: null, installDriver: false });
  });
  it('requires the dedicated context driver for live model checks', async () => {
    await expect(select(['--live'])).rejects.toThrow();
    await expect(select(['--context', '--acceptance', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--live'])).resolves.toMatchObject({ stage: 'context', installDriver: true });
  });

  it('registers the human-gated live model-catalog stage on its own isolated tree', async () => {
    await expect(select(['--live-model'])).resolves.toMatchObject({ stage: 'live-model', driver: 'tests/host/live-model-driver.js', installDriver: true });
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--live-model'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; reportPath: string };
    expect(tree.stage).toBe('live-model');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/live/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
  });

  it('refuses the live model-catalog stage in acceptance, native and model-request modes', async () => {
    await expect(select(['--live-model', '--acceptance'])).rejects.toThrow();
    await expect(select(['--live-model', '--native'])).rejects.toThrow();
    await expect(select(['--live-model', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--live-model'])).rejects.toThrow();
  });

  it('keeps every host driver file reachable from a stage registration', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { HOST_DRIVERS } from ${JSON.stringify(stageModule)}; console.log(JSON.stringify(HOST_DRIVERS));`,
    ], { cwd: repositoryRoot });
    const registered = new Set<string>(Object.values(JSON.parse(stdout) as Record<string, string>));
    // Selected by --native rather than by HOST_DRIVERS.
    registered.add('tests/host/native-action-driver.ts');
    const files = readdirSync(path.join(repositoryRoot, 'tests/host'))
      .filter(name => /-driver\.(js|ts)$/u.test(name))
      .map(name => `tests/host/${name}`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter(file => !registered.has(file))).toEqual([]);
  });
  it('isolates native task checks and forbids combining their automatic driver with live or manual mode', async () => {
    await expect(select(['--context', '--native'])).resolves.toMatchObject({ stage: 'context', driver: 'tests/host/native-action-driver.ts' });
    await expect(select(['--native'])).rejects.toThrow();
    await expect(select(['--context', '--native', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--native', '--acceptance'])).rejects.toThrow();
  });
  it('refuses to prepare a profile without an explicit stage', async () => {
    await expect(select([])).rejects.toSatisfy((error: unknown) => /Pass one of --context, --embed, --live-model, --s5, --s6, or --acceptance/.test(failureMessage(error)));
  });

  it('registers the embedded ChatGPT probe on its own isolated tree', async () => {
    await expect(select(['--embed'])).resolves.toMatchObject({ stage: 'embed', driver: 'tests/host/embed-driver.js', installDriver: true });
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--embed'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { stage: string; profile: string; dataDir: string; reportPath: string };
    expect(tree.stage).toBe('embed');
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/embed/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
  });

  it('refuses to auto-run the embedded ChatGPT probe as acceptance, native action or live verification', async () => {
    await expect(select(['--embed', '--acceptance'])).rejects.toThrow();
    await expect(select(['--embed', '--native'])).rejects.toThrow();
    await expect(select(['--embed', '--live'])).rejects.toThrow();
    await expect(select(['--context', '--embed'])).rejects.toThrow();
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

  it('rejects combining --acceptance with a host-driver stage', async () => {
    await expect(select(['--acceptance', '--s5'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s5 or --s6/.test(failureMessage(error)));
    await expect(select(['--acceptance', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass --acceptance without --s5 or --s6/.test(failureMessage(error)));
  });

  it('puts S6 in .zotero-chatgpt-dev/s6-virgin, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
  });

  it('puts S6 two-version upgrade in .zotero-chatgpt-dev/s6-upgrade, not the signed-in profile', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { selectHostTree } from ${JSON.stringify(stageModule)};
       console.log(JSON.stringify(selectHostTree(['--s6', '--upgrade-xpi', '/tmp/newer.xpi', '--rollback-xpi', '/tmp/older.xpi'], ${JSON.stringify(repositoryRoot)})));`,
    ], { cwd: repositoryRoot });
    const tree = JSON.parse(stdout) as { profile: string; dataDir: string; reportPath: string };
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/data'));
    expect(tree.reportPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-upgrade/host-report.json'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
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
    expect(tree.profile).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/profile'));
    expect(tree.dataDir).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/data'));
    expect(tree.pdfPath).toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/fixtures/reading.pdf'));
    expect(tree.profile).not.toBe(path.join(repositoryRoot, '.zotero-chatgpt-dev/s6-virgin/profile'));
  });

  it('rejects combining exclusive stage flags', async () => {
    await expect(select(['--s5', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass only one of --context, --embed, --live-model, --s5, --s6/.test(failureMessage(error)));
    await expect(select(['--context', '--s6'])).rejects.toSatisfy((error: unknown) => /Pass only one of --context, --embed, --live-model, --s5, --s6/.test(failureMessage(error)));
  });
});
