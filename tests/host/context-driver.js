/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// Native PDF text/coverage, attachment identity and UI performance. Never sends a model request.
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
    const b = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Supplement synthetic PDF', saveOptions: { notifierQueue: queue } });
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
    await check('signed-out-local-conversation', panel().dataset.zcrAuth === 'signedOut');
    const conversationA = panel().dataset.zcrConversation;
    input().value = 'Unsent synthetic question about the current PDF'; input().dispatchEvent(new (reader()._iframeWindow.Event)('input', { bubbles: true }));
    const pdf = () => reader()._internalReader._primaryView._iframeWindow.PDFViewerApplication;
    const openPage = rows[1].querySelector('button'); openPage.click();
    await until(() => pdf().pdfViewer.currentPageNumber === 2, 'source-navigation');
    toggle().click(); await until(() => !panel(), 'close-sidebar');
    await check('close-preserves-current-page', pdf().pdfViewer.currentPageNumber === 2);
    toggle().click(); await until(() => panel()?.dataset.zcrConversation === conversationA, 'same-conversation-restored');
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
    await check('no-model-request-recorded', requests === 0);
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.failedStep = step; report.finishedAt = new Date().toISOString(); await save(); Zotero.logError(error); }
}
