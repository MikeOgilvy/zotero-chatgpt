/* global Zotero, ChromeUtils, Cu */
// S4 host checks that do not send to Codex. Packaged only in the isolated test addon.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'S4', status: 'running', checks: [], build: { version: config.subjectVersion, sha256: config.artifactHash } };
  const delay = ms => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  report.notRun = report.notRun || [];
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
    Zotero.Prefs.set('extensions.zcr.sidebarWidth', 900, true);
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCR S4 synthetic reading test');
    const notifierQueue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper A', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]);
    const cached = await Zotero.Items.getAsync([parent.id, attachment.id]); await Promise.all(cached.map(item => item.loadAllData()));
    await Zotero.Notifier.commit(notifierQueue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close restored reader tabs');
    const opened = await Zotero.Reader.open(attachment.id); const tabID = opened.tabID;
    await until(() => Zotero.Reader.getByTabID(tabID)?._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.length, 'pdf viewer', 30000);
    const reader = () => {
      const current = Zotero.Reader.getByTabID(tabID);
      if (!current) throw new Error('The test reader tab was closed while the run was in progress; leave the dedicated Zotero window untouched during a host run.');
      return current;
    };
    const toggle = () => { try { return reader()._iframeWindow?.document.querySelector('[data-zcr-toggle]') ?? null; } catch (error) { if (String(error).includes('dead object')) throw new Error('The test reader was unloaded while the run was in progress.'); throw error; } };
    const chatDoc = () => { try { return reader()._iframeWindow?.document; } catch { return null; } };
    const panel = () => chatDoc()?.querySelector('[data-zcr-chat]');
    const dock = () => chatDoc()?.querySelector('[data-zcr-dock]');
    await until(() => toggle(), 'reader toolbar');
    win.ZoteroContextPane.collapsed = true; click(toggle());
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'native runtime initialization', 90000);
    await check('native-runtime-handshake-ready', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
    await check('katex-stylesheet-loaded', !!win.document.querySelector('link[href*="katex.min.css"]'));
    const model = () => panel()?.querySelector('[data-zcr-setting="model"]');
    const speed = () => panel()?.querySelector('[data-zcr-setting="speed"]');
    const effort = () => panel()?.querySelector('[data-zcr-setting="effort"]');
    const picker = () => panel()?.querySelector('[data-zcr-picker]');
    const openPicker = () => {
      const node = picker();
      if (node && node.getAttribute('aria-expanded') !== 'true' && !node.disabled) click(node);
    };
    await check('composer-controls-present', !!picker() && !!panel()?.querySelector('[data-zcr-picker-menu]'));
    const paneWidth = dock()?.getBoundingClientRect().width ?? 0;
    const storedWidth = Zotero.Prefs.get('extensions.zcr.sidebarWidth', true);
    await check('sidebar-width-honors-stored-900', Number(storedWidth) === 900 && paneWidth > 0, { paneWidth, pref: storedWidth });
    const readerToolbar = chatDoc()?.querySelector('.toolbar');
    await check('reader-toolbar-has-only-codex-toggle', !!toggle() && !readerToolbar?.querySelector('.zcr-chrome, [data-zcr-action="new-conversation"], [data-zcr-action="history"], [data-zcr-context-title]'), { toggle: !!toggle() });
    await check('plugin-chrome-stays-in-sidebar', !!panel()?.querySelector('.zcr-chrome') && !!panel()?.querySelector('[data-zcr-action="new-conversation"]') && !readerToolbar?.querySelector('.zcr-chrome') && !win.document.querySelector('#zotero-context-pane .zcr-chrome, #zotero-context-pane [data-zcr-chat]'));
    const signedIn = panel()?.dataset.zcrAuth === 'signedIn';
    report.account = { state: panel()?.dataset.zcrAuth };
    if (signedIn) {
      await until(() => panel()?.dataset.zcrConversation, 'attachment conversation bound');
      openPicker();
      const modelOptions = panel()?.querySelectorAll('[data-zcr-picker-menu] [data-zcr-setting="model"]');
      const effortOptions = panel()?.querySelectorAll('[data-zcr-picker-menu] [data-zcr-setting="effort"]');
      await check('catalog-model-options-loaded', (modelOptions?.length ?? 0) >= 1 && !picker()?.disabled, { models: modelOptions?.length ?? 0 });
      await check('speed-and-effort-are-independent', (effortOptions?.length ?? 0) >= 1 && (!speed() || speed().getAttribute('role') === 'switch'), { effort: effortOptions?.length ?? 0, speedRole: speed()?.getAttribute('role') || '' });
      const history = panel()?.querySelector('[data-zcr-history]');
      const currentId = panel().dataset.zcrConversation;
      await check('conversation-history-lists-current', !!currentId && !!history && (history.hidden || !!history.querySelector(`[data-zcr-conversation-id="${currentId}"]`)));
      await check('new-conversation-available', !!panel()?.querySelector('[data-zcr-action="new-conversation"]'));
      await check('copy-diagnostics-hidden-from-sidebar', !panel()?.querySelector('[data-zcr-action="copy-diagnostics"]'));
    } else {
      report.notRun = ['catalog-model-options-loaded', 'speed-and-effort-are-independent', 'conversation-history-lists-current', 'new-conversation-available', 'copy-diagnostics-hidden-from-sidebar'];
    }
    const startPressed = toggle()?.getAttribute('aria-pressed');
    for (let i = 0; i < 10; i++) {
      const want = toggle()?.getAttribute('aria-pressed') === 'true' ? 'false' : 'true';
      click(toggle());
      await until(() => toggle()?.getAttribute('aria-pressed') === want, `toolbar toggle cycle ${i + 1}`);
    }
    await check('toolbar-toggle-ten-cycles', toggle()?.getAttribute('aria-pressed') === startPressed);
    if (toggle()?.getAttribute('aria-pressed') !== 'true') {
      click(toggle());
      await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'sidebar reopened after toggle cycles');
    }
    const view = () => reader()._internalReader._primaryView;
    const viewWin = () => view()._iframeWindow;
    const readerDoc = () => reader()._iframeWindow.document;
    const selectionPopup = () => readerDoc().querySelector('.selection-popup');
    const bar = () => readerDoc().querySelector('[data-zcr-selection-bar]');
    const selectText = async () => {
      await until(() => view()._pdfPages?.[0]?.chars?.length > 8, 'page character data loaded', 30000);
      const w = viewWin(); w.PDFViewerApplication.pdfViewer.currentPageNumber = 1; await delay(400);
      const spans = await until(() => {
        const nodes = Array.from(w.document.querySelectorAll('.page[data-page-number="1"] .textLayer span')).filter(s => {
          const r = s.getBoundingClientRect();
          return s.textContent.trim().length > 2 && r.width > 0 && r.top > 8 && r.bottom < w.innerHeight - 8 && r.left >= 0 && r.right <= w.innerWidth;
        });
        return nodes.length >= 3 ? nodes : null;
      }, 'visible text layer', 30000);
      const first = spans[0].getBoundingClientRect(); const last = spans[2].getBoundingClientRect();
      const start = { x: first.left + 2, y: first.top + first.height / 2 }; const end = { x: last.right - 2, y: last.top + last.height / 2 };
      const target = w.document.elementFromPoint(start.x, start.y) || spans[0];
      const v = view();
      const ev = (x, y, extra = {}) => Cu.cloneInto({ target, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, ...extra }, w, { cloneFunctions: true, wrapReflectors: true });
      v._pointerDownTriggered = false; v._handlePointerDown(ev(start.x, start.y));
      await delay(60); v._handlePointerMove(ev(end.x, end.y, { dataTransfer: null })); await delay(120);
      v._handlePointerUp(ev(end.x, end.y, { button: 0 }));
      await until(() => selectionPopup(), 'native popup', 4000).catch(() => null);
      if (!selectionPopup()) {
        target.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: start.x, clientY: start.y }));
        await delay(80);
        target.dispatchEvent(new w.PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', buttons: 1, clientX: end.x, clientY: end.y }));
        await delay(120);
        target.dispatchEvent(new w.PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', button: 0, clientX: end.x, clientY: end.y }));
        await until(() => selectionPopup(), 'native popup after drag', 4000).catch(() => null);
      }
      if (!selectionPopup()) throw new Error('native selection popup did not appear');
      return until(() => bar(), 'plugin action bar', 5000);
    };
    let selected = false;
    for (let attempt = 0; attempt < 3 && !selected; attempt++) { try { await selectText(); selected = true; } catch (error) { report.selectionAttempt = String(error); await save(); await delay(500); } }
    await check('selection-popup-and-action-bar-appear', selected);
    const popupRect = selectionPopup().getBoundingClientRect(); const barRect = bar().getBoundingClientRect();
    const frameRect = view()._iframe.getBoundingClientRect();
    await check('action-bar-stays-inside-view-without-covering-popup', barRect.top >= frameRect.top && barRect.left >= frameRect.left && barRect.right <= frameRect.right && barRect.bottom <= frameRect.bottom && (barRect.bottom <= popupRect.top || barRect.top >= popupRect.bottom || barRect.right <= popupRect.left || barRect.left >= popupRect.right), { bar: barRect.toJSON(), popup: popupRect.toJSON() });
    const barInsideViewWithoutCovering = (barBox, popupBox, frameBox) => barBox.top >= frameBox.top && barBox.left >= frameBox.left && barBox.right <= frameBox.right && barBox.bottom <= frameBox.bottom && (barBox.bottom <= popupBox.top || barBox.top >= popupBox.bottom || barBox.right <= popupBox.left || barBox.left >= popupBox.right);
    const fontTokens = value => String(value).split(',').map(part => part.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean);
    const systemFamilies = new Set(['-apple-system', 'system-ui', 'blinkmacsystemfont', 'ui-sans-serif', 'sans-serif']);
    const fontsShareFamily = (a, b) => {
      const left = fontTokens(a); const right = fontTokens(b);
      return left.some(token => right.includes(token) || (systemFamilies.has(token) && right.some(other => systemFamilies.has(other))));
    };
    const parseRgb = color => {
      const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/u);
      return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null;
    };
    const vivid = color => {
      const rgb = parseRgb(color);
      if (!rgb) return false;
      const max = Math.max(rgb.r, rgb.g, rgb.b); const min = Math.min(rgb.r, rgb.g, rgb.b);
      return max - min > 90 && max > 170;
    };
    const nativeSearch = win.document.querySelector('#zotero-tb-search, #zotero-tb-search-textbox, .quick-search-textbox')
      || reader()._iframeWindow.document.querySelector('button.find');
    const chatButton = panel()?.querySelector('.zcr-button');
    const chatSelect = panel()?.querySelector('[data-zcr-setting], .zcr-menu, [data-zcr-picker]');
    if (chatButton && nativeSearch) {
      const chatFont = win.getComputedStyle(chatButton).fontFamily;
      const searchFont = (nativeSearch.ownerDocument.defaultView || win).getComputedStyle(nativeSearch).fontFamily;
      const chatColor = win.getComputedStyle(chatButton).color;
      const chatBg = win.getComputedStyle(chatButton).backgroundColor;
      const panelBg = win.getComputedStyle(panel()).backgroundColor;
      await check('chat-controls-inherit-host-font', fontsShareFamily(chatFont, searchFont), { chatFont, searchFont });
      await check('chat-controls-are-not-brand-chrome', !vivid(chatColor) && !vivid(chatBg) && !vivid(panelBg), { chatColor, chatBg, panelBg });
    } else {
      await skip('chat-controls-inherit-host-font', 'native search control or chat button was not found');
      await skip('chat-controls-are-not-brand-chrome', 'native search control or chat button was not found');
    }
    if (chatSelect || picker()) {
      openPicker();
      const selectRect = (panel()?.querySelector('[data-zcr-setting="model"]') || picker() || chatSelect).getBoundingClientRect();
      const pickerRect = picker()?.getBoundingClientRect();
      await check('composer-settings-remain-readable', (selectRect.width > 24 && selectRect.height > 12) || ((pickerRect?.width ?? 0) > 24 && (pickerRect?.height ?? 0) > 12), { width: selectRect.width, height: selectRect.height, picker: pickerRect });
    } else await skip('composer-settings-remain-readable', 'composer select was not in the panel');
    const themePref = 'extensions.zotero.theme';
    let previousTheme;
    try { previousTheme = Zotero.Prefs.get(themePref, true); } catch { previousTheme = undefined; }
    const sampleTheme = () => {
      const node = panel();
      if (!node) return null;
      const cs = win.getComputedStyle(node);
      const liveButton = node.querySelector('.zcr-button');
      const buttonCs = liveButton ? win.getComputedStyle(liveButton) : cs;
      return { background: cs.backgroundColor, color: cs.color, buttonBackground: buttonCs.backgroundColor, buttonColor: buttonCs.color };
    };
    const beforeTheme = sampleTheme();
    const nextTheme = previousTheme === 'dark' ? 'light' : 'dark';
    let themeSwitched = false;
    try {
      if (previousTheme !== undefined) {
        Zotero.Prefs.set(themePref, nextTheme, true);
        await delay(800);
        const afterTheme = sampleTheme();
        themeSwitched = Boolean(beforeTheme && afterTheme && (beforeTheme.background !== afterTheme.background || beforeTheme.color !== afterTheme.color || beforeTheme.buttonBackground !== afterTheme.buttonBackground));
        report.theme = { previous: previousTheme, next: nextTheme, before: beforeTheme, after: afterTheme, switched: themeSwitched };
        await save();
        if (themeSwitched) await check('native-theme-restyles-chat', true, report.theme);
        else await skip('native-theme-restyles-chat', 'extensions.zotero.theme did not change computed chat colors without a restart', report.theme);
      } else await skip('native-theme-restyles-chat', 'extensions.zotero.theme was not readable');
    } finally {
      if (previousTheme !== undefined) try { Zotero.Prefs.set(themePref, previousTheme, true); } catch { /* restore best-effort */ }
    }
    const pdfViewer = () => viewWin().PDFViewerApplication.pdfViewer;
    const ensureSidebar = async wantOpen => {
      const pressed = toggle()?.getAttribute('aria-pressed') === 'true';
      if (pressed === wantOpen) return;
      click(toggle());
      await until(() => (toggle()?.getAttribute('aria-pressed') === 'true') === wantOpen, wantOpen ? 'open sidebar' : 'close sidebar');
      if (wantOpen) await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'runtime after sidebar open', 90000);
      await delay(400);
    };
    const zoomModes = ['auto', 'page-fit', 'page-width'];
    for (const mode of zoomModes) {
      await ensureSidebar(false);
      pdfViewer().currentScaleValue = mode;
      await delay(450);
      const pageBefore = pdfViewer().currentPageNumber;
      const valueBefore = String(pdfViewer().currentScaleValue);
      await ensureSidebar(true);
      const afterOpen = { page: pdfViewer().currentPageNumber, scale: String(pdfViewer().currentScaleValue) };
      await check(`zoom-${mode}-open-keeps-page`, afterOpen.page === pageBefore, { pageBefore, afterOpen, valueBefore });
      await ensureSidebar(false);
      const afterClose = { page: pdfViewer().currentPageNumber, scale: String(pdfViewer().currentScaleValue) };
      await check(`zoom-${mode}-close-keeps-page-and-mode`, afterClose.page === pageBefore && (afterClose.scale === mode || afterClose.scale === valueBefore), { pageBefore, afterClose, valueBefore });
    }
    await ensureSidebar(false);
    pdfViewer().currentScale = 1.25;
    await delay(400);
    const fixedBefore = { page: pdfViewer().currentPageNumber, scale: pdfViewer().currentScale };
    await ensureSidebar(true);
    await check('fixed-zoom-open-keeps-page', pdfViewer().currentPageNumber === fixedBefore.page, { fixedBefore, page: pdfViewer().currentPageNumber, scale: pdfViewer().currentScaleValue });
    await ensureSidebar(false);
    await delay(350);
    await check('fixed-zoom-close-restores-numeric-scale', Math.abs(pdfViewer().currentScale - fixedBefore.scale) < 0.05 && pdfViewer().currentPageNumber === fixedBefore.page, { fixedBefore, after: { page: pdfViewer().currentPageNumber, scale: pdfViewer().currentScale } });
    await ensureSidebar(true);
    const zoomIn = reader()._iframeWindow.document.getElementById('zoomIn');
    if (zoomIn) {
      const pageWhileOpen = pdfViewer().currentPageNumber;
      click(zoomIn);
      await delay(300);
      const manual = pdfViewer().currentScale;
      await ensureSidebar(false);
      await delay(350);
      await check('manual-zoom-while-open-wins-on-close', Math.abs(pdfViewer().currentScale - manual) < 0.02 && pdfViewer().currentPageNumber === pageWhileOpen, { manual, after: pdfViewer().currentScale, pageWhileOpen });
    } else await skip('manual-zoom-while-open-wins-on-close', 'reader zoomIn control was not found');
    await ensureSidebar(true);
    pdfViewer().currentPageNumber = 2;
    await delay(400);
    const pageTwo = pdfViewer().currentPageNumber;
    await ensureSidebar(false);
    await delay(350);
    await check('close-after-page-change-keeps-new-page', pdfViewer().currentPageNumber === pageTwo, { pageTwo, after: pdfViewer().currentPageNumber });
    pdfViewer().currentPageNumber = 1;
    await delay(250);
    await ensureSidebar(true);
    const originalWindow = { w: win.outerWidth, h: win.outerHeight, x: win.screenX, y: win.screenY, inner: win.innerWidth };
    const paneEl = () => dock();
    try {
      for (const width of [800, 1024, 1440]) {
        const chromeX = Math.max(0, win.outerWidth - win.innerWidth);
        win.resizeTo(width + chromeX, Math.max(originalWindow.h, 900));
        await delay(700);
        const actualInner = win.innerWidth;
        const actualOuter = win.outerWidth;
        if (Math.abs(actualInner - width) > 80) {
          await skip(`window-${width}-keeps-dock-and-reader`, `could not set innerWidth to ${width} CSS px (inner ${actualInner}, outer ${actualOuter})`, { requested: width, actualInner, actualOuter });
          await skip(`window-${width}-composer-usable`, `window did not reach ${width} CSS px`);
          continue;
        }
        const paneW = paneEl()?.getBoundingClientRect().width ?? 0;
        const primaryBox = chatDoc()?.querySelector('#primary-view')?.getBoundingClientRect();
        const dockBox = paneEl()?.getBoundingClientRect();
        const readerInner = view()._iframeWindow?.innerWidth ?? 0;
        const overlay = !!(dockBox && primaryBox && dockBox.left < primaryBox.right - 8 && dockBox.right > primaryBox.left + 8 && dockBox.top < primaryBox.bottom - 8);
        const docked = paneW > 0 && readerInner > 160 && !overlay && !!primaryBox && primaryBox.width > 160;
        await check(`window-${width}-keeps-dock-and-reader`, docked, { paneW, readerInner, actualInner, overlay, primary: primaryBox?.toJSON?.() ?? null, layout: Zotero.Prefs.get('layout') });
        openPicker();
        const modelBox = model()?.getBoundingClientRect();
        const pickerBox = picker()?.getBoundingClientRect();
        const composerUsable = Boolean(picker()) && ((modelBox?.width ?? 0) > 32 && (modelBox?.height ?? 0) > 10 || (pickerBox?.width ?? 0) > 32 && (pickerBox?.height ?? 0) > 10);
        await check(`window-${width}-composer-usable`, composerUsable, { model: modelBox?.toJSON?.() ?? null, picker: pickerBox?.toJSON?.() ?? null, paneW, readerInner });
      }
    } finally {
      try { win.resizeTo(originalWindow.w, originalWindow.h); win.moveTo(originalWindow.x, originalWindow.y); } catch { /* restore best-effort */ }
      await delay(400);
    }
    const collections = win.document.getElementById('zotero-collections-pane');
    if (collections) {
      const readerBefore = view()._iframe.getBoundingClientRect().width;
      const collapsedBefore = collections.collapsed === true || collections.hidden === true || collections.getBoundingClientRect().width < 8;
      await check('collections-pane-does-not-cover-chat', Boolean(panel()) && (dock()?.getBoundingClientRect().width ?? 0) > 0, { collectionsWidth: collections.getBoundingClientRect().width, readerBefore, collapsedBefore });
    } else await skip('collections-pane-does-not-cover-chat', 'collections pane element was not found');
    const context = win.ZoteroContextPane?.context;
    if (context && typeof context.mode === 'string') {
      context.mode = 'notes';
      if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = false;
      await delay(500);
      const chatReleased = !dock();
      await check('notes-mode-releases-chat-dock', Boolean(chatReleased) && context.mode === 'notes', { mode: context.mode, dock: !!dock() });
      if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
      await until(() => panel() && ['ready', 'error'].includes(panel().dataset.zcrRuntime), 'reopen chat after notes', 90000);
      await check('codex-reopens-after-notes-mode', !!panel() && panel().dataset.zcrRuntime === 'ready');
    } else {
      await skip('notes-mode-releases-chat-dock', 'ZoteroContextPane.context.mode was not available');
      await skip('codex-reopens-after-notes-mode', 'native notes mode could not be switched');
    }
    const visibleSpans = () => {
      const w = viewWin();
      const viewHeight = w.innerHeight; const viewWidth = w.innerWidth;
      return Array.from(w.document.querySelectorAll('.page[data-page-number="1"] .textLayer span')).filter(node => {
        const box = node.getBoundingClientRect();
        return node.textContent.trim().length > 2 && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < viewHeight && box.left < viewWidth && box.right > 0;
      });
    };
    const selectAtEdge = async edge => {
      await until(() => view()._pdfPages?.[0]?.chars?.length > 8, 'page character data loaded', 30000);
      const w = viewWin();
      w.PDFViewerApplication.pdfViewer.currentPageNumber = 1;
      const container = w.PDFViewerApplication.pdfViewer.container;
      if (edge === 'top') container.scrollTop = 0;
      if (edge === 'bottom') {
        const page = w.document.querySelector('.page[data-page-number="1"]');
        const pageBottom = page ? page.offsetTop + page.offsetHeight : container.scrollHeight;
        container.scrollTop = Math.max(0, pageBottom - container.clientHeight);
      }
      await delay(400);
      const ranked = visibleSpans().slice().sort((a, b) => {
        const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
        if (edge === 'top') return ar.top - br.top;
        if (edge === 'bottom') return br.bottom - ar.bottom;
        if (edge === 'left') return ar.left - br.left;
        return br.right - ar.right;
      });
      if (ranked.length < 2) throw new Error(`no visible spans near ${edge}`);
      const first = ranked[0].getBoundingClientRect();
      const last = ranked[Math.min(2, ranked.length - 1)].getBoundingClientRect();
      const start = { x: first.left + Math.min(4, first.width / 3), y: first.top + first.height / 2 };
      const end = { x: last.right - Math.min(4, last.width / 3), y: last.top + last.height / 2 };
      const target = w.document.elementFromPoint(start.x, start.y) || ranked[0];
      const v = view();
      const ev = (x, y, extra = {}) => Cu.cloneInto({ target, clientX: x, clientY: y, button: 0, buttons: 1, detail: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, ...extra }, w, { cloneFunctions: true, wrapReflectors: true });
      v._pointerDownTriggered = false; v._handlePointerDown(ev(start.x, start.y));
      await delay(60); v._handlePointerMove(ev(end.x, end.y, { dataTransfer: null })); await delay(120);
      v._handlePointerUp(ev(end.x, end.y, { button: 0 }));
      await until(() => selectionPopup(), 'native popup', 4000).catch(() => null);
      if (!selectionPopup()) throw new Error(`native popup missing at ${edge}`);
      await until(() => bar(), 'plugin action bar', 5000);
      return { edge, bar: bar().getBoundingClientRect(), popup: selectionPopup().getBoundingClientRect(), frame: view()._iframe.getBoundingClientRect() };
    };
    const dismissSelection = async () => {
      const w = viewWin();
      try { w.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      w.document.body.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 4, clientY: 4 }));
      await delay(250);
    };
    const edgeResults = {};
    await ensureSidebar(true);
    for (const edge of ['top', 'left', 'right', 'bottom']) {
      let placed = false;
      for (let attempt = 0; attempt < 2 && !placed; attempt++) {
        try {
          const geometry = await selectAtEdge(edge);
          edgeResults[edge] = geometry;
          placed = true;
          await check(`selection-bar-${edge}-stays-in-view-without-covering-popup`, barInsideViewWithoutCovering(geometry.bar, geometry.popup, geometry.frame), geometry);
        } catch (error) {
          report.selectionAttempt = String(error);
          await save();
          await delay(400);
        }
      }
      if (!placed) await skip(`selection-bar-${edge}-stays-in-view-without-covering-popup`, `could not select visible text at the ${edge} edge`, { lastError: report.selectionAttempt });
      await dismissSelection();
    }
    report.edges = Object.fromEntries(Object.entries(edgeResults).map(([edge, geometry]) => [edge, { bar: geometry.bar.toJSON?.() ?? geometry.bar, popup: geometry.popup.toJSON?.() ?? geometry.popup }]));
    await save();
    let askReady = false;
    for (let attempt = 0; attempt < 3 && !askReady; attempt++) {
      try { await selectText(); askReady = true; } catch (error) { report.selectionAttempt = String(error); await save(); await delay(400); }
    }
    if (askReady && bar()?.querySelector('[data-zcr-action="ask"]')) {
      const popupBeforeAsk = selectionPopup();
      const nativeColors = popupBeforeAsk?.querySelector('.colors');
      await check('native-annotation-panel-intact-before-ask', Boolean(nativeColors) && !popupBeforeAsk.contains(bar()), { hasColors: !!nativeColors });
      click(bar().querySelector('[data-zcr-action="ask"]'));
      await until(() => panel()?.querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length >= 1, 'ask draft citation', 15000);
      await check('ask-adds-draft-without-sending', panel().querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]').length >= 1 && panel().dataset.zcrGenerating !== 'true' && !panel().dataset.zcrActiveRequest);
    } else {
      await skip('ask-adds-draft-without-sending', 'could not recreate a selection for Ask in sidechat');
      await skip('native-annotation-panel-intact-before-ask', 'Ask in sidechat was not clicked');
    }
    await skip('a23-a24-model-send-combinations', 'quota blocks live Codex until 2026-09-15; driver does not send');
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.error = `${String(error)}\n${error?.stack || ''}`; report.finishedAt = new Date().toISOString(); await save(); }
}
this.runHostSmoke = runHostSmoke;
