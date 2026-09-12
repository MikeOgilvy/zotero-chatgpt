import { clone } from '../../../contracts/src/clone.ts';
import { DOCUMENT_BYTES, validateDocument } from '../../../contracts/src/document.ts';
import { ReaderError, paperId, type DocumentContext, type DocumentPage, type DocumentRevision, type PaperScope } from '../../../contracts/src/index.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';

export interface TextPdf {
  numPages: number;
  fingerprints: string[];
  getPageLabels2(): Promise<string[] | null>;
  getPageData(options: { pageIndex: number }): Promise<{ partial?: boolean; chars: Array<{ c: string; ignorable?: boolean; spaceAfter?: boolean; lineBreakAfter?: boolean; paragraphBreakAfter?: boolean }> }>;
}
export interface DocumentSource { pdf: TextPdf; revision: DocumentRevision }
export interface DocumentProgress { done: number; total: number }
export type PageRange = readonly [number, number]; // physical PDF pages, 1-based and inclusive
const PARSER = 'zotero-native-text-v1';
export function cancelled(): ReaderError { return new ReaderError('INVALID_REQUEST', 'PDF preparation cancelled. Your question is kept.'); }
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw cancelled(); }
/** Stop waiting for a worker without destroying the PDF document owned by Zotero. */
async function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  checkSignal(signal);
  let abort: () => void = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); })]);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Plugin-owned, bounded local text cache. At most one extraction runs at a time. No network. */
export class ReaderDocumentCache {
  private entries = new Map<string, DocumentContext>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private options: { uuid(): string; yield(): Promise<void>; maxEntries?: number }) {}
  read(paper: PaperScope, source: DocumentSource, signal: AbortSignal, progress: (p: DocumentProgress) => void, range?: PageRange): Promise<DocumentContext> {
    const revision = { ...source.revision }; const scope = { ...paper };
    const selected = range ? [...range] as [number, number] : undefined;
    const operation = this.queue.catch(() => {}).then(async () => {
      checkSignal(signal);
      const total = source.pdf.numPages;
      const [first, last] = selected ?? [1, total];
      if (!Number.isSafeInteger(total) || total < 1 || total > 10_000 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > total) throw new ReaderError('INVALID_REQUEST', 'Choose a valid PDF page range.');
      const key = JSON.stringify([paperId(scope), revision, PARSER, first, last]);
      const cached = this.entries.get(key);
      if (cached) { this.entries.delete(key); this.entries.set(key, cached); progress({ done: cached.pages.length, total: last - first + 1 }); return clone(cached); }
      progress({ done: 0, total: last - first + 1 });
      const labels = await interruptible(source.pdf.getPageLabels2().catch(() => null), signal);
      const pages: DocumentPage[] = []; let bytes = 0;
      for (let number = first; number <= last; number++) {
        checkSignal(signal); await this.options.yield(); checkSignal(signal);
        let text = ''; let status: DocumentPage['status'] = 'empty'; let partial = false;
        try {
          const content = await interruptible(source.pdf.getPageData({ pageIndex: number - 1 }), signal);
          partial = content.partial === true;
          text = content.chars.map(char => char.ignorable ? '' : char.c + (char.paragraphBreakAfter ? '\n\n' : char.lineBreakAfter ? '\n' : char.spaceAfter ? ' ' : '')).join('').trim();
          status = text ? 'text' : 'empty';
        } catch { checkSignal(signal); status = 'error'; }
        bytes += new TextEncoder().encode(text).length;
        if (bytes > DOCUMENT_BYTES) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This PDF exceeds the local text limit. Nothing was truncated or sent. Choose a page range in Context.');
        pages.push({ pageIndex: number - 1, pageLabel: labels?.[number - 1] || String(number), text, status, ...(partial ? { partial: true } : {}) });
        progress({ done: pages.length, total: last - first + 1 });
      }
      checkSignal(signal);
      const document = validateDocument({ id: this.options.uuid(), paper: scope, revision, parserVersion: PARSER, totalPages: total, pages });
      // Retry transient extraction failures; an empty/scanned page is a stable, explicit gap.
      if (!pages.some(p => p.status === 'error' || p.partial)) {
        this.entries.set(key, document);
        while (this.entries.size > (this.options.maxEntries ?? 3)) this.entries.delete(this.entries.keys().next().value!);
      }
      return clone(document);
    });
    this.queue = operation.catch(() => {});
    return interruptible(operation, signal);
  }
  clear(): void { this.entries.clear(); }
}

/** Narrow native source access. Paths stay in this adapter and are never sent or persisted. */
export function nativeDocumentSource(zotero: ZoteroHost, reader: () => HostReader | undefined, scope: PaperScope) {
  const loadedVersions = new WeakMap<TextPdf, string>();
  const capture = (signal?: AbortSignal): Promise<DocumentSource> => {
    const work = (async () => {
    try {
      const hostReader = reader();
      const item = hostReader && zotero.Items.get(hostReader.itemID);
      if (!hostReader || !item || item.key !== scope.attachmentKey || item.libraryID !== scope.libraryId) throw new Error();
      const view = hostReader._internalReader?._primaryView ?? hostReader._internalReader?._lastView;
      await view?.initializedPromise;
      const pdf = view?._iframeWindow?.PDFViewerApplication?.pdfDocument;
      const path = await item.getFilePathAsync?.();
      if (!pdf || !path) throw new Error();
      const io = (globalThis as unknown as { IOUtils: { stat(path: string): Promise<{ size: number; lastModified: number }> } }).IOUtils;
      const stat = await io.stat(path);
      const revision = { fingerprint: pdf.fingerprints.filter(Boolean).join(':'), size: stat.size, modifiedAt: stat.lastModified };
      const key = JSON.stringify(revision);
      const loaded = loadedVersions.get(pdf);
      if (loaded && loaded !== key) throw new ReaderError('INVALID_REQUEST', 'The PDF file changed. Reopen this PDF before asking again.');
      loadedVersions.set(pdf, key);
      const nativeWindow = view._iframeWindow;
      if (!nativeWindow) throw new Error();
      const cu = (globalThis as unknown as { Cu: { cloneInto(value: object, target: object): { pageIndex: number } } }).Cu;
      return { revision, pdf: {
        numPages: pdf.numPages, fingerprints: [...pdf.fingerprints],
        getPageLabels2: () => pdf.getPageLabels2(),
        getPageData: (options: { pageIndex: number }) => pdf.getPageData(cu.cloneInto(options, nativeWindow)),
      } };
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      throw new ReaderError('INVALID_REQUEST', 'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.');
    }
    })();
    return signal ? interruptible(work, signal) : work;
  };
  return {
    capture,
    validate: async (document: DocumentContext) => {
      const fresh = await capture();
      if (JSON.stringify(fresh.revision) !== JSON.stringify(document.revision)) throw new ReaderError('INVALID_REQUEST', 'The PDF changed during preparation. Reopen it and send again.');
    },
  };
}
