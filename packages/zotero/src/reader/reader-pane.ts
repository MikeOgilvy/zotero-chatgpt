import { renderPreview, type AttachmentIdentity } from '../chat/view.ts';
import { ReaderLayoutController, type Anchor, type DockState, type LayoutHost, type Scale, type ViewPosition } from './layout.ts';
import type { HostReader, ItemDetails, ZoteroHost, ZoteroWindow } from './host-types.ts';
import { updateToolbarButton } from './toolbar.ts';

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
  private alive = true;
  private expectedPreset: string | undefined;
  private zoomGeneration = 0;
  private pendingFixedScale: number | undefined;
  private disconnectZoom: (() => void) | undefined;
  constructor(private zotero: ZoteroHost, readonly reader: HostReader, private paneID: string, private buttons: Set<HTMLButtonElement>) {}
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
    return { collapsed: context.collapsed, mode: context.context.mode, scrollTop: this.currentDetails()?.querySelector('#zotero-view-item')?.scrollTop ?? 0 };
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
    const context = this.win.ZoteroContextPane!;
    context.context.mode = state.mode; context.collapsed = state.collapsed;
    const scroll = this.currentDetails()?.querySelector('#zotero-view-item');
    if (scroll) scroll.scrollTop = state.scrollTop;
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
        renderPreview(body, identity, () => { this.controller.close(); this.focusButton(); });
        details.classList.add('zcr-chat-active');
        await details.scrollToPane(this.paneID, 'instant');
        if (!this.controller.active || !this.selected()) { this.unmountChat(); return false; }
        this.observeZoom();
        body.querySelector<HTMLElement>('button')?.focus();
        return true;
      }
      await new Promise<void>(resolve => { this.win.setTimeout(resolve, 25); });
    }
    return false;
  }
  unmountChat(): void { this.details?.classList.remove('zcr-chat-active'); }
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
      this.reader.navigate({ dest: [anchor.pageIndex, { name: 'XYZ' }, anchor.left, anchor.top, typeof scale === 'number' ? scale / 100 : null] });
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
  reconcile(): void {
    if (!this.controller.active) return;
    const context = this.win.ZoteroContextPane;
    if (!this.selected() || context?.collapsed || context?.context.mode !== 'item') this.controller.nativeAction();
  }
  dispose(): void { this.controller.dispose(); this.alive = false; this.disconnectZoom?.(); this.disconnectZoom = undefined; this.buttons.clear(); }
}
