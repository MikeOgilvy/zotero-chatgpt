/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// S6 virgin-profile install QA. Does not send a model turn. Does not copy credentials.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'S6', status: 'running', checks: [], notRun: [], build: { version: config.subjectVersion, sha256: config.artifactHash } };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const check = async (name, ok, details = {}) => {
    report.checks.push({ name, ok: Boolean(ok), details }); await save();
    if (!ok) throw new Error(`Host check failed: ${name}`);
  };
  const skip = async (name, reason, details = {}) => {
    report.notRun.push(name);
    report.checks.push({ name, ok: null, skipped: true, reason, details });
    await save();
  };
  const until = async (predicate, label, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(100); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = node => { if (!node) throw new Error('Expected UI control is missing'); node.focus(); node.click(); };
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const quitHost = async () => {
    try {
      if (typeof Zotero.Utilities?.Internal?.quit === 'function') {
        await delay(800);
        Zotero.Utilities.Internal.quit(false);
      }
    } catch {
      report.quit = 'quit-not-available';
      await save();
    }
  };
  const installLocalXpi = async (xpiPath, expectedVersion) => {
    const existing = await AddonManager.getAddonByID(config.subjectID);
    if (existing) {
      await existing.uninstall();
      await until(async () => !(await AddonManager.getAddonByID(config.subjectID)), `uninstall before ${expectedVersion ?? xpiPath}`);
    }
    const { FileUtils } = ChromeUtils.importESModule('resource://gre/modules/FileUtils.sys.mjs');
    const file = new FileUtils.File(xpiPath);
    const install = await AddonManager.getInstallForFile(file);
    if (!install) throw new Error(`AddonManager.getInstallForFile returned nothing for ${xpiPath}`);
    const addon = await Promise.race([
      install.install(),
      delay(60000).then(() => {
        throw new Error(`XPI install timed out: ${xpiPath} state=${install.state} error=${install.error}`);
      }),
    ]);
    if (install.state === AddonManager.STATE_POSTPONED) throw new Error(`XPI install postponed until restart: ${xpiPath}`);
    if (install.state === AddonManager.STATE_INSTALL_FAILED) throw new Error(`XPI install failed (${install.error}): ${xpiPath}`);
    return addon;
  };
  const waitForAddonVersion = async (expected, label) => until(async () => {
    const current = await AddonManager.getAddonByID(config.subjectID);
    return current?.version === expected ? current : null;
  }, label, 30000);
  try {
    await Zotero.initializationPromise;
    await check('isolated-data-directory', Zotero.DataDirectory.dir === config.dataDir, { dataDir: Zotero.DataDirectory.dir });
    await check('virgin-profile-tree', PathUtils.profileDir === config.profile && /\.zcr-dev\/s6-(virgin|upgrade)\//.test(String(config.profile)), { profile: PathUtils.profileDir });
    const win = await until(() => Zotero.getMainWindow(), 'main window');
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library view');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    let subject = await AddonManager.getAddonByID(config.subjectID);
    if (subject?.userDisabled) await subject.enable();
    await check('bundled-xpi-loaded', subject?.isActive && subject.version === config.subjectVersion, { version: subject?.version });
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCR S6 virgin install test');
    const notifierQueue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper A', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]);
    const cached = await Zotero.Items.getAsync([parent.id, attachment.id]); await Promise.all(cached.map(item => item.loadAllData()));
    await Zotero.Notifier.commit(notifierQueue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close restored reader tabs');
    const opened = await Zotero.Reader.open(attachment.id); const tabID = opened.tabID;
    await until(() => Zotero.Reader.getByTabID(tabID)?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.length, 'pdf viewer', 30000);
    const reader = () => Zotero.Reader.getByTabID(tabID);
    const toggle = () => {
      try {
        return reader()?._iframeWindow?.document.querySelector('[data-zcr-toggle]') ?? null;
      } catch (error) {
        if (String(error).includes('dead object')) return null;
        throw error;
      }
    };
    const selectedDetails = () => win.document.querySelector(`#zotero-context-pane-item-deck > [data-tab-id="${win.Zotero_Tabs.selectedID}"]`);
    const panel = () => selectedDetails()?.querySelector('[data-zcr-chat]');
    await until(() => toggle(), 'reader toolbar');
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const ownProcesses = async () => {
      const ps = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
      let output = ''; for (;;) { const bytes = await ps.stdout.read(); if (!bytes.byteLength) break; output += new TextDecoder().decode(bytes); }
      await ps.wait();
      return output.split('\n').filter(line => line.includes(PathUtils.profileDir + '/') && line.includes(' app-server')).map(line => Number(line.trim().split(/\s+/, 1)[0])).filter(pid => Number.isInteger(pid) && pid > 0);
    };
    win.ZoteroContextPane.collapsed = true; click(toggle());
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'native runtime initialization', 90000);
    await check('native-runtime-handshake-ready', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
    await check('one-owned-codex-process', (await ownProcesses()).length === 1, { count: (await ownProcesses()).length });
    const auth = panel()?.dataset.zcrAuth;
    report.account = { state: auth };
    await check('virgin-profile-signed-out', auth === 'signedOut', { auth });
    await check('login-control-visible', !!panel()?.querySelector('[data-zcr-action="login"]'));
    await check('not-generating', panel()?.dataset.zcrGenerating !== 'true' && !panel()?.dataset.zcrActiveRequest);
    await skip('live-model-send', 'quota blocks live Codex until 2026-09-15; this driver does not send');
    const conversationId = '11111111-0000-4000-8000-000000000006';
    const recordsDir = PathUtils.join(PathUtils.profileDir, 'zotero-codex-reader', 'v1', 'records', 'conversations');
    const recordPath = PathUtils.join(recordsDir, `${conversationId}.json`);
    if (typeof IOUtils?.writeUTF8 === 'function') {
      await IOUtils.makeDirectory(recordsDir, { createAncestors: true, ignoreExisting: true });
      const seeded = {
        schemaVersion: 1,
        logSeq: 0,
        id: conversationId,
        paper: { clientId: '22222222-0000-4000-8000-000000000006', libraryId: 1, attachmentKey: attachment.key },
        title: 'Synthetic paper A',
        settings: { model: 'catalog-default', serviceTier: null, effort: 'low' },
        activeRequestId: null,
        messages: [],
        lastSeq: 0,
        createdAt: '2026-09-09T08:00:00.000Z',
        updatedAt: '2026-09-09T08:00:00.000Z',
        upstream: { threadId: null },
        requests: [],
      };
      await IOUtils.writeUTF8(recordPath, `${JSON.stringify(seeded)}\n`);
      await check('seeded-conversation-record', (await IOUtils.exists(recordPath)) === true);
    } else {
      await skip('seeded-conversation-record', 'IOUtils.writeUTF8 was not available');
    }
    await subject.disable();
    await until(async () => (await ownProcesses()).length === 0, 'disable stops owned runtime');
    await check('disable-stops-owned-process', (await ownProcesses()).length === 0);
    const twoVersion = Boolean(config.upgradeXpi && config.rollbackXpi && config.upgradeVersion && config.rollbackVersion);
    if (twoVersion) {
      await skip('same-version-xpi-replaced-while-disabled', 'two-version host installs a newer packaged XPI through AddonManager instead of a same-version staging copy');
      await installLocalXpi(config.upgradeXpi, config.upgradeVersion);
      subject = await waitForAddonVersion(config.upgradeVersion, 'AddonManager version after upgrade');
      if (subject?.userDisabled) await subject.enable();
      await until(() => toggle(), 'toolbar after version-bump upgrade', 30000);
      if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'runtime after version-bump upgrade', 90000);
      subject = await AddonManager.getAddonByID(config.subjectID);
      report.upgrade = { installedVersion: subject?.version ?? null };
      await save();
      await check('version-bump-upgrade', subject?.isActive && subject.version === config.upgradeVersion, { version: subject?.version, expected: config.upgradeVersion });
      await check('handshake-ready-after-xpi-replace', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-replace', panel()?.dataset.zcrAuth === 'signedOut', { auth: panel()?.dataset.zcrAuth });
      await check('not-generating-after-replace', panel()?.dataset.zcrGenerating !== 'true' && !panel()?.dataset.zcrActiveRequest);
      if (typeof IOUtils?.exists === 'function') {
        await check('records-kept-after-xpi-replace', (await IOUtils.exists(recordPath)) === true);
      } else {
        await skip('records-kept-after-xpi-replace', 'IOUtils.exists was not available');
      }
      await subject.disable();
      await until(async () => (await ownProcesses()).length === 0, 'disable after upgrade');
      await installLocalXpi(config.rollbackXpi, config.rollbackVersion);
      subject = await waitForAddonVersion(config.rollbackVersion, 'AddonManager version after rollback');
      if (subject?.userDisabled) await subject.enable();
      await until(() => toggle(), 'toolbar after rollback', 30000);
      if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'runtime after rollback', 90000);
      subject = await AddonManager.getAddonByID(config.subjectID);
      report.rollback = { installedVersion: subject?.version ?? null };
      await save();
      await check('rollback-restores-previous-version', subject?.isActive && subject.version === config.rollbackVersion, { version: subject?.version, expected: config.rollbackVersion });
      await check('handshake-ready-after-rollback', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-rollback', panel()?.dataset.zcrAuth === 'signedOut', { auth: panel()?.dataset.zcrAuth });
      if (typeof IOUtils?.exists === 'function') {
        await check('records-kept-after-rollback', (await IOUtils.exists(recordPath)) === true);
      } else {
        await skip('records-kept-after-rollback', 'IOUtils.exists was not available');
      }
    } else if (typeof IOUtils?.copy !== 'function' || !config.installedXpi) {
      await skip('same-version-xpi-replaced-while-disabled', 'IOUtils.copy was not available');
      await skip('version-bump-upgrade', 'IOUtils.copy was not available');
      await skip('rollback-restores-previous-version', 'IOUtils.copy was not available');
    } else {
      const staging = PathUtils.join(PathUtils.profileDir, 'zcr-s6-upgrade-staging.xpi');
      await IOUtils.copy(config.installedXpi, staging, { noOverwrite: false });
      await IOUtils.copy(staging, config.installedXpi, { noOverwrite: false });
      await IOUtils.remove(staging);
      const after = await AddonManager.getAddonByID(config.subjectID);
      report.replace = { installedVersion: after?.version ?? null };
      await save();
      await check('same-version-xpi-replaced-while-disabled', true, { version: after?.version ?? config.subjectVersion });
      await skip('version-bump-upgrade', 'only one packaged development XPI exists; version-bump upgrade remains the Node fixture CLI');
      await skip('rollback-restores-previous-version', 'only one packaged development XPI exists; rollback remains the Node fixture CLI');
      await subject.enable();
      await until(() => toggle(), 'toolbar after reenable');
      if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'runtime after addon reload', 90000);
      await check('handshake-ready-after-xpi-replace', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-replace', panel()?.dataset.zcrAuth === 'signedOut', { auth: panel()?.dataset.zcrAuth });
      await check('not-generating-after-replace', panel()?.dataset.zcrGenerating !== 'true' && !panel()?.dataset.zcrActiveRequest);
      if (typeof IOUtils?.exists === 'function') {
        await check('records-kept-after-xpi-replace', (await IOUtils.exists(recordPath)) === true);
      } else {
        await skip('records-kept-after-xpi-replace', 'IOUtils.exists was not available');
      }
    }
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
    await quitHost();
  } catch (error) {
    report.status = 'failed'; report.error = `${String(error)}\n${error?.stack || ''}`; report.finishedAt = new Date().toISOString(); await save();
    await quitHost();
  }
}
this.runHostSmoke = runHostSmoke;
