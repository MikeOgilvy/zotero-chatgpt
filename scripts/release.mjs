import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUBJECT_ID = '{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}';
const repositoryRoot = path.resolve(import.meta.dirname, '..');

function requireNode24() {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`Node 24 is required; found ${process.versions.node}`);
  }
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return path.resolve(value);
}

export async function buildReleasePlan() {
  requireNode24();
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'packages/zotero/manifest.json'), 'utf8'));
  const npmPackage = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const xpiName = `zotero-codex-reader-${manifest.version}-dev.xpi`;
  const xpiPath = path.join(repositoryRoot, 'dist', xpiName);
  let sha256 = null;
  try {
    sha256 = createHash('sha256').update(await readFile(xpiPath)).digest('hex');
    await stat(xpiPath);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  return {
    ok: true,
    dryRun: true,
    published: false,
    githubRelease: null,
    githubOwner: null,
    repository: 'zotero-codex-reader',
    tag: `v${manifest.version}-dev`,
    npmVersion: npmPackage.version,
    addonId: SUBJECT_ID,
    addonVersion: manifest.version,
    xpi: sha256 ? xpiName : null,
    sha256,
    updateChannel: 'none',
    notes: 'docs/release.md',
    publishCommand: null,
  };
}

async function main() {
  requireNode24();
  if (hasFlag('--publish') || hasFlag('--gh-release') || hasFlag('--upload')) {
    throw new Error('GitHub Release is not authorized; pass --dry-run');
  }
  const plan = await buildReleasePlan();
  const output = readOption('--out');
  if (output) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
  }
  if (hasFlag('--json')) process.stdout.write(`${JSON.stringify(plan)}\n`);
  else {
    console.log(`Dry-run release plan for ${plan.tag} (not published)`);
    if (plan.sha256) console.log(`Local XPI SHA-256 ${plan.sha256}`);
    else console.log('No dist XPI present; plan records null checksum');
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
