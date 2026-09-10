import { expect, it, vi } from 'vitest';
import { NativeReaderPane } from '../../packages/zotero/src/reader/reader-pane.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../packages/zotero/src/reader/host-types.ts';
it('keeps chat ownership across tab switches and only closes for a native pane action on the selected reader', async () => {
  const context = { collapsed: false, context: { mode: 'item' as 'item' | 'notes' } };
  const tabs = { selectedID: 'pdf-a' };
  const win = { ZoteroContextPane: context, Zotero_Tabs: tabs, requestAnimationFrame: () => 0 } as unknown as ZoteroWindow;
  const reader: HostReader = {
    itemID: 1, tabID: 'pdf-a', type: 'pdf', _window: win,
    zoomPageWidth() {}, zoomPageHeight() {}, zoomAuto() {}, navigate() {},
  };
  const pane = new NativeReaderPane({ Prefs: { get: () => 'standard' } } as unknown as ZoteroHost, reader, 'codex', new Set());
  const mount = vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const unmount = vi.spyOn(pane, 'unmountChat');
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: false, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  await pane.controller.toggle();
  expect(pane.controller.active).toBe(true);
  mount.mockClear(); unmount.mockClear();
  tabs.selectedID = 'pdf-b';
  pane.reconcile();
  expect(pane.controller.active).toBe(true);
  expect(unmount).toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
  tabs.selectedID = 'pdf-a';
  pane.reconcile();
  expect(pane.controller.active).toBe(true);
  expect(mount).toHaveBeenCalled();
  context.collapsed = true;
  pane.reconcile();
  expect(pane.controller.active).toBe(false);
});
it('restores fixed scale across rapid reopen when Zotero ignores destination zoom', async () => {
  const frames: FrameRequestCallback[] = [];
  const location = { pageNumber: 3, left: 12, top: 190, scale: 125 as string | number };
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const scales: number[] = [];
  const pdfViewer = { _location: location,
    set currentScaleValue(value: number) { scales.push(value); location.scale = value * 100; },
    scrollPageIntoView: ({ pageNumber }: { pageNumber: number }) => { location.pageNumber = pageNumber; },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => { location.scale = 'page-fit'; }, zoomAuto: () => { location.scale = 'auto'; },
    // Zotero sets ignoreDestinationZoom=true, so navigation cannot change scale.
    navigate: ({ dest }) => { location.pageNumber = dest![0] + 1; },
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, 'codex', new Set());
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const flushFrames = () => { for (const callback of frames.splice(0)) callback(0); };
  await pane.controller.toggle(); flushFrames();
  expect(location.scale).toBe('page-width');
  pane.controller.close();
  await pane.controller.toggle();
  flushFrames();
  expect(location.scale).toBe('page-width');
  pane.controller.close(); flushFrames();
  expect(location.scale).toBe(125);
  expect(scales).toEqual([1.25]);
});
it('restores the current page without delayed link-navigation focus from the opening page', async () => {
  const frames: FrameRequestCallback[] = [];
  const location = { pageNumber: 1, left: -11, top: 600, scale: 210 as string | number };
  const textLayerFocus: (() => void)[] = [];
  const operations: string[] = [];
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const viewer = { _location: location,
    set currentScaleValue(value: number) {
      operations.push('scale'); location.scale = value * 100;
      // A scale change renders old pages again. Link-service destinations left
      // textlayerrendered callbacks that can focus and scroll the opening page.
      for (const focus of textLayerFocus.splice(0)) frames.push(() => focus());
    },
    scrollPageIntoView: ({ pageNumber, destArray, allowNegativeOffset }: { pageNumber: number; destArray: [number, { name: string }, number, number, null]; allowNegativeOffset: boolean }) => {
      operations.push('anchor'); location.pageNumber = pageNumber;
      location.left = allowNegativeOffset ? destArray[2] : Math.max(0, destArray[2]); location.top = destArray[3];
    },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer: viewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => {}, zoomAuto: () => {},
    navigate: ({ dest }) => { location.pageNumber = dest![0] + 1; textLayerFocus.push(() => { location.pageNumber = dest![0] + 1; }); },
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, 'codex', new Set());
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0, width: 280 });
  vi.spyOn(pane, 'restoreDock').mockImplementation(() => {});
  vi.spyOn(pane, 'mountChat').mockResolvedValue(true);
  const flushFrames = () => { for (const callback of frames.splice(0)) callback(0); };
  await pane.controller.toggle(); flushFrames();
  location.pageNumber = 2; location.top = 651;
  operations.length = 0;
  pane.controller.close(); flushFrames(); flushFrames();
  expect(location).toEqual({ pageNumber: 2, left: -11, top: 651, scale: 210 });
  expect(operations).toEqual(['scale', 'anchor']);
  expect(textLayerFocus).toHaveLength(0);
});
