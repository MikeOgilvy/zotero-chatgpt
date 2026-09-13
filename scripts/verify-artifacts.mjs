import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const requiredLicenses = [
  'content/runtime/licenses/LICENSE',
  'content/runtime/licenses/NOTICE',
  'content/assets/licenses/katex.LICENSE',
  'content/assets/licenses/markdown-it.LICENSE',
  'content/assets/licenses/dompurify.LICENSE',
];
const requiredPanes = ['content/preferences/preferences.xhtml', 'content/preferences/pane.js'];
const requiredFiles = ['bootstrap.js', 'content/zcr.js', 'manifest.json', 'LICENSE', ...requiredLicenses, ...requiredPanes];
const forbiddenNames = ['auth.json', 'auth.json.enc', 'credentials.json', '.zcr-dev'];
const textSuffixes = ['.js', '.json', '.css', '.html', '.ftl', '.md', '.txt', '.toml'];

function requireNode24() {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`Node 24 is required; found ${process.versions.node}`);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(filePath, archivePath)));
    else if (entry.isFile()) files.push(archivePath);
  }
  return files;
}

function isTextArtifact(relativePath) {
  return textSuffixes.some(suffix => relativePath.endsWith(suffix));
}

function assertCleanNames(files) {
  for (const file of files) {
    const base = file.split('/').pop() ?? file;
    if (forbiddenNames.includes(base) || forbiddenNames.some(name => file.includes(`/${name}/`) || file.includes(`${name}/`))) {
      throw new Error(`Packaged artifact contains a forbidden file: ${file}`);
    }
    if (file.includes('.zcr-dev') || file.endsWith('.jsonl') || file.includes('/records/')) {
      throw new Error(`Packaged artifact contains a forbidden file: ${file}`);
    }
  }
}

function assertRequired(files) {
  for (const required of requiredFiles) {
    if (!files.includes(required)) throw new Error(`Missing required packaged file: ${required.includes('NOTICE') ? 'NOTICE' : required}`);
  }
}

function assertBundleText(relativePath, text) {
  if (relativePath !== 'content/zcr.js' && relativePath !== 'bootstrap.js') return;
  if (/['"]node:/.test(text)) throw new Error(`Production bundle ${relativePath} imports a node: builtin`);
  if (/\/Users\//.test(text)) throw new Error(`Production bundle ${relativePath} contains a /Users/ path`);
}

export async function verifyExtensionDirectory(sourceDirectory) {
  requireNode24();
  const files = (await listFiles(sourceDirectory)).sort();
  assertRequired(files);
  assertCleanNames(files);
  for (const file of files) {
    if (!isTextArtifact(file)) continue;
    const text = await readFile(path.join(sourceDirectory, file), 'utf8');
    assertBundleText(file, text);
  }
  return { ok: true, files };
}

async function readArchive(filePath) {
  const zipFile = await yauzl.openPromise(filePath);
  const entries = [];
  for await (const entry of zipFile.eachEntry()) {
    if (entry.fileName.endsWith('/')) continue;
    const chunks = [];
    const stream = await zipFile.openReadStreamPromise(entry);
    for await (const chunk of stream) chunks.push(chunk);
    entries.push({ name: entry.fileName, contents: Buffer.concat(chunks) });
  }
  return entries;
}

export async function verifySiblingChecksums(archivePath) {
  const sumsPath = path.join(path.dirname(archivePath), 'SHA256SUMS');
  let text;
  try {
    text = await readFile(sumsPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { checked: false };
    throw error;
  }
  const name = path.basename(archivePath);
  const line = text.split('\n').find(entry => entry.endsWith(`  ${name}`) || entry.endsWith(` *${name}`));
  if (!line) throw new Error(`SHA256SUMS does not list ${name}`);
  const expected = line.slice(0, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(expected)) throw new Error(`SHA256SUMS digest for ${name} is not SHA-256`);
  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (digest !== expected) throw new Error(`SHA256SUMS mismatch for ${name}`);
  return { checked: true, digest };
}

export async function verifyXpi(archivePath) {
  requireNode24();
  const checksums = await verifySiblingChecksums(archivePath);
  const entries = await readArchive(archivePath);
  const files = entries.map(entry => entry.name).sort();
  assertRequired(files);
  assertCleanNames(files);
  for (const entry of entries) {
    if (!isTextArtifact(entry.name)) continue;
    assertBundleText(entry.name, entry.contents.toString('utf8'));
  }
  return { ok: true, files, checksums };
}

async function main() {
  const source = readOption('--source');
  const xpi = readOption('--xpi');
  if (source) {
    const result = await verifyExtensionDirectory(source);
    console.log(`Verified extension directory (${result.files.length} files)`);
    return;
  }
  if (xpi) {
      const result = await verifyXpi(xpi);
      console.log(`Verified XPI (${result.files.length} files${result.checksums.checked ? `; SHA256SUMS ${result.checksums.digest}` : ''})`);
    return;
  }
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/zotero/manifest.json'), 'utf8'));
  const defaultXpi = path.join(repositoryRoot, `dist/zotero-codex-reader-${manifest.version}-dev.xpi`);
  const defaultSource = path.join(repositoryRoot, 'build/dev');
  try {
    if ((await stat(defaultXpi)).isFile()) {
      const result = await verifyXpi(defaultXpi);
      console.log(`Verified XPI (${result.files.length} files${result.checksums.checked ? `; SHA256SUMS ${result.checksums.digest}` : ''})`);
      return;
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }
  try {
    if ((await stat(defaultSource)).isDirectory()) {
      const result = await verifyExtensionDirectory(defaultSource);
      console.log(`Verified extension directory (${result.files.length} files)`);
      return;
    }
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }
  throw new Error('Pass --source <dir> or --xpi <file>; no build/dev or dist XPI found');
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
