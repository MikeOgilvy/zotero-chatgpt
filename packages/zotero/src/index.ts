import { renderPreview } from './chat/view.ts';
import { NativeReaderPane, attachmentIdentity } from './reader/reader-pane.ts';
import { createToolbarButton, insertToolbarButton } from './reader/toolbar.ts';
import type { HostReader, ToolbarEvent, ZoteroHost, ZoteroWindow } from './reader/host-types.ts';
declare const Zotero: ZoteroHost;
export interface PluginContext { rootURI: string; pluginID: string }
interface ReaderEntry { pane: NativeReaderPane; buttons: Set<HTMLButtonElement> }
let context: PluginContext | undefined;
let paneID = '';
let active = false;
let notifierID: string | undefined;
const readers = new Map<HostReader, ReaderEntry>();
const windows = new Map<ZoteroWindow, () => void>();

function entry(reader: HostReader): ReaderEntry {
  let current = readers.get(reader);
  if (!current) {
    const buttons = new Set<HTMLButtonElement>();
    current = { buttons, pane: new NativeReaderPane(Zotero, reader, paneID, buttons) };
    readers.set(reader, current);
  }
  return current;
}
function attach(event: ToolbarEvent): void {
  if (!active) return;
  const current = entry(event.reader);
  if (!current.pane.supported()) return;
  const button = createToolbarButton(event.doc, () => {
    if (!active || !current.pane.selected()) return;
    void current.pane.controller.toggle().catch(error => Zotero.logError(error));
  });
  for (const old of current.buttons) if (!old.isConnected) current.buttons.delete(old);
  insertToolbarButton(event, button); current.buttons.add(button);
  current.pane.setActive(current.pane.controller.active);
}
function reconcile(): void {
  for (const [reader, current] of readers) {
    if (!Zotero.Reader._readers.includes(reader)) {
      current.pane.dispose();
      for (const button of current.buttons) button.remove();
      readers.delete(reader);
    } else current.pane.reconcile();
  }
}
export function startup(options: PluginContext): void {
  if (active) return;
  context = options; active = true;
  paneID = Zotero.ItemPaneManager.registerSection({
    paneID: 'codex-reader', pluginID: options.pluginID,
    header: { l10nID: 'zcr-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    sidenav: { l10nID: 'zcr-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    onItemChange: ({ tabType, setEnabled }) => { setEnabled(active && tabType === 'reader'); },
    onRender: ({ body, doc }) => {
      if (!active) return;
      const win = doc.defaultView as ZoteroWindow | null;
      const tabID = body.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId;
      const reader = tabID ? Zotero.Reader.getByTabID(tabID) : undefined;
      const identity = reader && attachmentIdentity(Zotero, reader);
      if (!win || !reader || !identity) { body.replaceChildren(); return; }
      body.closest<HTMLElement>('item-pane-custom-section')?.setAttribute('data-zcr-section', '');
      renderPreview(body, identity, () => entry(reader).pane.controller.close());
    },
  });
  // Zotero 9.0.6's unregisterEventListener has an inverted filter. PluginObserver
  // removes pluginID listeners on actual disable/uninstall; active guards late events.
  Zotero.Reader.registerEventListener('renderToolbar', attach, options.pluginID);
  notifierID = Zotero.Notifier.registerObserver({ notify: reconcile }, ['tab'], options.pluginID);
}
export function onMainWindowLoad(window: Window): void {
  const win = window as ZoteroWindow;
  if (!active || !context || windows.has(win)) return;
  const doc = win.document;
  const css = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  css.setAttribute('rel', 'stylesheet'); css.setAttribute('href', `${context.rootURI}content/assets/sidebar.css`);
  const locale = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  locale.setAttribute('rel', 'localization'); locale.setAttribute('href', `${context.rootURI}locale/en-US/zcr.ftl`);
  doc.documentElement.append(css, locale);
  const onNativeClick = (event: Event) => {
    const target = event.target as Element | null;
    const button = target?.closest?.('.btn[data-pane]') as HTMLElement | null;
    if (!button || !button.closest('#zotero-context-pane-sidenav')) return;
    const reader = win.Zotero_Tabs && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);
    if (!reader) return;
    const current = entry(reader);
    if (button.dataset.pane === paneID) {
      if (!current.pane.controller.active && current.pane.selected()) void current.pane.controller.toggle().catch(error => Zotero.logError(error));
    } else current.pane.controller.nativeAction();
  };
  doc.addEventListener('click', onNativeClick, true);
  const observer = new win.MutationObserver(reconcile);
  const pane = doc.getElementById('zotero-context-pane');
  if (pane) observer.observe(pane, { attributes: true, subtree: true, attributeFilter: ['collapsed', 'selectedIndex'] });
  windows.set(win, () => { observer.disconnect(); doc.removeEventListener('click', onNativeClick, true); css.remove(); locale.remove(); });
  // Enabling an add-on does not necessarily rerender an already-open reader toolbar.
  for (const reader of Zotero.Reader._readers) {
    if (reader._window !== win) continue;
    const readerDoc = reader._iframeWindow?.document;
    const find = readerDoc?.querySelector('.toolbar .find');
    if (readerDoc && find?.parentElement) attach({ reader, doc: readerDoc, append: (...nodes) => { find.before(...nodes); } });
  }
}
export function onMainWindowUnload(window: Window): void {
  const win = window as ZoteroWindow;
  for (const [reader, current] of readers) {
    if (reader._window !== win) continue;
    for (const button of current.buttons) button.remove();
    current.pane.dispose(); readers.delete(reader);
  }
  windows.get(win)?.(); windows.delete(win);
}
export function shutdown(): void {
  active = false;
  for (const win of windows.keys()) onMainWindowUnload(win);
  for (const current of readers.values()) { for (const button of current.buttons) button.remove(); current.pane.dispose(); }
  readers.clear();
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
  if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
  paneID = ''; context = undefined;
}
