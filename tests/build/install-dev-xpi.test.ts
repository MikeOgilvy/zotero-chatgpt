import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backupFileName,
  effectiveScanScopes,
  includesProfileScope,
  isManagedLever,
  leverText,
  measureOpenHandle,
  parseArgs,
  parseBackupFileName,
  parseLsofPids,
  parseLsofRows,
  parsePsProfilePids,
  parseUserPrefs,
  run,
  scanScopesInText,
  selectNewestBackup,
  timestampStamp,
  type DevInstallDeps,
  type DevInstallOutcome,
} from '../../scripts/install-dev-xpi.ts';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const SUBJECT_ID = '{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}';
const temporaryDirectories: string[] = [];
let fixtureSource = '';

function makeDeps(
  overrides: { lsof?: (target: string) => string | null; ps?: () => string; platform?: string } = {},
): DevInstallDeps {
  return {
    platform: overrides.platform ?? 'darwin',
    now: () => new Date(Date.UTC(2026, 8, 13, 21, 51, 59)),
    lsof: overrides.lsof ?? (() => ''),
    ps: overrides.ps ?? (() => ''),
  };
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'zcr-dev-xpi-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

beforeAll(async () => {
  fixtureSource = await makeTemporaryDirectory();
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'build', '--outdir', fixtureSource], {
    cwd: repositoryRoot,
  });
});

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

async function packageFixture(archivePath: string, version: string): Promise<string> {
  const manifestPath = path.join(fixtureSource, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };
  manifest.version = version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await execFileAsync(
    process.execPath,
    ['tests/runtime/package-fixture.mjs', 'package', '--source', fixtureSource, '--output', archivePath],
    { cwd: repositoryRoot },
  );
  return archivePath;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function makeProfile(root: string, name: string, prefsJs: string): Promise<string> {
  const profile = path.join(root, name);
  await mkdir(path.join(profile, 'extensions'), { recursive: true });
  await writeFile(path.join(profile, 'prefs.js'), prefsJs);
  return profile;
}

function ok(outcome: DevInstallOutcome | { ok: true; command: 'help'; usage: string }): DevInstallOutcome {
  if (outcome.command === 'help') throw new Error('expected a non-help outcome');
  return outcome;
}

describe('pref and lever planning', () => {
  it('parses integer user_pref lines and ignores non-integers', () => {
    const text = [
      '// comment',
      'user_pref("extensions.zotero.useDataDir", true);',
      'user_pref("extensions.startupScanScopes", 1);',
      'user_pref("extensions.startupScanScopes", "0");',
    ].join('\n');
    const entries = parseUserPrefs(text);
    expect(entries.map((entry) => entry.key)).toEqual([
      'extensions.zotero.useDataDir',
      'extensions.startupScanScopes',
      'extensions.startupScanScopes',
    ]);
    expect(entries[0]?.int).toBeNull();
    expect(entries[1]?.int).toBe(1);
    expect(scanScopesInText(text)).toEqual({ value: 1, line: 3, raw: '1' });
    expect(scanScopesInText('user_pref("extensions.startupScanScopes", "5");')).toBeNull();
  });

  it('lets user.js win over prefs.js and falls back to the compiled default', () => {
    expect(effectiveScanScopes('', null)).toEqual({ value: 0, source: 'default', raw: null });
    expect(effectiveScanScopes('user_pref("extensions.startupScanScopes", 4);', null)).toEqual({
      value: 4,
      source: 'prefs.js',
      raw: '4',
    });
    expect(
      effectiveScanScopes(
        'user_pref("extensions.startupScanScopes", 4);',
        'user_pref("extensions.startupScanScopes", 1);',
      ),
    ).toEqual({ value: 1, source: 'user.js', raw: '1' });
  });

  it('treats only the profile bit as a profile-scope scan', () => {
    expect(includesProfileScope(0)).toBe(false);
    expect(includesProfileScope(1)).toBe(true);
    expect(includesProfileScope(2)).toBe(false);
    expect(includesProfileScope(3)).toBe(true);
  });

  it('recognises its own user.js and appends exactly one managed pref', () => {
    expect(isManagedLever(leverText(1))).toBe(true);
    expect(isManagedLever(leverText(0))).toBe(true);
    expect(isManagedLever('user_pref("extensions.startupScanScopes", 1);')).toBe(false);
    expect(
      isManagedLever(`${leverText(1)}user_pref("extensions.zotero.useDataDir", true);`),
    ).toBe(false);
    expect(leverText(1)).toContain('user_pref("extensions.startupScanScopes", 1);');
  });

  it('round-trips backup file names and picks the newest by stamp', () => {
    const older = backupFileName(SUBJECT_ID, '0.4.0a3', '20260913-101010');
    const newer = backupFileName(SUBJECT_ID, '0.4.0a4', '20260913-215159');
    expect(parseBackupFileName(older, SUBJECT_ID)).toEqual({ stamp: '20260913-101010', version: '0.4.0a3' });
    expect(parseBackupFileName('not-a-backup.xpi', SUBJECT_ID)).toBeNull();
    expect(selectNewestBackup([older, 'notes.txt', newer], SUBJECT_ID)).toBe(newer);
    expect(selectNewestBackup(['notes.txt'], SUBJECT_ID)).toBeNull();
    expect(timestampStamp(new Date(Date.UTC(2026, 8, 13, 21, 51, 59)))).toBe('20260913-215159');
  });
});

describe('process and open-file parsing', () => {
  const header = 'COMMAND     PID USER   FD   TYPE DEVICE SIZE/OFF     NODE NAME';
  const row = `zotero    50356 kuhn  txt    REG   1,17 92661563  87654321 /Users/kuhn/Library/Application Support/Zotero/Profiles/mi2zhr2s.default/extensions/${SUBJECT_ID}.xpi`;
  const installedPath = `/Users/kuhn/Library/Application Support/Zotero/Profiles/mi2zhr2s.default/extensions/${SUBJECT_ID}.xpi`;

  it('parses lsof rows, keeping NAME with spaces, and dedupes pids', () => {
    const rows = parseLsofRows(`${header}\n${row}\n`);
    expect(rows).toEqual([
      { pid: 50356, size: 92661563, inode: '87654321', name: installedPath },
    ]);
    expect(parseLsofPids(`${header}\n${row}\n${row.replace('50356', '50357')}\n`)).toEqual([50356, 50357]);
    expect(parseLsofRows(header)).toEqual([]);
  });

  it('measures a hold only for the given pids and an acceptable path', () => {
    const output = `${header}\n${row}\n`;
    expect(measureOpenHandle(output, [50356], [installedPath])).toEqual({
      holds: true,
      inode: '87654321',
      size: 92661563,
      rows: 1,
    });
    expect(measureOpenHandle(output, [50356], ['/private/tmp/other.xpi', installedPath]).holds).toBe(true);
    expect(measureOpenHandle(output, [99999], [installedPath])).toEqual({
      holds: false,
      inode: null,
      size: null,
      rows: 0,
    });
    expect(measureOpenHandle(output, [50356], [`${installedPath}.other`]).holds).toBe(false);
  });

  it('finds a running profile from ps only for zotero lines naming that profile', () => {
    const profile = '/tmp/zcr-dev/profile';
    const output = [
      '    1 /sbin/launchd',
      '123 /Applications/Zotero.app/Contents/MacOS/zotero',
      `50356 /Applications/Zotero.app/Contents/MacOS/zotero -no-remote -profile ${profile}`,
      `50357 /Applications/Other.app/Contents/MacOS/other -profile ${profile}`,
    ].join('\n');
    expect(parsePsProfilePids(output, profile)).toEqual([50356]);
  });
});

describe('argument parsing', () => {
  it('defaults to help and accepts an explicit command', () => {
    expect(parseArgs([])).toEqual({ ok: true, command: 'help', usage: expect.any(String) as string });
    expect(parseArgs(['help']).command).toBe('help');
    expect(parseArgs(['plan', '--help']).command).toBe('help');
    expect(parseArgs(['check', '--profile', '/tmp/p'])).toMatchObject({ command: 'check', profile: '/tmp/p', apply: true });
    expect(parseArgs(['plan', '--profile', '/tmp/p'])).toMatchObject({ command: 'plan', apply: false });
  });

  it('rejects bad commands, flags and profile selectors', () => {
    expect(() => parseArgs(['nope'])).toThrow(/Unknown command/u);
    expect(() => parseArgs(['install', '--profile'])).toThrow(/requires a value/u);
    expect(() => parseArgs(['install', '--profile', '/a', '--profile-name', 'b'])).toThrow(/only one/u);
    expect(() => parseArgs(['install', '--rescan', 'sometimes'])).toThrow(/--rescan must be/u);
  });
});

describe('local plan and install against a temporary profile', () => {
  it('plans without writing, then installs with a backup, a record and the rescan lever', async () => {
    const root = await makeTemporaryDirectory();
    const previousXpi = await packageFixture(path.join(root, 'previous.xpi'), '0.4.0a3');
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', 'user_pref("extensions.zotero.useDataDir", true);\n');
    const installedPath = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
    await writeFile(installedPath, await readFile(previousXpi));
    const previousSha = await sha256(previousXpi);

    const planned = ok(await run(['plan', '--profile', profile, '--xpi', artifactXpi], makeDeps()));
    expect(planned.status).toBe('planned');
    expect(planned.lever.state).toBe('armed');
    expect(await readFile(installedPath)).toEqual(await readFile(previousXpi));
    await expect(stat(path.join(profile, 'user.js'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(`${installedPath}.zcr-install.json`)).rejects.toMatchObject({ code: 'ENOENT' });

    const installed = ok(await run(['install', '--profile', profile, '--xpi', artifactXpi], makeDeps()));
    expect(installed.ok).toBe(true);
    expect(installed.status).toBe('awaiting-launch');
    expect(installed.artifactVersion).toBe('0.4.0a4');
    expect(installed.previousVersion).toBe('0.4.0a3');
    expect(installed.installedSha256).toBe(await sha256(artifactXpi));
    expect(await sha256(installedPath)).toBe(await sha256(artifactXpi));
    expect(installed.backupPath).not.toBeNull();
    expect(await sha256(installed.backupPath as string)).toBe(previousSha);
    expect(await readFile(path.join(profile, 'user.js'), 'utf8')).toContain(
      'user_pref("extensions.startupScanScopes", 1);',
    );

    const record = JSON.parse(await readFile(`${installedPath}.zcr-install.json`, 'utf8')) as {
      addonId: string;
      artifactVersion: string;
      previous: { version: string; sha256: string } | null;
    };
    expect(record.addonId).toBe(SUBJECT_ID);
    expect(record.artifactVersion).toBe('0.4.0a4');
    expect(record.previous?.version).toBe('0.4.0a3');
    expect(record.previous?.sha256).toBe(previousSha);
  });

  it('is idempotent when the installed file already matches the artifact', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    const installedPath = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
    await writeFile(installedPath, await readFile(artifactXpi));

    const outcome = ok(await run(['install', '--profile', profile, '--xpi', artifactXpi], makeDeps()));
    expect(outcome.status).toBe('already-installed');
    expect(outcome.backupPath).toBeNull();
    expect(await readdir(path.join(profile, 'extensions'))).toEqual([`${SUBJECT_ID}.xpi`]);
  });

  it('refuses a running profile, a foreign user.js and a missing profile', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    const busy = makeDeps({
      lsof: () => `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nzotero 50356 kuhn txt REG 1,17 0 42 ${path.join(profile, '.parentlock')}\n`,
    });
    await expect(run(['install', '--profile', profile, '--xpi', artifactXpi], busy)).rejects.toThrow(/in use/u);

    await writeFile(path.join(profile, 'user.js'), 'user_pref("extensions.zotero.useDataDir", true);\n');
    await expect(run(['install', '--profile', profile, '--xpi', artifactXpi], makeDeps())).rejects.toThrow(
      /was not written by this tool/u,
    );

    await expect(run(['install', '--profile', path.join(root, 'missing'), '--xpi', artifactXpi], makeDeps())).rejects.toThrow(
      /Not a Zotero profile/u,
    );
  });

  it('leaves the reported version stale when the rescan lever is explicitly skipped', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    const outcome = ok(
      await run(['install', '--profile', profile, '--xpi', artifactXpi, '--rescan', 'never'], makeDeps()),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.lever.state).toBe('skipped');
    await expect(stat(path.join(profile, 'user.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('measurement and rollback on a temporary profile', () => {
  async function installInto(profile: string, artifactXpi: string): Promise<void> {
    await run(['install', '--profile', profile, '--xpi', artifactXpi], makeDeps());
  }

  it('verifies the held file and reported version, then relaxes and reverts the lever', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    await installInto(profile, artifactXpi);
    const installedPath = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
    const info = await stat(installedPath, { bigint: true });

    // Simulate the launch that rescanned: prefs.js now carries the pinned value (Gecko wrote it at exit).
    await writeFile(path.join(profile, 'prefs.js'), 'user_pref("extensions.startupScanScopes", 1);\n');
    await writeFile(
      path.join(profile, 'extensions.json'),
      `${JSON.stringify({ addons: [{ id: SUBJECT_ID, version: '0.4.0a4' }] }, null, 2)}\n`,
    );
    const lsofRow = `zotero 50356 kuhn txt REG 1,17 ${info.size} ${info.ino} ${installedPath}`;
    const deps = makeDeps({
      lsof: (target) =>
        target.endsWith('.parentlock')
          ? `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nzotero 50356 kuhn txt REG 1,17 0 42 ${target}\n`
          : `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n${lsofRow}\n`,
    });

    const checked = ok(await run(['check', '--profile', profile], deps));
    expect(checked.ok).toBe(true);
    expect(checked.status).toBe('verified');
    expect(checked.checks.map((check) => [check.name, check.outcome])).toEqual([
      ['installed-file-matches-artifact-sha256', 'pass'],
      ['running-instance-holds-installed-xpi', 'pass'],
      ['reported-version-matches-artifact', 'pass'],
    ]);
    expect(checked.lever.state).toBe('relaxing');
    expect(await readFile(path.join(profile, 'user.js'), 'utf8')).toContain(
      'user_pref("extensions.startupScanScopes", 0);',
    );

    // Next launch/quit drops the key; the final revert removes the managed file.
    await writeFile(path.join(profile, 'prefs.js'), '');
    const reverted = ok(await run(['revert', '--profile', profile], makeDeps()));
    expect(reverted.lever.state).toBe('reverted');
    await expect(stat(path.join(profile, 'user.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deletes the managed lever immediately when prefs.js never took the value', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    await installInto(profile, artifactXpi);
    const installedPath = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
    const info = await stat(installedPath, { bigint: true });
    await writeFile(
      path.join(profile, 'extensions.json'),
      `${JSON.stringify({ addons: [{ id: SUBJECT_ID, version: '0.4.0a4' }] }, null, 2)}\n`,
    );
    const deps = makeDeps({
      lsof: (target) =>
        target.endsWith('.parentlock')
          ? `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nzotero 50356 kuhn txt REG 1,17 0 42 ${target}\n`
          : `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nzotero 50356 kuhn txt REG 1,17 ${info.size} ${info.ino} ${installedPath}\n`,
    });
    const checked = ok(await run(['check', '--profile', profile], deps));
    expect(checked.status).toBe('verified');
    expect(checked.lever.state).toBe('reverted');
    await expect(stat(path.join(profile, 'user.js'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails loudly when the profile is idle but the reported version is stale', async () => {
    const root = await makeTemporaryDirectory();
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    await installInto(profile, artifactXpi);
    await writeFile(
      path.join(profile, 'extensions.json'),
      `${JSON.stringify({ addons: [{ id: SUBJECT_ID, version: '0.4.0a3' }] }, null, 2)}\n`,
    );
    const checked = ok(await run(['check', '--profile', profile], makeDeps()));
    expect(checked.ok).toBe(false);
    expect(checked.status).toBe('failed');
    expect(checked.checks.find((check) => check.name === 'reported-version-matches-artifact')?.outcome).toBe('fail');
    expect(checked.instructions.join('\n')).toMatch(/Config Editor/u);
  });

  it('restores the newest backup and records the outgoing XPI', async () => {
    const root = await makeTemporaryDirectory();
    const previousXpi = await packageFixture(path.join(root, 'previous.xpi'), '0.4.0a3');
    const artifactXpi = await packageFixture(path.join(root, 'artifact.xpi'), '0.4.0a4');
    const profile = await makeProfile(root, 'profile', '');
    const installedPath = path.join(profile, 'extensions', `${SUBJECT_ID}.xpi`);
    await writeFile(installedPath, await readFile(previousXpi));
    const artifactSha = await sha256(artifactXpi);
    await installInto(profile, artifactXpi);

    const rolled = ok(await run(['rollback', '--profile', profile], makeDeps()));
    expect(rolled.ok).toBe(true);
    expect(rolled.artifactVersion).toBe('0.4.0a3');
    expect(await sha256(installedPath)).toBe(await sha256(previousXpi));
    expect(rolled.installedSha256).toBe(await sha256(previousXpi));

    const backups = (await readdir(path.join(profile, 'extensions'))).filter((name) => name.includes('.zcr-bak-'));
    expect(backups).toHaveLength(2);
    const outgoingBackup = backups.find((name) => name.endsWith('-0.4.0a4'));
    expect(outgoingBackup).toBeDefined();
    expect(await sha256(path.join(profile, 'extensions', outgoingBackup as string))).toBe(artifactSha);

    await expect(run(['rollback', '--profile', path.join(root, 'empty')])).rejects.toThrow(/Not a Zotero profile/u);
  });
});
