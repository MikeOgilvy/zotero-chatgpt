/** Narrow Zotero 9 host surface, isolated from the layout state machine. */
export interface PdfEventBus {
  on(name: string, callback: (event: { presetValue?: string }) => void): void;
  off(name: string, callback: (event: { presetValue?: string }) => void): void;
}
export interface HostReader {
  itemID: number;
  tabID?: string;
  type: string;
  _window: ZoteroWindow;
  _iframeWindow?: Window;
  _internalReader?: { _lastView?: { _iframeWindow?: { PDFViewerApplication?: {
    pdfViewer: { currentScaleValue: number | string; _location?: { pageNumber: number; left: number; top: number; scale: string | number } };
    eventBus?: PdfEventBus;
  } } } };
  zoomPageWidth(): void;
  zoomPageHeight(): void;
  zoomAuto(): void;
  navigate(location: { dest: [number, { name: string }, number, number, number | null] }): void;
}
export interface ItemDetails extends HTMLElement { scrollToPane(id: string, behavior: string): Promise<void> }
export interface ZoteroWindow extends Window {
  MutationObserver: typeof MutationObserver;
  Zotero_Tabs?: { selectedID: string };
  ZoteroContextPane?: { collapsed: boolean; context: HTMLElement & { mode: 'item' | 'notes' } };
}
export interface ToolbarEvent { reader: HostReader; doc: Document; append(...elements: HTMLElement[]): void }
export interface SectionEvent { doc: Document; body: HTMLElement; tabType: string; setEnabled(this: void, enabled: boolean): void }
export interface ZoteroHost {
  getMainWindows(): ZoteroWindow[];
  logError(error: unknown): void;
  Prefs: { get(key: string): unknown };
  Items: { get(id: number): { key: string; libraryID: number; getField(name: string): string } | undefined };
  Reader: {
    _readers: HostReader[];
    getByTabID(id: string): HostReader | undefined;
    registerEventListener(name: string, listener: (event: ToolbarEvent) => void, pluginID: string): void;
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
