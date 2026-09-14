import { mountChatView, renderReaderShell, type AttachmentIdentity } from './chat/view.ts';
import { ConversationPresenter } from './chat/presenter.ts';
import { createRuntimeSupervisor } from './runtime/supervisor.ts';
import { createLocalServices } from './runtime/local-services.ts';
import { geckoHost } from './runtime/gecko.ts';
import { injectReaderStyles } from './reader/dock.ts';
import { NativeReaderPane, attachmentIdentity, currentReaderZoom, zoomReader } from './reader/reader-pane.ts';
import { createToolbarButton, insertToolbarButton } from './reader/toolbar.ts';
import { captureSelection, freezeCitationVersion, openCitation, paperMetadata, type SelectionPopupEvent } from './reader/selection.ts';
import { paperIdentityOf } from './reader/metadata.ts';
import { SelectionActionBar } from './reader/selection-actions.ts';
import { nativeDocumentSource, ReaderDocumentCache } from './reader/document.ts';
import { nativeSourceNavigator, openSourcePage } from './reader/source-highlight.ts';
import type { HostReader, ToolbarEvent, ZoteroHost, ZoteroWindow } from './reader/host-types.ts';
import { createPreferencesService } from './workspace/preferences-service.ts';
import { createPreferencePaneRegistrar, type PreferencePaneRegistrar } from './workspace/preferences-registration.ts';
import { ReaderError, paperId, type Citation, type PaperIdentity, type PaperScope } from '../../contracts/src/index.ts';
declare const Zotero: ZoteroHost;
declare const crypto: { randomUUID(): string };
export interface PluginContext { rootURI: string; pluginID: string; version?: string }
interface ReaderEntry { pane: NativeReaderPane; buttons: Set<HTMLButtonElement>; bar: SelectionActionBar; latestSelectionId?: string }
const CLIENT_ID_PREF = 'extensions.zcr.clientId';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
let context: PluginContext | undefined;
let paneID = '';
let active = false;
let notifierID: string | undefined;
let runtime: ReturnType<typeof createRuntimeSupervisor> | undefined;
let documentCache: ReaderDocumentCache | undefined;
let localServices: ReturnType<typeof createLocalServices> | undefined;
let preferencePanes: PreferencePaneRegistrar | undefined;
/** Small, JSON-only surface the Preferences window script may call; see preferences-entry.ts. */
interface PreferencesBridgeHost {
  ZoteroCodexReaderPreferencesHost?: unknown;
  ZoteroCodexReaderPreferencesPane?: unknown;
}
function preferencesBridge(): PreferencesBridgeHost { return Zotero as ZoteroHost & PreferencesBridgeHost; }
const AUTO_PDF_PREF = 'extensions.zcr.automaticPdfText';
const PDF_DISCLOSURE_PREF = 'extensions.zcr.pdfTextDisclosureSeen';
const readers = new Map<HostReader, ReaderEntry>();
const windows = new Map<ZoteroWindow, () => void>();
/** Presenters outlive views: drafts and conversation copies stay while a sidebar is closed. */
const presenters = new Map<string, ConversationPresenter>();
const citationVersions = new WeakMap<Citation, Promise<Citation>>();

/** Persistent random namespace of this Zotero profile; it never changes across restarts or upgrades. */
function clientId(): string {
  const existing = Zotero.Prefs.get(CLIENT_ID_PREF, true);
  if (typeof existing === 'string' && UUID.test(existing)) return existing;
  const fresh = crypto.randomUUID(); Zotero.Prefs.set(CLIENT_ID_PREF, fresh, true); return fresh;
}
export function paperOf(identity: AttachmentIdentity): PaperScope { return { clientId: clientId(), libraryId: identity.libraryID, attachmentKey: identity.key }; }
/**
 * Freezes everything the reader read about this paper into the one identity the session and the
 * model context carry. `paperIdentityOf` owns the field list, the caps and the "absent stays absent"
 * rule, so the sidebar card, the `@`-reference listing and the reading JSON all describe the same
 * paper the same way.
 */
function paperIdentityFor(identity: AttachmentIdentity, reader?: HostReader): PaperIdentity {
  const metadata = reader ? paperMetadata(Zotero, reader) : undefined;
  return paperIdentityOf(metadata ?? { title: '', authors: [] }, metadata?.title.trim() || identity.title || 'PDF attachment');
}
function presenterFor(identity: AttachmentIdentity, reader?: HostReader): ConversationPresenter {
  const paper = paperOf(identity); const key = paperId(paper);
  let presenter = presenters.get(key);
  if (!presenter) {
    const identityMeta = paperIdentityFor(identity, reader);
    const source = nativeDocumentSource(Zotero, () => Zotero.Reader._readers.find(r => {
      const item = Zotero.Items.get(r.itemID); return item?.key === paper.attachmentKey && item.libraryID === paper.libraryId;
    }), paper);
    presenter = new ConversationPresenter(paper, identityMeta.title, {
      ensureStarted: () => runtime ? runtime.ensureStarted() : Promise.reject(new Error('Plugin stopped.')),
      openAuthorization: url => Zotero.launchURL(url),
      uuid: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      ...(localServices ? {
        getWorkspace: localServices.getWorkspace,
        getTasks: localServices.getTasks,
        getReading: localServices.getReading,
        library: localServices.library,
        openCitation: citation => openCitation(Zotero, citation, clientId()),
        openItem: async (reference: import('../../contracts/src/agent.ts').NativeItemRef) => {
          if (reference.clientId !== clientId()) throw new ReaderError('NOT_FOUND', 'The output belongs to another profile.');
          const item = Zotero.Items.getByLibraryAndKey?.(reference.libraryId, reference.key);
          const win = Zotero.getMainWindows()[0] as (ZoteroWindow & { ZoteroPane?: { selectItem(id: number): Promise<void> } }) | undefined;
          if (!item || !item.id || !win?.ZoteroPane) throw new ReaderError('NOT_FOUND', 'The saved output could not be opened.');
          await win.ZoteroPane.selectItem(item.id);
        },
        openHistory: async (scope: PaperScope, conversationId: string) => {
          await localServices?.library.open(scope);
          const target = Zotero.Reader._readers.find(reader => { const item = Zotero.Items.get(reader.itemID); return item?.key === scope.attachmentKey && item.libraryID === scope.libraryId; });
          const identity = target && attachmentIdentity(Zotero, target);
          if (!target || !identity) throw new ReaderError('NOT_FOUND', 'The saved chat attachment could not be opened.');
          await entry(target).pane.controller.open();
          const next = presenterFor(identity, target); await next.activate(); await next.openConversation(conversationId);
        },
      } : {}),
      document: {
        readEnabled: () => Zotero.Prefs.get(AUTO_PDF_PREF, true) !== false,
        writeEnabled: value => Zotero.Prefs.set(AUTO_PDF_PREF, value, true),
        needsDisclosure: () => Zotero.Prefs.get(PDF_DISCLOSURE_PREF, true) !== true,
        acknowledge: () => Zotero.Prefs.set(PDF_DISCLOSURE_PREF, true, true),
        prepare: async (signal, progress, range) => {
          const captured = await source.capture(signal);
          if (!documentCache) throw new Error('PDF preparation is unavailable.');
          return documentCache.read(paper, captured, signal, progress, range);
        },
        validate: source.validate,
      },
    }, identityMeta);
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
  exportImage: async (image: import('../../contracts/src/index.ts').ImageAttachment) => {
    if (!localServices) throw new Error('Image export is unavailable.');
    await localServices.library.exportImage(image);
  },
};
function readerAssets(): { stylesheet?: string; katex?: string } {
  if (!context) return {};
  return {
    stylesheet: `${context.rootURI}content/assets/sidebar.css`,
    katex: `${context.rootURI}content/assets/katex/katex.min.css`,
  };
}
function zoomDocuments(reader: HostReader, root: HTMLElement): Array<Document | HTMLElement> {
  // Reader chrome iframe only. The nested PDF.js document keeps native zoom.
  const readerDoc = reader._iframeWindow?.document ?? root.ownerDocument;
  return [...new Set([readerDoc, root])];
}
function entry(reader: HostReader): ReaderEntry {
  let current = readers.get(reader);
  if (!current) {
    const buttons = new Set<HTMLButtonElement>();
    const pane = new NativeReaderPane(Zotero, reader, paneID, buttons, (body, identity, close, opened) => {
      const root = renderReaderShell(body, identity, close);
      const presenter = presenterFor(identity, reader);
      const unmount = mountChatView(root, presenter, {
        ...hooks,
        openDocumentPage: (document, pageIndex, quote) =>
          openSourcePage(nativeSourceNavigator(Zotero, () => reader, document.paper), document, pageIndex, quote ?? null),
        zoomTargets: zoomDocuments(reader, root),
        // The reader's own close callback: collapses the dock exactly as the toolbar toggle does,
        // restoring the previous Zotero context pane, zoom/anchor and focus. The view calls it only
        // when the last unarchived chat for this attachment is closed.
        closeDock: close,
        uuid: () => crypto.randomUUID(),
        readerZoom: {
          zoomIn: () => { pane.controller.manualZoom(); zoomReader(reader, 'in'); },
          zoomOut: () => { pane.controller.manualZoom(); zoomReader(reader, 'out'); },
          zoomReset: () => { pane.controller.manualZoom(); zoomReader(reader, 'reset'); },
          readZoom: () => currentReaderZoom(reader),
        },
      });
      if (opened) void presenter.activate();
      return unmount;
    }, readerAssets());
    // Both selection actions only show the sidebar; the citation copy was taken before the click.
    const act = async (citation: Citation, run: (presenter: ConversationPresenter, frozen: Citation) => void) => {
      const identity = attachmentIdentity(Zotero, reader); if (!identity || !active) return;
      const frozen = await (citationVersions.get(citation) ?? freezeCitationVersion(Zotero, reader, citation));
      await pane.controller.open();
      const presenter = presenterFor(identity, reader); await presenter.activate(); run(presenter, frozen);
    };
    const bar = new SelectionActionBar({
      explain: citation => { void act(citation, (presenter, frozen) => { void presenter.explain(frozen); }).catch(error => Zotero.logError(error)); },
      ask: citation => { void act(citation, (presenter, frozen) => { presenter.addCitation(frozen); presenter.focusInput(); }).catch(error => Zotero.logError(error)); },
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
    const version = freezeCitationVersion(Zotero, event.reader, citation);
    current.latestSelectionId = citation.id;
    citationVersions.set(citation, version);
    void version.catch(() => { if (active && current.latestSelectionId === citation.id) current.bar.showNotice(event, 'This PDF version could not be verified. Reopen the PDF and select the passage again.'); });
    current.bar.show(event, citation);
  } catch (error) {
    // Limits (for example a cross-page selection) are stated in place; nothing is sent.
    current.bar.showNotice(event, error instanceof ReaderError ? error.message : 'This selection cannot be used with Codex.');
    if (!(error instanceof ReaderError)) Zotero.logError(error);
  }
}
function attach(event: ToolbarEvent): void {
  if (!active) return;
  injectReaderStyles(event.doc, readerAssets());
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
  if (runtime) throw new Error('The previous Codex process has not stopped. Retry shutdown before enabling the plugin.');
  context = options; active = true;
  runtime = createRuntimeSupervisor(options.rootURI, options.version);
  documentCache = new ReaderDocumentCache({ yield: () => new Promise(resolve => setTimeout(resolve, 0)) });
  localServices = createLocalServices(geckoHost().host, Zotero, clientId(), documentCache);
  paneID = Zotero.ItemPaneManager.registerSection({
    paneID: 'codex-reader', pluginID: options.pluginID,
    header: { l10nID: 'zcr-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    sidenav: { l10nID: 'zcr-pane-title', icon: `${options.rootURI}content/assets/icon.svg` },
    onItemChange: ({ tabType, setEnabled }) => { setEnabled(active && tabType === 'reader'); },
    onRender: ({ body }) => {
      if (!active) return;
      body.replaceChildren();
      const section = body.closest<HTMLElement>('item-pane-custom-section');
      if (section) {
        section.dataset.zcrSection = '';
        section.hidden = true;
      }
    },
  });
  const workspace = () => localServices
    ? localServices.getWorkspace()
    : Promise.reject(new ReaderError('BUSY', 'Zotero Codex Reader is stopping.'));
  preferencesBridge().ZoteroCodexReaderPreferencesHost = createPreferencesService({
    workspace,
    // One pref, one owner: the native pane and the reader opt-out read the same value.
    readAutomaticPdfText: () => Zotero.Prefs.get(AUTO_PDF_PREF, true) !== false,
    writeAutomaticPdfText: value => { Zotero.Prefs.set(AUTO_PDF_PREF, value, true); },
    // The runtime's last live `model/list` ids, or null when it is not running. Read-only: opening
    // the Preferences window never starts Codex, and an offerable id it reports (a GPT-5.3 Spark
    // model) becomes selectable in the pane. Excluded families are filtered in core, not here.
    liveModels: () => {
      const client = runtime?.currentClient();
      return Promise.resolve(client ? client.snapshot().models.map(model => model.id) : null);
    },
  });
  preferencePanes = createPreferencePaneRegistrar({
    panes: Zotero.PreferencePanes, pluginID: options.pluginID, rootURI: options.rootURI,
    logError: error => Zotero.logError(error),
  });
  void preferencePanes.ensure();
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
  preferencePanes?.remove(); preferencePanes = undefined;
  const bridge = preferencesBridge();
  try { delete bridge.ZoteroCodexReaderPreferencesHost; delete bridge.ZoteroCodexReaderPreferencesPane; }
  catch (error) { Zotero.logError(error); }
  if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
  notifierID = undefined;
  if (paneID) Zotero.ItemPaneManager.unregisterSection(paneID);
  paneID = ''; context = undefined;
  for (const presenter of presenters.values()) { await presenter.flushDraft?.().catch(() => Zotero.logError(new Error('A chat draft could not be saved during shutdown.'))); presenter.dispose(); }
  presenters.clear();
  documentCache?.clear(); documentCache = undefined;
  const stopping = runtime;
  const local = localServices; localServices = undefined;
  const results = await Promise.allSettled([local?.stop(), stopping?.stop()]);
  if (results[1]?.status === 'fulfilled' && runtime === stopping) runtime = undefined;
  if (results.some(result => result.status === 'rejected')) throw new Error('Plugin shutdown could not complete every cleanup operation. Retrying preserves ownership of any remaining Codex process.');
}
