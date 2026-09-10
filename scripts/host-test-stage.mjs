/** Exclusive dedicated-profile host stages. Product XPI contents are unchanged by this mapping. */
import { join } from 'node:path';

export const HOST_DRIVERS = {
  s1: 'tests/host/driver.js',
  s2: 'tests/host/s2-driver.js',
  s3: 'tests/host/s3-driver.js',
  s4: 'tests/host/s4-driver.js',
  s5: 'tests/host/s5-driver.js',
  s6: 'tests/host/s6-driver.js',
};

const EXCLUSIVE = ['s2', 's3', 's4', 's5', 's6'];

/**
 * @param {string[]} argv
 * @returns {{ stage: string, driver: string | null, installDriver: boolean }}
 */
export function selectHostStage(argv) {
  const acceptance = argv.includes('--acceptance');
  const selected = EXCLUSIVE.filter(name => argv.includes(`--${name}`));
  if (acceptance && (selected.length > 0 || argv.includes('--login'))) {
    throw new Error('Pass --acceptance without --s2, --s3, --s4, --s5, --s6, or --login');
  }
  if (selected.length > 1) throw new Error('Pass only one of --s2, --s3, --s4, --s5, --s6');
  if (acceptance) return { stage: 'acceptance', driver: null, installDriver: false };
  const stage = selected[0] ?? 's1';
  return { stage, driver: HOST_DRIVERS[stage], installDriver: true };
}

/**
 * S6 uses a virgin tree so the signed-in `.zcr-dev/profile` is never overwritten.
 * @param {string[]} argv
 * @param {string} repositoryRoot
 */
export function selectHostTree(argv, repositoryRoot) {
  const { stage } = selectHostStage(argv);
  const dev = join(repositoryRoot, '.zcr-dev');
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
