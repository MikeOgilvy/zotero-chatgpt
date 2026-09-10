import { mountChatView, renderReaderShell, type AttachmentIdentity } from './chat/view.ts';
import { ConversationPresenter } from './chat/presenter.ts';
import { createRuntimeSupervisor } from './runtime/supervisor.ts';
import { NativeReaderPane, attachmentIdentity } from './reader/reader-pane.ts';
import { createToolbarButton, insertToolbarButton } from './reader/toolbar.ts';
import { captureSelection, openCitation, paperMetadata, type SelectionPopupEvent } from './reader/selection.ts';
import { SelectionActionBar } from './reader/selection-actions.ts';
import type { HostReader, ToolbarEvent, ZoteroHost, ZoteroWindow } from './reader/host-types.ts';
import { ReaderError, paperId, type Citation, type PaperScope } from '../../contracts/src/index.ts';
declare const Zotero: ZoteroHost;
declare const crypto: { randomUUID(): string };
export interface PluginContext { rootURI: string; pluginID: string }
interface ReaderEntry { pane: NativeReaderPane; buttons: Set<HTMLButtonElement>; bar: SelectionActionBar }
const CLIENT_ID_PREF = 'extensions.zcr.clientId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let context: PluginContext | undefined;
let paneID = '';
let active = false;
let notifierID: string | undefined;
let runtime: ReturnType<typeof createRuntimeSupervisor> | undefined;
const readers = new Map<HostReader, ReaderEntry>();
const windows = new Map<ZoteroWindow, () => void>();
/** Presenters outlive views: drafts and conversation copies stay while a sidebar is closed. */
const presenters = new Map<string, ConversationPresenter>();

/** Persistent random namespace of this Zotero profile; it never changes across restarts or upgrades. */
function clientId(): string {
  const existing = Zotero.Prefs.get(CLIENT_ID_PREF, true);
  if (typeof existing === 'string' && UUID.test(existing)) return existing;
  const fresh = crypto.randomUUID(); Zotero.Prefs.set(CLIENT_ID_PREF, fresh, true); return fresh;
}
export function paperOf(identity: AttachmentIdentity): PaperScope { return { clientId: clientId(), libraryId: identity.libraryID, attachmentKey: identity.key }; }
function presenterFor(identity: AttachmentIdentity): ConversationPresenter {
  const paper = paperOf(identity); const key = paperId(paper);
  let presenter = presenters.get(key);
  if (!presenter) {
    presenter = new ConversationPresenter(paper, identity.title || 'PDF attachment', {
      ensureStarted: () => runtime ? runtime.ensureStarted() : Promise.reject(new Error('Plugin stopped.')),
      openAuthorization: url => Zotero.launchURL(url),
      uuid: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    });
    presenters.set(key, presenter);
  }
  return presenter;
}
const hooks = {
  openCitation: (citation: Citation) => openCitation(Zotero, citation, clientId()),
  copyText: (text: string) => {
    const internals = (Zotero as ZoteroHost & { Utilities?: { Internal?: { copyTextToClipboard?(value: string): void } } }).Utilities?.Internal;
    if (internals?.copyTextToClipboard) internals.copyTextToClipboard(text);
    else void globalThis.navigator?.clipboard?.writeText(text);
  },
  openLink: (url: string) => { Zotero.launchURL(url); },
};
function entry(reader: HostReader): ReaderEntry {
  let current = readers.get(reader);
  if (!current) {
    const buttons = new Set<HTMLButtonElement>();
    const pane = new NativeReaderPane(Zotero, reader, paneID, buttons, (body, identity, close, opened) => {
      const root = renderReaderShell(body, identity, close);
      const presenter = presenterFor(identity);
      const unmount = mountChatView(root, presenter, hooks);
      if (opened) void presenter.activate();
      return unmount;
    });
    // Both selection actions only show the sidebar; the citation copy was taken before the click.
    const act = async (citation: Citation, run: (presenter: ConversationPresenter) => void) => {
      const identity = attachmentIdentity(Zotero, reader); if (!identity || !active) return;
      await pane.controller.open();
      const presenter = presenterFor(identity); await presenter.activate(); run(presenter);
    };
    const bar = new SelectionActionBar({
      explain: citation => { void act(citation, presenter => { void presenter.explain(citation); }).catch(error => Zotero.logError(error)); },
      ask: citation => { void act(citation, presenter => { presenter.addCitation(citation); presenter.focusInput(); }).catch(error => Zotero.logError(error)); },
    });
    current = { buttons, pane, bar };
    readers.set(reader, current);
  }
  return current;
}
function onSelectionPopup(event: SelectionPopupEvent): void {
  if (!active) return;
  const current = entry(event.reader);
  if (!current.pane.supported()) return;
  const identity = attachmentIdentity(Zotero, event.reader); const metadata = paperMetadata(Zotero, event.reader);
  if (!identity || !metadata) return;
  try {
    const citation = captureSelection(event, paperOf(identity), metadata, { uuid: () => crypto.randomUUID(), now: () => new Date().toISOString() });
    current.bar.show(event, citation);
  } catch (error) {
    // Limits (for example a cross-page selection) are stated in place; nothing is sent.
    current.bar.showNotice(event, error instanceof ReaderError ? error.message : 'This selection cannot be used with Codex.');
    if (!(error instanceof ReaderError)) Zotero.logError(error);
  }
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
      current.pane.dispose(); current.bar.dispose();
      for (const button of current.buttons) button.remove();
      readers.delete(reader);
    } else current.pane.reconcile();
  }
}
export function startup(options: PluginContext): void {
  if (active) return;
  context = options; active = true;
  runtime = createRuntimeSupervisor(options.rootURI);
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
      entry(reader).pane.render(body);
    },
  });
  // Zotero 9.0.6's unregisterEventListener has an inverted filter. PluginObserver
  // removes pluginID listeners on actual disable/uninstall; active guards late events.
  Zotero.Reader.registerEventListener('renderToolbar', attach, options.pluginID);
  Zotero.Reader.registerEventListener('renderTextSelectionPopup', onSelectionPopup, options.pluginID);
  notifierID = Zotero.Notifier.registerObserver({ notify: reconcile }, ['tab'], options.pluginID);
}
export function onMainWindowLoad(window: Window): void {
  const win = window as ZoteroWindow;
  if (!active || !context || windows.has(win)) return;
  const doc = win.document;
  const css = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  css.setAttribute('rel', 'stylesheet'); css.setAttribute('href', `${context.rootURI}content/assets/sidebar.css`);
  const katex = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  katex.setAttribute('rel', 'stylesheet'); katex.setAttribute('href', `${context.rootURI}content/assets/katex/katex.min.css`);
  const locale = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
  // Zotero registers plugin locale files by resource basename, not absolute URI.
  locale.setAttribute('rel', 'localization'); locale.setAttribute('href', 'zcr.ftl');
  doc.documentElement.append(css, katex, locale);
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
  windows.set(win, () => { observer.disconnect(); doc.removeEventListener('click', onNativeClick, true); css.remove(); katex.remove(); locale.remove(); });
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
    current.pane.dispose(); current.bar.dispose(); readers.delete(reader);
  }
  windows.get(win)?.(); windows.delete(win);
}
export async function shutdown(): Promise<void> {
  active = false;
  for (const win of windows.keys()) onMainWindowUnload(win);
  for (const current of readers.values()) { for (const button of current.buttons) button.remove(); current.pane.dispose(); current.bar.dispose(); }
  readers.clear();
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
  if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
  paneID = ''; context = undefined;
  for (const presenter of presenters.values()) presenter.dispose();
  presenters.clear();
  const stopping = runtime; runtime = undefined;
  await stopping?.stop();
}
