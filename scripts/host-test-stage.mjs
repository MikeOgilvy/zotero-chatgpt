/** Exclusive dedicated-profile host stages. Product XPI contents are unchanged by this mapping. */
import { join } from 'node:path';

export const HOST_DRIVERS = {
  s5: 'tests/host/s5-driver.js',
  s6: 'tests/host/s6-driver.js',
  context: 'tests/host/context-driver.js',
  // Embedded ChatGPT web surface: loads chatgpt.com in a Zotero browser surface and measures what the
  // host actually does. It never types, clicks a login control, or reads credentials.
  embed: 'tests/host/embed-driver.js',
  // Human-gated: the operator completes exactly one official login and the driver sends no model request.
  'live-model': 'tests/host/live-model-driver.js',
};

const EXCLUSIVE = ['s5', 's6', 'context', 'embed', 'live-model'];

/**
 * @param {string[]} argv
 * @returns {{ stage: string, driver: string | null, installDriver: boolean }}
 */
export function selectHostStage(argv) {
  const acceptance = argv.includes('--acceptance');
  const selected = EXCLUSIVE.filter(name => argv.includes(`--${name}`));
  if (argv.includes('--native') && (acceptance || argv.includes('--live') || selected.length !== 1 || selected[0] !== 'context')) throw new Error('--native requires only the dedicated --context driver');
  if (argv.includes('--live') && (acceptance || selected.length !== 1 || selected[0] !== 'context')) throw new Error('--live requires only the dedicated --context driver');
  const manualContext = acceptance && selected.length === 1 && selected[0] === 'context';
  if (acceptance && selected.length > 0 && !manualContext) throw new Error('Pass --acceptance without --s5 or --s6');
  if (selected.length > 1) throw new Error('Pass only one of --context, --embed, --live-model, --s5, --s6');
  if (acceptance) return { stage: manualContext ? 'context' : 'acceptance', driver: null, installDriver: false };
  // No implicit default: preparing a profile rewrites its extensions, so the stage must be named.
  if (selected.length === 0) throw new Error('Pass one of --context, --embed, --live-model, --s5, --s6, or --acceptance');
  const stage = selected[0];
  return { stage, driver: argv.includes('--native') ? 'tests/host/native-action-driver.ts' : HOST_DRIVERS[stage], installDriver: true };
}

/**
 * S6 uses a virgin tree so the signed-in `.zotero-chatgpt-dev/profile` is never overwritten.
 * @param {string[]} argv
 * @param {string} repositoryRoot
 */
export function selectHostTree(argv, repositoryRoot) {
  const { stage } = selectHostStage(argv);
  const dev = join(repositoryRoot, '.zotero-chatgpt-dev');
  if (stage === 'context') return { stage, profile: join(dev, 'context/profile'), dataDir: join(dev, 'context/data'), reportPath: join(dev, 'context/host-report.json'), pdfPath: join(dev, 'context/fixtures/reading.pdf') };
  // Browser-surface embedding experiment, isolated in its own `.zotero-chatgpt-dev/embed` tree so a
  // ChatGPT session created there is never confused with the product acceptance profile.
  if (stage === 'embed') return { stage, profile: join(dev, 'embed/profile'), dataDir: join(dev, 'embed/data'), reportPath: join(dev, 'embed/host-report.json'), pdfPath: join(dev, 'embed/fixtures/reading.pdf') };
  // Human-gated model-catalog measurement, isolated in its own `.zotero-chatgpt-dev/live` tree.
  if (stage === 'live-model') return { stage, profile: join(dev, 'live/profile'), dataDir: join(dev, 'live/data'), reportPath: join(dev, 'live/host-report.json'), pdfPath: join(dev, 'live/fixtures/reading.pdf') };
  if (stage === 's6') {
    const twoVersion = argv.includes('--upgrade-xpi') && argv.includes('--rollback-xpi');
    const root = join(dev, twoVersion ? 's6-upgrade' : 's6-virgin');
    return {
      stage,
      profile: join(root, 'profile'),
      dataDir: join(root, 'data'),
      reportPath: join(root, 'host-report.json'),
      pdfPath: join(root, 'fixtures', 'reading.pdf'),
    };
  }
  return {
    stage,
    profile: join(dev, 'profile'),
    dataDir: join(dev, 'data'),
    reportPath: join(dev, 'host-report.json'),
    pdfPath: join(dev, 'fixtures', 'reading.pdf'),
  };
}
