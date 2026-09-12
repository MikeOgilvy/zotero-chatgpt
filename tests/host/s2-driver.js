/* global Zotero, ChromeUtils, IOUtils, PathUtils */
// Actual native runtime/GUI checks; this driver is packaged only in the isolated test addon.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'S2', status: 'running', checks: [], build: { version: config.subjectVersion, sha256: config.artifactHash } };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const check = async (name, ok, details = {}) => {
    report.checks.push({ name, ok: Boolean(ok), details }); await save();
    if (!ok) throw new Error(`Host check failed: ${name}`);
  };
  const until = async (predicate, label, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(100); }
    throw new Error(`Timed out: ${label}`);
  };
  const click = node => { if (!node) throw new Error('Expected UI control is missing'); node.focus(); node.click(); };
  try {
    await Zotero.initializationPromise;
    await check('isolated-data-directory', Zotero.DataDirectory.dir === config.dataDir);
    const win = await until(() => Zotero.getMainWindow(), 'main window');
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library view');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const subject = await AddonManager.getAddonByID(config.subjectID);
    if (subject?.userDisabled) await subject.enable();
    await check('bundled-xpi-loaded', subject?.isActive && subject.version === config.subjectVersion);
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCR S2 synthetic connection test');
    const notifierQueue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper - no text sent', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]);
    const cached = await Zotero.Items.getAsync([parent.id, attachment.id]); await Promise.all(cached.map(item => item.loadAllData()));
    await Zotero.Notifier.commit(notifierQueue);
    // Earlier runs leave restored reader tabs in this disposable data directory; start clean so
    // the test tab is the only reader and the window is not cluttered during the run.
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close restored reader tabs');
    const opened = await Zotero.Reader.open(attachment.id); const tabID = opened.tabID;
    // Resolve the reader by tab each time: a closed or unloaded tab must produce a clear
    // message instead of a Gecko "dead object" failure deep inside a check.
    const reader = () => {
      const current = Zotero.Reader.getByTabID(tabID);
      if (!current) throw new Error('The test reader tab was closed while the run was in progress; leave the dedicated Zotero window untouched during a host run.');
      return current;
    };
    const toggle = () => {
      try { return reader()._iframeWindow?.document.querySelector('[data-zcr-toggle]') ?? null; }
      catch (error) { if (String(error).includes('dead object')) throw new Error('The test reader was unloaded while the run was in progress; leave the dedicated Zotero window untouched during a host run.'); throw error; }
    };
    const panel = () => { try { return reader()._iframeWindow?.document.querySelector('[data-zcr-chat]'); } catch { return null; } };
    const action = name => panel()?.querySelector(`[data-zcr-action="${name}"]`);
    await until(toggle, 'reader toolbar');
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const ownProcesses = async () => {
      const ps = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
      let output = ''; for (;;) { const bytes = await ps.stdout.read(); if (!bytes.byteLength) break; output += new TextDecoder().decode(bytes); }
      await ps.wait();
      // Only return IDs from this disposable profile; never persist other process arguments.
      return output.split('\n').filter(line => line.includes(PathUtils.profileDir + '/') && line.includes(' app-server'))
        .map(line => Number(line.trim().split(/\s+/, 1)[0]));
    };
    const before = await ownProcesses();
    await check('no-runtime-before-sidebar-open', before.length === 0);
    win.ZoteroContextPane.collapsed = true; click(toggle());
    await until(() => panel()?.dataset.zcrRuntime === 'ready' || panel()?.dataset.zcrRuntime === 'error', 'native runtime initialization', 90000);
    await check('native-runtime-handshake-ready', panel()?.dataset.zcrRuntime === 'ready', { visibleStatus: panel()?.querySelector('[role="status"]')?.textContent, visibleError: panel()?.querySelector('[role="alert"]')?.textContent });
    await check('one-owned-codex-process', (await ownProcesses()).length === 1);
    const initialAuth = panel().dataset.zcrAuth;
    await check('real-account-state-rendered', ['signedOut', 'signedIn'].includes(initialAuth));
    click(toggle()); await until(() => toggle()?.getAttribute('aria-pressed') === 'false', 'close sidebar');
    await check('closing-view-keeps-process', (await ownProcesses()).length === 1);
    click(toggle()); await until(() => panel()?.dataset.zcrRuntime === 'ready', 'reopen sidebar');
    await check('reopen-reuses-process', (await ownProcesses()).length === 1);
    if (panel().dataset.zcrAuth !== 'signedIn' && !config.interactiveLogin) {
      report.status = 'pre-auth-passed'; report.finishedAt = new Date().toISOString(); await save(); return;
    }
    if (panel().dataset.zcrAuth !== 'signedIn') {
      click(action('login')); report.status = 'waiting-for-login'; await save();
      await until(() => panel()?.dataset.zcrAuth === 'signedIn', 'official browser login', 360000);
    }
    await check('official-chatgpt-login-completed', panel().dataset.zcrAuth === 'signedIn');
    const alertText = () => panel()?.querySelector('[role="alert"]')?.textContent || '';
    const requestId = () => panel()?.dataset.zcrRequestId || '';
    const requestState = () => panel()?.dataset.zcrRequestState || '';
    const terminal = ['completed', 'failed', 'uncertain', 'cancelled'];
    // A restored earlier request may already show a terminal state; wait for a new request ID.
    const submit = async label => {
      const previous = requestId(); click(action('run-test'));
      await until(() => requestId() && requestId() !== previous, `${label}: new synthetic request accepted`);
      return requestId();
    };
    const first = await submit('first');
    await until(() => terminal.includes(requestState()), 'real synthetic answer', 180000);
    const outcome = { requestId: first, state: requestState(), visibleError: alertText(), outputChars: panel().querySelector('[data-zcr-output]').textContent.trim().length };
    if (outcome.state === 'completed') {
      await check('real-synthetic-answer-completed', true, outcome);
      await check('real-output-is-nonempty', outcome.outputChars > 0);
      await submit('second');
      click(action('stop'));
      await until(() => terminal.includes(requestState()), 'interrupt response', 30000);
      await check('stop-reaches-confirmed-terminal', requestState() === 'cancelled');
    } else {
      // The turn was submitted but the upstream refused or failed it (for example an exhausted
      // usage limit). Record the typed reason shown to the user; the answer and stop checks
      // stay not-run rather than being faked.
      report.upstream = { ...outcome, notRun: ['real-synthetic-answer-completed', 'real-output-is-nonempty', 'stop-reaches-confirmed-terminal'] };
      await save();
    }
    const beforeRestart = { id: requestId(), state: requestState() };
    await subject.disable(); await until(async () => !toggle() && (await ownProcesses()).length === 0, 'disable cleans owned runtime');
    await check('disable-stops-owned-process', (await ownProcesses()).length === 0);
    await subject.enable(); await until(toggle, 'reenable plugin'); click(toggle());
    await until(() => panel()?.dataset.zcrRuntime === 'ready', 'restart native runtime', 90000);
    await check('plugin-login-survives-restart', panel().dataset.zcrAuth === 'signedIn');
    await check('terminal-request-restored-without-resending', requestId() === beforeRestart.id && requestState() === beforeRestart.state, { restored: { id: requestId(), state: requestState() }, beforeRestart });
    report.status = report.upstream ? 'passed-except-upstream-refusal' : 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.error = `${String(error)}\n${error?.stack || ''}`; report.finishedAt = new Date().toISOString(); await save(); }
}
this.runHostSmoke = runHostSmoke;
