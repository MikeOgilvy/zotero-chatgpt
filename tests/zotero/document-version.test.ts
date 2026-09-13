import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeDocumentSource, ReaderDocumentCache } from '../../packages/zotero/src/reader/document.ts';
import { freezeCitationVersion, openCitation } from '../../packages/zotero/src/reader/selection.ts';
import type { HostReader, ZoteroHost } from '../../packages/zotero/src/reader/host-types.ts';
import { citationA, paperA } from '../contracts/factories.ts';
afterEach(() => vi.unstubAllGlobals());
function fixture(replaced = false) {
  const loaded = new TextEncoder().encode('%PDF synthetic version A'); let disk = replaced ? '%PDF synthetic version B' : '%PDF synthetic version A';
  const getData = vi.fn(() => Promise.resolve(loaded));
  const pdf = { numPages: 1, fingerprints: ['unchanged'], getData, getPageLabels2: () => Promise.resolve(['1']), getPageData: () => Promise.resolve({ chars: [{ c: 'A' }] }) };
  const navigate = vi.fn();
  const reader = { itemID: 1, navigate, _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: { pdfDocument: pdf } } } } } as unknown as HostReader;
  const zotero = { Reader: { _readers: [reader] }, Items: { get: () => ({ key: paperA.attachmentKey, libraryID: paperA.libraryId, getFilePathAsync: () => Promise.resolve('/synthetic/fixture.pdf') }) } } as unknown as ZoteroHost;
  vi.stubGlobal('Cu', { cloneInto: (value: unknown) => value });
  vi.stubGlobal('IOUtils', { stat: () => Promise.resolve({ size: loaded.length, lastModified: 1000 }), computeHexDigest: () => Promise.resolve(createHash('sha256').update(disk).digest('hex')) });
  return { source: nativeDocumentSource(zotero, () => reader, paperA), replace: () => { disk = '%PDF synthetic version B'; }, getData, zotero, reader, navigate, loaded };
}
it('rejects same-size same-mtime replacement against loaded bytes and caches only the loaded hash', async () => {
  const f = fixture(); const first = await f.source.capture(); const second = await f.source.capture();
  expect(first.revision.sha256).toHaveLength(64); expect(second.revision.sha256).toBe(first.revision.sha256); expect(f.getData).toHaveBeenCalledTimes(1);
  f.replace(); await expect(f.source.capture()).rejects.toThrow(/changed|reopen|loaded/i);
});
it('detects a replacement even before the first sidebar capture', async () => {
  await expect(fixture(true).source.capture()).rejects.toThrow(/changed|reopen|loaded/i);
});
it('awaits the native loaded-byte promise before attaching callbacks in the plugin realm', async () => {
  const f = fixture(); let calls = 0;
  const pdf = f.reader._internalReader!._primaryView!._iframeWindow!.PDFViewerApplication!.pdfDocument!;
  // A direct host double avoids the test spy itself attaching settlement callbacks.
  pdf.getData = () => {
    calls++;
    const native = Promise.resolve(f.loaded);
    void Object.defineProperty(native, 'then', { get() { throw new Error('Native realm rejects direct privileged callbacks'); } });
    return native;
  };
  await expect(f.source.capture()).resolves.toHaveProperty('revision.sha256');
  await f.source.capture(); expect(calls).toBe(1);
});
it('does not confuse Zotero basic-page enrichment partial with incomplete extracted text', async () => {
  const f = fixture(); const pdf = f.reader._internalReader!._primaryView!._iframeWindow!.PDFViewerApplication!.pdfDocument!;
  pdf.getPageData = () => Promise.resolve({ partial: true, chars: [{ c: 'Complete page text' }] });
  const source = await f.source.capture(); const cache = new ReaderDocumentCache({ yield: () => Promise.resolve() });
  const result = await cache.read(paperA, source, new AbortController().signal, () => {});
  expect(result.pages).toEqual([{ pageIndex: 0, pageLabel: '1', status: 'text', text: 'Complete page text' }]);
});
it('waits for the reader PDF that loads after the panel opens instead of failing local preparation once', async () => {
  const f = fixture();
  const application = f.reader._internalReader!._primaryView!._iframeWindow!.PDFViewerApplication!;
  const pdf = application.pdfDocument!;
  delete application.pdfDocument;
  let waits = 0;
  const source = nativeDocumentSource(f.zotero, () => f.reader, paperA, { delay: () => { waits += 1; if (waits === 3) application.pdfDocument = pdf; return Promise.resolve(); } });
  await expect(source.capture()).resolves.toHaveProperty('revision.sha256');
  expect(waits).toBe(3);
});
it('reports one honest failure when the PDF never loads and stays cancellable while waiting', async () => {
  const f = fixture();
  const application = f.reader._internalReader!._primaryView!._iframeWindow!.PDFViewerApplication!;
  delete application.pdfDocument;
  let waits = 0;
  const source = nativeDocumentSource(f.zotero, () => f.reader, paperA, { delay: () => { waits += 1; return Promise.resolve(); } });
  await expect(source.capture()).rejects.toThrow(/could not be read locally/i);
  expect(waits).toBe(40);
  const abort = new AbortController(); abort.abort();
  await expect(source.capture(abort.signal)).rejects.toThrow(/cancel/i);
});
it('fails a loaded-bytes read that never settles instead of leaving preparation pending forever', async () => {
  const f = fixture();
  const pdf = f.reader._internalReader!._primaryView!._iframeWindow!.PDFViewerApplication!.pdfDocument!;
  // A native read that never settles is the observed failure mode: `capture()` awaited it forever and
  // the owner got nothing at all. It must fail within the bound, with its own cause named.
  pdf.getData = () => new Promise<Uint8Array>(() => {});
  const source = nativeDocumentSource(f.zotero, () => f.reader, paperA, { loadedBytesTimeoutMs: 20 });
  await expect(source.capture()).rejects.toThrow(/did not finish loading in time/i);
  // And the hung read must not poison this document: once the host can answer, capture succeeds.
  pdf.getData = () => Promise.resolve(f.loaded);
  await expect(source.capture()).resolves.toHaveProperty('revision.sha256');
});
it('freezes citation bytes before the action and refuses old coordinates after a file replacement', async () => {
  const f = fixture(); const citation = await freezeCitationVersion(f.zotero, f.reader, citationA);
  expect(citation.documentRevision?.sha256).toHaveLength(64);
  f.replace(); await expect(openCitation(f.zotero, citation, paperA.clientId)).rejects.toThrow(/changed|reopen/i);
  expect(f.navigate).not.toHaveBeenCalled();
});
