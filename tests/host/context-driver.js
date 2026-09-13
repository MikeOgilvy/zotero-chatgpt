/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// Native PDF text/coverage, attachment identity and UI performance. Only --live sends bounded synthetic requests.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'current-pdf', status: 'running', checks: [], notRun: ['real-model-answer', 'official-login', 'in-flight-model-stop', 'long-term-memory', 'image-understanding'], build: { version: config.subjectVersion, sha256: config.artifactHash } };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  let step = 'startup';
  const until = async (predicate, label, timeout = 20000) => {
    step = label; const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(10); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  try {
    await Zotero.initializationPromise;
    await check('isolated-context-profile', PathUtils.profileDir === config.profile && String(config.profile).endsWith('/.zcr-dev/context/profile') && Zotero.DataDirectory.dir === config.dataDir);
    const win = await until(() => Zotero.getMainWindow(), 'main-window');
    report.environment = { zotero: Zotero.version, width: win.innerWidth, height: win.innerHeight, devicePixelRatio: win.devicePixelRatio };
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library-ready');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const addon = await AddonManager.getAddonByID(config.subjectID); if (addon?.userDisabled) await addon.enable();
    await check('full-xpi-active', addon?.isActive && addon.version === config.subjectVersion);
    const title = 'ZCR current-PDF synthetic context and native interaction test';
    const parent = new Zotero.Item('journalArticle'); parent.setField('title', title);
    const queue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue: queue });
    const a = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Main synthetic PDF', saveOptions: { notifierQueue: queue } });
    const b = await Zotero.Attachments.importFromFile({ file: config.supplementPdfPath ?? config.pdfPath, parentItemID: parent.id, title: 'Supplement synthetic PDF', saveOptions: { notifierQueue: queue } });
    await Promise.all([parent.loadAllData(), a.loadAllData(), b.loadAllData()]); await Zotero.Notifier.commit(queue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close-only-this-profile-tabs');
    Zotero.Prefs.set('extensions.zcr.automaticPdfText', true, true);
    Zotero.Prefs.set('extensions.zcr.pdfTextDisclosureSeen', false, true);
    const opened = await Zotero.Reader.open(a.id); let tabId = opened.tabID;
    const reader = () => Zotero.Reader.getByTabID(tabId);
    const rdoc = () => reader()?._iframeWindow?.document;
    const panel = () => rdoc()?.querySelector('[data-zcr-chat]');
    const context = () => rdoc()?.querySelector('[data-zcr-document-context]');
    const toggle = () => rdoc()?.querySelector('[data-zcr-toggle]');
    const input = () => panel()?.querySelector('[data-zcr-input]');
    await until(() => reader()?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument, 'pdf-loaded');
    await until(() => toggle(), 'toolbar-toggle');
    const coldStart = win.performance.now(); toggle().click();
    await until(() => input(), 'immediate-input');
    report.coldInputMs = win.performance.now() - coldStart;
    await check('title-before-or-with-connection', panel()?.textContent.includes(title));
    await until(() => context()?.dataset.zcrContextPhase === 'ready', 'local-pdf-prepared');
    report.localPreparationMs = win.performance.now() - coldStart;
    await check('two-pages-extracted', context().dataset.zcrContextTextPages === '2' && context().dataset.zcrContextTotalPages === '2');
    await check('honest-local-coverage', context().textContent.includes('not sent') && context().textContent.includes('unknown') && context().textContent.includes('Figures'));
    context().open = true;
    const rows = context().querySelectorAll('.zcr-context-pages details');
    for (const row of rows) row.open = true;
    await until(() => context().querySelectorAll('pre').length === 2, 'source-preview');
    await check('text-from-both-pages-and-page-labels', context().textContent.includes('Synthetic page 1') && context().textContent.includes('Synthetic page 2') && rows[0].textContent.includes('p. i') && rows[1].textContent.includes('p. 1'));
    await until(() => panel()?.dataset.zcrRuntime === 'ready' && panel()?.dataset.zcrConversation, 'native-runtime-and-local-conversation', 60000);
    await check('local-conversation-independent-of-login', ['signedIn', 'signedOut'].includes(panel().dataset.zcrAuth));
    const conversationA = panel().dataset.zcrConversation;
    input().value = 'Unsent synthetic question about the current PDF'; input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
    const pdf = () => reader()._internalReader._primaryView._iframeWindow.PDFViewerApplication;
    const openPage = rows[1].querySelector('button'); openPage.click();
    await until(() => pdf().pdfViewer.currentPageNumber === 2, 'source-navigation');
    toggle().click(); await until(() => !panel(), 'close-sidebar');
    await check('close-preserves-current-page', pdf().pdfViewer.currentPageNumber === 2, {
      page: pdf().pdfViewer.currentPageNumber,
      location: pdf().pdfViewer._location && { pageNumber: pdf().pdfViewer._location.pageNumber, left: pdf().pdfViewer._location.left, top: pdf().pdfViewer._location.top, scale: pdf().pdfViewer._location.scale },
      dock: Boolean(rdoc()?.querySelector('[data-zcr-dock]')),
      sidebarCollapsed: win.ZoteroContextPane?.collapsed,
    });
    toggle().click(); await until(() => panel()?.dataset.zcrConversation === conversationA, 'same-conversation-restored');
    await check('reopen-keeps-current-page', pdf().pdfViewer.currentPageNumber === 2, {
      page: pdf().pdfViewer.currentPageNumber,
      locationPage: pdf().pdfViewer._location?.pageNumber,
    });
    await check('draft-preserved', input().value === 'Unsent synthetic question about the current PDF');
    const readRange = context().querySelectorAll('input'); readRange[0].value = '2'; readRange[1].value = '2';
    context().querySelector('.zcr-context-range button').click();
    await until(() => context()?.dataset.zcrContextPhase === 'ready' && context().dataset.zcrContextTextPages === '1', 'page-range-extracted');
    await check('range-reports-omitted-page', context().textContent.includes('1 pages outside'));
    const other = await Zotero.Reader.open(b.id); tabId = other.tabID;
    await until(() => toggle(), 'sibling-toolbar'); toggle().click();
    await until(() => panel()?.dataset.zcrConversation, 'sibling-conversation', 60000);
    await check('same-title-attachments-separated', panel().dataset.zcrConversation !== conversationA && input().value === '' && panel().textContent.includes(title));
    tabId = opened.tabID; win.Zotero_Tabs.select(tabId);
    await until(() => panel()?.dataset.zcrConversation === conversationA, 'main-attachment-restored');
    await check('attachment-switch-keeps-draft', input().value === 'Unsent synthetic question about the current PDF');
    context().querySelectorAll('.zcr-context-range button')[1].click();
    await until(() => context()?.dataset.zcrContextPhase === 'ready' && context().dataset.zcrContextTextPages === '2', 'full-range-before-performance');
    // Measure actual input-ready reopen and state-changing checkbox feedback, not an animation.
    const warm = []; const local = [];
    for (let n = 0; n < 30; n++) {
      toggle().click(); await until(() => !panel(), 'perf-close');
      const start = win.performance.now(); toggle().click();
      await until(() => input() && !input().disabled && panel()?.dataset.zcrConversation === conversationA, 'perf-input-ready'); warm.push(win.performance.now() - start);
      panel().querySelector('[data-zcr-action="settings"]').click();
      const checkbox = panel().querySelector('[data-zcr-automatic-pdf]');
      const feedback = win.performance.now(); checkbox.click();
      await until(() => context().querySelector('summary').textContent.includes('off'), 'perf-state-feedback'); local.push(win.performance.now() - feedback);
      checkbox.click(); await until(() => context()?.dataset.zcrContextPhase === 'ready', 'perf-preparation-reused');
      panel().querySelector('[data-zcr-action="settings"]').click();
    }
    const metrics = values => ({ n: values.length, p95: [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1], max: Math.max(...values), samplesMs: values });
    report.performance = { cachedOpen: metrics(warm), localInteraction: metrics(local), method: 'performance.now; poll 10ms until restored conversation+enabled input or context-state change; same synthetic 2-page PDF; 30 cycles; runtime warmed; no model' };
    await check('warm-open-p95-under-250ms', report.performance.cachedOpen.p95 <= 250, { p95: report.performance.cachedOpen.p95 });
    await check('local-feedback-p95-under-100ms', report.performance.localInteraction.p95 <= 100, { p95: report.performance.localInteraction.p95 });
    await check('single-dock-and-toggle-after-cycles', rdoc().querySelectorAll('[data-zcr-dock]').length === 1 && rdoc().querySelectorAll('[data-zcr-toggle]').length === 1);
    step = 'inspect-request-records';
    const records = PathUtils.join(config.profile, 'zotero-codex-reader', 'v1', 'records', 'conversations');
    let requests = 0;
    for (const file of await IOUtils.getChildren(records)) if (file.endsWith('.json') && !file.endsWith('.source.json')) requests += JSON.parse(await IOUtils.readUTF8(file)).requests.length;
    if (!config.live) await check('no-model-request-in-this-conversation', JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`))).requests.length === 0);
    if (config.live) {
      report.notRun = report.notRun.filter(name => !['real-model-answer', 'in-flight-model-stop'].includes(name));
      await check('live-account-signed-in', panel().dataset.zcrAuth === 'signedIn');
      const picker = panel().querySelector('[data-zcr-picker]'); picker.click();
      const spark = [...panel().querySelectorAll('[data-zcr-setting="model"]')].find(node => /spark/i.test(node.textContent));
      if (spark) spark.click();
      if (picker.getAttribute('aria-expanded') === 'true') picker.click();
      report.liveModel = picker.textContent;
      input().value = 'What is the hidden verification token on the second physical page of this synthetic PDF, and what combines prior beliefs and likelihood? Cite the page label. Answer briefly.';
      input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      const started = win.performance.now(); panel().querySelector('[data-zcr-action="send"]').click();
      await until(() => panel()?.dataset.zcrGenerating === 'true', 'live-request-accepted');
      await until(() => panel()?.dataset.zcrGenerating === 'false', 'live-answer-terminal', 120000);
      const record = JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`)));
      const last = record.requests.at(-1);
      const answer = record.messages.filter(m => m.role === 'assistant' && m.requestId === last?.requestId).map(m => m.text).join('\n');
      report.live = { state: last?.state, latencyMs: win.performance.now() - started, answer: answer.slice(0, 1600), inputDocumentId: record.messages.find(m => m.requestId === last?.requestId && m.role === 'user')?.document?.id };
      await check('real-model-answer', last?.state === 'completed' && answer.trim().length > 0, { state: last?.state, characters: answer.length });
      await check('model-used-second-page-source', answer.includes('ORCHID-72') && !answer.includes('BAMBOO-19'));
      await check('full-document-in-live-request', Boolean(report.live.inputDocumentId));
      input().value = 'Explain this synthetic example in depth with ten worked examples and detailed reasoning for a beginner.';
      input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
      panel().querySelector('[data-zcr-action="send"]').click();
      await until(() => panel()?.dataset.zcrGenerating === 'true', 'live-followup-started');
      await until(() => panel()?.querySelector('[data-status="streaming"] [data-zcr-text]')?.textContent?.length > 0 || panel()?.dataset.zcrGenerating === 'false', 'live-followup-output', 120000);
      const stop = panel().querySelector('[data-zcr-action="stop"]'); if (panel().dataset.zcrGenerating === 'true') stop.click();
      await until(() => panel()?.dataset.zcrGenerating === 'false', 'live-followup-stopped', 30000);
      const afterStop = JSON.parse(await IOUtils.readUTF8(PathUtils.join(records, `${conversationA}.json`)));
      const terminal = afterStop.requests.at(-1)?.state;
      report.live.stopState = terminal;
      await check('live-stop-confirmed-or-completion-race', terminal === 'cancelled' || terminal === 'completed', { state: terminal });
      if (terminal === 'completed') report.notRun.push('stop-during-stream-completed-too-fast');
    }
    try {
      const doc = pdf().pdfDocument;
      const data = typeof doc.getData === 'function' ? await doc.getData() : null;
      report.loadedDocumentBytes = { supported: !!data?.byteLength, bytes: data?.byteLength ?? 0 };
    } catch { report.loadedDocumentBytes = { supported: false }; }

    // --- Native Preferences pane preflight (bounded addition; does not touch the checks above) ---
    // Observed on the installed subject XPI only. The visual pane, native theming and keyboard
    // focus are explicitly not verifiable here and stay in notRun.
    report.notRun.push('pref-pane-visual-theme-and-keyboard');
    report.notRun.push('pref-pane-registrar-isolated-from-host-auto-unregister');
    step = 'preferences-pane-preflight';
    const PANE_ID = 'zcr-prefpane-settings';
    const panePanes = () => (Array.isArray(Zotero.PreferencePanes?.pluginPanes) ? Zotero.PreferencePanes.pluginPanes.filter(pane => pane && pane.id === PANE_ID) : null);
    const waive = value => { try { return Cu.waiveXrays(value); } catch { return value; } };
    const firstPane = () => { const entries = panePanes(); return entries && entries[0] ? waive(entries[0]) : null; };
    const paneDetails = () => {
      const pane = firstPane();
      return {
        paneCount: panePanes()?.length ?? null,
        id: pane ? String(pane.id) : null,
        pluginID: pane ? String(pane.pluginID) : null,
        pluginIDMatches: Boolean(pane && String(pane.pluginID) === config.subjectID),
        src: pane ? String(pane.src) : null,
        label: pane ? String(pane.rawLabel) : null,
        scripts: pane && Array.isArray(pane.scripts) ? pane.scripts.map(String) : [],
      };
    };
    const identity = paneDetails();
    await check('pref-pane-registered-once-after-startup',
      identity.paneCount === 1 && identity.pluginIDMatches &&
      typeof identity.src === 'string' && identity.src.endsWith('content/preferences/preferences.xhtml') &&
      identity.label === 'Zotero Codex Reader' &&
      identity.scripts.length === 1 && identity.scripts[0].endsWith('content/preferences/pane.js'),
      identity);
    // Open the real Preferences window and select our pane; Zotero loads the fragment and its script.
    const prefWin = Zotero.Utilities.Internal.openPreferences(PANE_ID);
    await until(() => prefWin && waive(prefWin).document && waive(prefWin).document.getElementById(PANE_ID), 'preferences-pane-window');
    const prefDoc = waive(prefWin).document;
    const paneRoot = prefDoc.getElementById(PANE_ID);
    await until(() => paneRoot.querySelector('[data-zcr-pref="form"]') || paneRoot.querySelector('[data-zcr-pref="error"]') || paneRoot.querySelector('[role="alert"]'), 'preferences-pane-mounted', 30000);
    const form = paneRoot.querySelector('[data-zcr-pref="form"]');
    const paneText = String(paneRoot.textContent || '').slice(0, 200);
    const bridge = Boolean(waive(prefWin).Zotero && waive(prefWin).Zotero.ZoteroCodexReaderPreferencesPane);
    const unavailable = !form || /unavailable|could not be displayed/i.test(paneText);
    report.preferencesPane = {
      windowOpened: true,
      sandboxPaneBridgeVisible: bridge,
      mountedForm: Boolean(form),
      controlCount: paneRoot.querySelectorAll('input, select, textarea, button').length,
      settingsFields: paneRoot.querySelectorAll('[data-zcr-pref^="preference-"]').length,
      unavailable,
      textSample: paneText,
    };
    await check('pref-pane-window-mounts-real-form',
      Boolean(form) && report.preferencesPane.controlCount > 0 && !unavailable && bridge,
      report.preferencesPane);
    // The pane's copy must follow the stored UI language inside the real Preferences window. The
    // check switches the stored language through the pane's own control, then restores it, so the
    // profile is left as it was found. Only the UI-language setting is written; no record is touched.
    const paneLegend = () => String(paneRoot.querySelector('legend')?.textContent ?? '');
    const paneIdentifiers = () => [...paneRoot.querySelectorAll('[data-zcr-skill]')].map(row => ({ id: String(row.getAttribute('data-zcr-skill')), name: String(row.querySelector('label span')?.textContent ?? '') }));
    const storedLanguage = async () => JSON.parse(String(await Zotero.ZoteroCodexReaderPreferencesHost.readSettings())).uiLanguage;
    const expectedLegend = language => (language === 'zh' ? '对话' : 'Chat');
    const switchLanguage = async language => {
      const select = paneRoot.querySelector('[data-zcr-pref="uiLanguage"]');
      select.value = language;
      select.dispatchEvent(new (waive(prefWin).Event)('change', { bubbles: true }));
      await until(() => paneLegend() === expectedLegend(language) && String(select.value) === language, `pref-pane-copy-${language}`, 30000);
    };
    const languageBefore = await storedLanguage();
    report.preferencesPane.storedLanguage = languageBefore;
    report.preferencesPane.legend = paneLegend();
    report.preferencesPane.identifiersBefore = paneIdentifiers();
    await check('pref-pane-copy-matches-stored-ui-language',
      languageBefore === String(paneRoot.querySelector('[data-zcr-pref="uiLanguage"]').value) && paneLegend() === expectedLegend(languageBefore),
      { storedLanguage: languageBefore, legend: paneLegend() });
    await switchLanguage('zh');
    const chineseIdentifiers = paneIdentifiers();
    report.preferencesPane.legendAfterSwitch = paneLegend();
    report.preferencesPane.identifiersInChinese = chineseIdentifiers;
    await check('pref-pane-copy-follows-language-switch-with-verbatim-identifiers',
      (await storedLanguage()) === 'zh' && paneLegend() === '对话' &&
      chineseIdentifiers.length === report.preferencesPane.identifiersBefore.length &&
      chineseIdentifiers.every((row, index) => row.id === report.preferencesPane.identifiersBefore[index].id && row.name === report.preferencesPane.identifiersBefore[index].name),
      { storedLanguage: await storedLanguage(), legend: paneLegend(), identifiers: chineseIdentifiers });
    await switchLanguage('en');
    await check('pref-pane-copy-reverts-with-the-stored-language',
      (await storedLanguage()) === 'en' && paneLegend() === 'Chat' && JSON.stringify(paneIdentifiers()) === JSON.stringify(report.preferencesPane.identifiersBefore),
      { storedLanguage: await storedLanguage(), legend: paneLegend() });
    let prefWinClosed = false;
    try { prefWin.close(); prefWinClosed = true; } catch { prefWinClosed = false; }
    report.preferencesPane.windowClosed = prefWinClosed;
    await save();
    // A disable/enable cycle must not stack panes: absent while disabled, exactly one after re-enable,
    // with no preference-pane error logged by the plugin. Zotero's own plugin-shutdown observer also
    // clears panes, so this proves the end state, not that only our registrar did the removal.
    const { AddonManager: PrefAddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const subjectAddon = await PrefAddonManager.getAddonByID(config.subjectID);
    const loggedErrors = [];
    const originalLogError = Zotero.logError;
    Zotero.logError = error => { loggedErrors.push(String((error && error.message) || error)); };
    try {
      await subjectAddon.disable();
      await until(() => (panePanes()?.length ?? -1) === 0, 'pref-pane-absent-while-disabled');
      await subjectAddon.enable();
      await until(() => panePanes()?.length === 1, 'pref-pane-single-after-reenable', 30000);
    } finally { Zotero.logError = originalLogError; }
    const paneErrors = loggedErrors.filter(text => /preferences pane|prefpane|zcr-prefpane/i.test(text));
    await check('pref-pane-no-duplicates-across-disable-enable',
      panePanes()?.length === 1 && paneErrors.length === 0,
      { panesAfterReenable: panePanes()?.length ?? null, paneCountAfterStartup: identity.paneCount, preferencePaneErrors: paneErrors, loggedErrorCount: loggedErrors.length });

    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.failedStep = step; report.finishedAt = new Date().toISOString(); await save(); Zotero.logError(error); }
}
