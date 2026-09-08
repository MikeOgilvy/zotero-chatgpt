var ZoteroCodexReader;
var Zotero;
var Services;
var scriptScope;

function install() {}

async function startup({ id, rootURI }) {
  Services = ChromeUtils.importESModule(
    "resource://gre/modules/Services.sys.mjs",
  ).Services;

  await Zotero.initializationPromise;

  scriptScope = { Zotero };
  Services.scriptloader.loadSubScript(
    `${rootURI}content/zcr.js`,
    scriptScope,
  );
  ZoteroCodexReader = scriptScope.ZoteroCodexReader;

  await ZoteroCodexReader.startup({ rootURI, pluginID: id });
  for (const window of Zotero.getMainWindows()) {
    await ZoteroCodexReader.onMainWindowLoad(window);
  }
}

async function onMainWindowLoad({ window }) {
  await ZoteroCodexReader.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }) {
  await ZoteroCodexReader.onMainWindowUnload(window);
}

async function shutdown() {
  if (!ZoteroCodexReader) {
    return;
  }

  for (const window of Zotero.getMainWindows()) {
    await ZoteroCodexReader.onMainWindowUnload(window);
  }
  await ZoteroCodexReader.shutdown();

  ZoteroCodexReader = undefined;
  scriptScope = undefined;
  Services = undefined;
}

function uninstall() {}
