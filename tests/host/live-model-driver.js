/* global Zotero, ChromeUtils, PathUtils */
// Dedicated live model-catalog measurement driver. Packaged only into the isolated
// `.zotero-chatgpt-dev/live/` test addon; never part of the product XPI.
//
// Boundaries enforced here:
//  - exactly one human-driven official login (this driver only waits; it never enters credentials);
//  - no turn/start, no question, no image generation, no model request of any kind;
//  - no credential file is read, copied, logged or screenshotted;
//  - only model ids and non-identifying catalog metadata are written to the report.
async function runHostSmoke(config) {
  const report = {
    startedAt: new Date().toISOString(),
    stage: 'LIVE-MODEL-LIST',
    status: 'running',
    build: { version: config.subjectVersion, sha256: config.artifactHash, xpiName: config.xpiName ?? null },
    isolation: { profile: config.profile ?? null, dataDir: config.dataDir ?? null },
    environment: { zoteroVersion: Zotero.version ?? null, dataDirMatches: null },
    observation: {
      authState: null,
      runtimeState: null,
      modelRows: [],
      selectedModel: null,
      pickerSummary: null,
      pickerButtonText: null,
      conversationPresent: false,
      perModel: {},
    },
    checks: [],
  };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const note = async (name, ok, details = {}) => { report.checks.push({ name, ok: Boolean(ok), ...details }); await save(); };
  const until = async (predicate, label, timeout = 30000) => {
    const start = Date.now();
    for (;;) {
      let value = null;
      try { value = await predicate(); } catch { value = null; }
      if (value) return value;
      if (Date.now() - start >= timeout) throw new Error(`Timed out: ${label}`);
      await delay(200);
    }
  };
  const click = node => { if (!node) throw new Error('Expected UI control is missing'); node.focus(); node.click(); };
  try {
    await Zotero.initializationPromise;
    report.environment.dataDirMatches = Zotero.DataDirectory.dir === config.dataDir;
    await note('isolated-data-directory', report.environment.dataDirMatches, { dataDir: Zotero.DataDirectory.dir });
    const win = await until(() => Zotero.getMainWindow(), 'main window');
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library view');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const subject = await AddonManager.getAddonByID(config.subjectID);
    if (subject?.userDisabled) await subject.enable();
    await note('bundled-xpi-loaded', subject?.isActive && subject.version === config.subjectVersion, { installedVersion: subject?.version ?? null });

    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCHATGPT live model-catalog synthetic item');
    const notifierQueue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper - no text sent', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]);
    const cached = await Zotero.Items.getAsync([parent.id, attachment.id]); await Promise.all(cached.map(item => item.loadAllData()));
    await Zotero.Notifier.commit(notifierQueue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close restored reader tabs');

    const opened = await Zotero.Reader.open(attachment.id); const tabID = opened.tabID;
    const reader = () => {
      const current = Zotero.Reader.getByTabID(tabID);
      if (!current) throw new Error('The live reader tab was closed while the run was in progress; leave the dedicated Zotero window untouched.');
      return current;
    };
    const doc = () => reader()._iframeWindow?.document ?? null;
    const toggle = () => doc()?.querySelector('[data-zchatgpt-toggle]') ?? null;
    const panel = () => doc()?.querySelector('[data-zchatgpt-chat]') ?? null;
    const modelRows = () => [...(doc()?.querySelectorAll('[data-zchatgpt-setting="model"]') ?? [])].map(row => ({
      id: row.dataset.zchatgptValue ?? '',
      label: row.querySelector('.zchatgpt-picker-option-label')?.textContent ?? '',
      checked: row.getAttribute('aria-checked') === 'true',
      disabled: row.disabled === true,
    }));
    await until(toggle, 'reader toolbar');
    win.ZoteroContextPane.collapsed = true;
    click(toggle());
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zchatgptRuntime ?? ''), 'native runtime initialization', 120000);
    report.observation.runtimeState = panel()?.dataset.zchatgptRuntime ?? null;
    report.observation.authState = panel()?.dataset.zchatgptAuth ?? null;
    await note('native-runtime-reached', report.observation.runtimeState === 'ready', {
      runtime: report.observation.runtimeState,
      auth: report.observation.authState,
      visibleStatus: panel()?.querySelector('[role="status"]')?.textContent ?? null,
      visibleError: panel()?.querySelector('[role="alert"]')?.textContent ?? null,
    });
    if (report.observation.runtimeState !== 'ready') { report.status = 'runtime-error'; report.finishedAt = new Date().toISOString(); await save(); return; }

    // Hand the official login to the human. The driver only waits; it does not click the login
    // button, enter credentials, or drive the OAuth flow.
    if (report.observation.authState !== 'signedIn') {
      report.status = 'waiting-for-login';
      report.finishedAt = null;
      await note('login-handed-to-human', true, { hint: 'Click "Sign in with ChatGPT" in the Codex sidebar of the dedicated Zotero window, then finish the official browser login.' });
      const loginWaitMs = Number.isFinite(config.loginWaitMs) ? config.loginWaitMs : 1800000;
      const deadline = Date.now() + loginWaitMs;
      for (;;) {
        const auth = panel()?.dataset.zchatgptAuth ?? null;
        if (auth !== report.observation.authState) { report.observation.authState = auth; await save(); }
        if (auth === 'signedIn') break;
        if (Date.now() >= deadline) break;
        await delay(500);
      }
      if (report.observation.authState !== 'signedIn') {
        report.status = 'login-not-completed';
        report.finishedAt = new Date().toISOString();
        await note('official-chatgpt-login-completed', false, { auth: report.observation.authState });
        await save();
        return;
      }
    }
    await note('official-chatgpt-login-completed', true, { auth: report.observation.authState });

    // The runtime's parsed catalog is what the picker renders. Wait until it is populated.
    await until(() => modelRows().length > 0, 'model picker rows', 60000);
    report.observation.modelRows = modelRows();
    const checked = report.observation.modelRows.find(row => row.checked);
    report.observation.selectedModel = checked?.id ?? null;
    const picker = doc()?.querySelector('[data-zchatgpt-action="picker"]');
    report.observation.pickerSummary = picker?.dataset.summary ?? picker?.textContent ?? null;
    report.observation.pickerButtonText = picker?.textContent ?? null;
    report.observation.conversationPresent = Boolean(panel()?.dataset.zchatgptConversation);
    await note('model-list-observed', report.observation.modelRows.length > 0, {
      rowCount: report.observation.modelRows.length,
      ids: report.observation.modelRows.map(row => row.id),
      selected: report.observation.selectedModel,
    });

    // Per-model, non-identifying metadata: the picker only mounts effort/speed for the selected
    // model, so probe each visible model by selecting it (a local draft change only, no request).
    for (const entry of report.observation.modelRows) {
      const row = [...(doc()?.querySelectorAll('[data-zchatgpt-setting="model"]') ?? [])].find(candidate => candidate.dataset.zchatgptValue === entry.id);
      if (!row || row.disabled) { report.observation.perModel[entry.id] = { selectable: false }; await save(); continue; }
      row.click();
      await delay(120);
      const efforts = [...(doc()?.querySelectorAll('[data-zchatgpt-setting="effort"]') ?? [])].map(node => node.dataset.zchatgptValue ?? '').filter(Boolean);
      const speed = doc()?.querySelector('[data-zchatgpt-setting="speed"]');
      report.observation.perModel[entry.id] = {
        selectable: true,
        reasoningEfforts: efforts,
        fastToggle: speed ? { present: true, on: speed.getAttribute('aria-checked') === 'true' } : { present: false },
      };
      await save();
    }
    // Restore the fresh-chat selection observed before probing, if it was selectable.
    const restore = report.observation.selectedModel
      ? [...(doc()?.querySelectorAll('[data-zchatgpt-setting="model"]') ?? [])].find(candidate => candidate.dataset.zchatgptValue === report.observation.selectedModel)
      : null;
    if (restore && !restore.disabled) { restore.click(); await delay(120); }
    report.observation.selectedAfterProbe = modelRows().find(row => row.checked)?.id ?? null;

    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    await save();
  } catch (error) {
    report.status = 'failed';
    report.error = `${String(error)}\n${error?.stack || ''}`;
    report.finishedAt = new Date().toISOString();
    await save();
  }
}
this.runHostSmoke = runHostSmoke;
