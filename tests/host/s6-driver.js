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
    await check('virgin-profile-tree', PathUtils.profileDir === config.profile && /\.zotero-chatgpt-dev\/s6-(virgin|upgrade)\//.test(String(config.profile)), { profile: PathUtils.profileDir });
    const win = await until(() => Zotero.getMainWindow(), 'main window');
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library view');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    let subject = await AddonManager.getAddonByID(config.subjectID);
    if (subject?.userDisabled) await subject.enable();
    await check('bundled-xpi-loaded', subject?.isActive && subject.version === config.subjectVersion, { version: subject?.version });
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCHATGPT S6 virgin install test');
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
        return reader()?._iframeWindow?.document.querySelector('[data-zchatgpt-toggle]') ?? null;
      } catch (error) {
        if (String(error).includes('dead object')) return null;
        throw error;
      }
    };
    const panel = () => { try { return reader()._iframeWindow?.document.querySelector('[data-zchatgpt-chat]'); } catch { return null; } };
    await until(() => toggle(), 'reader toolbar');
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const ownProcesses = async () => {
      const ps = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
      let output = ''; for (;;) { const bytes = await ps.stdout.read(); if (!bytes.byteLength) break; output += new TextDecoder().decode(bytes); }
      await ps.wait();
      return output.split('\n').filter(line => line.includes(PathUtils.profileDir + '/') && line.includes(' app-server')).map(line => Number(line.trim().split(/\s+/, 1)[0])).filter(pid => Number.isInteger(pid) && pid > 0);
    };
    win.ZoteroContextPane.collapsed = true; click(toggle());
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'native runtime initialization', 90000);
    // Codex is started by an explicit Agent action, not by opening the dock: the shared client works
    // without it. Selecting Agent mode is that action here, and the login control it reveals is the
    // one a virgin profile shows; without this click the profile owns no Codex process at all.
    await until(() => panel()?.querySelector('[data-zchatgpt-action="mode-agent"]'), 'mode switch');
    click(panel().querySelector('[data-zchatgpt-action="mode-agent"]'));
    await until(async () => (await ownProcesses()).length === 1, 'lazy codex start', 90000);
    await check('native-runtime-handshake-ready', panel()?.dataset.zchatgptRuntime === 'ready' && (await ownProcesses()).length === 1, { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
    await check('one-owned-codex-process', (await ownProcesses()).length === 1, { count: (await ownProcesses()).length });
    const auth = panel()?.dataset.zchatgptAuth;
    report.account = { state: auth };
    await check('virgin-profile-signed-out', auth === 'signedOut', { auth });
    await check('login-control-visible', !!panel()?.querySelector('[data-zchatgpt-action="login"]'));
    await check('not-generating', panel()?.dataset.zchatgptGenerating !== 'true' && !panel()?.dataset.zchatgptActiveRequest);
    await skip('live-model-send', 'quota blocks live Codex until 2026-09-15; this driver does not send');
    const conversationId = '11111111-0000-4000-8000-000000000006';
    const recordsDir = PathUtils.join(PathUtils.profileDir, 'zotero-chatgpt', 'v1', 'records', 'conversations');
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
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'runtime after version-bump upgrade', 90000);
      subject = await AddonManager.getAddonByID(config.subjectID);
      report.upgrade = { installedVersion: subject?.version ?? null };
      await save();
      await check('version-bump-upgrade', subject?.isActive && subject.version === config.upgradeVersion, { version: subject?.version, expected: config.upgradeVersion });
      await check('handshake-ready-after-xpi-replace', panel()?.dataset.zchatgptRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-replace', panel()?.dataset.zchatgptAuth === 'signedOut', { auth: panel()?.dataset.zchatgptAuth });
      await check('not-generating-after-replace', panel()?.dataset.zchatgptGenerating !== 'true' && !panel()?.dataset.zchatgptActiveRequest);
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
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'runtime after rollback', 90000);
      subject = await AddonManager.getAddonByID(config.subjectID);
      report.rollback = { installedVersion: subject?.version ?? null };
      await save();
      await check('rollback-restores-previous-version', subject?.isActive && subject.version === config.rollbackVersion, { version: subject?.version, expected: config.rollbackVersion });
      await check('handshake-ready-after-rollback', panel()?.dataset.zchatgptRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-rollback', panel()?.dataset.zchatgptAuth === 'signedOut', { auth: panel()?.dataset.zchatgptAuth });
      if (typeof IOUtils?.exists === 'function') {
        await check('records-kept-after-rollback', (await IOUtils.exists(recordPath)) === true);
      } else {
        await skip('records-kept-after-rollback', 'IOUtils.exists was not available');
      }
      // Downgrade safety probe on a fresh synthetic attachment, so the checks above keep their
      // original meaning: the older build must refuse a conversation written in the newer schema
      // with an honest message and must leave the record bytes untouched. A newly opened reader has
      // no cached conversation to reuse, so it must consult the paper index for this attachment.
      const profileClientId = Zotero.Prefs.get('extensions.zchatgpt.clientId', true);
      if (typeof IOUtils?.writeUTF8 === 'function' && typeof profileClientId === 'string' && /^[0-9a-f-]{36}$/u.test(profileClientId)) {
        const downgradeId = '33333333-0000-4000-8000-000000000003';
        const probeAttachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic downgrade probe PDF' });
        await probeAttachment.loadAllData();
        const probeRecordPath = PathUtils.join(recordsDir, `${downgradeId}.json`);
        const seededDowngrade = {
          schemaVersion: 3, logSeq: 0, id: downgradeId,
          paper: { clientId: profileClientId, libraryId: Zotero.Libraries.userLibraryID, attachmentKey: probeAttachment.key },
          paperIdentity: { title: 'Synthetic downgrade probe PDF', authors: [] },
          title: 'Synthetic schema-3 downgrade record',
          settings: { model: 'catalog-default', serviceTier: null, effort: 'low' },
          activeRequestId: null, messages: [], lastSeq: 0,
          createdAt: '2026-09-12T08:00:00.000Z', updatedAt: '2026-09-12T08:00:00.000Z',
          upstream: { threadId: null, permissionMode: 'read' }, requests: [], documents: {}, documentIds: [],
        };
        const seededBytes = `${JSON.stringify(seededDowngrade)}\n`;
        await IOUtils.writeUTF8(probeRecordPath, seededBytes);
        const papersDir = PathUtils.join(PathUtils.profileDir, 'zotero-chatgpt', 'v1', 'records', 'papers');
        await IOUtils.makeDirectory(papersDir, { createAncestors: true, ignoreExisting: true });
        const probeIndexPath = PathUtils.join(papersDir, `${profileClientId}-${Zotero.Libraries.userLibraryID}-${probeAttachment.key}.json`);
        let priorIndex = null;
        try { priorIndex = await IOUtils.readUTF8(probeIndexPath); } catch { priorIndex = null; }
        await IOUtils.writeUTF8(probeIndexPath, `${JSON.stringify({ schemaVersion: 1, conversations: [downgradeId], current: downgradeId })}\n`);
        const probeOpened = await Zotero.Reader.open(probeAttachment.id);
        const probeReader = () => Zotero.Reader.getByTabID(probeOpened.tabID);
        const probeToggle = () => { try { return probeReader()?._iframeWindow?.document.querySelector('[data-zchatgpt-toggle]') ?? null; } catch { return null; } };
        const probePanel = () => { try { return probeReader()?._iframeWindow?.document.querySelector('[data-zchatgpt-chat]'); } catch { return null; } };
        await until(() => probeToggle(), 'downgrade probe toolbar', 30000);
        if (probeToggle()?.getAttribute('aria-pressed') !== 'true') click(probeToggle());
        const probeAlert = () => probePanel()?.querySelector('[role="alert"]')?.textContent || '';
        await until(() => probeAlert(), 'older build refusal message', 60000).catch(() => undefined);
        const exists = await IOUtils.exists(probeRecordPath);
        const after = exists ? await IOUtils.readUTF8(probeRecordPath) : null;
        let schema = null; try { schema = after === null ? null : JSON.parse(after).schemaVersion; } catch { schema = 'unparsable'; }
        await check('schema3-record-refused-without-rewrite-after-downgrade', exists && after === seededBytes && schema === 3 && /could not be read|left untouched/i.test(probeAlert()), {
          recordExists: exists, bytesUnchanged: after === seededBytes, schemaVersion: schema,
          rejectionVisible: /could not be read|left untouched/i.test(probeAlert()), alert: probeAlert().slice(0, 200),
          probeAttachmentKey: probeAttachment.key,
        });
        try { probeReader()?.close(); } catch { /* The instance is about to quit. */ }
        if (priorIndex !== null) await IOUtils.writeUTF8(probeIndexPath, priorIndex);
      } else {
        await skip('schema3-record-refused-without-rewrite-after-downgrade', 'profile clientId or IOUtils.writeUTF8 was not available');
      }
    } else if (typeof IOUtils?.copy !== 'function' || !config.installedXpi) {
      await skip('same-version-xpi-replaced-while-disabled', 'IOUtils.copy was not available');
      await skip('version-bump-upgrade', 'IOUtils.copy was not available');
      await skip('rollback-restores-previous-version', 'IOUtils.copy was not available');
    } else {
      const staging = PathUtils.join(PathUtils.profileDir, 'zchatgpt-s6-upgrade-staging.xpi');
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
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime), 'runtime after addon reload', 90000);
      await check('handshake-ready-after-xpi-replace', panel()?.dataset.zchatgptRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
      await check('still-signed-out-after-replace', panel()?.dataset.zchatgptAuth === 'signedOut', { auth: panel()?.dataset.zchatgptAuth });
      await check('not-generating-after-replace', panel()?.dataset.zchatgptGenerating !== 'true' && !panel()?.dataset.zchatgptActiveRequest);
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
