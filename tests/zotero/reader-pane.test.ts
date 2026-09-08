import { expect, it, vi } from 'vitest';
import { NativeReaderPane } from '../../packages/zotero/src/reader/reader-pane.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../packages/zotero/src/reader/host-types.ts';
it('restores fixed scale across rapid reopen when Zotero ignores destination zoom', async () => {
  const frames: FrameRequestCallback[] = [];
  const location = { pageNumber: 3, left: 12, top: 190, scale: 125 as string | number };
  const win = { ZoteroContextPane: { collapsed: true, context: { mode: 'item' } }, requestAnimationFrame: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; } } as ZoteroWindow;
  const scales: number[] = [];
  const pdfViewer = { _location: location,
    set currentScaleValue(value: number) { scales.push(value); location.scale = value * 100; },
  };
  const reader: HostReader = {
    itemID: 42, tabID: 'pdf-tab', type: 'pdf', _window: win,
    _internalReader: { _lastView: { _iframeWindow: { PDFViewerApplication: { pdfViewer } } } },
    zoomPageWidth: () => { location.scale = 'page-width'; }, zoomPageHeight: () => { location.scale = 'page-fit'; }, zoomAuto: () => { location.scale = 'auto'; },
    // Zotero sets ignoreDestinationZoom=true, so navigation cannot change scale.
    navigate: ({ dest }) => { location.pageNumber = dest[0] + 1; },
  };
  const pane = new NativeReaderPane({} as ZoteroHost, reader, 'codex', new Set());
  vi.spyOn(pane, 'captureDock').mockReturnValue({ collapsed: true, mode: 'item', scrollTop: 0 });
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
