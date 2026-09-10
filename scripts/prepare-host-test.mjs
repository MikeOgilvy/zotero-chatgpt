import { copyFile, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { createFixturePdf } from '../tests/fixtures/create-pdf.mjs';
import { selectHostStage, selectHostTree } from './host-test-stage.mjs';
import { assertIsolatedRoot, assertNotRegularProfile, readXpiIdentity, requireLocalXpi } from './install-lifecycle.mjs';

const root = resolve(import.meta.dirname, '..');
const subjectID = '{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}';
const subjectManifest = JSON.parse(await readFile(join(root, 'packages/zotero/manifest.json'), 'utf8'));
const argumentsList = process.argv.slice(2);
const interactiveLogin = argumentsList.includes('--login');
const { driver: driverPath, installDriver } = selectHostStage(argumentsList);
const tree = selectHostTree(argumentsList, root);
const { profile, dataDir, reportPath, pdfPath } = tree;

function readRawOption(name) {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function positionalXpi() {
  const flagsWithValue = new Set(['--upgrade-xpi', '--rollback-xpi']);
  const skip = new Set();
  const found = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (skip.has(index)) continue;
    const value = argumentsList[index];
    if (flagsWithValue.has(value)) {
      skip.add(index + 1);
      continue;
    }
    if (value.startsWith('--')) continue;
    found.push(value);
  }
  return found[0];
}

const upgradeRaw = readRawOption('--upgrade-xpi');
const rollbackRaw = readRawOption('--rollback-xpi');
if (Boolean(upgradeRaw) !== Boolean(rollbackRaw)) {
  throw new Error('Pass both --upgrade-xpi and --rollback-xpi for two-version S6, or neither');
}
const twoVersion = Boolean(upgradeRaw);
if (twoVersion && tree.stage !== 's6') {
  throw new Error('--upgrade-xpi is only valid with --s6');
}

if (tree.stage === 's6') {
  assertIsolatedRoot(profile);
  assertIsolatedRoot(dataDir);
} else {
  assertNotRegularProfile(profile);
  assertNotRegularProfile(dataDir);
}

let subjectXpi;
let upgradeXpi;
let rollbackXpi;
let upgradeIdentity;
let rollbackIdentity;
if (twoVersion) {
  upgradeXpi = requireLocalXpi(upgradeRaw);
  rollbackXpi = requireLocalXpi(rollbackRaw);
  await stat(upgradeXpi);
  await stat(rollbackXpi);
  upgradeIdentity = await readXpiIdentity(upgradeXpi);
  rollbackIdentity = await readXpiIdentity(rollbackXpi);
  if (upgradeIdentity.version === rollbackIdentity.version) {
    throw new Error('Upgrade and rollback XPIs must have different versions');
  }
  subjectXpi = rollbackXpi;
} else {
  subjectXpi = resolve(positionalXpi() ?? join(root, `dist/zotero-codex-reader-${subjectManifest.version}-dev.xpi`));
  await stat(subjectXpi);
}

const processes = execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' });
if (processes.split('\n').some((line) => line.startsWith('/Applications/Zotero.app/Contents/MacOS/zotero ') && line.includes(` -profile ${profile}`))) {
  throw new Error('Close the dedicated Zotero test instance before preparing its profile.');
}
await mkdir(join(profile, 'extensions'), { recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(join(pdfPath, '..'), { recursive: true });
await writeFile(pdfPath, createFixturePdf());
const prefs = {
  'extensions.zotero.useDataDir': true,
  'extensions.zotero.dataDir': dataDir,
  'extensions.zotero.firstRun2': false,
  'extensions.zotero.sync.autoSync': false,
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.startupScanScopes': 1,
  'extensions.update.enabled': false,
  'extensions.zotero.httpServer.enabled': false,
  'extensions.zotero.integration.port': tree.stage === 's6' ? (twoVersion ? 50013 : 50012) : 50011,
  'extensions.zoteroMacWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'app.update.enabled': false,
  'toolkit.telemetry.enabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.sessionstore.resume_from_crash': false,
};
await writeFile(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
await copyFile(subjectXpi, join(profile, 'extensions', `${subjectID}.xpi`));
const upgradeInProfile = twoVersion ? join(profile, 'zcr-upgrade.xpi') : undefined;
const rollbackInProfile = twoVersion ? join(profile, 'zcr-rollback.xpi') : undefined;
if (twoVersion) {
  await copyFile(upgradeXpi, upgradeInProfile);
  await copyFile(rollbackXpi, rollbackInProfile);
}
const config = {
  interactiveLogin,
  subjectID,
  subjectVersion: twoVersion ? rollbackIdentity.version : subjectManifest.version,
  artifactHash: createHash('sha256').update(await readFile(subjectXpi)).digest('hex'),
  dataDir,
  profile,
  xpiPath: subjectXpi,
  installedXpi: join(profile, 'extensions', `${subjectID}.xpi`),
  reportPath,
  pdfPath,
  ...(twoVersion ? {
    upgradeXpi: upgradeInProfile,
    rollbackXpi: rollbackInProfile,
    upgradeVersion: upgradeIdentity.version,
    rollbackVersion: rollbackIdentity.version,
  } : {}),
};
const driverOut = join(profile, 'extensions', 'zcr-host-test@local.xpi');
if (installDriver) {
  if (!driverPath) throw new Error('Host stage is missing its driver');
  const manifest = {
    manifest_version: 2,
    name: 'ZCR isolated host test driver',
    version: '0.0.1',
    applications: { zotero: { id: 'zcr-host-test@local', update_url: 'https://zcr-dev.invalid/driver-updates.json', strict_min_version: '9.0.6', strict_max_version: '9.0.*' } },
  };
  const bootstrap = `function startup(data) {
  Zotero.initializationPromise.then(async () => {
    const scope = { Zotero, ChromeUtils, PathUtils, IOUtils, TextDecoder, Cu: Components.utils };
    Services.scriptloader.loadSubScript(data.rootURI + "driver.js", scope);
    await scope.runHostSmoke(${JSON.stringify(config)});
  }).catch(error => Zotero.logError(error));
}
function shutdown() {}
function install() {}
function uninstall() {}
`;
  const zip = new ZipFile();
  for (const [name, contents] of [
    ['manifest.json', JSON.stringify(manifest)],
    ['bootstrap.js', bootstrap],
    ['driver.js', await readFile(join(root, driverPath))],
  ]) zip.addBuffer(Buffer.isBuffer(contents) ? contents : Buffer.from(contents), name);
  const written = pipeline(zip.outputStream, createWriteStream(driverOut));
  zip.end();
  await written;
  console.log(`Prepared isolated profile: ${profile}`);
  console.log('Launch only this profile with -no-remote -profile and -datadir. The host test creates synthetic items only.');
} else {
  await rm(driverOut, { force: true });
  console.log(`Prepared human-acceptance profile: ${profile}`);
  console.log('No host-test driver is installed. Launch only this profile with -no-remote -profile and -datadir.');
}
