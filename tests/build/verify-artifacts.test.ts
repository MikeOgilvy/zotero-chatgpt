import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];
let builtExtension = '';

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'zcr-verify-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function verify(source: string) {
  return execFileAsync(process.execPath, ['scripts/verify-artifacts.mjs', '--source', source], { cwd: repositoryRoot });
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error && typeof error.stderr === 'string') return error.stderr;
  if (error instanceof Error) return error.message;
  return String(error);
}

beforeAll(async () => {
  builtExtension = await makeTemporaryDirectory();
  await execFileAsync(process.execPath, ['tests/runtime/package-fixture.mjs', 'build', '--outdir', builtExtension], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

afterEach(async () => {
  const extras = temporaryDirectories.splice(1);
  await Promise.all(extras.map(directory => rm(directory, { force: true, recursive: true })));
});

describe('shareable artifact verification', () => {
  it('accepts a fixture development package with licenses and no node builtins', async () => {
    const { stdout } = await verify(builtExtension);
    expect(stdout).toMatch(/Verified extension directory/);
  });

  it('rejects a production bundle that imports node builtins', async () => {
    const copy = path.join(await makeTemporaryDirectory(), 'pkg');
    await cp(builtExtension, copy, { recursive: true });
    const bundle = path.join(copy, 'content/zcr.js');
    await writeFile(bundle, `${await readFile(bundle, 'utf8')}\nimport "node:fs";\n`);
    await expect(verify(copy)).rejects.toSatisfy((error: unknown) => /node:/i.test(failureMessage(error)));
  });

  it('rejects packaged auth files, development profiles and username paths', async () => {
    const copy = path.join(await makeTemporaryDirectory(), 'pkg');
    await cp(builtExtension, copy, { recursive: true });
    await mkdir(path.join(copy, 'content/account'), { recursive: true });
    await writeFile(path.join(copy, 'content/account/auth.json'), '{"token":"secret"}');
    await expect(verify(copy)).rejects.toSatisfy((error: unknown) => /auth\.json/i.test(failureMessage(error)));

    await rm(path.join(copy, 'content/account/auth.json'));
    const bundle = path.join(copy, 'content/zcr.js');
    await writeFile(bundle, `${await readFile(bundle, 'utf8')}\nconst home = "/Users/secret-user/Library";\n`);
    await expect(verify(copy)).rejects.toSatisfy((error: unknown) => /\/Users\//.test(failureMessage(error)));
  });

  it('rejects a package missing the Codex NOTICE', async () => {
    const copy = path.join(await makeTemporaryDirectory(), 'pkg');
    await cp(builtExtension, copy, { recursive: true });
    await rm(path.join(copy, 'content/runtime/licenses/NOTICE'));
    await expect(verify(copy)).rejects.toSatisfy((error: unknown) => /NOTICE/.test(failureMessage(error)));
  });
});

describe('sibling SHA256SUMS for packaged XPI', () => {
  async function writeArchive(name: string, contents: string): Promise<string> {
    const directory = await makeTemporaryDirectory();
    const archivePath = path.join(directory, name);
    await writeFile(archivePath, contents);
    return archivePath;
  }

  async function checksums(archivePath: string): Promise<{ checked: boolean; digest?: string }> {
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      `import { verifySiblingChecksums } from ${JSON.stringify(pathToFileURL(path.join(repositoryRoot, 'scripts/verify-artifacts.mjs')).href)};
       const result = await verifySiblingChecksums(${JSON.stringify(archivePath)});
       console.log(JSON.stringify(result));`,
    ], { cwd: repositoryRoot });
    return JSON.parse(stdout) as { checked: boolean; digest?: string };
  }

  it('accepts a matching sibling checksum file', async () => {
    const archivePath = await writeArchive('zotero-codex-reader-0.3.0a1-dev.xpi', 'packaged-bytes');
    const digest = createHash('sha256').update('packaged-bytes').digest('hex');
    await writeFile(path.join(path.dirname(archivePath), 'SHA256SUMS'), `${digest}  zotero-codex-reader-0.3.0a1-dev.xpi\n`);
    await expect(checksums(archivePath)).resolves.toEqual({ checked: true, digest });
  });

  it('rejects a mismatched sibling checksum', async () => {
    const archivePath = await writeArchive('zotero-codex-reader-0.3.0a1-dev.xpi', 'packaged-bytes');
    await writeFile(path.join(path.dirname(archivePath), 'SHA256SUMS'), `${'0'.repeat(64)}  zotero-codex-reader-0.3.0a1-dev.xpi\n`);
    await expect(checksums(archivePath)).rejects.toSatisfy((error: unknown) => /SHA256SUMS mismatch/.test(failureMessage(error)));
  });

  it('skips the check when SHA256SUMS is absent', async () => {
    const archivePath = await writeArchive('plugin.xpi', 'packaged-bytes');
    await expect(checksums(archivePath)).resolves.toEqual({ checked: false });
  });
});
