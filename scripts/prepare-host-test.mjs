import { copyFile, lstat, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { ZipFile } from 'yazl';
import { build } from 'esbuild';
import { createFixturePdf } from '../tests/fixtures/create-pdf.mjs';
import { selectHostStage, selectHostTree } from './host-test-stage.mjs';
import { assertIsolatedRoot, assertNotRegularProfile, readXpiIdentity, requireLocalXpi } from './install-lifecycle.mjs';

const root = resolve(import.meta.dirname, '..');
const subjectID = '{90909501-7b5b-4985-9f55-566e9890746c}';
const subjectManifest = JSON.parse(await readFile(join(root, 'packages/zotero/manifest.json'), 'utf8'));
const argumentsList = process.argv.slice(2);
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
  const flagsWithValue = new Set(['--upgrade-xpi', '--rollback-xpi', '--url', '--probe-timeout-ms', '--watch-seconds', '--run-id', '--login-wait-seconds']);
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

async function reserveExclusiveRoot(exclusiveRoot) {
  const devRoot = join(root, '.zotero-chatgpt-dev');
  const runsRoot = join(devRoot, 'context-runs');
  if (dirname(resolve(exclusiveRoot)) !== resolve(runsRoot)) throw new Error('Refusing an unbounded --run-id target');
  await mkdir(devRoot, { recursive: true });
  const devInfo = await lstat(devRoot);
  if (!devInfo.isDirectory() || devInfo.isSymbolicLink()) throw new Error('Refusing a symbolic development root');
  await mkdir(runsRoot, { recursive: true });
  const runsInfo = await lstat(runsRoot);
  if (!runsInfo.isDirectory() || runsInfo.isSymbolicLink()) throw new Error('Refusing a symbolic context-runs root');
  try {
    await mkdir(exclusiveRoot);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error(`Context run ${exclusiveRoot} already exists; choose a new --run-id`, { cause: error });
    }
    throw error;
  }
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
  subjectXpi = resolve(positionalXpi() ?? join(root, `dist/zotero-chatgpt-${subjectManifest.version}-dev.xpi`));
  await stat(subjectXpi);
}

const processes = execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' });
if (processes.split('\n').some((line) => line.startsWith('/Applications/Zotero.app/Contents/MacOS/zotero ') && line.includes(` -profile ${profile}`))) {
  throw new Error('Close the dedicated Zotero test instance before preparing its profile.');
}
if (tree.exclusiveRoot) await reserveExclusiveRoot(tree.exclusiveRoot);
await mkdir(join(profile, 'extensions'), { recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(join(pdfPath, '..'), { recursive: true });
const verificationToken = `RUN-${randomBytes(12).toString('hex')}`;
await writeFile(pdfPath, createFixturePdf('ZCHATGPT synthetic reading fixture', verificationToken));
// Runtime records and account state have their own lifetime. Preparing a host driver must never
// clear them, even in the dedicated context profile. A separate, verified-new tree is required for
// checks whose precondition is that no runtime has been prepared yet.
const liveRun = argumentsList.includes('--live');
const cleanRuntimeTree = tree.cleanRuntimeTree === true;
const supplementPdfPath = tree.stage === 'context' ? join(pdfPath, '..', 'supplement.pdf') : undefined;
if (supplementPdfPath) await writeFile(supplementPdfPath, createFixturePdf('ZCHATGPT synthetic supplement fixture', 'BAMBOO-19'));
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
  'extensions.zotero.integration.port': tree.stage === 'context' ? 50014 : tree.stage === 'embed' ? 50015 : tree.stage === 's6' ? (twoVersion ? 50013 : 50012) : 50011,
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
const upgradeInProfile = twoVersion ? join(profile, 'zchatgpt-upgrade.xpi') : undefined;
const rollbackInProfile = twoVersion ? join(profile, 'zchatgpt-rollback.xpi') : undefined;
if (twoVersion) {
  await copyFile(upgradeXpi, upgradeInProfile);
  await copyFile(rollbackXpi, rollbackInProfile);
}
const config = {
  live: liveRun,
  liveCoreFlows: argumentsList.includes('--live-core-flows'),
  loginWaitSeconds: Number(readRawOption('--login-wait-seconds') ?? 0),
  // True only for an atomically reserved --run-id tree that did not exist before this preparation.
  cleanRuntimeTree,
  verificationToken,
  subjectID,
  subjectVersion: twoVersion ? rollbackIdentity.version : subjectManifest.version,
  artifactHash: createHash('sha256').update(await readFile(subjectXpi)).digest('hex'),
  dataDir,
  profile,
  xpiPath: subjectXpi,
  // The live-model driver reports the measured XPI by name; without this the report's
  // `build.xpiName` would stay permanently blank even though the artifact was identified.
  xpiName: basename(subjectXpi),
  installedXpi: join(profile, 'extensions', `${subjectID}.xpi`),
  reportPath,
  pdfPath,
  // The embed probe defaults to the real chatgpt.com; `--url` exists so the same probe can be pointed
  // at a local fixture to separate "our surface is broken" from "the remote site refused us".
  ...(tree.stage === 'embed' ? {
    url: readRawOption('--url'),
    ...(readRawOption('--probe-timeout-ms') ? { probeTimeoutMs: Number(readRawOption('--probe-timeout-ms')) } : {}),
    // Off by default: the comparison probes read remote documents from privileged code and one of
    // them ends this host build's process, so the product evidence is what a default run measures.
    surfaceProbes: argumentsList.includes('--surface-probes'),
    // Opt-in too: the capability probe loads the loopback fixture in the product's exact surface
    // shape, parked and painted, and reports what the page could do in each. `--url` names the page.
    capabilityProbe: argumentsList.includes('--capability-probe'),
    // Off by default too: with a watch window the run stays alive so a human can use the hosted
    // application while the driver observes network activity, console output and new-window requests.
    ...(readRawOption('--watch-seconds') ? { watchSeconds: Number(readRawOption('--watch-seconds')) } : {}),
  } : {}),
  ...(supplementPdfPath ? { supplementPdfPath } : {}),
  ...(twoVersion ? {
    upgradeXpi: upgradeInProfile,
    rollbackXpi: rollbackInProfile,
    upgradeVersion: upgradeIdentity.version,
    rollbackVersion: rollbackIdentity.version,
  } : {}),
};
const driverOut = join(profile, 'extensions', 'zchatgpt-host-test@local.xpi');
if (installDriver) {
  if (!driverPath) throw new Error('Host stage is missing its driver');
  const compiled = driverPath.endsWith('.ts') ? await build({ entryPoints: [join(root, driverPath)], bundle: true, format: 'iife', globalName: 'ZchatgptHostDriver', write: false, target: 'firefox140', platform: 'browser' }) : null;
  const driverContents = compiled ? compiled.outputFiles[0].text + '\nvar runHostSmoke = ZchatgptHostDriver.runHostSmoke;\n' : await readFile(join(root, driverPath));
  const driverSourceHash = createHash('sha256').update(driverContents).digest('hex');
  config.driverSourceHash = driverSourceHash;
  const driverVersion = `0.0.${(Number.parseInt(driverSourceHash.slice(0, 8), 16) % 2147483646) + 1}`;
  const manifest = {
    manifest_version: 2,
    name: 'ZCHATGPT isolated host test driver',
    version: driverVersion,
    applications: { zotero: { id: 'zchatgpt-host-test@local', update_url: 'https://zotero-chatgpt-dev.invalid/driver-updates.json', strict_min_version: '9.0.6', strict_max_version: '9.0.*' } },
  };
  const bootstrap = `function startup(data) {
  Zotero.initializationPromise.then(async () => {
    Components.utils.importGlobalProperties(['AbortController', 'atob', 'btoa']);
    const scope = { Zotero, ChromeUtils, PathUtils, IOUtils, Services, TextDecoder, TextEncoder, crypto, URL, fetch, AbortController, atob, btoa, setTimeout, clearTimeout, Cu: Components.utils, Cc: Components.classes, Ci: Components.interfaces };
    Services.scriptloader.loadSubScriptWithOptions(data.rootURI + "driver.js", { target: scope, ignoreCache: true });
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
    ['driver.js', driverContents],
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
