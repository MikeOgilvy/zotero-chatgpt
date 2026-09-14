import { expect, it, vi } from 'vitest';
import { Window as HappyWindow } from 'happy-dom';
import { createLibraryReferencePort, type LibraryDocumentSource, type LibraryFilePicker, type LibraryItem, type LibraryReader, type LibraryReferenceOptions, type NativeLibraryHost } from '../../packages/zotero/src/reader/library.ts';
import { ReaderDocumentCache, type DocumentSource } from '../../packages/zotero/src/reader/document.ts';
import { paperA, citationA, citationB, TINY_PNG_DATA_URL } from '../contracts/factories.ts';
import { forgetSelection, rememberSelection } from '../../packages/zotero/src/reader/current-selection.ts';
import type { ReaderReference } from '../../packages/contracts/src/workspace.ts';

const uuid = '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e';
const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
const reference: ReaderReference = { id: 'article-one', kind: 'article', label: 'Paper · Main PDF', paper: paperA, identity: { title: 'Paper', authors: ['Ada'], year: '2026' }, capturedAt: '2026-09-12T00:00:00Z' };

function setup(options: Partial<LibraryReferenceOptions> = {}, nativeRaster = false) {
  const metadataReads: string[] = [];
  const item = (id: number, key: string, title: string, pdf: boolean, parentID?: number): LibraryItem => ({ id, key, libraryID: paperA.libraryId, ...(parentID ? { parentID } : {}), getField: field => field === 'title' ? title : field === 'date' ? '2026-01-01' : '', getCreators: () => pdf ? [] : [{ firstName: 'Ada', lastName: 'Lovelace' }], isRegularItem: () => !pdf, isPDFAttachment: () => pdf, getAttachments: () => pdf ? [] : [2, 3], loadDataType: type => { metadataReads.push(type); return Promise.resolve(); }, getFilePathAsync: vi.fn().mockResolvedValue('/synthetic/paper.pdf') });
  const items = [item(1, 'PARENT01', 'Same paper', false), item(2, paperA.attachmentKey, 'Main PDF', true, 1), item(3, 'PDFSUPP2', 'Supplement', true, 1)];
  const tabs = new Map<string, { id: string; data: { itemID: number } }>();
  const nativeTabs = { selectedID: 'user-tab', getTabInfo: (id: string) => tabs.get(id) ?? {}, add: (options: { id: string; type: string; title: string; data: { itemID: number }; select: false }) => { tabs.set(options.id, { id: options.id, data: options.data }); return { id: options.id }; }, close: (id: string) => { tabs.delete(id); } };
  const win = { Zotero_Tabs: nativeTabs } as unknown as Window & { Zotero_Tabs: typeof nativeTabs };
  let onSelection: (id: string) => void = () => undefined;
  const unwatch = vi.fn();
  const closes = vi.fn();
  const conditions: Array<[string, string, string | undefined]> = [];
  const pdf: DocumentSource = { revision: { fingerprint: 'synthetic-v1', size: 1024, modifiedAt: 1000 }, pdf: { numPages: 2, fingerprints: ['synthetic-v1'], getPageLabels2: () => Promise.resolve(['i', 'ii']), getPageData: vi.fn(({ pageIndex }) => Promise.resolve({ chars: [{ c: `Page ${pageIndex + 1} evidence` }] })) } };
  const source: LibraryDocumentSource = { capture: vi.fn().mockResolvedValue(pdf), validate: vi.fn().mockResolvedValue(undefined) };
  const picker: LibraryFilePicker = { modeOpen: 0, modeOpenMultiple: 3, modeSave: 1, returnOK: 0, returnReplace: 2, defaultString: '', file: '/synthetic/SKILL.md', files: ['/synthetic/image.png'], init: vi.fn(), appendFilter: vi.fn(), show: vi.fn().mockResolvedValue(0) };
  const io = { stat: vi.fn().mockResolvedValue({ size: png.length }), read: vi.fn().mockResolvedValue(png), write: vi.fn().mockResolvedValue(undefined) };
  const host: NativeLibraryHost = {
    Items: { get: id => items.find(item => item.id === id), getAsync: id => Promise.resolve(items.find(item => item.id === id)), getByLibraryAndKey: (library, key) => items.find(item => item.libraryID === library && item.key === key) },
    Search: class { addCondition(condition: string, operator: string, value?: string) { conditions.push([condition, operator, value]); } search() { return Promise.resolve([1]); } },
    Reader: { _readers: [], open: vi.fn<NativeLibraryHost['Reader']['open']>((itemID, _location, options) => {
      if (options?.tabID && !tabs.has(options.tabID)) return Promise.reject(new TypeError('A supplied tabID requires an existing native container'));
      const tabID = options?.tabID ?? 'host-selected-existing';
      const reader: LibraryReader = { itemID, tabID, _window: win, _initPromise: Promise.resolve(), close: () => { closes(tabID); tabs.delete(tabID); host.Reader._readers = host.Reader._readers.filter(item => item !== reader); } };
      tabs.set(tabID, { id: tabID, data: { itemID } }); host.Reader._readers.push(reader); return Promise.resolve(reader);
    }) }, getMainWindow: () => win,
  };
  const port = createLibraryReferencePort(host, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z', source: () => source, getWindow: () => win, watchTabSelection: selected => { onSelection = selected; return unwatch; }, createFilePicker: () => picker, io, decodeImage: () => Promise.resolve({ width: 1, height: 1 }), ...(!nativeRaster ? { rasterize: vi.fn().mockResolvedValue(png) } : {}), ...options });
  return { port, host, items, pdf, source, conditions, metadataReads, tabs, nativeTabs, closes, unwatch, picker, io, select: (id: string) => { nativeTabs.selectedID = id; onSelection(id); } };
}

it('performs metadata-only explicit article search and disambiguates PDF attachments', async () => {
  const f = setup(); expect(f.conditions).toEqual([]);
  expect(await f.port.search('  ')).toEqual([]); expect(f.conditions).toEqual([]);
  const result = await f.port.search('Same paper');
  expect(result).toHaveLength(2); expect(result[0]?.identity?.authors).toEqual(['Ada Lovelace']);
  expect(result.map(item => item.label)).toEqual(['Same paper · Main PDF', 'Same paper · Supplement']);
  expect(result.map(item => item.paper?.attachmentKey)).toEqual([paperA.attachmentKey, 'PDFSUPP2']);
  expect(f.conditions).toContainEqual(['quicksearch-titleCreatorYear', 'contains', 'Same paper']);
  expect(f.conditions.some(([name]) => /note|annotation|fulltext/iu.test(name))).toBe(false);
  expect(f.source.capture).not.toHaveBeenCalled();
  for (const item of f.items) expect(item.getFilePathAsync).not.toHaveBeenCalled();
});

it('searches every readable library and disambiguates same-title articles by author and year', async () => {
  const searches: Array<{ libraryID?: number; conditions: Array<[string, string, string | undefined]> }> = [];
  const item = (id: number, key: string, libraryID: number, title: string, pdf: boolean, author: string, year: string, parentID?: number): LibraryItem => ({ id, key, libraryID, ...(parentID ? { parentID } : {}), getField: field => field === 'title' ? title : field === 'date' ? `${year}-01-01` : '', getCreators: () => pdf ? [] : [{ firstName: author.split(' ')[0]!, lastName: author.split(' ').slice(1).join(' ') }], isRegularItem: () => !pdf, isPDFAttachment: () => pdf, getAttachments: () => pdf ? [] : [id + 1], loadDataType: () => Promise.resolve() });
  const items = [
    item(10, 'USERITEM', 1, 'Shared Methods', false, 'Ada Lovelace', '2020'), item(11, 'USERPDF1', 1, 'Shared Methods', true, '', '', 10),
    item(20, 'GROUPITE', 2, 'Shared Methods', false, 'Alan Turing', '2024'), item(21, 'GRPPDF01', 2, 'Shared Methods', true, '', '', 20),
    item(30, 'LOCKEDIT', 3, 'Shared Methods', false, 'Grace Hopper', '1952'), item(31, 'LOCKPDF1', 3, 'Shared Methods', true, '', '', 30),
  ];
  const host: NativeLibraryHost = {
    Items: { get: id => items.find(entry => entry.id === id), getAsync: id => Promise.resolve(items.find(entry => entry.id === id)), getByLibraryAndKey: (library, key) => items.find(entry => entry.libraryID === library && entry.key === key) },
    Search: class {
      libraryID = 1; conditions: Array<[string, string, string | undefined]> = [];
      addCondition(condition: string, operator: string, value?: string) { this.conditions.push([condition, operator, value]); }
      search() {
        searches.push({ libraryID: this.libraryID, conditions: this.conditions });
        return Promise.resolve(this.libraryID === 1 ? [10] : this.libraryID === 2 ? [20] : [30]);
      }
    },
    Libraries: { getAll: () => [
      { libraryID: 1, name: 'Personal', editable: true, libraryType: 'user' },
      { libraryID: 2, name: 'Lab Group', editable: false, libraryType: 'group' },
      { libraryID: 3, name: 'Locked Group', editable: false, libraryType: 'group' },
      { libraryID: 9, name: 'Feeds', editable: false, libraryType: 'feed' },
    ] },
    Reader: { _readers: [], open: vi.fn() },
  };
  const port = createLibraryReferencePort(host, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  const results = await port.search('Shared Methods');
  expect(searches.map(entry => entry.libraryID)).toEqual([1, 2, 3]);
  expect(searches.every(entry => entry.conditions.some(([name]) => name === 'quicksearch-titleCreatorYear'))).toBe(true);
  expect(results.map(reference => reference.paper?.libraryId)).toEqual([1, 2, 3]);
  expect(results.map(reference => reference.label)).toEqual([
    'Shared Methods · Ada Lovelace · 2020',
    'Shared Methods · Alan Turing · 2024',
    'Shared Methods · Grace Hopper · 1952',
  ]);
  expect(results.map(reference => reference.identity?.authors[0])).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper']);
  // A single unreachable library is skipped; the reachable libraries still answer.
  const flaky = { ...host, Search: class { libraryID = 1; addCondition() { /* noop */ } search() { if (this.libraryID === 3) return Promise.reject(new Error('This library is unavailable.')); return Promise.resolve(this.libraryID === 1 ? [10] : [20]); } } } as NativeLibraryHost;
  const tolerant = createLibraryReferencePort(flaky, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  expect((await tolerant.search('Shared Methods')).map(reference => reference.paper?.libraryId)).toEqual([1, 2]);
  // Every library failing is still a real failure, never a silent empty list.
  const broken = { ...host, Search: class { libraryID = 1; addCondition() { /* noop */ } search() { return Promise.reject(new Error('offline')); } } } as NativeLibraryHost;
  const failing = createLibraryReferencePort(broken, { clientId: paperA.clientId, documentCache: new ReaderDocumentCache({ yield: async () => {} }), uuid: () => uuid, now: () => '2026-09-12T00:00:00Z' });
  await expect(failing.search('Shared Methods')).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'Article metadata could not be searched.' });
});

it('uses an isolated background tab even when an unloaded tab already exists, then closes only its own', async () => {
  const f = setup(); f.tabs.set('unloaded-user-tab', { id: 'unloaded-user-tab', data: { itemID: 2 } });
  const result = await f.port.read(reference, new AbortController().signal);
  expect(f.host.Reader.open).toHaveBeenCalledWith(2, undefined, expect.objectContaining({ openInBackground: true, allowDuplicate: true, tabID: `zcr-reference-${uuid}` }));
  expect(result.document?.paper).toEqual(paperA); expect(result.document?.revision).toEqual(f.pdf.revision);
  expect(result.document?.pages).toHaveLength(2); expect(f.source.validate).toHaveBeenCalled();
  expect(f.closes).toHaveBeenCalledWith(`zcr-reference-${uuid}`); expect(f.tabs.has('unloaded-user-tab')).toBe(true);
  expect(f.nativeTabs.selectedID).toBe('user-tab'); expect(f.unwatch).toHaveBeenCalledTimes(1);
});
it('creates the reserved native tab container before passing its id to Reader.open', async () => {
  const f = setup(); const result = await f.port.read(reference, new AbortController().signal);
  expect(result.document?.pages).toHaveLength(2); expect(f.tabs.has(`zcr-reference-${uuid}`)).toBe(false); expect(f.nativeTabs.selectedID).toBe('user-tab');
});

it('reuses a loaded reader without selecting or closing it', async () => {
  const f = setup(); const close = vi.fn();
  f.host.Reader._readers.push({ itemID: 2, tabID: 'existing', close });
  await f.port.read(reference, new AbortController().signal);
  expect(f.host.Reader.open).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});

it('retains a background reader once the user selects it, even after selecting another tab', async () => {
  const f = setup();
  vi.mocked(f.source.validate).mockImplementation(() => { f.select(`zcr-reference-${uuid}`); f.select('other-user-tab'); return Promise.resolve(); });
  await f.port.read(reference, new AbortController().signal);
  expect(f.closes).not.toHaveBeenCalled(); expect(f.nativeTabs.selectedID).toBe('other-user-tab');
});

it('freezes caller scope and range before asynchronous preparation and checks the source version', async () => {
  const f = setup(); const requested = structuredClone(reference); requested.range = [2, 2];
  const pending = f.port.read(requested, new AbortController().signal);
  requested.paper!.attachmentKey = 'PDFSUPP2'; requested.range[0] = 1;
  const result = await pending;
  expect(result.paper).toEqual(paperA); expect(result.document?.pages.map(page => page.pageIndex)).toEqual([1]);
  vi.mocked(f.source.validate).mockRejectedValueOnce(new Error('private filepath'));
  await expect(f.port.read(reference, new AbortController().signal)).rejects.toThrow(/source|PDF|read/iu);
});

it('rejects a foreign profile and never closes an unexpected host-owned tab', async () => {
  const f = setup();
  await expect(f.port.read({ ...reference, paper: { ...paperA, clientId: 'other-client' } }, new AbortController().signal)).rejects.toThrow(/environment|profile/iu);
  expect(f.host.Reader.open).not.toHaveBeenCalled();
  const close = vi.fn(); vi.mocked(f.host.Reader.open).mockResolvedValueOnce({ itemID: 2, tabID: 'existing-user-tab', close });
  await expect(f.port.read(reference, new AbortController().signal)).rejects.toThrow(/background|isolated/iu);
  expect(close).not.toHaveBeenCalled();
});

it('cancels pending source work and closes only the untouched background tab', async () => {
  const f = setup(); vi.mocked(f.source.capture).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController(); const pending = f.port.read(reference, controller.signal);
  await vi.waitFor(() => expect(f.source.capture).toHaveBeenCalled()); controller.abort();
  await expect(pending).rejects.toThrow(/cancel/iu); expect(f.closes).toHaveBeenCalledTimes(1);
});

it('validates picked image bytes and rejects oversized input before reading it', async () => {
  const f = setup(); const result = await f.port.pickImages!();
  expect(result[0]?.mime).toBe('image/png'); expect(result[0]?.name).toBe('image.png');
  expect(f.io.read).toHaveBeenCalledWith('/synthetic/image.png', { maxBytes: 2 * 1024 * 1024 + 1 });
  f.io.read.mockClear(); f.io.stat.mockResolvedValueOnce({ size: 3 * 1024 * 1024 });
  await expect(f.port.pickImages!()).rejects.toThrow(/large|limit/iu); expect(f.io.read).not.toHaveBeenCalled();
  f.io.read.mockResolvedValueOnce(new TextEncoder().encode('%PDF-not-an-image'));
  await expect(f.port.pickImages!()).rejects.toThrow(/image/iu);
});

it('imports bounded UTF8 Markdown and exports only through accepted native save selections', async () => {
  const f = setup(); f.io.read.mockResolvedValueOnce(new TextEncoder().encode('# Workflow\n')); f.io.stat.mockResolvedValueOnce({ size: 11 });
  expect(await f.port.pickSkill!()).toBe('# Workflow\n');
  f.io.read.mockResolvedValueOnce(new Uint8Array([0xc0, 0x80]));
  await expect(f.port.pickSkill!()).rejects.toThrow(/UTF|text/iu);
  vi.mocked(f.picker.show).mockResolvedValueOnce(1);
  await f.port.exportText!('SKILL.md', 'text'); expect(f.io.write).not.toHaveBeenCalled();
  vi.mocked(f.picker.show).mockResolvedValueOnce(f.picker.returnReplace);
  await f.port.exportText!('SKILL.md', 'text'); expect(f.io.write).toHaveBeenCalledWith('/synthetic/SKILL.md', new TextEncoder().encode('text'));
});

it('captures frozen PDF coordinates and whole pages with real paper provenance, then exports image bytes', async () => {
  const rasterize = vi.fn<NonNullable<LibraryReferenceOptions['rasterize']>>().mockResolvedValue(png);
  const f = setup({ rasterize });
  const citation = { ...citationA, positions: [{ ...citationA.positions[0]!, pageIndex: 0 }] };
  const image = await f.port.captureRegion!(paperA, citation);
  expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({ paper: paperA, pageIndex: 0, rect: citation.positions[0]!.rects[0], scale: 2 }));
  expect(image?.origin).toEqual({ kind: 'paper', paper: paperA, pageIndex: 0, revision: f.pdf.revision });
  const page = await f.port.capturePage(paperA, 1); expect(page.origin).toEqual({ kind: 'paper', paper: paperA, pageIndex: 1, revision: f.pdf.revision });
  await f.port.exportImage(page); expect(f.io.write).toHaveBeenCalledWith('/synthetic/SKILL.md', png);
  // No citation and nothing selected: the owner is told what to do instead of getting an empty image.
  forgetSelection(paperA);
  await expect(f.port.captureRegion!(paperA)).rejects.toThrow(/select|region/iu);
});

it('captures the region the owner last selected without requiring a citation in the draft', async () => {
  const rasterize = vi.fn<NonNullable<LibraryReferenceOptions['rasterize']>>().mockResolvedValue(png);
  const f = setup({ rasterize });
  forgetSelection(paperA);
  // The popup records what was selected; the composer button then captures it. Two per-line rects are
  // unioned, so a wrapped selection is captured whole rather than as one line.
  rememberSelection(paperA, { pageIndex: 0, rects: [[10, 20, 50, 40], [10, 44, 90, 64]] });
  const image = await f.port.captureRegion!(paperA);
  expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({ paper: paperA, pageIndex: 0, rect: [10, 20, 90, 64] }));
  expect(image?.origin).toEqual({ kind: 'paper', paper: paperA, pageIndex: 0, revision: f.pdf.revision });
  // A region recorded for another PDF is never used for this one.
  forgetSelection(paperA);
  await expect(f.port.captureRegion!(paperA)).rejects.toThrow(/select|region/iu);
});

it('refuses to rasterize a citation that belongs to a different PDF than the open paper', async () => {
  const rasterize = vi.fn<NonNullable<LibraryReferenceOptions['rasterize']>>().mockResolvedValue(png);
  const f = setup({ rasterize });
  await expect(f.port.captureRegion!(paperA, citationB)).rejects.toThrow(/another PDF/iu);
  expect(rasterize).not.toHaveBeenCalled();
});

it('handles native tab lookup throwing for a not-yet-created tab', async () => {
  const f = setup();
  f.nativeTabs.getTabInfo = id => { const tab = f.tabs.get(id); if (!tab) throw new Error('No such tab'); return tab; };
  await expect(f.port.read(reference, new AbortController().signal)).resolves.toHaveProperty('document');
  expect(f.closes).toHaveBeenCalledTimes(1);
});

it('cleans up an untouched background tab when cancellation beats native Reader.open', async () => {
  const f = setup(); const original = vi.mocked(f.host.Reader.open).getMockImplementation()!;
  let release!: () => void;
  vi.mocked(f.host.Reader.open).mockImplementation((...args) => new Promise(resolve => { release = () => { void original(...args).then(resolve); }; }));
  const controller = new AbortController(); const pending = f.port.read(reference, controller.signal);
  const rejected = expect(pending).rejects.toThrow(/cancel/iu);
  await vi.waitFor(() => expect(f.host.Reader.open).toHaveBeenCalled()); controller.abort(); await rejected;
  expect(f.unwatch).not.toHaveBeenCalled(); release();
  await vi.waitFor(() => expect(f.closes).toHaveBeenCalledTimes(1));
  expect(f.unwatch).toHaveBeenCalledTimes(1);
});

it('keeps a shared background reader alive until all concurrent reads finish', async () => {
  const f = setup(); let firstDone!: () => void; let secondDone!: () => void;
  vi.mocked(f.source.validate).mockImplementationOnce(() => new Promise(resolve => { firstDone = resolve; })).mockImplementationOnce(() => new Promise(resolve => { secondDone = resolve; }));
  const first = f.port.read(reference, new AbortController().signal);
  await vi.waitFor(() => expect(f.source.validate).toHaveBeenCalledTimes(1));
  const second = f.port.read(reference, new AbortController().signal);
  await vi.waitFor(() => expect(f.source.validate).toHaveBeenCalledTimes(2));
  firstDone(); await first; expect(f.closes).not.toHaveBeenCalled();
  secondDone(); await second; expect(f.closes).toHaveBeenCalledTimes(1);
});

it('uses native PDF coordinates at fixed resolution without changing reader zoom or creating annotations', async () => {
  const f = setup({ cloneInto: value => value }, true);
  const document = new HappyWindow().document as unknown as Document;
  const canvas = document.createElement('canvas');
  const dimensions: number[][] = [];
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toDataURL').mockReturnValue(TINY_PNG_DATA_URL);
  vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
  const getViewport = vi.fn((options: { scale: number; offsetX?: number; offsetY?: number }) => ({ width: 300 * options.scale, height: 400 * options.scale, convertToViewportRectangle: (rect: number[]) => rect.map(value => value * options.scale) }));
  const render = vi.fn(() => { dimensions.push([canvas.width, canvas.height]); return { promise: Promise.resolve() }; });
  const page = { view: [0, 0, 300, 400], getViewport, render };
  const pdf = { ...f.pdf.pdf, getPage: vi.fn(() => Promise.resolve(page)) };
  const pdfViewer = { currentScale: 1.5, currentScaleValue: 'page-width', scrollPageIntoView: vi.fn() };
  const nativeWindow = { document, PDFViewerApplication: { pdfDocument: pdf, pdfViewer } };
  f.host.Reader._readers.push({ itemID: 2, _internalReader: { _primaryView: { _iframeWindow: nativeWindow } } });
  const citation = { ...citationA, positions: [{ pageIndex: 0, rects: [[10, 20, 50, 40] as [number, number, number, number]] }] };
  const result = await f.port.captureRegion!(paperA, citation);
  expect(result?.mime).toBe('image/png'); expect(dimensions).toEqual([[80, 40]]);
  expect(getViewport).toHaveBeenLastCalledWith({ scale: 2, offsetX: -20, offsetY: -40 });
  expect(pdfViewer.currentScale).toBe(1.5); expect(pdfViewer.currentScaleValue).toBe('page-width');
  expect(pdfViewer.scrollPageIntoView).not.toHaveBeenCalled(); expect(canvas.width).toBe(0);
  page.view = [0, 0, 10000, 10000];
  await expect(f.port.capturePage(paperA, 0)).rejects.toThrow(/not downsampled/iu);
  expect(render).toHaveBeenCalledTimes(1);
});
it('unwraps the host page proxy before using its hidden PDF rendering methods', async () => {
  const wrappedPage = {};
  const document = new HappyWindow().document as unknown as Document; const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D); vi.spyOn(canvas, 'toDataURL').mockReturnValue(TINY_PNG_DATA_URL); vi.spyOn(document, 'createElement').mockImplementation(() => canvas);
  const page = { view: [0, 0, 300, 400], getViewport: (options: { scale: number }) => ({ width: 300 * options.scale, height: 400 * options.scale, convertToViewportRectangle: (rect: number[]) => rect.map(value => value * options.scale) }), render: vi.fn(() => ({ promise: Promise.resolve() })) };
  const f = setup({ cloneInto: value => value, waiveXrays: value => value === wrappedPage ? page : value }, true);
  const nativeWindow = { document, PDFViewerApplication: { pdfDocument: { ...f.pdf.pdf, getPage: () => Promise.resolve(wrappedPage) }, pdfViewer: { currentScale: 1, currentScaleValue: 'page-width', scrollPageIntoView: () => {} } } };
  f.host.Reader._readers.push({ itemID: 2, _internalReader: { _primaryView: { _iframeWindow: nativeWindow } } });
  expect((await f.port.capturePage(paperA, 0)).mime).toBe('image/png'); expect(page.render).toHaveBeenCalledTimes(1);
});

it('fails explicitly when native raster capability is absent or the PDF version changes during capture', async () => {
  const unsupported = setup({}, true);
  await expect(unsupported.port.capturePage(paperA, 0)).rejects.toThrow(/render/iu);
  const f = setup({ rasterize: () => { f.pdf.revision.modifiedAt++; return Promise.resolve(png); } });
  await expect(f.port.capturePage(paperA, 0)).rejects.toThrow(/changed/iu);
});

it('lists only editable native collections and keeps profile, library, and collection keys intact', async () => {
  const f = setup(); const listed = vi.fn(() => [
    { libraryID: 1, name: 'Personal', editable: true },
    { libraryID: 2, name: 'Read only', editable: false },
  ]);
  f.host.Libraries = { getAll: listed };
  const collection = (key: string, name: string, editable = true, parentKey?: string) => ({ key, name, libraryID: 1, isEditable: () => editable, ...(parentKey ? { parentKey } : {}) });
  f.host.Collections = { getByLibrary: vi.fn(() => [collection('PARENT01', 'Research'), collection('CHILD001', 'Methods', true, 'PARENT01'), collection('LOCKED01', 'Locked', false), { ...collection('DELETED1', 'Deleted'), deleted: true }]) };
  expect(listed).not.toHaveBeenCalled();
  expect(await f.port.collections()).toEqual([
    { clientId: paperA.clientId, libraryId: 1, collectionKey: 'PARENT01', name: 'Personal / Research' },
    { clientId: paperA.clientId, libraryId: 1, collectionKey: 'CHILD001', name: 'Personal / Research / Methods' },
  ]);
  expect(f.host.Collections.getByLibrary).toHaveBeenCalledTimes(1);
  expect(f.source.capture).not.toHaveBeenCalled();
});

// This test really base64-encodes and decodes an image just over the ordinary 2 MiB limit and
// compares the exported bytes. The comparison is byte-exact but no longer uses vitest's generic
// deep equality over the multi-MiB `Uint8Array` (that was the measured timeout root cause); it now
// checks the target and length, then one `Buffer.equals` memcmp. The payload stays the exact
// 2 MiB + 1 boundary, and the explicit budget stays as defence for slower shared CI runners — the
// real work and the strength of the assertion are unchanged.
it('exports generated output images above the input limit while retaining the ordinary 2 MiB limit', { timeout: 15000 }, async () => {
  const f = setup(); const bytes = new Uint8Array(2 * 1024 * 1024 + 1); bytes.set(png);
  const image = { id: uuid, name: 'generated.png', mime: 'image/png' as const, dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` };
  await expect(f.port.exportImage(image)).rejects.toThrow(/larger/iu);
  expect(f.io.write).not.toHaveBeenCalled();
  await f.port.exportImage({ ...image, origin: { kind: 'generated', model: 'image-model' } });
  const write = (f.io.write.mock.calls as unknown as Array<[string, Uint8Array]>).find(([target]) => target === '/synthetic/SKILL.md');
  expect(write, 'exports to the SKILL.md target').toBeDefined();
  const writtenBytes = write![1];
  expect(writtenBytes.length).toBe(bytes.length);
  expect(Buffer.from(writtenBytes).equals(Buffer.from(bytes))).toBe(true);
});
