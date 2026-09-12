/* global Zotero, ChromeUtils, PathUtils, Cu */
// Actual native reader/runtime checks for S3; this driver is packaged only in the isolated test addon.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'S3', status: 'running', checks: [], build: { version: config.subjectVersion, sha256: config.artifactHash } };
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
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCR S3 synthetic reading test');
    const notifierQueue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue });
    const attachmentA = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper A', saveOptions: { notifierQueue } });
    const attachmentB = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic supplement B', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), attachmentA.loadAllData(), attachmentB.loadAllData()]);
    const cached = await Zotero.Items.getAsync([parent.id, attachmentA.id, attachmentB.id]); await Promise.all(cached.map(item => item.loadAllData()));
    await Zotero.Notifier.commit(notifierQueue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close restored reader tabs');
    const openReader = async item => {
      const opened = await Zotero.Reader.open(item.id); const tabID = opened.tabID;
      await until(() => Zotero.Reader.getByTabID(tabID)?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.length, 'pdf viewer', 30000);
      return () => {
        const current = Zotero.Reader.getByTabID(tabID);
        if (!current) throw new Error('The test reader tab was closed while the run was in progress; leave the dedicated Zotero window untouched during a host run.');
        return current;
      };
    };
    const readerA = await openReader(attachmentA);
    const toggle = reader => { try { return reader()._iframeWindow?.document.querySelector('[data-zcr-toggle]') ?? null; } catch (error) { if (String(error).includes('dead object')) throw new Error('The test reader was unloaded while the run was in progress.'); throw error; } };
    const selectedReader = () => Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    const chatDoc = () => { try { return selectedReader()?._iframeWindow?.document; } catch { return null; } };
    const panel = () => chatDoc()?.querySelector('[data-zcr-chat]');
    const shell = () => chatDoc()?.querySelector('[data-zcr-sidebar]');
    const alertText = () => panel()?.querySelector('[role="alert"]')?.textContent || '';
    await until(() => toggle(readerA), 'reader toolbar');
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const ownProcesses = async () => {
      const ps = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
      let output = ''; for (;;) { const bytes = await ps.stdout.read(); if (!bytes.byteLength) break; output += new TextDecoder().decode(bytes); }
      await ps.wait();
      return output.split('\n').filter(line => line.includes(PathUtils.profileDir + '/') && line.includes(' app-server')).map(line => Number(line.trim().split(/\s+/, 1)[0]));
    };
    await check('no-runtime-before-sidebar-open', (await ownProcesses()).length === 0);
    win.ZoteroContextPane.collapsed = true; click(toggle(readerA));
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'native runtime initialization', 90000);
    await check('native-runtime-handshake-ready', panel()?.dataset.zcrRuntime === 'ready', { visibleStatus: panel()?.querySelector('[role="status"]')?.textContent, visibleError: alertText() });
    await check('one-owned-codex-process', (await ownProcesses()).length === 1);
    await check('real-account-state-rendered', ['signedOut', 'signedIn'].includes(panel().dataset.zcrAuth));
    const signedIn = panel().dataset.zcrAuth === 'signedIn';
    if (signedIn) await until(() => panel()?.dataset.zcrConversation, 'attachment conversation bound');
    await check('attachment-identity-shown', shell()?.dataset.attachmentKey === attachmentA.key);
    click(toggle(readerA)); await until(() => toggle(readerA)?.getAttribute('aria-pressed') === 'false', 'close sidebar');
    await check('closing-view-keeps-process', (await ownProcesses()).length === 1);
    // --- real text selection in the PDF view (reader.js mousedown/pointermove/pointerup model) ---
    const view = () => readerA()._internalReader._primaryView;
    const viewWin = () => view()._iframeWindow;
    const readerDoc = () => readerA()._iframeWindow.document;
    const selectionPopup = () => readerDoc().querySelector('.selection-popup');
    const bar = () => readerDoc().querySelector('[data-zcr-selection-bar]');
    const diagnose = () => { try { const v = view(); return { popup: !!selectionPopup(), bar: !!bar(), barHidden: bar()?.hidden ?? null, notice: readerDoc().querySelector('[data-zcr-selection-notice]')?.textContent ?? null, sentinel: !!readerDoc().querySelector('[data-zcr-sentinel]'), customSections: readerDoc().querySelector('.selection-popup .custom-sections')?.innerHTML.slice(0, 200) ?? null, listeners: Zotero.Reader._registeredListeners.map(l => `${l.type}:${l.pluginID}`), ranges: (v._selectionRanges || []).map(r => ({ collapsed: r.collapsed, pageIndex: r.position?.pageIndex })), pdfPage: !!v._pdfPages?.[0], charCount: v._pdfPages?.[0]?.chars?.length ?? null, action: v.action?.type ?? null, pointerDownPosition: !!v.pointerDownPosition, tool: v._tool?.type, domSelection: viewWin().getSelection().toString().length, statePopup: !!readerA()._internalReader._state.primaryViewSelectionPopup }; } catch (error) { return { error: String(error) }; } };
    const selectText = async () => {
      await until(() => view()._pdfPages?.[0]?.chars?.length > 8, 'page character data loaded', 30000);
      const w = viewWin(); w.PDFViewerApplication.pdfViewer.currentPageNumber = 1; await delay(400);
      // elementsFromPoint only sees the visible viewport: use text spans that are actually on screen.
      const spans = await until(() => { const nodes = Array.from(w.document.querySelectorAll('.page[data-page-number="1"] .textLayer span')).filter(s => { const r = s.getBoundingClientRect(); return s.textContent.trim().length > 2 && r.width > 0 && r.top > 8 && r.bottom < w.innerHeight - 8 && r.left >= 0 && r.right <= w.innerWidth; }); return nodes.length >= 3 ? nodes : null; }, 'visible text layer', 30000);
      const first = spans[0].getBoundingClientRect(); const last = spans[2].getBoundingClientRect();
      const start = { x: first.left + 2, y: first.top + first.height / 2 }; const end = { x: last.right - 2, y: last.top + last.height / 2 };
      const target = w.document.elementFromPoint(start.x, start.y) || spans[0];
      report.selectionGeometry = { start, end, targetHitsPage: !!target.closest('.page'), innerHeight: w.innerHeight, charCount: view()._pdfPages[0].chars.length };
      report.selectionDiagnostics = report.selectionDiagnostics || {};
      const waitPopup = (label, timeout = 4000) => until(() => selectionPopup(), label, timeout).catch(() => null);
      // PDFView._handlePointerDown returns immediately for pointerType === 'mouse' (reader.js:69947).
      // Content-compartment handler objects without pointerType reach the real selection model.
      const v = view();
      const ev = (x, y, extra = {}) => Cu.cloneInto({ target, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, ...extra }, w, { cloneFunctions: true, wrapReflectors: true });
      v._pointerDownTriggered = false; v._handlePointerDown(ev(start.x, start.y));
      await delay(60); v._handlePointerMove(ev(end.x, end.y, { dataTransfer: null })); await delay(120);
      v._handlePointerUp(ev(end.x, end.y, { button: 0 }));
      await waitPopup('native popup after direct handler calls');
      report.selectionDiagnostics.afterDirect = diagnose(); await save();
      if (!selectionPopup()) {
        target.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: start.x, clientY: start.y }));
        await delay(80);
        target.dispatchEvent(new w.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', buttons: 1, clientX: end.x, clientY: end.y }));
        await delay(120);
        target.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, clientX: end.x, clientY: end.y }));
        await waitPopup('native popup after drag');
        report.selectionDiagnostics.afterDrag = diagnose(); await save();
      }
      if (!selectionPopup()) throw new Error('native selection popup did not appear');
      return until(() => bar(), 'plugin action bar next to the native popup', 5000);
    };
    let selected = false;
    for (let attempt = 0; attempt < 3 && !selected; attempt++) { try { await selectText(); selected = true; } catch (error) { report.selectionAttempt = String(error); await save(); await delay(500); } }
    await check('selection-popup-and-action-bar-appear', selected, { attempts: report.selectionAttempt, diagnostics: report.selectionDiagnostics });
    const popupRect = selectionPopup().getBoundingClientRect(); const barRect = bar().getBoundingClientRect();
    const frameRect = view()._iframe.getBoundingClientRect();
    await check('action-bar-above-native-popup-inside-view', barRect.bottom <= popupRect.top && barRect.top >= frameRect.top && barRect.left >= frameRect.left && barRect.right <= frameRect.right, { bar: barRect.toJSON(), popup: popupRect.toJSON(), view: frameRect.toJSON() });
    await check('native-annotation-panel-intact', !!selectionPopup().querySelector('.colors') && !selectionPopup().contains(bar()));
    const sentinelSection = selectionPopup().querySelector('.custom-sections .section:has(> [data-zcr-sentinel])');
    await check('sentinel-section-hidden', !!sentinelSection && readerDoc().defaultView.getComputedStyle(sentinelSection).display === 'none');
    // --- Ask in sidechat: citation into the draft, focus input, zero requests ---
    click(bar().querySelector('[data-zcr-action="ask"]'));
    await until(() => panel()?.dataset.zcrRuntime === 'ready', 'sidebar opened by Ask', 30000);
    await until(() => panel()?.querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length === 1, 'draft citation card');
    await check('ask-adds-one-draft-citation-without-request', panel().querySelectorAll('[data-zcr-message]').length === 0 && !panel().dataset.zcrActiveRequest);
    const askInput = panel().querySelector('[data-zcr-input]');
    await check('ask-focuses-question-input', !!askInput && (chatDoc()?.activeElement === askInput || askInput.matches(':focus')));
    await until(() => !bar(), 'action bar removed with native popup after click', 10000).catch(() => undefined);
    // --- More details: exactly one explain request ---
    if (!signedIn && !config.interactiveLogin) { report.status = 'pre-auth-passed'; report.finishedAt = new Date().toISOString(); await save(); return; }
    if (!signedIn) { click(panel().querySelector('[data-zcr-action="login"]')); report.status = 'waiting-for-login'; await save(); await until(() => panel()?.dataset.zcrAuth === 'signedIn', 'official browser login', 360000); }
    selected = false; for (let attempt = 0; attempt < 3 && !selected; attempt++) { try { await selectText(); selected = true; } catch { await delay(500); } }
    await check('second-selection-for-more-details', selected);
    click(bar().querySelector('[data-zcr-action="explain"]'));
    await until(() => panel()?.querySelectorAll('[data-zcr-message][data-role="user"]').length === 1, 'explain user message recorded', 30000);
    const userMessage = panel().querySelector('[data-zcr-message][data-role="user"]');
    const visibleExplain = `${userMessage?.textContent || ''} ${panel().querySelector('[data-zcr-input]')?.value || ''}`;
    await check('more-details-records-one-user-message-with-citation', !!userMessage && userMessage.querySelectorAll('[data-zcr-citation]').length === 0 && !!panel().querySelector('[data-zcr-context] [data-zcr-action="open-citation"]') && panel().querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length === 1 && !/tell me more about this|请用中文解释|请详细解释/u.test(visibleExplain));
    await until(() => panel()?.dataset.zcrGenerating === 'false', 'explain reaches a terminal state', 240000);
    const assistant = panel().querySelectorAll('[data-zcr-message][data-role="assistant"]');
    const outcome = { assistantMessages: assistant.length, lastStatus: assistant[assistant.length - 1]?.dataset.status ?? null, outputChars: Array.from(assistant).reduce((n, node) => n + (node.querySelector('[data-zcr-text]')?.textContent.trim().length ?? 0), 0), visibleError: alertText() };
    if (outcome.lastStatus === 'completed' && outcome.outputChars > 0) {
      await check('real-streamed-answer-completed', true, outcome);
      // follow-up on the same conversation
      const input = panel().querySelector('[data-zcr-input]'); input.value = '请再解释一下第二句。'; input.dispatchEvent(new win.Event('input', { bubbles: true }));
      click(panel().querySelector('[data-zcr-action="send"]'));
      await until(() => panel()?.querySelectorAll('[data-zcr-message][data-role="user"]').length === 2, 'follow-up recorded', 30000);
      await until(() => panel()?.dataset.zcrGenerating === 'true', 'follow-up generating', 30000);
      click(panel().querySelector('[data-zcr-action="stop"]'));
      await until(() => panel()?.dataset.zcrGenerating === 'false', 'stop reaches terminal state', 60000);
      await check('follow-up-stop-reaches-terminal', ['cancelled', 'completed'].includes(panel().querySelectorAll('[data-zcr-message][data-role="assistant"]')[1]?.dataset.status ?? 'cancelled'));
    } else {
      report.upstream = { ...outcome, notRun: ['real-streamed-answer-completed', 'follow-up-stop-reaches-terminal'] }; await save();
    }
    // --- attachment isolation: B gets its own conversation and draft ---
    const readerB = await openReader(attachmentB);
    await until(() => toggle(readerB), 'reader B toolbar');
    if (toggle(readerB).getAttribute('aria-pressed') !== 'true') click(toggle(readerB));
    await until(() => shell()?.dataset.attachmentKey === attachmentB.key && panel()?.dataset.zcrRuntime === 'ready', 'sidebar for B', 30000);
    await until(() => panel()?.dataset.zcrConversation, 'conversation bound for B');
    await check('sibling-attachment-has-empty-conversation-and-draft', panel().querySelectorAll('[data-zcr-message]').length === 0 && panel().querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length === 0);
    win.Zotero_Tabs.select(readerA().tabID);
    await until(() => shell()?.dataset.attachmentKey === attachmentA.key && panel()?.querySelectorAll('[data-zcr-message][data-role="user"]').length >= 1, 'A restored after switching back', 30000).catch(error => {
      report.switchBack = { selected: win.Zotero_Tabs.selectedID, attachment: shell()?.dataset.attachmentKey, users: panel()?.querySelectorAll('[data-zcr-message][data-role="user"]').length ?? 0, active: toggle(readerA)?.getAttribute('aria-pressed') };
      throw error;
    });
    await check('switching-back-restores-a-messages-and-draft', panel().querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length === 1);
    click(toggle(readerA)); await until(() => toggle(readerA)?.getAttribute('aria-pressed') === 'false', 'close A');
    click(toggle(readerA)); await until(() => panel()?.querySelectorAll('[data-zcr-message][data-role="user"]').length >= 1, 'reopen A', 30000);
    await check('close-reopen-keeps-history-and-draft', panel().querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length === 1);
    const beforeRestart = { messages: panel().querySelectorAll('[data-zcr-message]').length, conversation: panel().dataset.zcrConversation };
    await subject.disable(); await until(async () => !toggle(readerA) && (await ownProcesses()).length === 0, 'disable cleans owned runtime');
    await check('disable-stops-owned-process', (await ownProcesses()).length === 0);
    await subject.enable(); await until(() => toggle(readerA), 'reenable plugin'); click(toggle(readerA));
    await until(() => panel()?.dataset.zcrRuntime === 'ready' && panel()?.dataset.zcrConversation, 'restart native runtime', 90000);
    await check('plugin-login-survives-restart', panel().dataset.zcrAuth === 'signedIn');
    await check('conversation-restored-after-restart-without-resending', panel().dataset.zcrConversation === beforeRestart.conversation && panel().querySelectorAll('[data-zcr-message]').length === beforeRestart.messages && !panel().dataset.zcrActiveRequest, { beforeRestart, after: panel().querySelectorAll('[data-zcr-message]').length });
    const openCitationButton = panel().querySelector('[data-zcr-message] [data-zcr-action="open-citation"]');
    if (openCitationButton) {
      const viewer = () => viewWin().PDFViewerApplication.pdfViewer; viewer().currentPageNumber = viewer().pagesCount;
      await delay(300); click(openCitationButton); await delay(1500);
      await check('return-to-source-navigates-to-cited-page', viewer().currentPageNumber === 1, { page: viewer().currentPageNumber });
    }
    report.status = report.upstream ? 'passed-except-upstream-refusal' : 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.error = `${String(error)}\n${error?.stack || ''}`; report.finishedAt = new Date().toISOString(); await save(); }
}
this.runHostSmoke = runHostSmoke;
