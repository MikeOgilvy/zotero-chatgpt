import { renderPreview, type AttachmentIdentity } from '../chat/view.ts';
import { DEFAULT_SIDEBAR_WIDTH, ReaderLayoutController, type Anchor, type DockState, type LayoutHost, type Scale, type ViewPosition } from './layout.ts';
import type { HostReader, ItemDetails, ZoteroHost, ZoteroWindow } from './host-types.ts';
import { updateToolbarButton } from './toolbar.ts';
export type SidebarRenderer = (body: HTMLElement, identity: AttachmentIdentity, close: () => void, active: boolean) => (() => void) | void;
const WIDTH_PREF = 'extensions.zcr.sidebarWidth';

export function attachmentIdentity(zotero: ZoteroHost, reader: HostReader): AttachmentIdentity | undefined {
  const item = zotero.Items.get(reader.itemID);
  return item && { title: item.getField('title'), key: item.key, libraryID: item.libraryID };
}
/** Private PDF state is read in this adapter only. Numeric _location.scale is a percentage. */
export function capturePosition(reader: HostReader): ViewPosition | undefined {
  const location = reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer._location;
  if (!location) return;
  const scale = location.scale;
  if (typeof scale !== 'number' && scale !== 'auto' && scale !== 'page-fit' && scale !== 'page-width') return;
  return { scale, anchor: { pageIndex: location.pageNumber - 1, left: location.left, top: location.top } };
}
export class NativeReaderPane implements LayoutHost {
  readonly controller = new ReaderLayoutController(this);
  private details: ItemDetails | undefined;
  private disposeView: (() => void) | undefined;
  private alive = true;
  private expectedPreset: string | undefined;
  private zoomGeneration = 0;
  private pendingFixedScale: number | undefined;
  private disconnectZoom: (() => void) | undefined;
  private disconnectLayout: (() => void) | undefined;
  private layoutTimer: number | undefined;
  private applyingWidth = false;
  private lastAvailable = 0;
  private lastWidth = 0;
  constructor(private zotero: ZoteroHost, readonly reader: HostReader, private paneID: string, private buttons: Set<HTMLButtonElement>, private renderView: SidebarRenderer = renderPreview) {}
  private get win(): ZoteroWindow { return this.reader._window; }
  supported(): boolean {
    return this.alive && this.reader.type === 'pdf' && !!this.reader.tabID && !!this.win.ZoteroContextPane
      && this.zotero.Prefs.get('layout') !== 'stacked';
  }
  selected(): boolean { return this.supported() && this.win.Zotero_Tabs?.selectedID === this.reader.tabID; }
  private currentDetails(): ItemDetails | undefined {
    return Array.from(this.win.document.querySelectorAll<ItemDetails>('#zotero-context-pane-item-deck > [data-tab-id]'))
      .find(node => node.dataset.tabId === this.reader.tabID);
  }
  captureDock(): DockState {
    const context = this.win.ZoteroContextPane!;
    return { collapsed: context.collapsed, mode: context.context.mode, scrollTop: this.currentDetails()?.querySelector('#zotero-view-item')?.scrollTop ?? 0, width: this.currentWidth() };
  }
  capturePosition(): ViewPosition | undefined {
    const position = capturePosition(this.reader);
    // A reopen inherits the restoration target even before the queued native call.
    return position && { ...position, scale: this.pendingFixedScale ?? position.scale };
  }
  showDock(): void {
    ++this.zoomGeneration;
    this.pendingFixedScale = undefined;
    const context = this.win.ZoteroContextPane!;
    context.context.mode = 'item'; context.collapsed = false;
  }
  restoreDock(state: DockState): void {
    if (!this.selected()) return;
    this.applyWidth(state.width);
    const context = this.win.ZoteroContextPane!;
    context.context.mode = state.mode; context.collapsed = state.collapsed;
    const scroll = this.currentDetails()?.querySelector('#zotero-view-item');
    if (scroll) scroll.scrollTop = state.scrollTop;
  }
  readDesiredWidth(): number {
    const stored = this.zotero.Prefs?.get?.(WIDTH_PREF, true);
    if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
    const current = this.currentWidth();
    if (current >= 240 && this.win.ZoteroContextPane && !this.win.ZoteroContextPane.collapsed) return current;
    return DEFAULT_SIDEBAR_WIDTH;
  }
  rememberWidth(cssPixels: number): void { this.zotero.Prefs?.set?.(WIDTH_PREF, cssPixels, true); }
  measureAvailableWidth(): number {
    const pane = this.contextPane();
    const splitter = this.win.document?.getElementById?.('zotero-context-splitter');
    const readerWidth = this.reader._iframeWindow?.innerWidth ?? 0;
    const paneWidth = pane && !this.win.ZoteroContextPane?.collapsed ? pane.getBoundingClientRect().width : 0;
    const splitterWidth = splitter?.getBoundingClientRect().width ?? 0;
    const total = readerWidth + paneWidth + splitterWidth;
    return total > 0 ? total : (this.win.innerWidth || DEFAULT_SIDEBAR_WIDTH / 0.45);
  }
  currentWidth(): number {
    const pane = this.contextPane();
    if (!pane) return DEFAULT_SIDEBAR_WIDTH;
    const rect = pane.getBoundingClientRect().width;
    if (rect > 0) return rect;
    const styled = Number.parseFloat(pane.style.width);
    return Number.isFinite(styled) && styled > 0 ? styled : DEFAULT_SIDEBAR_WIDTH;
  }
  applyWidth(cssPixels: number): void {
    const pane = this.contextPane();
    if (!pane) return;
    this.applyingWidth = true;
    try {
      const rounded = Math.round(cssPixels);
      pane.style.width = `${rounded}px`;
      pane.setAttribute('width', String(rounded));
      const context = this.win.ZoteroContextPane as { width?: number } | undefined;
      if (context && typeof context.width === 'number') context.width = rounded;
      this.lastWidth = rounded;
      this.lastAvailable = this.measureAvailableWidth();
    } finally { this.applyingWidth = false; }
  }
  private contextPane(): HTMLElement | null {
    return this.win.document?.getElementById?.('zotero-context-pane') ?? null;
  }
  async mountChat(): Promise<boolean> {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!this.selected() || !this.controller.active) return false;
      const details = this.currentDetails();
      const section = details && Array.from(details.querySelectorAll<HTMLElement>('item-pane-custom-section')).find(node => node.dataset.pane === this.paneID);
      const body = section?.querySelector<HTMLElement>('[data-type="body"]');
      const identity = attachmentIdentity(this.zotero, this.reader);
      if (details && section && body && identity) {
        this.details = details;
        section.dataset.zcrSection = '';
        const collapsible = section.querySelector<HTMLElement & { open: boolean }>('collapsible-section');
        if (collapsible) collapsible.open = true;
        this.render(body);
        details.classList.add('zcr-chat-active');
        await details.scrollToPane(this.paneID, 'instant');
        if (!this.controller.active || !this.selected()) { this.unmountChat(); return false; }
        this.observeZoom();
        this.observeLayout();
        body.querySelector<HTMLElement>('button')?.focus();
        return true;
      }
      await new Promise<void>(resolve => { this.win.setTimeout(resolve, 25); });
    }
    return false;
  }
  render(body: HTMLElement): void {
    this.disposeView?.(); this.disposeView = undefined;
    const identity = attachmentIdentity(this.zotero, this.reader);
    if (!identity) { body.replaceChildren(); return; }
    this.disposeView = this.renderView(body, identity, () => { this.controller.close(); this.focusButton(); }, this.controller.active) || undefined;
  }
  unmountChat(): void {
    this.details?.classList.remove('zcr-chat-active');
    this.disposeView?.(); this.disposeView = undefined;
    this.details = undefined;
  }
  setActive(active: boolean): void { for (const button of this.buttons) updateToolbarButton(button, active && this.selected()); }
  private focusButton(): void { Array.from(this.buttons).find(button => button.isConnected)?.focus(); }
  setZoom(scale: Scale, anchor: Anchor): void {
    const generation = ++this.zoomGeneration;
    this.pendingFixedScale = typeof scale === 'number' ? scale : undefined;
    this.expectedPreset = typeof scale === 'string' ? scale : undefined;
    if (scale === 'page-width') this.reader.zoomPageWidth();
    else if (scale === 'page-fit') this.reader.zoomPageHeight();
    else if (scale === 'auto') this.reader.zoomAuto();
    // Native preset methods resize the canvas. Restore the PDF anchor after layout settles.
    this.win.requestAnimationFrame(() => {
      if (generation !== this.zoomGeneration) return;
      this.pendingFixedScale = undefined;
      const viewer = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
      if (!viewer) return;
      // Zotero ignores destination zoom; restore native scale before the anchor.
      if (typeof scale === 'number') viewer.currentScaleValue = scale / 100;
      // Reader.navigate routes through link history and installs a deferred
      // text-layer focus callback, which can jump back after a later zoom render.
      this.scrollTo(anchor);
    });
  }
  keepAnchor(anchor: Anchor): void {
    const generation = ++this.zoomGeneration;
    this.win.requestAnimationFrame(() => {
      if (generation !== this.zoomGeneration) return;
      this.scrollTo(anchor);
    });
  }
  private scrollTo(anchor: Anchor): void {
    const viewer = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.pdfViewer;
    if (!viewer) return;
    viewer.scrollPageIntoView({
      pageNumber: anchor.pageIndex + 1,
      destArray: [anchor.pageIndex, { name: 'XYZ' }, anchor.left, anchor.top, null],
      allowNegativeOffset: true,
      ignoreDestinationZoom: true,
    });
  }
  private observeZoom(): void {
    if (this.disconnectZoom) return;
    const bus = this.reader._internalReader?._lastView?._iframeWindow?.PDFViewerApplication?.eventBus;
    if (!bus) return;
    const handler = (event: { presetValue?: string }) => {
      if (!this.controller.active) return;
      // Repeated same-preset scale events are native viewport resizes, not a manual override.
      if (this.expectedPreset && event.presetValue === this.expectedPreset) return;
      ++this.zoomGeneration; this.expectedPreset = undefined; this.controller.manualZoom();
    };
    bus.on('scalechanging', handler); this.disconnectZoom = () => bus.off('scalechanging', handler);
  }
  private observeLayout(): void {
    if (this.disconnectLayout) return;
    const win = this.win;
    const pane = this.contextPane();
    const splitter = win.document?.getElementById?.('zotero-context-splitter');
    const schedule = () => {
      if (this.layoutTimer !== undefined) win.clearTimeout(this.layoutTimer);
      this.layoutTimer = win.setTimeout(() => { this.layoutTimer = undefined; this.onLayoutSettled(); }, 80);
    };
    win.addEventListener('resize', schedule);
    const Observer = win.ResizeObserver;
    const observer = pane && Observer ? new Observer(() => schedule()) : undefined;
    observer?.observe(pane!);
    splitter?.addEventListener('mouseup', schedule);
    splitter?.addEventListener('pointerup', schedule);
    this.lastAvailable = this.measureAvailableWidth();
    this.lastWidth = this.currentWidth();
    this.disconnectLayout = () => {
      win.removeEventListener('resize', schedule);
      observer?.disconnect();
      splitter?.removeEventListener('mouseup', schedule);
      splitter?.removeEventListener('pointerup', schedule);
      if (this.layoutTimer !== undefined) win.clearTimeout(this.layoutTimer);
      this.layoutTimer = undefined;
    };
  }
  private onLayoutSettled(): void {
    if (!this.controller.active || this.applyingWidth) return;
    const available = this.measureAvailableWidth();
    const width = this.currentWidth();
    const availableChanged = Math.abs(available - this.lastAvailable) > 1;
    const widthChanged = Math.abs(width - this.lastWidth) > 1;
    if (!availableChanged && !widthChanged) return;
    if (availableChanged) this.controller.viewportChanged();
    else void this.controller.setWidth(width);
    this.lastAvailable = this.measureAvailableWidth();
    this.lastWidth = this.currentWidth();
  }
  reconcile(): void {
    if (!this.controller.active) return;
    const context = this.win.ZoteroContextPane;
    // Switching to another reader is not a close. The dock belongs to the selected tab;
    // this reader keeps ownership so coming back remounts the same conversation.
    if (!this.selected()) { this.unmountChat(); return; }
    if (context?.collapsed || context?.context.mode !== 'item') this.controller.nativeAction();
    else if (!this.details?.isConnected || !this.details.classList.contains('zcr-chat-active')) {
      void this.mountChat().then(ready => { if (ready && this.controller.active && this.selected()) this.setActive(true); });
    }
  }
  dispose(): void {
    this.controller.dispose(); this.disposeView?.(); this.disposeView = undefined; this.alive = false;
    this.disconnectZoom?.(); this.disconnectZoom = undefined;
    this.disconnectLayout?.(); this.disconnectLayout = undefined;
    this.buttons.clear();
  }
}
