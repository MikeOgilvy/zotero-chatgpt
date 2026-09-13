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
  /**
   * The runtime's live model ids as JSON text, or the JSON literal `null` when no runtime has
   * reported any. Optional so a plugin host that has not published it still mounts the pane.
   */
  readLiveModels?(): Promise<string> | string;
  /**
   * History management, added after the first pane shipped. Optional here as well as on the pane, so
   * an older plugin host simply renders no History section instead of failing to mount the pane.
   */
  readHistory?(query: string): Promise<string> | string;
  setHistoryArchived?(ids: string, archived: boolean): Promise<string> | string;
  deleteHistory?(ids: string): Promise<string> | string;
  /** Bounded storage measurement, optional like the rest: absent means the pane says size is unknown. */
  readStorageReport?(): Promise<string> | string;
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
  // History methods cross as JSON text too. A host that has not published them yet gets a pane with
  // no History section; a malformed payload is the section's problem, never a mount failure.
  const history = bridge.readHistory && bridge.setHistoryArchived && bridge.deleteHistory
    ? {
        readHistory: async (query: string): Promise<unknown> => JSON.parse(await bridge.readHistory!(query)) as unknown,
        setHistoryArchived: async (ids: string[], archived: boolean): Promise<unknown> => JSON.parse(await bridge.setHistoryArchived!(JSON.stringify(ids), archived)) as unknown,
        deleteHistory: async (ids: string[]): Promise<unknown> => JSON.parse(await bridge.deleteHistory!(JSON.stringify(ids))) as unknown,
        // The storage measurement is separately optional: without it the section still lists chats.
        ...(bridge.readStorageReport ? {
          readStorageReport: async (): Promise<unknown> => JSON.parse(await bridge.readStorageReport!()) as unknown,
        } : {}),
      }
    : {};
  const pane = createPreferencesPane({
    read: async () => JSON.parse(await bridge.readSettings()) as WorkspaceSettings,
    save: value => Promise.resolve(bridge.writeSettings(JSON.stringify(value))),
    setSkillEnabled: (id, enabled) => Promise.resolve(bridge.setSkillEnabled(id, enabled)),
    exportPreferences: () => Promise.resolve(bridge.exportPreferences()),
    profileId: () => bridge.newProfileId(),
    readAutomaticPdfText: () => bridge.readAutomaticPdfText(),
    writeAutomaticPdfText: enabled => bridge.writeAutomaticPdfText(enabled),
    // The live model list is optional like History: an older host renders the bundled families and
    // the honest "these come from the runtime" copy instead of failing to mount.
    ...(bridge.readLiveModels ? {
      readLiveModels: async (): Promise<unknown> => JSON.parse(await bridge.readLiveModels!()) as unknown,
    } : {}),
    ...history,
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
