/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// Recover one explicit completed real-model organization response through the installed UI. This
// stage starts no model turn and injects no fixture; all keys and proposals come from the saved record.
async function runHostSmoke(config) {
  const report = {
    startedAt: new Date().toISOString(), stage: 'recover-organization', status: 'running', checks: [], modelTurnsStarted: 0,
    build: { executionVersion: config.subjectVersion, executionSha256: config.artifactHash, driverSourceHash: config.driverSourceHash ?? null },
    originalRequest: { productVersion: config.recoveryOriginVersion, conversationId: config.recoveryConversationId, requestId: config.recoveryRequestId, expectedToken: config.recoveryToken },
    driverReadAuthFiles: false,
  };
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2)); const delay = ms => Zotero.Promise.delay(ms); let step = 'startup';
  const until = async (read, label, timeout = 30000) => { step = label; const started = Date.now(); while (Date.now() - started < timeout) { const value = await read(); if (value) return value; await delay(25); } throw new Error(`Timed out: ${label}`); };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };
  const click = node => { if (!node || node.hidden || node.closest?.('[hidden]')) throw new Error('Expected visible UI control is missing.'); node.focus(); node.click(); };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u; const TOKEN = /^RUN-[a-f0-9]{24}$/u;
  try {
    await Zotero.initializationPromise;
    if (!UUID.test(config.recoveryConversationId) || !UUID.test(config.recoveryRequestId) || !TOKEN.test(config.recoveryToken)) throw new Error('Recovery identifiers are invalid.');
    const profile = String(config.profile); const profileMatch = profile.match(/^(.*\/\.zotero-chatgpt-dev\/context)\/profile$/u);
    await check('dedicated-preserved-context-profile', Boolean(profileMatch) && PathUtils.profileDir === profile && config.dataDir === `${profileMatch?.[1]}/data` && Zotero.DataDirectory.dir === config.dataDir);
    const conversationPath = PathUtils.join(profile, 'zotero-chatgpt', 'v1', 'records', 'conversations', `${config.recoveryConversationId}.json`);
    const record = JSON.parse(await IOUtils.readUTF8(conversationPath)); const request = record.requests?.find(value => value.requestId === config.recoveryRequestId);
    const user = record.messages?.find(value => value.role === 'user' && value.requestId === config.recoveryRequestId); const assistant = record.messages?.find(value => value.role === 'assistant' && value.requestId === config.recoveryRequestId && value.status === 'completed');
    const selection = user?.organization?.selection ?? []; const collections = user?.organization?.collections ?? [];
    let proposal = null; try { proposal = JSON.parse(assistant?.text ?? ''); } catch { /* rejected below */ }
    const candidates = proposal?.candidates ?? [];
    await check('saved-real-organization-request-is-exact', record.schemaVersion === 3 && record.id === config.recoveryConversationId && record.activeRequestId === null && request?.state === 'completed' && user?.mode === 'agent' && user?.workflow?.skill?.workflow === 'organize' && assistant && selection.length === 2 && candidates.length === 2 && selection.every(item => item.metadata?.title?.includes(config.recoveryToken)), {
      requestState: request?.state ?? null, mode: user?.mode ?? null, workflow: user?.workflow?.skill?.workflow ?? null, model: user?.settings?.model ?? null, selectionCount: selection.length, candidateCount: candidates.length,
    });
    const indexes = candidates.map(value => value.itemIndex).sort((a, b) => a - b); const targetIndexes = [...new Set(candidates.flatMap(value => value.collectionIndexes ?? []))]; const proposedTags = [...new Set(candidates.flatMap(value => value.tags ?? []))];
    if (JSON.stringify(indexes) !== '[0,1]' || targetIndexes.length !== 1 || proposedTags.length !== 1 || proposedTags[0] !== `live-organized-${config.recoveryToken}`) throw new Error('Saved organization proposal does not match the bounded recovery scope.');
    const target = collections[targetIndexes[0]]; if (!target || !String(target.name ?? '').includes(config.recoveryToken)) throw new Error('Saved target collection does not match the synthetic token.');
    const profileClientId = Zotero.Prefs.get('extensions.zchatgpt.clientId', true); const libraryID = selection[0]?.libraryId;
    await check('frozen-scope-belongs-to-this-profile-library', typeof profileClientId === 'string' && selection.every(item => item.clientId === profileClientId && item.libraryId === libraryID) && libraryID === Zotero.Libraries.userLibraryID && target.clientId === profileClientId && target.libraryId === libraryID, { libraryID, selectionCount: selection.length });
    const items = selection.map(snapshot => Zotero.Items.getByLibraryAndKey(snapshot.libraryId, snapshot.key)); if (items.some(item => !item || !item.isRegularItem())) throw new Error('A frozen selected item is unavailable.');
    const tags = item => item.getTags().map(value => value.tag).sort(); const collectionKeys = item => item.getCollections().map(id => Zotero.Collections.get(id)?.key).filter(Boolean).sort();
    await Promise.all(items.map(item => item.loadAllData()));
    await check('native-items-still-match-frozen-prewrite-scope', items.every((item, index) => item.getField('title') === selection[index].metadata.title && JSON.stringify(tags(item)) === JSON.stringify([...selection[index].tags].sort()) && JSON.stringify(collectionKeys(item)) === JSON.stringify([...selection[index].collectionKeys].sort())), { itemKeys: items.map(item => item.key) });
    const attachment = Zotero.Items.getByLibraryAndKey(record.paper.libraryId, record.paper.attachmentKey); if (!attachment?.isPDFAttachment() || attachment.parentKey !== selection[0].key) throw new Error('Stored attachment does not belong to the frozen primary item.');
    const requestIDsBefore = [...(record.requests ?? []).map(value => value.requestId)].sort();
    const win = await until(() => Zotero.getMainWindow(), 'main-window'); const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const addon = await AddonManager.getAddonByID(config.subjectID);
    await check('installed-recovery-xpi-active', addon?.isActive && addon.version === config.subjectVersion, { executionVersion: addon?.version ?? null, originalRequestVersion: config.recoveryOriginVersion, model: user.settings.model });
    const opened = await Zotero.Reader.open(attachment.id); const tabId = opened.tabID; const reader = () => Zotero.Reader.getByTabID(tabId); const doc = () => reader()?._iframeWindow?.document;
    const shell = () => doc()?.querySelector('[data-zchatgpt-sidebar]'); const panel = () => doc()?.querySelector('[data-zchatgpt-chat]'); const toggle = () => doc()?.querySelector('[data-zchatgpt-toggle]');
    await until(() => toggle(), 'toolbar-toggle'); toggle().click(); await until(() => shell(), 'sidebar-shell', 60000);
    const modeSwitch = () => shell()?.querySelector('[data-zchatgpt-mode-switch]'); const modeButton = mode => modeSwitch()?.querySelector(`[data-zchatgpt-action="mode-${mode}"]`);
    if (modeSwitch()?.dataset.zchatgptMode !== 'agent') click(modeButton('agent')); await until(() => modeSwitch()?.dataset.zchatgptMode === 'agent' && panel()?.dataset.zchatgptRuntime === 'ready', 'agent-runtime-ready', 120000);
    if (panel().dataset.zchatgptConversation !== config.recoveryConversationId) {
      click(panel().querySelector('[data-zchatgpt-action="history"]'));
      const row = await until(() => panel().querySelector(`[data-zchatgpt-history] [data-zchatgpt-conversation-id="${config.recoveryConversationId}"]`), 'stored-conversation-history-row', 60000); click(row);
      await until(() => panel().dataset.zchatgptConversation === config.recoveryConversationId, 'stored-conversation-open', 60000);
    }
    const taskCard = () => [...panel().querySelectorAll('[data-zchatgpt-task-id]')].find(card => card.dataset.zchatgptTaskId === config.recoveryRequestId || String(card.querySelector('summary')?.textContent ?? '').includes('Organize library'));
    const card = await until(() => { const value = taskCard(); return value?.dataset.state === 'review' ? value : null; }, 'recovered-organization-review', 120000);
    const requestAfterRecovery = JSON.parse(await IOUtils.readUTF8(conversationPath));
    await check('installed-ui-recovers-saved-model-json-without-new-request', card.dataset.zchatgptTaskId === config.recoveryRequestId && card.querySelectorAll('[data-zchatgpt-task-item-id]').length === 2 && items.every(item => card.textContent.includes(item.getField('title'))) && card.textContent.includes(String(target.name).split(' / ').at(-1)), { taskId: card.dataset.zchatgptTaskId, state: card.dataset.state, candidates: card.querySelectorAll('[data-zchatgpt-task-item-id]').length, requestsBefore: requestIDsBefore.length, requestsAfterRecovery: requestAfterRecovery.requests.length });
    card.open = true; click(card.querySelector('[data-zchatgpt-task-action="approve"]')); await until(() => card.dataset.state === 'completed', 'recovered-organization-applied', 60000); await Promise.all(items.map(item => item.loadAllData()));
    await check('recovered-organization-native-readback', items.every(item => tags(item).includes(proposedTags[0]) && collectionKeys(item).includes(target.collectionKey) && selection.find(snapshot => snapshot.key === item.key).tags.every(tag => tags(item).includes(tag))));
    const laterTag = `recovery-later-edit-${config.recoveryToken}`; items[1].addTag(laterTag); await items[1].saveTx({ skipSelect: true }); card.open = true; click(card.querySelector('[data-zchatgpt-task-action="undo"]')); await until(() => card.dataset.state === 'conflict', 'recovered-organization-undo-conflict', 60000); await Promise.all(items.map(item => item.loadAllData()));
    await check('recovered-organization-undo-preserves-later-edit', !tags(items[0]).includes(proposedTags[0]) && !collectionKeys(items[0]).includes(target.collectionKey) && selection[0].tags.every(tag => tags(items[0]).includes(tag)) && tags(items[1]).includes(proposedTags[0]) && tags(items[1]).includes(laterTag) && collectionKeys(items[1]).includes(target.collectionKey));
    const finalRecord = JSON.parse(await IOUtils.readUTF8(conversationPath)); const requestIDsAfter = [...(finalRecord.requests ?? []).map(value => value.requestId)].sort();
    await check('recovery-starts-zero-model-turns', report.modelTurnsStarted === 0 && JSON.stringify(requestIDsAfter) === JSON.stringify(requestIDsBefore), { modelTurnsStarted: 0, requestsBefore: requestIDsBefore.length, requestsAfter: requestIDsAfter.length, originalRequest: { requestId: config.recoveryRequestId, state: request.state, workflow: user.workflow.skill.workflow, model: user.settings.model } });
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) {
    report.status = 'failed'; report.failedStep = step; report.failureClass = String(error?.name ?? 'Error').slice(0, 80); report.finishedAt = new Date().toISOString();
    try { await save(); } catch { /* no remaining evidence channel */ }
  }
}
