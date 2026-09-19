/* global Zotero, ChromeUtils, PathUtils, IOUtils */
// Restart/history acceptance for one exact persisted official ChatGPT conversation. The default path
// is read-only; --stop-test authorizes one additional visible turn and one exact official Stop click.
async function runHostSmoke(config) {
  const targetURL = `https://chatgpt.com/c/${config.webResumeConversationId}`;
  const report = {
    startedAt: new Date().toISOString(), stage: 'web-resume', status: 'running', checks: [], submissionAttempts: 0, modelTurnsStarted: 0, confirmedServiceReply: false,
    build: { version: config.subjectVersion, sha256: config.artifactHash, driverSourceHash: config.driverSourceHash ?? null, webAcceptanceSourceHash: config.webAcceptanceSourceHash ?? null },
    expected: { canonicalURL: targetURL, token: config.webResumeToken, originVersion: config.webResumeOriginVersion, stopTest: config.webStopTest === true }, driverReadAuthFiles: false,
  };
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2)); const delay = ms => Zotero.Promise.delay(ms); let step = 'startup';
  const until = async (read, label, timeout = 30000) => { step = label; const started = Date.now(); while (Date.now() - started < timeout) { const value = await read(); if (value) return value; await delay(100); } throw new Error(`Timed out: ${label}`); };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };
  const ownCodexProcesses = async profile => {
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs'); const child = await Subprocess.call({ command: '/bin/ps', arguments: ['-axo', 'pid=,args='], stderr: 'pipe' });
    const decoder = new TextDecoder(); let output = ''; for (let bytes = await child.stdout.read(); bytes.byteLength !== 0; bytes = await child.stdout.read()) output += decoder.decode(bytes, { stream: true }); output += decoder.decode(); await child.wait();
    return output.split('\n').filter(line => line.includes(`${profile}/zotero-chatgpt/`) && line.includes(' app-server')).length;
  };
  const boundedQuery = async (browser, actor, name, data, timeout = 10000) => {
    const global = browser.browsingContext?.currentWindowGlobal; if (!global) throw new Error('Hosted page WindowGlobal unavailable.'); let timer = null;
    try { return await Promise.race([global.getActor(actor).sendQuery(name, data), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${actor} ${name} timed out.`)), timeout); })]); }
    finally { if (timer !== null) clearTimeout(timer); }
  };
  try {
    await Zotero.initializationPromise;
    if (!/^[A-Za-z0-9-]{8,128}$/u.test(config.webResumeConversationId) || !/^RUN-[a-f0-9]{24}$/u.test(config.webResumeToken)) throw new Error('Resume identifiers invalid.');
    const profile = String(config.profile); const match = profile.match(/^(.*\/\.zotero-chatgpt-dev\/embed)\/profile$/u);
    await check('dedicated-preserved-embed-profile', Boolean(match) && PathUtils.profileDir === profile && config.dataDir === `${match?.[1]}/data` && Zotero.DataDirectory.dir === config.dataDir);
    const loadOwnedAttachment = async itemID => {
      const attachment = Number.isSafeInteger(itemID) ? Zotero.Items.get(itemID) : null; if (!attachment) return { attachment: null, parent: null };
      await attachment.loadAllData(); const parent = attachment.parentItem ?? null; if (parent) await parent.loadAllData(); return { attachment, parent };
    };
    const resumePath = PathUtils.join(match[1], 'web-resume.json'); let resumeManifest = null;
    if (await IOUtils.exists(resumePath)) { try { resumeManifest = JSON.parse(await IOUtils.readUTF8(resumePath)); } catch { throw new Error('Stored web-resume manifest is unreadable.'); } }
    if (!resumeManifest) {
      let store = {}; try { const raw = Zotero.Prefs.get('extensions.zchatgpt.officialChatConversationURLs', true); if (typeof raw === 'string' && raw.length <= 128 * 1024) store = JSON.parse(raw); } catch { store = {}; }
      const matches = Object.entries(store).filter(([, entry]) => entry && typeof entry === 'object' && entry.url === targetURL); if (matches.length !== 1) throw new Error('Exact persisted official conversation binding unavailable.');
      const [binding] = matches[0]; const itemID = Number(String(binding).split(':').at(-1)); const { attachment, parent } = await loadOwnedAttachment(itemID);
      if (!attachment?.isPDFAttachment() || parent?.getField('title') !== 'ZCHATGPT embedded web surface probe') throw new Error('Persisted binding is not the owned synthetic PDF.');
      resumeManifest = { schemaVersion: 1, conversationId: config.webResumeConversationId, canonicalURL: targetURL, token: config.webResumeToken, binding, itemID, attachmentKey: attachment.key, parentKey: parent.key, parentTitle: parent.getField('title'), originVersion: config.webResumeOriginVersion, firstReplyVerified: false };
      await IOUtils.writeUTF8(resumePath, JSON.stringify(resumeManifest, null, 2));
    }
    if (resumeManifest.schemaVersion !== 1 || resumeManifest.conversationId !== config.webResumeConversationId || resumeManifest.canonicalURL !== targetURL || resumeManifest.token !== config.webResumeToken || resumeManifest.originVersion !== config.webResumeOriginVersion || !Number.isSafeInteger(resumeManifest.itemID) || typeof resumeManifest.binding !== 'string') throw new Error('Stored web-resume manifest does not match the explicit recovery scope.');
    const binding = resumeManifest.binding; const itemID = resumeManifest.itemID; const { attachment, parent } = await loadOwnedAttachment(itemID);
    await check('persisted-binding-points-to-owned-synthetic-pdf', Boolean(attachment?.isPDFAttachment() && parent?.getField('title') === 'ZCHATGPT embedded web surface probe' && (!resumeManifest.attachmentKey || resumeManifest.attachmentKey === attachment.key) && (!resumeManifest.parentKey || resumeManifest.parentKey === parent.key)), { bindingMatched: true, itemID, attachmentKeyMatched: !resumeManifest.attachmentKey || resumeManifest.attachmentKey === attachment?.key, parentKeyMatched: !resumeManifest.parentKey || resumeManifest.parentKey === parent?.key, parentSynthetic: parent?.getField('title') === 'ZCHATGPT embedded web surface probe' });
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); const addon = await AddonManager.getAddonByID(config.subjectID);
    await check('installed-resume-xpi-active', addon?.isActive && addon.version === config.subjectVersion, { actualVersion: addon?.version ?? null });
    const win = await until(() => Zotero.getMainWindow(), 'main-window'); const opened = await Zotero.Reader.open(attachment.id); const reader = () => Zotero.Reader.getByTabID(opened.tabID); const doc = () => reader()?._iframeWindow?.document;
    await until(() => doc()?.querySelector('[data-zchatgpt-toggle]'), 'toolbar-toggle'); doc().querySelector('[data-zchatgpt-toggle]').click();
    await until(() => { const section = doc()?.querySelector('[data-zchatgpt-embed]'); return section && !section.hidden ? section : null; }, 'hosted-chat-visible', 60000);
    const browser = await until(() => [...win.document.querySelectorAll('[data-zchatgpt-embed-browser]')].find(node => node.getAttribute('data-zchatgpt-context-binding') === binding), 'bound-official-browser', 60000);
    await until(() => String(browser.currentURI?.spec || '').replace(/\/$/u, '') === targetURL, 'persisted-official-conversation-restored', 120000);
    const codexBefore = await ownCodexProcesses(profile);
    const baseline = await until(async () => {
      try {
        const value = await boundedQuery(browser, 'ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.webResumeToken });
        return value?.status === 'ok' && value.canonicalURL === targetURL && !value.streaming && value.userMarkerMessages >= 1 && value.assistantMessages >= 1 && value.latestAssistantContainsToken === true ? value : null;
      } catch (error) {
        const text = String(error?.message ?? error); if (/WindowGlobal unavailable|timed out|NS_ERROR_NOT_INITIALIZED|dead object|actor/iu.test(text)) return null; throw error;
      }
    }, 'persisted-official-answer-visible', 120000);
    await check('official-restart-restores-real-history-and-token', baseline.userMarkerMessages >= 1 && baseline.assistantMessages >= 1 && baseline.latestAssistantContainsToken === true && baseline.canonicalURL === targetURL && codexBefore === 0, { officialURL: baseline.officialURL, canonicalURL: baseline.canonicalURL, userMarkerMessages: baseline.userMarkerMessages, assistantMessages: baseline.assistantMessages, latestAssistantContainsToken: baseline.latestAssistantContainsToken, streaming: baseline.streaming, codexProcesses: codexBefore });
    resumeManifest = { ...resumeManifest, firstReplyVerified: true, verifiedAt: new Date().toISOString(), executionVersion: config.subjectVersion, executionSha256: config.artifactHash }; await IOUtils.writeUTF8(resumePath, JSON.stringify(resumeManifest, null, 2));
    if (config.webStopTest !== true) { report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save(); return; }
    if (baseline.draftLength > 0) {
      if (!baseline.draftMatchesKnownSyntheticHarness) { report.status = 'blocked'; report.blockedStage = 'unrelated-existing-draft'; report.finishedAt = new Date().toISOString(); await save(); return; }
      const cleared = await boundedQuery(browser, 'ZoteroChatGPTWebAcceptance', 'clearKnownHarnessDraft', {}, 10000); if (cleared?.status !== 'cleared' || !cleared.empty) throw new Error('Known test draft cleanup was not confirmed.'); report.discardedKnownSyntheticDraft = true;
    } else report.discardedKnownSyntheticDraft = false;
    const consent = doc()?.querySelector('[data-zchatgpt-action="continue-with-pdf"]'); if (consent && !consent.hidden) { consent.click(); await until(() => consent.hidden, 'pdf-disclosure-acknowledged'); }
    const stopQuestion = 'Write a long synthetic answer with fifty numbered short paragraphs explaining Bayesian updating. Continue until I press Stop.';
    report.submissionAttempts = 1; await save(); const submitted = await boundedQuery(browser, 'ZoteroChatGPTOfficialChat', 'submitQuestion', { question: stopQuestion }, 90000); report.productSubmitStatus = submitted?.status ?? 'invalid-response'; await save();
    if (submitted?.status !== 'accepted') { report.status = submitted?.status === 'blocked' ? 'blocked' : 'failed'; report.outcomeUnknown = submitted?.status !== 'blocked'; report.finishedAt = new Date().toISOString(); await save(); return; }
    const generating = await until(async () => { const value = await boundedQuery(browser, 'ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.webResumeToken }); return value?.streaming === true && value.userMarkerMessages === baseline.userMarkerMessages + 1 ? value : null; }, 'official-generation-observed', 60000);
    report.modelTurnsStarted = 1; report.streamingTransitions = { before: false, generating: true, after: null }; await save();
    const stopped = await boundedQuery(browser, 'ZoteroChatGPTWebAcceptance', 'stopKnownGeneration', {}, 10000); if (stopped?.status !== 'clicked' || stopped.knownStop !== true) throw new Error('Exact official Stop control was not clicked.'); report.exactVisibleStopClicked = true;
    const terminal = await until(async () => { const value = await boundedQuery(browser, 'ZoteroChatGPTWebAcceptance', 'probe', { verificationToken: config.webResumeToken }); return value?.streaming === false ? value : null; }, 'official-generation-stopped', 30000);
    report.streamingTransitions.after = false;
    const codexAfter = await ownCodexProcesses(profile);
    await check('one-visible-turn-stops-without-fallback', report.submissionAttempts === 1 && report.modelTurnsStarted === 1 && report.exactVisibleStopClicked === true && generating.streaming === true && terminal.streaming === false && terminal.officialURL === true && terminal.canonicalURL === targetURL && terminal.userMarkerMessages === baseline.userMarkerMessages + 1 && codexBefore === 0 && codexAfter === 0, { submissionAttempts: report.submissionAttempts, modelTurnsStarted: report.modelTurnsStarted, productSubmitStatus: report.productSubmitStatus, exactVisibleStopClicked: report.exactVisibleStopClicked, streamingTransitions: report.streamingTransitions, officialURL: terminal.officialURL, canonicalURL: terminal.canonicalURL, userMarkerDelta: terminal.userMarkerMessages - baseline.userMarkerMessages, codexProcessesBefore: codexBefore, codexProcessesAfter: codexAfter });
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
  } catch (error) { report.status = 'failed'; report.failedStep = step; report.failureClass = String(error?.name ?? 'Error').slice(0, 80); report.finishedAt = new Date().toISOString(); try { await save(); } catch { /* no remaining evidence channel */ } }
}
