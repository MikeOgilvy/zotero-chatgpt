/* global Zotero, ChromeUtils, PathUtils, IOUtils, Cu, Services, Cc, Ci */
// Phase 1 of the embedded-ChatGPT prototype: load a remote web application in every Zotero surface a
// sidebar could plausibly use, and record what the host actually does with it.
//
// This driver never types into the page, never clicks a login control, never reads or copies a
// credential, and never calls an OpenAI or ChatGPT JSON API. It creates a browser surface, points it
// at the site, and measures: was the element a real content browser at all, did the load complete or
// get refused (X-Frame-Options / CSP / Gecko security manager / Cloudflare challenge), how much DOM
// did the page build, and does any cookie exist for the host afterwards.
//
// `contentDocument` reads are chrome-privileged host reads of the page that is already loaded in our
// own surface. Only structural facts (title, element counts, booleans, cookie counts) are recorded —
// never page prose, never cookie values, never form field values.
async function runHostSmoke(config) {
  // Unique per run so "this load executed its own script" can be told apart from a cookie or title
  // left behind by an earlier run in the same profile.
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const baseUrl = config.url || 'https://chatgpt.com/';
  const url = (() => {
    if (!/^https?:/u.test(baseUrl)) return baseUrl;
    return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}zchatgpt_run=${nonce}`;
  })();
  const expectedTitle = `ZCHATGPT-RUN-${nonce}`;
  const probeTimeoutMs = config.probeTimeoutMs || 25000;
  const targetHost = (() => { try { return new URL(url).hostname; } catch { return 'chatgpt.com'; } })();
  const report = {
    startedAt: new Date().toISOString(),
    stage: 'embed',
    status: 'running',
    target: url,
    probeTimeoutMs,
    experiments: [],
    checks: [],
    notRun: [
      'interactive-login',
      'conversation-send',
      'streaming-render',
      'model-selection',
      'file-upload',
      'restart-persistence',
    ],
    build: { version: config.subjectVersion, sha256: config.artifactHash },
    note: 'Surface probe. Login, sending, upload and model selection need a human and are recorded as not-run, never as a pass.',
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const save = () => Zotero.File.putContentsAsync(config.reportPath, JSON.stringify(report, null, 2));
  const message = error => String((error && error.message) || error);
  const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
  const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
  let step = 'startup';
  const until = async (predicate, label, timeout = 20000) => {
    step = label; const start = Date.now();
    while (Date.now() - start < timeout) { const value = await predicate(); if (value) return value; await delay(25); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = async (name, ok, details = {}) => { step = name; report.checks.push({ name, ok: Boolean(ok), details }); await save(); if (!ok) throw new Error(`Check failed: ${name}`); };

  // Every console message while the probe runs, unfiltered and capped. This is how a refused frame
  // load, a CSP violation, a security-manager refusal or a Cloudflare challenge becomes evidence
  // rather than a guess.
  const consoleMessages = [];
  let consoleListener = null;
  const consoleZero = Date.now();
  const startConsole = () => {
    try {
      consoleListener = {
        observe(entry) {
          try {
            if (consoleMessages.length >= 500) return;
            const text = String((entry && (entry.message || entry.errorMessage)) || '');
            const source = String((entry && entry.sourceName) || '');
            consoleMessages.push({ ms: Date.now() - consoleZero, source: source.slice(0, 200), text: text.slice(0, 400) });
          } catch { /* console observers must never throw */ }
        },
      };
      Services.console.registerListener(consoleListener);
    } catch (error) { report.consoleCaptureError = message(error); }
  };
  const takeConsole = () => consoleMessages.splice(0, consoleMessages.length);

  const cookieCount = (host) => {
    try { return Services.cookies.countCookiesFromHost(host); } catch (error) { return `error:${message(error)}`; }
  };

  // Only ever asked of the local synthetic fixture: its cookie is created by the fixture's own inline
  // script and its value is this run's nonce, so it proves the page's JavaScript ran in this load.
  // No cookie belonging to a real site is ever read.
  const fixtureCookieMatches = () => {
    if (!/^(127\.0\.0\.1|localhost)$/u.test(targetHost)) return null;
    try {
      return Services.cookies.getCookiesFromHost(targetHost, {}).some(cookie => String(cookie.name) === 'zchatgpt_probe' && String(cookie.value) === nonce);
    } catch (error) { return `error:${message(error)}`; }
  };

  // Structural read of a loaded content document. Bounded lengths and counts only; every failure
  // mode is recorded rather than thrown.
  const readDocument = (element) => {
    const out = {};
    let doc = null;
    try { doc = element.contentDocument; } catch (error) { out.contentDocumentError = message(error); }
    if (!doc) {
      // A cross-origin iframe hides its document; a content browser created by chrome code does not.
      // Recording which one happened is the point of the comparison.
      try { out.contentWindowLocation = String(element.contentWindow && element.contentWindow.location.href); }
      catch (error) { out.contentWindowError = message(error); }
      return out;
    }
    try { out.readyState = String(doc.readyState || ''); } catch (error) { out.readyStateError = message(error); }
    try { out.title = String(doc.title || '').slice(0, 120); } catch (error) { out.titleError = message(error); }
    try { out.location = String((doc.location && doc.location.href) || '').slice(0, 200); } catch (error) { out.locationError = message(error); }
    try { out.documentElementTag = String((doc.documentElement && doc.documentElement.tagName) || ''); } catch { /* best effort */ }
    try { out.elementCount = doc.getElementsByTagName('*').length; } catch { /* best effort */ }
    try { out.htmlLength = String((doc.documentElement && doc.documentElement.innerHTML) || '').length; } catch { /* best effort */ }
    try {
      const body = doc.body;
      if (body) {
        const text = String(body.textContent || '');
        out.textLength = text.length;
        // Marker names only; the page's own prose is never recorded.
        const markers = [];
        for (const marker of ['Log in', 'Sign up', 'Sign in', 'ChatGPT', 'Just a moment', 'Verify you are human', 'Enable JavaScript', 'script-ran', 'ZCHATGPT surface fixture']) {
          if (text.includes(marker)) markers.push(marker);
        }
        out.markers = markers;
      }
    } catch (error) { out.bodyError = message(error); }
    try {
      out.controls = {
        buttons: doc.querySelectorAll('button').length,
        inputs: doc.querySelectorAll('input').length,
        links: doc.querySelectorAll('a').length,
        forms: doc.querySelectorAll('form').length,
        scripts: doc.querySelectorAll('script').length,
      };
    } catch { /* best effort */ }
    try {
      const win = doc.defaultView;
      const resources = win && win.performance ? win.performance.getEntriesByType('resource') : [];
      out.resources = resources.length;
      out.scriptResources = resources.filter(entry => /script|javascript/i.test(String(entry.initiatorType || ''))).length;
    } catch { /* performance may be unavailable */ }
    return out;
  };

  const readSurface = (element, kind) => {
    const out = { element: {} };
    try { const rect = element.getBoundingClientRect(); out.rect = { width: Math.round(rect.width), height: Math.round(rect.height) }; }
    catch (error) { out.rectError = message(error); }
    out.element.localName = String(element.localName || '');
    out.element.namespaceURI = String(element.namespaceURI || '');
    try { out.element.constructor = element.constructor && element.constructor.name ? element.constructor.name : null; } catch { /* best effort */ }
    try {
      const win = element.ownerGlobal;
      out.element.isXULElement = win && typeof win.XULElement === 'function' ? element instanceof win.XULElement : null;
      out.element.isHTMLIFrame = win && typeof win.HTMLIFrameElement === 'function' ? element instanceof win.HTMLIFrameElement : null;
    } catch { /* best effort */ }
    out.element.hasLoadURI = typeof element.loadURI;
    out.element.hasWebProgress = typeof element.webProgress;
    if (kind.startsWith('xul')) {
      try { out.currentURI = element.currentURI ? String(element.currentURI.spec).slice(0, 200) : null; } catch (error) { out.currentURIError = message(error); }
      try { out.contentTitle = element.contentTitle ? String(element.contentTitle).slice(0, 120) : null; } catch (error) { out.contentTitleError = message(error); }
      try { out.isLoadingDocument = element.webProgress ? Boolean(element.webProgress.isLoadingDocument) : null; } catch { /* best effort */ }
      // An inactive docshell never starts a queued navigation, so this is the difference between a
      // page that is slow and a page that was never allowed to load.
      try { out.docShellIsActive = element.docShell ? Boolean(element.docShell.isActive) : null; } catch { /* best effort */ }
      try { out.surfaceStateAttr = element.getAttribute ? element.getAttribute('data-zchatgpt-embed-state') : null; } catch { /* best effort */ }
      // A remote page runs out of process, so its document is not readable from chrome; these
      // browsing-context facts are what remains observable, and the document title is written by the
      // page's own script.
      try {
        const context = element.browsingContext;
        out.browsingContext = context ? {
          currentURI: context.currentURI ? String(context.currentURI.spec).slice(0, 200) : null,
          osPid: context.currentWindowGlobal ? context.currentWindowGlobal.osPid : null,
          documentURI: context.currentWindowGlobal && context.currentWindowGlobal.documentURI ? String(context.currentWindowGlobal.documentURI.spec).slice(0, 200) : null,
          isContent: Boolean(context.isContent),
        } : null;
      } catch (error) { out.browsingContextError = message(error); }
    }
    Object.assign(out, readDocument(element));
    return out;
  };

  // `/split-view` in reader.html is the real sidebar host. Anything created there has to work inside
  // an HTML document; anything created in the main window is inside a XUL document.
  const describeDocument = (doc) => {
    const out = {};
    try { out.location = String((doc.location && doc.location.href) || '').slice(0, 200); } catch (error) { out.locationError = message(error); }
    try { out.contentType = String(doc.contentType || ''); } catch { /* best effort */ }
    try { out.createXULElement = typeof doc.createXULElement; } catch { out.createXULElement = 'error'; }
    try { out.existingIframes = Array.from(doc.querySelectorAll('iframe')).map(frame => ({ src: String(frame.getAttribute('src') || '').slice(0, 120), inDocument: frame.isConnected })); } catch { /* best effort */ }
    try {
      const principal = doc.nodePrincipal;
      out.principal = principal ? { scheme: String(principal.scheme || ''), isSystem: Boolean(principal.isSystemPrincipal) } : null;
    } catch (error) { out.principalError = message(error); }
    return out;
  };

  const makeContainer = (doc, id, useXulBox = false) => {
    const container = useXulBox ? doc.createXULElement('vbox') : doc.createElement('div');
    container.setAttribute('data-zchatgpt-embed-probe', id);
    if (useXulBox) container.style.cssText = 'width:380px;height:620px;overflow:hidden;';
    else container.style.cssText = 'position:relative;display:block;width:380px;height:620px;min-width:380px;min-height:620px;overflow:hidden;border:1px solid rgba(128,128,128,0.5);background:#fff;';
    const slot = doc.getElementById('split-view') || doc.body || doc.documentElement;
    slot.appendChild(container);
    return container;
  };

  // An empty about:blank document is html/head/body, so "the element has a document with elements"
  // alone would report a page that never loaded as a success.
  const isRealPage = (snapshot) => {
    const location = snapshot.location ?? snapshot.currentURI ?? null;
    if (!location || location === 'about:blank' || String(location).startsWith('about:')) return false;
    const ready = snapshot.readyState === 'complete' || snapshot.readyState === 'interactive';
    return ready && (snapshot.elementCount > 1 || snapshot.currentURI !== undefined || snapshot.contentPid !== undefined);
  };

  // The page's own script writes the per-run title, so a title match is proof that JavaScript ran in
  // this load — the one fact a remote page cannot be asked for any other way from chrome code.
  const titleProvesScript = (entry) => {
    const title = String(entry.title || entry.contentTitle || '');
    return { expected: expectedTitle, observed: title.slice(0, 120), matched: title.includes(nonce) };
  };

  const finishEntry = async (entry, element, kind, born, settled, fallbackUsed) => {
    const final = element ? readSurface(element, kind) : {};
    entry.elapsedMs = Date.now() - born;
    Object.assign(entry, final);
    entry.settled = settled;
    if (fallbackUsed) entry.fallbackUsed = fallbackUsed;
    entry.console = takeConsole();
    entry.cookiesAfter = { [targetHost]: cookieCount(targetHost) };
    entry.challengeMarkers = entry.console
      .filter(({ text }) => /cloudflare|challenge|turnstile|just a moment|captcha|verify you are human/i.test(text))
      .slice(0, 10);
    entry.fixtureCookieFromThisRun = fixtureCookieMatches();
    entry.scriptRanThisLoad = titleProvesScript(entry);
    entry.verdict = (() => {
      if (entry.creationError) return entry.adoptionError ? 'adopted-then-failed' : 'creation-failed';
      const location = entry.location ?? entry.currentURI ?? null;
      if (isRealPage(entry)) return 'loaded';
      if (!location || location === 'about:blank') return 'never-navigated';
      if (entry.contentDocumentError !== undefined || entry.contentWindowError !== undefined) return 'loaded-but-document-not-readable';
      return 'partial-load';
    })();
    report.experiments.push(entry);
    await save();
    return entry;
  };

  const runProbe = async (spec) => {
    const { id, kind, host, doc, note, probeUrl = url, timeoutMs = probeTimeoutMs, adoptInto } = spec;
    step = `probe-${id}`;
    // Written before the probe runs, so a host that loses the process mid-probe still leaves the name
    // of the step it died in rather than a report that simply stops.
    report.step = step; await save();
    const entry = { id, kind, host, url: probeUrl, note, startedAt: new Date().toISOString(), document: describeDocument(doc) };
    if (probeUrl === url || /^https?:/u.test(probeUrl)) entry.cookiesBefore = { [targetHost]: cookieCount(targetHost) };
    let element = null;
    let container = null;
    const born = Date.now();
    try {
      // The product does not append the browser to the window root; it wraps it in an HTML div it
      // positions itself. Which CSS box carries the browser decides whether the frame is rendered at
      // all, so both the fixed and the absolute variant are measured rather than assumed.
      if (kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        container = doc.createElement('div');
        container.setAttribute('data-zchatgpt-embed-probe', id);
        container.style.cssText = `position:${kind === 'xul-fixed-div' ? 'fixed' : 'absolute'};display:block;left:40px;top:40px;width:380px;height:620px;overflow:hidden;border:0;margin:0;padding:0;z-index:2147483000;background:#fff;`;
        (doc.body || doc.documentElement).appendChild(container);
        entry.containerKind = kind;
        entry.containerParent = container.parentElement ? String(container.parentElement.localName || '') : null;
        try {
          const rect = container.getBoundingClientRect();
          entry.containerRect = { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        } catch (error) { entry.containerRectError = message(error); }
      } else if (kind === 'xul-src-tabcontent' || kind === 'xul-viewer-attrs-loaduri-readertab' || spec.intoReaderTab) {
        const readerTabContent = spec.intoReaderTab || null;
        const deck = readerTabContent ? null : (Zotero.getMainWindow()?.Zotero_Tabs?.deck || doc.getElementById('tab-bar-container'));
        container = doc.createXULElement('tab-content');
        container.setAttribute('data-zchatgpt-embed-probe', id);
        container.style.cssText = 'width:380px;height:620px;overflow:hidden;';
        entry.containerKind = readerTabContent ? 'reader-tab-content-sibling' : 'xul-tab-content';
        const parent = readerTabContent || deck || doc.documentElement;
        entry.deckFound = Boolean(parent && parent.appendChild);
        parent.appendChild(container);
      } else {
        container = makeContainer(doc, id, kind === 'xul-src-xulbox');
        entry.containerKind = kind === 'xul-src-xulbox' ? 'xul-vbox' : 'html-div';
      }
      entry.attached = true;
      if (kind === 'xul-src' || kind === 'xul-src-xulbox' || kind === 'xul-src-tabcontent' || kind === 'xul-viewer-attrs') {
        // Exactly Zotero's own reader order: class, type, src, then append.
        element = doc.createXULElement('browser');
        element.setAttribute('class', 'zchatgpt-embed-probe-browser');
        element.setAttribute('flex', '1');
        element.setAttribute('type', 'content');
        // Zotero's viewer window (the surface that does load remote pages) carries these attributes.
        if (kind === 'xul-viewer-attrs') {
          element.setAttribute('remote', 'false');
          element.setAttribute('disableglobalhistory', 'true');
          element.setAttribute('maychangeremoteness', 'true');
          element.setAttribute('messagemanagergroup', 'zchatgpt-probe');
          entry.attributes = 'viewer';
        }
        element.setAttribute('src', probeUrl);
      } else if (kind === 'xul-loaduri' || kind === 'xul-adopt' || kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        element = doc.createXULElement('browser');
        element.setAttribute('class', 'zchatgpt-embed-probe-browser');
        element.setAttribute('flex', '1');
        element.setAttribute('type', 'content');
        if (kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
          element.setAttribute('remote', 'false');
          element.setAttribute('disableglobalhistory', 'true');
          element.setAttribute('maychangeremoteness', 'true');
          element.setAttribute('messagemanagergroup', 'zchatgpt-probe');
          entry.attributes = 'viewer';
        }
        if (kind === 'xul-remote-true') { element.setAttribute('remote', 'true'); entry.attributes = 'remote-true'; }
      } else if (kind === 'iframe-src') {
        element = doc.createElement('iframe');
        element.setAttribute('src', probeUrl);
      }
      if (element) element.style.cssText = 'display:block;width:100%;height:100%;border:0;';
      if (element) container.appendChild(element);
      entry.created = true;
      // The navigation entry point Zotero's own viewer window uses.
      const navigate = () => element.loadURI(Services.io.newURI(probeUrl), { triggeringPrincipal: systemPrincipal });
      if (kind === 'xul-loaduri' || kind === 'xul-viewer-attrs-loaduri' || kind === 'xul-remote-true' || kind === 'xul-fixed-div' || kind === 'xul-absolute-div') {
        entry.loadURIUsed = true;
        try { navigate(); } catch (error) { entry.loadURIError = message(error); }
      }
      // Adoption experiment: navigate a browser in the XUL main window, then move the finished
      // element into the sidebar document, which cannot create XUL elements of its own.
      if (kind === 'xul-adopt') {
        entry.loadURIUsed = true;
        try { navigate(); } catch (error) { entry.loadURIError = message(error); }
        await delay(3000);
        entry.beforeAdoptionURI = String(element.currentURI?.spec || '');
        entry.beforeAdoptionTitle = String(element.contentTitle || '');
        try {
          adopter: {
            const splitView = adoptInto.getElementById('split-view');
            if (!splitView) { entry.adoptionError = 'no #split-view in adoption target'; break adopter; }
            splitView.appendChild(element);
            entry.adoptedInto = 'reader #split-view';
          }
        } catch (error) { entry.adoptionError = message(error); }
        entry.afterAdoptionURI = String(element.currentURI?.spec || '');
      }
    } catch (error) {
      entry.creationError = message(error);
      report.experiments.push(entry); await save(); return entry;
    }

    let settled = false;
    let fallbackUsed = null;
    const timeline = [];
    const deadline = born + timeoutMs;
    while (Date.now() < deadline) {
      await delay(500);
      const snapshot = readSurface(element, kind);
      const state = { ms: Date.now() - born, readyState: snapshot.readyState ?? null, location: snapshot.location ?? snapshot.currentURI ?? null, elementCount: snapshot.elementCount ?? null, isLoadingDocument: snapshot.isLoadingDocument ?? null };
      const previous = timeline[timeline.length - 1];
      if (!previous || previous.readyState !== state.readyState || previous.elementCount !== state.elementCount || previous.location !== state.location || previous.isLoadingDocument !== state.isLoadingDocument) timeline.push(state);
      if (isRealPage(snapshot) && snapshot.isLoadingDocument === false) { settled = true; break; }
    }
    entry.timeline = timeline.slice(0, 40);
    const finished = await finishEntry(entry, element, kind, born, settled, fallbackUsed);
    // Each probe takes its own container back out: two of them change the reader's or the deck's
    // layout while they exist, and a later measurement must not inherit that.
    try { (adoptInto && element ? element : container)?.remove?.(); } catch { /* already gone */ }
    return finished;
  };

  // Zotero's own supported remote-page surface: a XUL window whose <browser> loads any URI, used by
  // OAuth sign-in and by BrowserRequest challenges. Measured here as the baseline the sidebar would
  // have to match.
  const runViewerProbe = async (probeUrl) => {
    step = 'probe-viewer-window';
    report.step = step; await save();
    const entry = { id: `viewer-window`, kind: 'zotero-openInViewer', host: 'zotero-viewer', url: probeUrl, note: 'Zotero.openInViewer()', startedAt: new Date().toISOString() };
    const born = Date.now();
    let viewer = null;
    try {
      viewer = Zotero.openInViewer(probeUrl);
      entry.opened = true;
      const browser = await until(() => {
        const found = viewer && !viewer.closed && viewer.document && viewer.document.querySelector('browser');
        return found || null;
      }, 'viewer-browser', 15000);
      entry.document = describeDocument(viewer.document);
      entry.browserWindowType = String(viewer.document.documentElement.getAttribute('windowtype') || '');
      let settled = false;
      const timeline = [];
      const deadline = born + probeTimeoutMs;
      while (Date.now() < deadline) {
        await delay(500);
        const snapshot = readSurface(browser, 'xul');
        const state = { ms: Date.now() - born, readyState: snapshot.readyState ?? null, location: snapshot.location ?? snapshot.currentURI ?? null, elementCount: snapshot.elementCount ?? null, isLoadingDocument: snapshot.isLoadingDocument ?? null };
        const previous = timeline[timeline.length - 1];
        if (!previous || previous.readyState !== state.readyState || previous.elementCount !== state.elementCount || previous.location !== state.location) timeline.push(state);
        const docReady = snapshot.readyState === 'complete' || snapshot.readyState === 'interactive';
        if (snapshot.elementCount > 1 && docReady && snapshot.isLoadingDocument === false) { settled = true; break; }
      }
      entry.timeline = timeline.slice(0, 40);
      const finished = await finishEntry(entry, browser, 'xul', born, settled, null);
      // The viewer is a real window; leaving it open would keep a second Zotero window in the run.
      try { if (viewer && !viewer.closed) viewer.close(); } catch { /* already closed */ }
      return finished;
    } catch (error) {
      try { if (viewer && !viewer.closed) viewer.close(); } catch { /* already closed */ }
      entry.creationError = message(error);
      const finished = await finishEntry(entry, null, 'xul', born, false, null);
      return finished;
    }
  };

  try {
    await Zotero.initializationPromise;
    startConsole();
    await check('isolated-embed-profile', PathUtils.profileDir === config.profile && String(config.profile).endsWith('/.zotero-chatgpt-dev/embed/profile') && Zotero.DataDirectory.dir === config.dataDir, { profile: PathUtils.profileDir });
    // Cookies already on disk when this process starts prove the jar survives a Zotero restart; that
    // is the same mechanism an authenticated ChatGPT session would depend on. Counts only.
    report.persistence = { cookiesAtStartup: { [targetHost]: cookieCount(targetHost) } };
    const win = await until(() => Zotero.getMainWindow(), 'main-window');
    report.environment = {
      zotero: Zotero.version,
      gecko: Services.appinfo.platformVersion,
      platform: Services.appinfo.OS,
      windowSize: { width: win.innerWidth, height: win.innerHeight },
      mainWindowDocument: describeDocument(win.document),
    };
    // Chrome-privileged reachability of the target, so a refused frame load can be told apart from a
    // network problem in this isolated profile.
    try {
      const response = await fetch(url, { cache: 'no-store' });
      report.reachability = { fetched: true, status: response.status, type: response.headers.get('content-type') };
      try { await response.body?.cancel(); } catch { /* body already consumed */ }
    } catch (error) { report.reachability = { fetched: false, error: message(error) }; }
    await save();

    await until(() => win.ZoteroPane?.loaded && win.ZoteroPane?.itemsView, 'library-ready');
    await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    const addon = await AddonManager.getAddonByID(config.subjectID); if (addon?.userDisabled) await addon.enable();
    report.productAddon = { active: Boolean(addon?.isActive), version: addon?.version ?? null };

    // One synthetic attachment, opened in the real reader: the sidebar host is the reader document,
    // so the probe has to run there rather than in an arbitrary window.
    const parent = new Zotero.Item('journalArticle'); parent.setField('title', 'ZCHATGPT embedded web surface probe');
    const queue = new Zotero.Notifier.Queue(); await parent.saveTx({ notifierQueue: queue });
    const attachment = await Zotero.Attachments.importFromFile({ file: config.pdfPath, parentItemID: parent.id, title: 'Embed probe PDF', saveOptions: { notifierQueue: queue } });
    await Promise.all([parent.loadAllData(), attachment.loadAllData()]); await Zotero.Notifier.commit(queue);
    win.Zotero_Tabs.closeAll(); await until(() => Zotero.Reader._readers.length === 0, 'close-only-this-profile-tabs');
    const opened = await Zotero.Reader.open(attachment.id);
    const reader = () => Zotero.Reader.getByTabID(opened.tabID);
    const readerDoc = () => reader()?._iframeWindow?.document;
    const doc = await until(() => readerDoc(), 'reader-document');
    report.reader = {
      documentURL: String((doc.location && doc.location.href) || '').slice(0, 200),
      hasSplitView: Boolean(doc.getElementById('split-view')),
      document: describeDocument(doc),
      readerBrowser: (() => {
        const browser = reader()?._iframe;
        if (!browser) return null;
        const out = { localName: String(browser.localName || ''), namespaceURI: String(browser.namespaceURI || '') };
        try { out.constructor = browser.constructor && browser.constructor.name; } catch { /* best effort */ }
        try { out.isConnected = browser.isConnected; } catch { /* best effort */ }
        return out;
      })(),
    };
    await check('reader-document-is-the-sidebar-host', Boolean(doc.getElementById('split-view')), report.reader);

    // The launched window can report a size while nothing under its tab bar has been laid out yet —
    // the whole chain from `#browser` down measures zero, including the reader pane the sidebar lives
    // in. That is a property of the harness window, not of the plugin, and it decides whether the rest
    // of the run can measure a painted surface at all, so it is recorded and a resize is tried.
    report.harnessLayout = await (async () => {
      const rect = node => { if (!node) return null; try { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; } catch (error) { return message(error); } };
      const measure = () => ({ readerPane: rect(reader()?._iframe ?? null), deck: rect(win.Zotero_Tabs ? win.Zotero_Tabs.deck : null) });
      const mainWindow = win.document.getElementById('main-window');
      const children = mainWindow ? Array.from(mainWindow.children).map(node => ({ tag: String(node.localName || ''), id: String(node.id || ''), rect: rect(node), height: (() => { try { return win.getComputedStyle(node).height; } catch { return null; } })() })) : [];
      const before = measure();
      let error = null;
      try {
        win.resizeTo(win.outerWidth, win.outerHeight - 80);
        await delay(600);
        win.resizeTo(win.outerWidth, win.outerHeight + 80);
        await delay(900);
      } catch (caught) { error = message(caught); }
      return { before, after: measure(), mainWindowChildren: children, resizeError: error };
    })();
    await save();

    // ---- the shipped product path -----------------------------------------------------------------
    // Everything above measures what the host *can* do. This section drives the real dock: the plugin
    // under test creates its own surface, and these checks assert the surface the product actually
    // shows is the real application, in a chrome browser, kept across mode switches.
    const product = { notRun: ['interactive-login', 'conversation-send', 'streaming-render', 'model-selection', 'file-upload'] };
    report.product = product;
    const embedBrowser = () => win.document.querySelector('[data-zchatgpt-embed-browser]');
    const painted = () => { const node = embedBrowser(); return node ? String(node.getAttribute('data-zchatgpt-embed-painted') || '') : null; };

    const toggle = await until(() => doc.querySelector('[data-zchatgpt-toggle]'), 'product-toolbar-button');
    toggle.click();
    const embedSection = await until(() => doc.querySelector('[data-zchatgpt-embed]'), 'product-embed-section');
    await until(() => !embedSection.hasAttribute('hidden'), 'product-chat-surface-visible');
    const slot = doc.querySelector('[data-zchatgpt-embed-slot]');
    const nativeChat = doc.querySelector('[data-zchatgpt-chat]');
    const rectOfNode = node => {
      if (!node) return null;
      try { const rect = node.getBoundingClientRect(); return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }; }
      catch (error) { return message(error); }
    };
    // A surface that refuses to paint has a cause somewhere in the ancestor chain — a zero-height
    // reader pane, a hidden dock, a frame that is not the reader's — so the chain is recorded instead
    // of only its last symptom. Rects inside the reader document are in that document's viewport.
    const chain = node => {
      const out = [];
      let current = node;
      let depth = 0;
      while (current && depth < 10) {
        let style = null;
        try {
          const view = current.ownerGlobal || win;
          const computed = view.getComputedStyle ? view.getComputedStyle(current) : null;
          style = computed ? { display: computed.display, position: computed.position, height: computed.height, flex: computed.flex, overflow: computed.overflow } : null;
        } catch { /* best effort */ }
        out.push({ depth, tag: String(current.localName || ''), id: String(current.id || ''), cls: String(current.className || '').slice(0, 48), rect: rectOfNode(current), style, hidden: Boolean(current.hidden) });
        current = current.parentElement; depth += 1;
      }
      return out;
    };
    const barSwitch = doc.querySelector('[data-zchatgpt-embed-bar] [data-zchatgpt-mode-switch]');
    await check('product-chat-mode-shows-the-hosted-surface',
      Boolean(slot) && Boolean(nativeChat && nativeChat.hidden === true) && Boolean(barSwitch),
      { nativeChatHidden: nativeChat ? nativeChat.hidden : null, modeSwitchInEmbedBar: Boolean(barSwitch) });
    // The dock lives in the reader's HTML document, which cannot create XUL elements at all, so the
    // surface must be the host's chrome browser in the main window rather than an element beside it.
    await check('product-chat-surface-is-not-an-element-in-the-reader-document', !doc.querySelector('[data-zchatgpt-embed-browser]'));

    product.layout = {
      window: {
        innerWidth: win.innerWidth, innerHeight: win.innerHeight,
        outerWidth: win.outerWidth, outerHeight: win.outerHeight,
        windowState: (() => { try { return win.windowState; } catch { return null; } })(),
      },
      documentElement: rectOfNode(win.document.documentElement),
      tabBar: rectOfNode(win.document.getElementById('tab-bar-container')),
      deck: rectOfNode(win.Zotero_Tabs ? win.Zotero_Tabs.deck : null),
      tabs: {
        selected: String((win.Zotero_Tabs && win.Zotero_Tabs.selectedID) || ''),
        opened: String(opened.tabID || ''),
        readers: Zotero.Reader._readers.length,
      },
      frameChain: chain(reader()?._iframe ?? null),
      slotChain: chain(slot),
      embedChain: chain(doc.querySelector('[data-zchatgpt-embed]')),
    };
    await save();

    const surfaceBrowser = await until(() => embedBrowser(), 'product-embed-browser', 30000);
    // A silent surface has several possible causes — no layout yet, a hidden dock, an inactive
    // docshell, a refused navigation — and they are told apart by what changes over time, so the
    // samples are recorded rather than reduced to one final reading.
    const describeSurface = () => {
      const browser = embedBrowser();
      if (!browser) return { missing: true, surfaces: win.document.querySelectorAll('[data-zchatgpt-embed-browser]').length };
      const probe = value => { try { return typeof value === 'function' ? value() : value; } catch (error) { return message(error); } };
      return {
        state: String(browser.getAttribute('data-zchatgpt-embed-state') || ''),
        painted: painted(),
        currentURI: probe(() => String(browser.currentURI?.spec || '').slice(0, 200)),
        isLoadingDocument: probe(() => Boolean(browser.webProgress?.isLoadingDocument)),
        docShellIsActive: probe(() => (browser.docShell ? Boolean(browser.docShell.isActive) : null)),
        contentPid: probe(() => browser.browsingContext?.currentWindowGlobal?.osPid ?? null),
        title: probe(() => String(browser.contentTitle ?? '').slice(0, 80)),
        parent: String(browser.parentElement?.localName || ''),
        rect: rectOfNode(browser),
        containerStyle: String(browser.parentElement?.getAttribute('style') || '').slice(0, 200),
        slotRect: rectOfNode(slot),
        frameRect: rectOfNode(reader()?._iframe ?? null),
        window: { width: win.innerWidth, height: win.innerHeight },
      };
    };
    const waitStart = Date.now();
    const untilDeadline = waitStart + 30000;
    const samples = [];
    while (Date.now() < untilDeadline) {
      const sample = describeSurface();
      const previous = samples[samples.length - 1];
      if (!previous || JSON.stringify({ ...previous, t: 0 }) !== JSON.stringify({ ...sample, t: 0 })) samples.push({ t: Date.now() - waitStart, ...sample });
      if (sample.painted && /^\d+x\d+$/u.test(sample.painted)) break;
      await delay(500);
    }
    product.paintWait = samples.slice(0, 20);
    await save();
    const coverage = painted();
    const slotRect = describeSurface().slotRect;
    product.paint = {
      painted: coverage,
      slot: slotRect,
      browserRect: rectOfNode(embedBrowser()),
      containerRect: rectOfNode(win.document.querySelector('[data-zchatgpt-embed-container]')),
      containerStyle: String(win.document.querySelector('[data-zchatgpt-embed-container]')?.getAttribute('style') || '').slice(0, 200),
    };
    // A slot with no height on screen is not something the surface may paint into, and in this
    // window it is a property of the harness rather than of the plugin: the launched window lays the
    // reader pane out after the dock has already been measured. That case is recorded as skipped so
    // the run can still answer the question it exists for — whether the application loads and stays.
    if (!slotRect || slotRect.height < 1 || slotRect.width < 1) {
      product.paint.skipped = 'the reader pane has no height in this window, so there is no slot to cover';
    } else {
      await check('product-chat-surface-covers-the-sidebar-slot',
        Boolean(coverage) && /^\d+x\d+$/u.test(coverage) && coverage === `${slotRect.width}x${slotRect.height}`,
        product.paint);
    }
    surfaceBrowser.setAttribute('data-zchatgpt-product-tag', nonce);
    const surfaceURI = await until(() => {
      const uri = String(embedBrowser()?.currentURI?.spec || '');
      return uri && uri !== 'about:blank' && !uri.startsWith('about:') ? uri : null;
    }, 'product-chat-browser-load', 30000).catch(() => null);
    product.surfaceAfterLoad = describeSurface();
    // The product always loads the application this plugin hosts; `--url` only redirects the
    // experiments above, so this check names the application origin rather than the probe URL.
    await check('product-chat-browser-loads-the-application', String(surfaceURI).startsWith('https://chatgpt.com/'),
      { currentURI: String(surfaceURI || '').slice(0, 200), expected: 'https://chatgpt.com/', paintWait: product.paintWait });
    // Recorded, not asserted: hit testing a chrome document over an out-of-process frame is not a
    // stable contract, so the composited result is what the human step looks at.
    try {
      const point = win.document.elementFromPoint(product.paint.browserRect.left + Math.floor(product.paint.browserRect.width / 2), product.paint.browserRect.top + Math.floor(product.paint.browserRect.height / 2));
      product.paint.hitTest = point ? { localName: String(point.localName || ''), isSurface: point.hasAttribute?.('data-zchatgpt-embed-browser') === true } : null;
    } catch (error) { product.paint.hitTestError = message(error); }

    // Chat -> Agent -> Chat: the mode control moves with the mode, the native surface appears, and
    // the application document is neither reloaded nor rebuilt.
    const click = selector => { const node = doc.querySelector(selector); if (!node) throw new Error(`Missing ${selector}`); node.click(); };
    click('[data-zchatgpt-action="mode-agent"]');
    await until(() => { const node = doc.querySelector('[data-zchatgpt-embed]'); return node && node.hasAttribute('hidden'); }, 'product-agent-mode-surface-hidden');
    await check('product-agent-mode-restores-the-native-chat',
      doc.querySelector('[data-zchatgpt-chat]').hidden === false && doc.querySelector('[data-zchatgpt-composer-leading] [data-zchatgpt-mode-switch]') !== null && painted() === '',
      { nativeChatHidden: doc.querySelector('[data-zchatgpt-chat]').hidden, painted: painted() });
    click('[data-zchatgpt-action="mode-chat"]');
    await until(() => painted(), 'product-chat-repainted');
    const back = embedBrowser();
    await check('product-mode-switch-keeps-the-application-document',
      back === surfaceBrowser && back.getAttribute('data-zchatgpt-product-tag') === nonce && String(back.currentURI?.spec || '') === surfaceURI,
      { sameElement: back === surfaceBrowser, currentURI: String(back.currentURI?.spec || '').slice(0, 200) });
    product.cookiesAfterChatSurface = { [targetHost]: cookieCount(targetHost) };
    await save();

    // ---- the Zotero context routes, driven through the product's own controls ---------------------
    // Chat mode hosts the real application, and the application owns its own conversation: this host
    // cannot put the paper into that page. What it can do is put the paper — as text, and as the
    // actual PDF file — on the clipboard, and these checks drive the product's own controls and read
    // the pasteboard back, so "the paper reached the clipboard" is measured rather than asserted.
    // A pasteboard read that records *why* it found nothing: which flavors the clipboard actually
    // advertises, and what shape the value came back in. A flavor that is simply absent and a read
    // that threw are different failures, and only one of them is the product's.
    const readClipboard = (flavor) => {
      const clipboard = Services.clipboard;
      const which = clipboard.kGlobalClipboard;
      const out = { flavor, present: null, read: null, kind: null, error: null };
      try { out.present = Boolean(clipboard.hasDataMatchingFlavors([flavor], which)); }
      catch (error) { out.present = `error:${message(error)}`; }
      if (out.present !== true) return out;
      try {
        // The same read Zotero's own `Utilities.Internal.getClipboard` performs: no `init`, an
        // out-object for the transfer data, then the value's own `data` for text.
        const transferable = Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);
        transferable.addDataFlavor(flavor);
        clipboard.getData(transferable, which);
        const data = {};
        transferable.getTransferData(flavor, data, {});
        const value = data.value ?? null;
        out.kind = value === null ? 'null' : typeof value;
        if (typeof value === 'string') out.read = value;
        else if (value) {
          // Text arrives as `nsISupportsString`; a file arrives as `nsIFile`. Asking either one for
          // `data` throws NS_NOINTERFACE, which is a shape answer rather than a read failure.
          try { out.read = typeof value.QueryInterface === 'function' ? value.QueryInterface(Ci.nsISupportsString).data : value.data; }
          catch { out.read = typeof value.path === 'string' ? value.path : null; }
        }
      } catch (error) { out.error = message(error); }
      return out;
    };
    /** The first flavors the clipboard advertises, so a miss can be told from a wrong flavor name. */
    const clipboardFlavors = () => {
      const out = {};
      for (const flavor of ['text/unicode', 'text/plain;charset=utf-16', 'text/plain', 'text/html', 'application/x-moz-file']) {
        try { out[flavor] = Boolean(Services.clipboard.hasDataMatchingFlavors([flavor], Services.clipboard.kGlobalClipboard)); }
        catch (error) { out[flavor] = `error:${message(error)}`; }
      }
      return out;
    };
    /** Up to 60 characters, for the *synthetic* block this driver itself asked the product to build. */
    const clipboardHead = (value) => (typeof value === 'string' ? value.slice(0, 60) : null);
    // Gecko has advertised copied text under more than one flavor name across versions, and which one
    // a given Zotero build uses is exactly the kind of detail this probe must measure rather than
    // assume: every candidate is tried, and each attempt is recorded.
    const readFirstText = () => {
      const attempts = [];
      for (const flavor of ['text/unicode', 'text/plain;charset=utf-16', 'text/plain']) {
        const reading = readClipboard(flavor);
        attempts.push(reading);
        if (typeof reading.read === 'string' && reading.read.length > 0) return { reading, attempts };
      }
      return { reading: null, attempts };
    };
    const embedStatus = () => { const node = doc.querySelector('[data-zchatgpt-embed-status]'); return node ? String(node.textContent || '') : null; };
    /**
     * Click one bar control and wait for the bar's *own* answer to that click: the line the previous
     * action left standing must not be read as this action's result, so the wait is for a change.
     */
    const useControl = async (id) => {
      const control = doc.querySelector(`[data-zchatgpt-action="${id}"]`);
      await check(`product-context-control-${id}`, Boolean(control), { status: embedStatus() });
      const before = embedStatus();
      control.click();
      return until(() => { const now = embedStatus(); return now && now !== before ? now : null; }, `product-status-${id}`, 30000);
    };

    // A sentinel the driver puts on the pasteboard itself, so "the product wrote nothing" and "this
    // probe cannot read the pasteboard" are told apart before the product's own write is measured.
    const sentinel = `ZCHATGPT-SENTINEL-${nonce}`;
    const sentinelWrite = (() => {
      try {
        const helper = Services.clipboardHelper || Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper);
        helper.copyString(sentinel);
        return true;
      } catch (error) { return message(error); }
    })();
    const sentinelRead = readFirstText();
    product.clipboardReadPath = {
      sentinelWritten: sentinelWrite === true ? true : sentinelWrite,
      sentinelSeen: sentinelRead.reading ? sentinelRead.reading.read === sentinel : false,
      chosenFlavor: sentinelRead.reading ? sentinelRead.reading.flavor : null,
      attempts: sentinelRead.attempts,
    };
    await check('product-clipboard-read-path', product.clipboardReadPath.sentinelSeen === true, product.clipboardReadPath);

    const contextStatus = await useControl('copy-context');
    await save();
    const { reading: paperReading, attempts: paperAttempts } = readFirstText();
    const paperText = paperReading ? paperReading.read : null;
    product.contextClipboard = {
      status: String(contextStatus || ''),
      chosenFlavor: paperReading ? paperReading.flavor : null,
      attempts: paperAttempts,
      flavorsAdvertised: clipboardFlavors(),
      // The synthetic block carries our own generated text, so a bounded head and two booleans are
      // enough to show the pasteboard holds the document rather than a sentence about it.
      head: clipboardHead(paperText),
      textLength: paperText === null ? null : paperText.length,
      carriesPaperText: paperText === null ? null : /prior describes beliefs|likelihood describes|ORCHID-72/u.test(paperText),
      carriesHeader: paperText === null ? null : /Context from the PDF open in Zotero/u.test(paperText),
    };
    await check('product-chat-copies-the-paper-context',
      product.contextClipboard.carriesHeader === true && product.contextClipboard.carriesPaperText === true,
      product.contextClipboard);

    const fileStatus = await useControl('copy-pdf-file');
    await save();
    const fileReading = readClipboard('application/x-moz-file');
    const clipboardFile = fileReading.read;
    let attachmentPath = null;
    try { attachmentPath = await (await Zotero.Items.get(attachment.id)).getFilePathAsync(); } catch { /* recorded below */ }
    product.fileClipboard = {
      status: String(fileStatus || ''),
      flavorPresent: fileReading.present,
      valueKind: fileReading.kind,
      readError: fileReading.error,
      flavorsAdvertised: clipboardFlavors(),
      clipboardPath: clipboardFile ? String(clipboardFile) : null,
      attachmentPath: attachmentPath ? String(attachmentPath) : null,
      matchesAttachment: Boolean(clipboardFile && attachmentPath && String(clipboardFile) === String(attachmentPath)),
    };
    await check('product-chat-copies-the-pdf-file',
      product.fileClipboard.matchesAttachment === true &&
      String(fileStatus || '').includes('clipboard'),
      product.fileClipboard);

    // Recorded, not asserted: what the application itself reached. `contentTitle` is written by the
    // page's own script, so a non-empty title is the page's own statement that its JavaScript ran;
    // an empty title with a live URI is a page that is still starting. The remote document is
    // deliberately NOT walked: it belongs to another origin, and this prototype's whole point is that
    // the host does not reach into the application it hosts. Two archived runs of these same bytes
    // recorded the application's own title and a Cloudflare interstitial respectively, which is the
    // ordinary behavior of the site for a profile with no signed-in session.
    report.step = 'product-application';
    await save();
    const applicationSnapshot = await (async () => {
      const start = Date.now();
      let snapshot = describeSurface();
      while (Date.now() - start < 25000 && !snapshot.title) { await delay(750); snapshot = describeSurface(); }
      return snapshot;
    })();
    const applicationTitle = String(applicationSnapshot.title || '');
    product.application = {
      currentURI: applicationSnapshot.currentURI ?? null,
      title: applicationTitle.slice(0, 120),
      isLoadingDocument: applicationSnapshot.isLoadingDocument ?? null,
      docShellIsActive: applicationSnapshot.docShellIsActive ?? null,
      osPid: applicationSnapshot.contentPid ?? null,
      state: applicationSnapshot.state ?? null,
      // The title is the page's own, so it separates an interstitial from the application without
      // reading the page. Whether the app reached a sign-in screen or a signed-in conversation is
      // what the human step answers, and stays NOT RUN here.
      reached: /just a moment|verify you are human/i.test(applicationTitle) ? 'challenge'
        : /chatgpt/i.test(applicationTitle) ? 'application'
        : applicationTitle ? 'unknown' : 'no-title',
      note: 'Browser-element properties only; the remote document is not walked.',
    };
    await save();

    // ---- what the host can do beyond the product path ---------------------------------------------
    // Run after the product so the destructive experiments cannot disturb what the shipped surface
    // measures: each probe is torn down as it finishes, but a XUL `tab-content` placed inside the
    // reader's own tab content damages the host layout while it exists, and the product would then be
    // measured in a reader pane that has no height.
    // The comparison probes read remote documents from privileged code, and in this Zotero build one
    // of them — a remote page in a privileged reader-document iframe — ends the host process. They are
    // therefore opt-in rather than part of the default run: `--surface-probes` runs them, and the
    // default run ends on the product evidence and says where the comparison lives.
    if (config.surfaceProbes) {
      await runProbe({ id: 'reader-iframe', kind: 'iframe-src', host: 'reader-document', doc, note: 'HTML iframe in the reader sidebar host document, for the record: this is the surface the current dock lives in.' });
      await runProbe({ id: 'mainwindow-xul-viewer-attrs-src', kind: 'xul-viewer-attrs', host: 'main-window', doc: win.document, note: 'XUL browser in the XUL main window carrying the attribute set of Zotero\'s own remote-page viewer, navigated by src.' });
      await runProbe({ id: 'mainwindow-xul-viewer-attrs-loadURI', kind: 'xul-viewer-attrs-loaduri', host: 'main-window', doc: win.document, note: 'Same attribute set, navigated by loadURI with the system principal.' });
      await runProbe({ id: 'mainwindow-fixed-div', kind: 'xul-fixed-div', host: 'main-window', doc: win.document, note: 'The product shape: viewer attributes inside an HTML div the surface positions itself, fixed over the window.' });
      await runProbe({ id: 'mainwindow-absolute-div', kind: 'xul-absolute-div', host: 'main-window', doc: win.document, note: 'The same HTML div positioned absolutely, in case a chrome viewport does not support fixed positioning.' });
      await runViewerProbe(url);
    } else {
      report.surfaceProbes = {
        run: false,
        why: 'Opt-in (`--surface-probes`): these probes read remote documents from privileged code and one of them ends this host build\'s process. The iframe/XUL/viewer comparison for this same target is in `.zotero-chatgpt-dev/embed/host-report-0.4.0a17-surface-8of8-PASS.json`.',
      };
      await save();
    }

    report.status = 'completed';
    report.finishedAt = new Date().toISOString();
    await save();
  } catch (error) {
    report.status = 'failed';
    report.failure = { step, message: message(error), stack: String((error && error.stack) || '').split('\n').slice(0, 6).map(line => line.trim()) };
    report.finishedAt = new Date().toISOString();
    try { await save(); } catch { /* nothing left to report */ }
  } finally {
    if (consoleListener) { try { Services.console.unregisterListener(consoleListener); } catch { /* already gone */ } }
    try { await save(); } catch { /* nothing left to report */ }
  }
}
