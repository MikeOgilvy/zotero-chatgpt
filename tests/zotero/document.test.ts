import { expect, it } from 'vitest';
import { ReaderDocumentCache, type DocumentSource } from '../../packages/zotero/src/reader/document.ts';
import { paperA, paperB } from '../contracts/factories.ts';
function source(texts = ['Definition: x = 3.', 'Theorem: y = x + 7.']): { source: DocumentSource; calls: number[] } {
  const calls: number[] = [];
  return { calls, source: { revision: { fingerprint: 'synthetic-v1', size: 1024, modifiedAt: 1000 }, pdf: {
    numPages: texts.length, fingerprints: ['synthetic-v1'], getPageLabels2: () => Promise.resolve(['iv', 'v', 'vi']),
    getPageData: ({ pageIndex }) => { calls.push(pageIndex + 1); if (texts[pageIndex] === 'FAIL') return Promise.reject(new Error('/private/path must not leak')); return Promise.resolve({ partial: false, chars: [{ c: texts[pageIndex]!, paragraphBreakAfter: true }] }); },
  } } };
}
let ids = 0;
const cache = (maxEntries = 3) => new ReaderDocumentCache({ uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, yield: async () => {}, maxEntries });
it('extracts every page with page labels, retains real gaps and never caches failed pages as complete text', async () => {
  const f = source(['Definition: x.', '', 'FAIL']);
  const progress: number[] = [];
  const result = await cache().read(paperA, f.source, new AbortController().signal, p => progress.push(p.done));
  expect(result.pages).toEqual([
    { pageIndex: 0, pageLabel: 'iv', text: 'Definition: x.', status: 'text' },
    { pageIndex: 1, pageLabel: 'v', text: '', status: 'empty' },
    { pageIndex: 2, pageLabel: 'vi', text: '', status: 'error' },
  ]);
  expect(progress).toEqual([0, 1, 2, 3]); expect(f.calls).toEqual([1, 2, 3]);
  expect(JSON.stringify(result)).not.toContain('/private');
});
it('reuses a bounded cache, separates attachments and invalidates replaced files', async () => {
  const f = source(); const c = cache(1); const read = (paper = paperA) => c.read(paper, f.source, new AbortController().signal, () => {});
  const original = await read(); original.pages[0]!.text = 'mutated by view';
  expect((await read()).pages[0]!.text).toBe('Definition: x = 3.'); expect(f.calls).toEqual([1, 2]);
  f.source.revision = { ...f.source.revision, modifiedAt: 2000 };
  expect((await read()).id).not.toBe(original.id); expect(f.calls).toHaveLength(4);
  await read(paperB); await read(); expect(f.calls).toHaveLength(8);
});
it('explicit page ranges do not claim that omitted pages were extracted', async () => {
  const f = source();
  const result = await cache().read(paperA, f.source, new AbortController().signal, () => {}, [2, 2]);
  expect(result.totalPages).toBe(2); expect(result.pages.map(p => p.pageIndex)).toEqual([1]); expect(f.calls).toEqual([2]);
});
it('cancels while a PDF worker is pending without destroying the reader', async () => {
  const f = source(); const abort = new AbortController();
  f.source.pdf.getPageData = () => new Promise(() => {});
  const pending = cache().read(paperA, f.source, abort.signal, () => {});
  abort.abort(); await expect(pending).rejects.toThrow(/cancel/i);
});
