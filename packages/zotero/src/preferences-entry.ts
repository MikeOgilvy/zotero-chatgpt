import type { WorkspaceSettings } from '../../contracts/src/workspace.ts';
import { createPreferencesPane } from './workspace/preferences-pane.ts';

/**
 * Entry point of the Preferences pane script.
 *
 * Zotero loads this file into a sandbox whose prototype is the Preferences window, so it owns the
 * DOM of its own compartment. The plugin only publishes JSON-text functions on the shared Zotero
 * object; the pane never receives live store objects, files or capabilities. The pane root in
 * `content/preferences/preferences.xhtml` calls `mount`/`unmount` for load and unload.
 */
interface PreferencesBridge {
  readSettings(): Promise<string> | string;
  writeSettings(json: string): Promise<void> | void;
  setSkillEnabled(id: string, enabled: boolean): Promise<void> | void;
  exportPreferences(): Promise<void> | void;
  newProfileId(): string;
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
}
interface ZoteroGlobal {
  ZoteroCodexReaderPreferencesHost?: PreferencesBridge;
  ZoteroCodexReaderPreferencesPane?: { mount(root: Element): void; unmount(root: Element): void };
  logError?(error: unknown): void;
}

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const scope = globalThis as unknown as { Zotero?: ZoteroGlobal };
const panes = new WeakMap<Element, ReturnType<typeof createPreferencesPane>>();

function unavailable(root: Element, text: string): void {
  const message = root.ownerDocument.createElementNS(HTML_NS, 'p');
  message.setAttribute('role', 'alert');
  message.textContent = text;
  root.replaceChildren(message);
}

function mount(root: Element): void {
  // Zotero dispatches one load event per pane root, but a second one must never stack a second form.
  if (panes.has(root)) return;
  const zotero = scope.Zotero;
  const bridge = zotero?.ZoteroCodexReaderPreferencesHost;
  if (!zotero || !bridge) {
    unavailable(root, 'Zotero Codex Reader preferences are unavailable because the plugin is not running.');
    return;
  }
  const pane = createPreferencesPane({
    read: async () => JSON.parse(await bridge.readSettings()) as WorkspaceSettings,
    save: value => Promise.resolve(bridge.writeSettings(JSON.stringify(value))),
    setSkillEnabled: (id, enabled) => Promise.resolve(bridge.setSkillEnabled(id, enabled)),
    exportPreferences: () => Promise.resolve(bridge.exportPreferences()),
    profileId: () => bridge.newProfileId(),
    readAutomaticPdfText: () => bridge.readAutomaticPdfText(),
    writeAutomaticPdfText: enabled => bridge.writeAutomaticPdfText(enabled),
  });
  panes.set(root, pane);
  void pane.mount(root).catch((error: unknown) => {
    zotero.logError?.(error);
    unavailable(root, 'The preferences pane could not be displayed. Reopen the Preferences window to retry.');
  });
}

function unmount(root: Element): void {
  panes.get(root)?.dispose();
  panes.delete(root);
}

if (scope.Zotero) scope.Zotero.ZoteroCodexReaderPreferencesPane = { mount, unmount };
