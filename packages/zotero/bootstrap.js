var ZoteroCodexReader;
var Zotero;
var scriptScope;
var startupTask;
var shutdownRequested = false;
var registeredWindows = new Set();

function install() {}

async function startup({ id, rootURI }) {
  shutdownRequested = false;
  registeredWindows.clear();
  startupTask = initialize({ id, rootURI });
  await startupTask;
}

async function initialize({ id, rootURI }) {
  await Zotero.initializationPromise;
  if (shutdownRequested) {
    return;
  }

  // loadSubScript's target does not inherit the plugin sandbox capabilities.
  scriptScope = {
    Zotero, ChromeUtils, IOUtils, PathUtils, Services,
    Cc: Components.classes, Ci: Components.interfaces,
    fetch, crypto, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout,
  };
  Services.scriptloader.loadSubScript(
    `${rootURI}content/zcr.js`,
    scriptScope,
  );
  ZoteroCodexReader = scriptScope.ZoteroCodexReader;

  await ZoteroCodexReader.startup({ rootURI, pluginID: id });
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
  return !shutdownRequested && Boolean(ZoteroCodexReader);
}

async function registerWindow(window) {
  if (shutdownRequested || registeredWindows.has(window)) {
    return;
  }

  registeredWindows.add(window);
  try {
    await ZoteroCodexReader.onMainWindowLoad(window);
  } catch (error) {
    registeredWindows.delete(window);
    throw error;
  }
}

async function unregisterWindow(window) {
  if (!registeredWindows.delete(window)) {
    return;
  }
  await ZoteroCodexReader.onMainWindowUnload(window);
}

async function shutdown() {
  shutdownRequested = true;
  if (startupTask) {
    try {
      await startupTask;
    } catch {}
  }

  if (ZoteroCodexReader) {
    for (const window of Array.from(registeredWindows)) {
      await unregisterWindow(window);
    }
    await ZoteroCodexReader.shutdown();
  }

  registeredWindows.clear();
  ZoteroCodexReader = undefined;
  scriptScope = undefined;
  startupTask = undefined;
}

function uninstall() {}
