/* global Zotero, ChromeUtils */
// Runs only in the separate test-driver addon inside the dedicated test profile.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), checks: [], status: 'running' };
  const delay = (ms) => Zotero.Promise.delay(ms);
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const check = async (name, ok, details = {}) => {
    report.checks.push({ name, ok: Boolean(ok), details });
    await save();
    if (!ok) throw new Error(`Host check failed: ${name}`);
  };
  const until = async (predicate, label, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = predicate();
      if (value) return value;
      await delay(50);
    }
    throw new Error(`Timed out: ${label}`);
  };
  const pdf = (reader) => (reader._internalReader?._lastView || reader._internalReader?._primaryView)
    ?._iframeWindow?.PDFViewerApplication?.pdfViewer;
  const toolbar = (reader) => reader._iframeWindow?.document.querySelector('[data-zcr-toggle]');
  const viewWidth = (reader) => reader._iframeWindow?.innerWidth;
  try {
    await Zotero.initializationPromise;
    await check('isolated-data-directory', Zotero.DataDirectory.dir === config.dataDir, { dataDir: Zotero.DataDirectory.dir });
    const win = await until(() => Zotero.getMainWindow(), 'main window');
    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView && win.Zotero_Tabs?.selectedID, 'main window UI ready');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const subject = await AddonManager.getAddonByID(config.subjectID);
    await check('development-xpi-loaded', subject?.isActive, { version: subject?.version });
    const parent = new Zotero.Item('book');
    parent.setField('title', 'ZCR synthetic host test - disposable');
    const notifierQueue = new Zotero.Notifier.Queue();
    await parent.saveTx({ notifierQueue });
    const first = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic paper A', saveOptions: { notifierQueue } });
    const second = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Synthetic supplement B', saveOptions: { notifierQueue } });
    await Promise.all([parent.loadAllData(), first.loadAllData(), second.loadAllData()]);
    const cachedItems = await Zotero.Items.getAsync([parent.id, first.id, second.id]);
    await Promise.all(cachedItems.map(item => item.loadAllData()));
    report.fixtureData = { parentSameObject: cachedItems[0] === parent, parentLoaded: { ...cachedItems[0]._loaded } };
    await save();
    await Zotero.Notifier.commit(notifierQueue);
    report.attachments = [first, second].map((item) => ({ id: item.id, key: item.key, libraryID: item.libraryID }));
    report.phase = 'opening-first-reader';
    await save();
    let reader = await Promise.race([
      Zotero.Reader.open(first.id),
      delay(15000).then(() => { throw new Error('Reader.open timed out'); }),
    ]);
    await until(() => toolbar(reader) && pdf(reader)?._location, 'reader + plugin toolbar');
    await delay(500);
    const button = toolbar(reader);
    const find = reader._iframeWindow.document.querySelector('button.find');
    await check('toolbar-before-find', button.getBoundingClientRect().right <= find.getBoundingClientRect().left);
    await check('single-toolbar-button', reader._iframeWindow.document.querySelectorAll('[data-zcr-toggle]').length === 1);
    win.ZoteroContextPane.collapsed = true;
    await reader.navigate({ dest: [0, { name: 'XYZ' }, 0, 600, null] });
    await delay(350);
    reader.zoomIn();
    await delay(300);
    report.nativeZoom = { scale: pdf(reader).currentScale, value: pdf(reader).currentScaleValue, location: { ...pdf(reader)._location } };
    await save();
    await until(() => typeof pdf(reader)?._location?.scale === 'number', 'native fixed zoom');
    await delay(150);
    const before = { width: viewWidth(reader), scale: pdf(reader).currentScale, location: { ...pdf(reader)._location } };
    toolbar(reader).click();
    await delay(300);
    report.openDiagnostic = {
      pressed: toolbar(reader)?.getAttribute('aria-pressed'),
      collapsed: win.ZoteroContextPane.collapsed,
      mode: win.ZoteroContextPane.context.mode,
      activeDetails: win.document.querySelectorAll('item-details.zcr-chat-active').length,
      sidebarCount: win.document.querySelectorAll('[data-zcr-sidebar]').length,
      type: reader.type,
      tabID: reader.tabID,
      selectedID: win.Zotero_Tabs.selectedID,
      readerWindowMatches: reader._window === win,
      buttonCount: reader._iframeWindow.document.querySelectorAll('[data-zcr-toggle]').length,
      scale: pdf(reader).currentScaleValue,
      selectedType: win.Zotero_Tabs.selectedType,
      registeredPanes: Zotero.ItemPaneManager.customSectionData.options.map(pane => pane.paneID),
      details: Array.from(win.document.querySelectorAll('#zotero-context-pane-item-deck > [data-tab-id]')).map(node => ({
        tabID: node.dataset.tabId, tabType: node.tabType, initialized: node.initialized, skipRender: node.skipRender, itemID: node.item?.id,
        sections: Array.from(node.querySelectorAll('item-pane-custom-section')).map(section => ({ pane: section.dataset.pane, hidden: section.hidden, body: Boolean(section.querySelector('[data-type="body"]')) })),
      })),
    };
    await save();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'true', 'sidebar open');
    await delay(500);
    const active = win.document.querySelector('item-details.zcr-chat-active');
    const panel = active?.querySelector('[data-zcr-sidebar]');
    const opened = { width: viewWidth(reader), scale: pdf(reader).currentScaleValue, location: { ...pdf(reader)._location } };
    await check('native-dock-shrinks-pdf', !win.ZoteroContextPane.collapsed && opened.width < before.width - 100, { before, opened });
    await check('opening-keeps-reading-anchor', opened.location.pageNumber === before.location.pageNumber && Math.abs(opened.location.top - before.location.top) < 3, { before: before.location, opened: opened.location });
    await check('development-preview-visible', panel && /Development preview|开发预览/.test(panel.textContent), { text: panel?.textContent?.slice(0, 600) });
    const panelRect = panel.getBoundingClientRect();
    const dockRect = win.document.getElementById('zotero-context-pane').getBoundingClientRect();
    await check('sidebar-uses-native-pane-height', panelRect.width > 180 && panelRect.height > dockRect.height * 0.75, {
      panel: { width: panelRect.width, height: panelRect.height },
      nativeDock: { width: dockRect.width, height: dockRect.height },
    });
    await check('attachment-identity-from-reader', panel?.textContent.includes(first.key), { expected: first.key });
    await check('fixed-zoom-adapts-to-width', opened.scale === 'page-width', { scale: opened.scale });
    await reader.navigate({ dest: [1, { name: 'XYZ' }, 0, 650, null] });
    await until(() => pdf(reader).currentPageNumber === 2 && pdf(reader)._location.pageNumber === 2, 'navigate to second page');
    await delay(300);
    const anchorBeforeClose = { ...pdf(reader)._location };
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'false', 'sidebar close');
    await delay(400);
    const closed = { width: viewWidth(reader), scale: pdf(reader).currentScale, location: { ...pdf(reader)._location } };
    await check('close-restores-width-and-fixed-zoom', Math.abs(closed.width - before.width) < 3 && Math.abs(closed.scale - before.scale) < 0.01, { before, closed });
    await check('close-keeps-current-page', pdf(reader).currentPageNumber === 2, { before: anchorBeforeClose, after: closed.location, pageNumber: pdf(reader).currentPageNumber });
    await check('closing-keeps-current-anchor', Math.abs(closed.location.top - anchorBeforeClose.top) < 3, { before: anchorBeforeClose, closed: closed.location });
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'true', 'second open');
    await delay(250);
    reader.zoomIn();
    await delay(250);
    const manual = pdf(reader).currentScale;
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'false', 'second close');
    await delay(350);
    await check('manual-zoom-wins', Math.abs(pdf(reader).currentScale - manual) < 0.01, { manual, current: pdf(reader).currentScale });
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'true', 'open before native toggle');
    reader._iframeWindow.document.querySelector('button.context-pane-toggle').click();
    await until(() => win.ZoteroContextPane.collapsed && toolbar(reader)?.getAttribute('aria-pressed') === 'false', 'native close clears chat mode');
    reader._iframeWindow.document.querySelector('button.context-pane-toggle').click();
    await until(() => !win.ZoteroContextPane.collapsed, 'native context reopens');
    await delay(200);
    await check('native-toggle-shows-native-content', win.document.querySelectorAll('item-details.zcr-chat-active').length === 0);
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'true', 'codex selects its own content');
    await check('codex-toggle-selects-chat-content', win.document.querySelectorAll('item-details.zcr-chat-active [data-zcr-sidebar]').length === 1);
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'false', 'restore native content');
    await check('close-restores-previous-native-pane', !win.ZoteroContextPane.collapsed && win.document.querySelectorAll('item-details.zcr-chat-active').length === 0);
    for (let i = 0; i < 3; i++) {
      await subject.disable();
      await until(() => !toolbar(reader), `disable ${i}`);
      await subject.enable();
      await until(() => toolbar(reader), `enable ${i}`);
      await check(`enable-disable-cycle-${i + 1}`, reader._iframeWindow.document.querySelectorAll('[data-zcr-toggle]').length === 1);
    }
    reader = await Zotero.Reader.open(second.id);
    await until(() => toolbar(reader) && pdf(reader)?._location, 'second attachment');
    toolbar(reader).click();
    await until(() => toolbar(reader)?.getAttribute('aria-pressed') === 'true', 'second attachment panel');
    await delay(300);
    const secondPanel = win.document.querySelector('item-details.zcr-chat-active [data-zcr-sidebar]');
    await check('siblings-have-distinct-identities', secondPanel?.textContent.includes(second.key) && !secondPanel?.textContent.includes(first.key), { expected: second.key });
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

// The test-only bootstrap reads this function from its isolated script scope.
this.runHostSmoke = runHostSmoke;
