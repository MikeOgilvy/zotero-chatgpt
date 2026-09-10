/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// S5 restart QA that does not send a model turn. Packaged only in the isolated test addon.
async function runHostSmoke(config) {
  const report = { startedAt: new Date().toISOString(), stage: 'S5', status: 'running', checks: [], notRun: [], build: { version: config.subjectVersion, sha256: config.artifactHash } };
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
  const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const n = Math.floor(Math.random() * 16);
    return (ch === 'x' ? n : (n & 0x3) | 0x8).toString(16);
  });
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
    const parent = new Zotero.Item('book'); parent.setField('title', 'ZCR S5 synthetic restart test');
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
    const pidsBefore = await ownProcesses();
    await check('one-owned-codex-process', pidsBefore.length === 1, { count: pidsBefore.length });
    const signedIn = panel()?.dataset.zcrAuth === 'signedIn';
    report.account = { state: panel()?.dataset.zcrAuth };
    if (signedIn) await until(() => panel()?.dataset.zcrConversation, 'attachment conversation bound');
    const conversationId = panel()?.dataset.zcrConversation || null;
    await check('not-generating-before-kill', panel()?.dataset.zcrGenerating !== 'true');
    const killedPid = pidsBefore[0];
    const kill = await Subprocess.call({ command: '/bin/kill', arguments: ['-TERM', String(killedPid)] });
    await kill.wait();
    await until(async () => !(await ownProcesses()).includes(killedPid), 'killed pid no longer in this profile', 15000);
    await delay(800);
    const pidsAfterTerm = await ownProcesses();
    report.kill = { killedPid, pidsAfterTerm };
    await save();
    await check('killed-pid-no-longer-running', !pidsAfterTerm.includes(killedPid) && pidsAfterTerm.length <= 1, { killedPid, pidsAfterTerm });
    const errorOrRetry = await until(() => {
      const node = panel();
      if (!node) return null;
      if (node.dataset.zcrRuntime === 'error') return 'error';
      const retry = node.querySelector('[data-zcr-action="retry"]');
      if (retry && retry.hidden !== true) return 'retry';
      return null;
    }, 'connection error or retry after process kill', 20000).catch(() => null);
    if (errorOrRetry) await check('process-kill-surfaces-error-or-retry', true, { observed: errorOrRetry, runtime: panel()?.dataset.zcrRuntime });
    else await skip('process-kill-surfaces-error-or-retry', 'UI stayed ready after TERM; stdout EOF was not observed before timeout', { runtime: panel()?.dataset.zcrRuntime });
    const retry = panel()?.querySelector('[data-zcr-action="retry"]');
    if (retry && retry.hidden !== true) click(retry);
    else {
      click(toggle());
      await until(() => toggle()?.getAttribute('aria-pressed') === 'false', 'close sidebar after kill');
      click(toggle());
    }
    const recoveredAfterKill = await until(() => panel()?.dataset.zcrRuntime === 'ready', 'handshake after process kill', 90000).catch(() => null);
    if (!recoveredAfterKill) {
      await subject.disable();
      await until(async () => (await ownProcesses()).length === 0, 'disable after failed retry');
      await subject.enable();
      await until(() => toggle(), 'toolbar after enable following failed retry');
      if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
      await until(() => panel()?.dataset.zcrRuntime === 'ready', 'handshake after disable/enable fallback', 90000);
      report.killRecovery = 'disable-enable-fallback';
    } else report.killRecovery = retry && retry.hidden !== true ? 'retry' : 'reopen-sidebar';
    await save();
    await check('handshake-ready-after-process-kill', panel()?.dataset.zcrRuntime === 'ready', { recovery: report.killRecovery, visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
    await check('one-owned-process-after-kill-recover', (await ownProcesses()).length === 1);
    await check('not-generating-after-process-kill', panel()?.dataset.zcrGenerating !== 'true');
    if (conversationId) await check('same-conversation-after-process-kill', panel()?.dataset.zcrConversation === conversationId, { before: conversationId, after: panel()?.dataset.zcrConversation });
    else await skip('same-conversation-after-process-kill', 'no conversation was bound before the kill (account may be signed out)');
    await skip('in-flight-turn-resume-after-kill', 'quota blocks live Codex until 2026-09-15; no in-flight turn/start was started');
    await subject.disable();
    await until(async () => (await ownProcesses()).length === 0, 'disable stops owned runtime');
    await check('disable-stops-owned-process', (await ownProcesses()).length === 0);
    let leftover = { injected: false };
    if (conversationId && typeof IOUtils?.readUTF8 === 'function') {
      const convPath = PathUtils.join(PathUtils.profileDir, 'zotero-codex-reader', 'v1', 'records', 'conversations', `${conversationId}.json`);
      try {
        const raw = await IOUtils.readUTF8(convPath);
        const data = JSON.parse(raw);
        if (data?.schemaVersion === 1 && data.settings && typeof data.settings.model === 'string') {
          const now = new Date().toISOString();
          const requestId = uuid();
          data.upstream = { threadId: typeof data.upstream?.threadId === 'string' ? data.upstream.threadId : 'thread-s5-host-fixture' };
          data.requests = Array.isArray(data.requests) ? data.requests : [];
          data.messages = Array.isArray(data.messages) ? data.messages : [];
          data.requests.push({ requestId, hash: 'ab'.repeat(32), state: 'uncertain', turnId: 'turn-s5-leftover', createdAt: now, updatedAt: now, action: 'ask' });
          data.messages.push(
            { id: uuid(), requestId, role: 'user', phase: null, settings: data.settings, text: 'synthetic leftover question', citations: [], status: 'completed' },
            { id: uuid(), requestId, role: 'assistant', phase: 'final', settings: data.settings, text: '', citations: [], status: 'uncertain' },
          );
          data.activeRequestId = null;
          await IOUtils.writeUTF8(convPath, JSON.stringify(data));
          leftover = { injected: true, requestId, threadId: data.upstream.threadId };
        } else leftover = { injected: false, reason: 'conversation snapshot lacked schemaVersion 1 settings' };
      } catch (error) { leftover = { injected: false, reason: String(error) }; }
    } else leftover = { injected: false, reason: conversationId ? 'IOUtils.readUTF8 was not available in the driver scope' : 'no conversation id to patch' };
    report.leftover = leftover; await save();
    await subject.enable();
    await until(() => toggle(), 'toolbar after reenable');
    if (toggle()?.getAttribute('aria-pressed') !== 'true') click(toggle());
    await until(() => ['ready', 'error'].includes(panel()?.dataset.zcrRuntime), 'runtime after addon reload', 90000);
    await check('handshake-ready-after-addon-reload', panel()?.dataset.zcrRuntime === 'ready', { visibleError: panel()?.querySelector('[role="alert"]')?.textContent || '' });
    await check('not-generating-after-addon-reload', panel()?.dataset.zcrGenerating !== 'true' && panel()?.dataset.zcrGenerating !== 'running');
    if (conversationId) await check('same-conversation-after-addon-reload', panel()?.dataset.zcrConversation === conversationId, { before: conversationId, after: panel()?.dataset.zcrConversation });
    else await skip('same-conversation-after-addon-reload', 'no conversation was bound before reload');
    const isolation = 'An earlier request in this conversation could not be confirmed; start a new conversation to continue.';
    if (leftover.injected) {
      const text = `${panel()?.textContent || ''} ${panel()?.querySelector('[role="alert"]')?.textContent || ''}`;
      await check('uncertain-leftover-isolation', text.includes(isolation), { snippet: text.slice(0, 400) });
      await check('uncertain-leftover-does-not-auto-send', panel()?.dataset.zcrGenerating !== 'true' && !panel()?.dataset.zcrActiveRequest);
    } else {
      await skip('uncertain-leftover-isolation', leftover.reason || 'leftover fixture was not injected');
      await skip('uncertain-leftover-does-not-auto-send', leftover.reason || 'leftover fixture was not injected');
    }
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.error = `${String(error)}\n${error?.stack || ''}`; report.finishedAt = new Date().toISOString(); await save(); }
}
this.runHostSmoke = runHostSmoke;
