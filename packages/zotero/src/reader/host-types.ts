/** Narrow Zotero 9 host surface, isolated from the layout state machine. Source-checked against 9.0.6. */
export interface PdfEventBus {
  on(name: string, callback: (event: { presetValue?: string }) => void): void;
  off(name: string, callback: (event: { presetValue?: string }) => void): void;
}
export interface PdfPageView { div: HTMLElement; viewport: { convertToViewportPoint(x: number, y: number): [number, number] } }
export interface PdfViewer {
  currentScaleValue: number | string;
  scrollPageIntoView(options: { pageNumber: number; destArray: [number, { name: string }, number, number, null]; allowNegativeOffset: boolean; ignoreDestinationZoom: boolean }): void;
  _location?: { pageNumber: number; left: number; top: number; scale: string | number };
  _pages?: PdfPageView[];
}
export interface PdfView {
  _iframeWindow?: { PDFViewerApplication?: { pdfViewer: PdfViewer; eventBus?: PdfEventBus } };
  _iframe?: HTMLIFrameElement;
  initializedPromise?: Promise<void>;
}
export interface ReaderLocation { position?: { pageIndex: number; rects: number[][] }; pageIndex?: number; dest?: [number, { name: string }, number, number, number | null] }
export interface HostReader {
  itemID: number;
  tabID?: string;
  type: string;
  _window: ZoteroWindow;
  _iframeWindow?: Window;
  _internalReader?: { _lastView?: PdfView; _primaryView?: PdfView };
  zoomPageWidth(): void;
  zoomPageHeight(): void;
  zoomAuto(): void;
  navigate(location: ReaderLocation): void | Promise<void>;
}
export interface ItemDetails extends HTMLElement { scrollToPane(id: string, behavior: string): Promise<void> }
export interface ZoteroWindow extends Window {
  MutationObserver: typeof MutationObserver;
  ResizeObserver: typeof ResizeObserver;
  Zotero_Tabs?: { selectedID: string };
  ZoteroContextPane?: { collapsed: boolean; context: HTMLElement & { mode: 'item' | 'notes' } };
}
export interface HostItem { id?: number; key: string; libraryID: number; parentItemID?: number; getField(name: string): string; getCreators?(): Array<{ firstName?: string; lastName?: string; name?: string }> }
export interface ToolbarEvent { reader: HostReader; doc: Document; append(...elements: HTMLElement[]): void }
export interface SectionEvent { doc: Document; body: HTMLElement; tabType: string; setEnabled(this: void, enabled: boolean): void }
export interface ZoteroHost {
  getMainWindows(): ZoteroWindow[];
  logError(error: unknown): void;
  launchURL(url: string): void;
  Prefs: { get(key: string, global?: boolean): unknown; set(key: string, value: string | number | boolean, global?: boolean): void };
  Items: { get(id: number): HostItem | undefined; getByLibraryAndKey?(libraryID: number, key: string): HostItem | false | undefined };
  Reader: {
    _readers: HostReader[];
    getByTabID(id: string): HostReader | undefined;
    open?(itemID: number, location?: ReaderLocation): Promise<HostReader | false>;
    registerEventListener(name: string, listener: (event: never) => void, pluginID: string): void;
  };
  ItemPaneManager: {
    registerSection(options: {
      paneID: string; pluginID: string;
      header: { l10nID: string; icon: string }; sidenav: { l10nID: string; icon: string };
      onItemChange(event: SectionEvent): void; onRender(event: SectionEvent): void;
    }): string;
    unregisterSection(id: string): void;
  };
  Notifier: { registerObserver(observer: { notify(): void }, types: string[], id: string): string; unregisterObserver(id: string): void };
}
