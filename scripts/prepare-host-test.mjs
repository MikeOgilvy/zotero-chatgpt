import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { createFixturePdf } from '../tests/fixtures/create-pdf.mjs';

const root = resolve(import.meta.dirname, '..');
const dev = join(root, '.zcr-dev');
const profile = join(dev, 'profile');
const dataDir = join(dev, 'data');
const subjectID = '{8a5f5bde-b4e1-41eb-b5d9-2774afa0cf72}';
const subjectManifest = JSON.parse(await readFile(join(root, 'packages/zotero/manifest.json'), 'utf8'));
const subjectXpi = resolve(process.argv[2] ?? join(root, `dist/zotero-codex-reader-${subjectManifest.version}-dev.xpi`));
await stat(subjectXpi);
const processes = execFileSync('ps', ['-axo', 'args='], { encoding: 'utf8' });
if (processes.split('\n').some((line) => line.startsWith('/Applications/Zotero.app/Contents/MacOS/zotero ') && line.includes(` -profile ${profile}`))) {
  throw new Error('Close the dedicated Zotero test instance before preparing its profile.');
}
await mkdir(join(profile, 'extensions'), { recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(join(dev, 'fixtures'), { recursive: true });
await writeFile(join(dev, 'fixtures/reading.pdf'), createFixturePdf());
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
  'extensions.zotero.integration.port': 50011,
  'extensions.zoteroMacWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'app.update.enabled': false,
  'toolkit.telemetry.enabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'browser.shell.checkDefaultBrowser': false,
};
await writeFile(join(profile, 'user.js'), Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
await copyFile(subjectXpi, join(profile, 'extensions', `${subjectID}.xpi`));
const config = { subjectID, subjectVersion: subjectManifest.version, artifactHash: createHash('sha256').update(await readFile(subjectXpi)).digest('hex'), dataDir, reportPath: join(dev, 'host-report.json'), pdfPath: join(dev, 'fixtures/reading.pdf') };
const manifest = {
  manifest_version: 2,
  name: 'ZCR isolated host test driver',
  version: '0.0.1',
  applications: { zotero: { id: 'zcr-host-test@local', update_url: 'https://zcr-dev.invalid/driver-updates.json', strict_min_version: '9.0.6', strict_max_version: '9.0.*' } },
};
const bootstrap = `function startup(data) {
  Zotero.initializationPromise.then(async () => {
    const scope = { Zotero, ChromeUtils };
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
  ['driver.js', await readFile(join(root, 'tests/host/driver.js'))],
]) zip.addBuffer(Buffer.isBuffer(contents) ? contents : Buffer.from(contents), name);
const out = join(profile, 'extensions', 'zcr-host-test@local.xpi');
const written = pipeline(zip.outputStream, createWriteStream(out));
zip.end();
await written;
console.log(`Prepared isolated profile: ${profile}`);
console.log('Launch only this profile with -no-remote -profile and -datadir. The host test creates synthetic items only.');
