var ZoteroChatGPT;
var Zotero;
var scriptScope;
var startupTask;
var shutdownRequested = false;
var registeredWindows = new Set();

function install() {}

async function startup({ id, rootURI, version }) {
  shutdownRequested = false;
  registeredWindows.clear();
  startupTask = initialize({ id, rootURI, version });
  await startupTask;
}

async function initialize({ id, rootURI, version }) {
  await Zotero.initializationPromise;
  if (shutdownRequested) {
    return;
  }

  // loadSubScript's target does not inherit the plugin sandbox capabilities.
  Components.utils.importGlobalProperties(['AbortController', 'atob', 'btoa']);
  scriptScope = {
    Zotero, ChromeUtils, IOUtils, PathUtils, Services,
    Cc: Components.classes, Ci: Components.interfaces,
    Cu: Components.utils,
    fetch, crypto, TextDecoder, TextEncoder, URL, AbortController, atob, btoa, setTimeout, clearTimeout,
  };
  Services.scriptloader.loadSubScript(
    `${rootURI}content/zchatgpt.js`,
    scriptScope,
  );
  ZoteroChatGPT = scriptScope.ZoteroChatGPT;

  await ZoteroChatGPT.startup({ rootURI, pluginID: id, ...(version ? { version } : {}) });
  if (shutdownRequested) {
    return;
  }

  for (const window of Zotero.getMainWindows()) {
    await registerWindow(window);
  }
}

async function onMainWindowLoad({ window }) {
  if (await isReady()) {
    await registerWindow(window);
  }
}

async function onMainWindowUnload({ window }) {
  if (await isReady()) {
    await unregisterWindow(window);
  }
}

async function isReady() {
  if (!startupTask) {
    return false;
  }
  await startupTask;
  return !shutdownRequested && Boolean(ZoteroChatGPT);
}

async function registerWindow(window) {
  if (shutdownRequested || registeredWindows.has(window)) {
    return;
  }

  registeredWindows.add(window);
  try {
    await ZoteroChatGPT.onMainWindowLoad(window);
  } catch (error) {
    registeredWindows.delete(window);
    throw error;
  }
}

async function unregisterWindow(window) {
  if (!registeredWindows.delete(window)) {
    return;
  }
  await ZoteroChatGPT.onMainWindowUnload(window);
}

async function shutdown() {
  shutdownRequested = true;
  if (startupTask) {
    try {
      await startupTask;
    } catch {}
  }

  if (ZoteroChatGPT) {
    for (const window of Array.from(registeredWindows)) {
      await unregisterWindow(window);
    }
    await ZoteroChatGPT.shutdown();
  }

  registeredWindows.clear();
  ZoteroChatGPT = undefined;
  scriptScope = undefined;
  startupTask = undefined;
}

function uninstall() {}
