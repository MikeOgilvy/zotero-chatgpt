import { expect, it } from 'vitest';
import { ReaderDocumentCache, type DocumentSource } from '../../../packages/zotero/src/reader/document.ts';
import { paperA, paperB } from '../../contracts/factories.ts';
function source(texts = ['Definition: x = 3.', 'Theorem: y = x + 7.']): { source: DocumentSource; calls: number[] } {
  const calls: number[] = [];
  return { calls, source: { revision: { fingerprint: 'synthetic-v1', size: 1024, modifiedAt: 1000 }, pdf: {
    numPages: texts.length, fingerprints: ['synthetic-v1'], getPageLabels2: () => Promise.resolve(['iv', 'v', 'vi']),
    getPageData: ({ pageIndex }) => { calls.push(pageIndex + 1); if (texts[pageIndex] === 'FAIL') return Promise.reject(new Error('/private/path must not leak')); return Promise.resolve({ partial: false, chars: [{ c: texts[pageIndex]!, paragraphBreakAfter: true }] }); },
  } } };
}
const cache = (maxEntries = 3) => new ReaderDocumentCache({ yield: async () => {}, maxEntries });
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
it('keeps the source identity after cache eviction and changes it for a different extraction result', async () => {
  const f = source(); const c = cache(1); const signal = new AbortController().signal;
  const original = await c.read(paperA, f.source, signal, () => {});
  await c.read(paperB, f.source, signal, () => {});
  const reread = await c.read(paperA, f.source, signal, () => {});
  expect(reread.id).toBe(original.id);
  c.clear(); const partial = source(['Definition: x = 3.', 'FAIL']);
  expect((await c.read(paperA, partial.source, signal, () => {})).id).not.toBe(original.id);
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
const bounded = (maxBytes: number) => new ReaderDocumentCache({ yield: async () => {}, maxBytes });
it('keeps the pages it already extracted and reports unread pages as gaps at the local limit', async () => {
  const f = source(['A'.repeat(120), 'B'.repeat(120), 'C'.repeat(120), 'D'.repeat(120)]);
  const progress: number[] = [];
  const result = await bounded(240).read(paperA, f.source, new AbortController().signal, p => progress.push(p.done));
  expect(result.totalPages).toBe(4);
  expect(result.pages.map(page => [page.pageIndex, page.status, page.pageLabel])).toEqual([
    [0, 'text', 'iv'], [1, 'text', 'v'], [2, 'error', 'vi'], [3, 'error', '4'],
  ]);
  expect(result.pages[0]!.text).toBe('A'.repeat(120)); expect(result.pages[1]!.text).toBe('B'.repeat(120));
  expect(result.pages.slice(2).every(page => page.text === '')).toBe(true);
  expect(progress).toEqual([0, 1, 2]); expect(JSON.stringify(result)).not.toContain('/private');
});
it('marks a page whose text was clipped at the local limit as partial and reports the rest as unread', async () => {
  const f = source(['Q'.repeat(200), 'R'.repeat(10)]);
  const result = await bounded(50).read(paperA, f.source, new AbortController().signal, () => {});
  expect(result.pages).toEqual([
    { pageIndex: 0, pageLabel: 'iv', text: 'Q'.repeat(50), status: 'text', partial: true },
    { pageIndex: 1, pageLabel: 'v', text: '', status: 'error' },
  ]);
});
it('clips an oversized page at a Unicode code-point boundary and never emits a lone surrogate', async () => {
  const text = '数学🙂'.repeat(60); const f = source([text, 'tail']);
  const result = await bounded(25).read(paperA, f.source, new AbortController().signal, () => {});
  const page = result.pages[0]!;
  expect(page.partial).toBe(true); expect(page.text.startsWith('数学🙂')).toBe(true);
  expect(new TextEncoder().encode(page.text).length).toBeLessThanOrEqual(25);
  expect(page.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u);
  expect(result.pages[1]).toMatchObject({ pageIndex: 1, status: 'error', text: '' });
});
