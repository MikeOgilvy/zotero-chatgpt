import { clone } from '../../../contracts/src/clone.ts';
import { DOCUMENT_BYTES, validateDocument } from '../../../contracts/src/document.ts';
import { ReaderError, paperId, type DocumentContext, type DocumentPage, type DocumentRevision, type PaperScope } from '../../../contracts/src/index.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';

export interface TextPdf {
  numPages: number;
  fingerprints: string[];
  getData?(): Promise<Uint8Array | ArrayBuffer>;
  getPageLabels2(): Promise<string[] | null>;
  getPageData(options: { pageIndex: number }): Promise<{ partial?: boolean; chars: Array<{ c: string; ignorable?: boolean; spaceAfter?: boolean; lineBreakAfter?: boolean; paragraphBreakAfter?: boolean }> }>;
}
export interface DocumentSource { pdf: TextPdf; revision: DocumentRevision }
export interface DocumentProgress { done: number; total: number }
export type PageRange = readonly [number, number]; // physical PDF pages, 1-based and inclusive
const PARSER = 'zotero-native-text-v2';
const loadedHashes = new WeakMap<TextPdf, Promise<string>>();
async function digestBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function digest(text: string): Promise<string> {
  return digestBytes(new TextEncoder().encode(text));
}
/** Largest prefix of `text` whose UTF-8 encoding fits `room` bytes, cut only at code-point boundaries. */
function clipToBytes(text: string, room: number): string {
  if (room <= 0) return '';
  let output = ''; let used = 0;
  for (const character of text) {
    const size = new TextEncoder().encode(character).length;
    if (used + size > room) break;
    output += character; used += size;
  }
  return output;
}
function identifier(hash: string): string { return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`; }
export function cancelled(): ReaderError { return new ReaderError('INVALID_REQUEST', 'PDF preparation cancelled. Your question is kept.'); }
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw cancelled(); }
/** Stop waiting for a worker without destroying the PDF document owned by Zotero. */
async function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // The loser of the race must not surface as an unhandled rejection when the caller cancels.
  void work.catch(() => {});
  checkSignal(signal);
  let abort: () => void = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); })]);
  } finally { signal.removeEventListener('abort', abort); }
}
/**
 * Bound a local host read. The bound is not a second cancellation path: cancellation stays with
 * `signal`/`interruptible`, and this only stops waiting on work that has not settled. It exists
 * because a native `getData()` that never settles must not leave preparation pending forever.
 */
async function bounded<T>(work: Promise<T>, signal: AbortSignal | undefined, milliseconds: number, timeoutMessage: string): Promise<T> {
  void work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = globalThis.setTimeout(() => reject(new ReaderError('INVALID_REQUEST', timeoutMessage)), milliseconds); });
  try {
    const raced = Promise.race([work, deadline]);
    return signal ? await interruptible(raced, signal) : await raced;
  } finally { if (timer !== undefined) globalThis.clearTimeout(timer); }
}

/** Plugin-owned, bounded local text cache. At most one extraction runs at a time. No network. */
export class ReaderDocumentCache {
  private entries = new Map<string, DocumentContext>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private options: { yield(): Promise<void>; maxEntries?: number; maxBytes?: number }) {}
  read(paper: PaperScope, source: DocumentSource, signal: AbortSignal, progress: (p: DocumentProgress) => void, range?: PageRange): Promise<DocumentContext> {
    const revision = { ...source.revision }; const scope = { ...paper };
    const selected = range ? [...range] as [number, number] : undefined;
    const operation = this.queue.catch(() => {}).then(async () => {
      checkSignal(signal);
      const total = source.pdf.numPages;
      const [first, last] = selected ?? [1, total];
      if (!Number.isSafeInteger(total) || total < 1 || total > 10_000 || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > total) throw new ReaderError('INVALID_REQUEST', 'The requested PDF page range is not valid for this document.');
      const key = JSON.stringify([paperId(scope), revision, PARSER, first, last]);
      const cached = this.entries.get(key);
      if (cached) { this.entries.delete(key); this.entries.set(key, cached); progress({ done: cached.pages.length, total: last - first + 1 }); return clone(cached); }
      progress({ done: 0, total: last - first + 1 });
      const labels = await interruptible(source.pdf.getPageLabels2().catch(() => null), signal);
      const label = (number: number) => labels?.[number - 1] || String(number);
      // The local ceiling bounds memory, not the model's context window. Reaching it must not discard
      // the pages already extracted: keep every page that fits, clip the page that straddles the
      // ceiling as `partial`, and record every page after it as an explicit unread gap. A throw here
      // used to send nothing at all, which is the refusal the owner asked us to remove.
      const maxBytes = this.options.maxBytes ?? DOCUMENT_BYTES;
      const pages: DocumentPage[] = []; let bytes = 0; let unread: number | null = null;
      for (let number = first; number <= last; number++) {
        checkSignal(signal); await this.options.yield(); checkSignal(signal);
        let text = ''; let status: DocumentPage['status'] = 'empty'; let partial = false;
        try {
          const content = await interruptible(source.pdf.getPageData({ pageIndex: number - 1 }), signal);
          partial = content.partial === true;
          text = content.chars.map(char => char.ignorable ? '' : char.c + (char.paragraphBreakAfter ? '\n\n' : char.lineBreakAfter ? '\n' : char.spaceAfter ? ' ' : '')).join('').trim();
          status = text ? 'text' : 'empty';
        } catch { checkSignal(signal); status = 'error'; }
        const encoded = new TextEncoder().encode(text).length;
        if (bytes + encoded > maxBytes) {
          // Keep the code-point-aligned prefix that fits and mark it partial, so no reader can mistake
          // it for the page's complete text. A page with no room for even one code point becomes a gap.
          const clipped = text ? clipToBytes(text, maxBytes - bytes) : '';
          if (clipped.trim()) {
            pages.push({ pageIndex: number - 1, pageLabel: label(number), text: clipped, status: 'text', partial: true });
            bytes += new TextEncoder().encode(clipped).length;
            unread = number + 1;
          } else unread = number;
          break;
        }
        bytes += encoded;
        pages.push({ pageIndex: number - 1, pageLabel: label(number), text, status, ...(partial ? { partial: true } : {}) });
        progress({ done: pages.length, total: last - first + 1 });
      }
      if (unread !== null) for (let number = unread; number <= last; number++) pages.push({ pageIndex: number - 1, pageLabel: label(number), text: '', status: 'error' });
      checkSignal(signal);
      // Keep the source identity a digest over per-page hashes, so equal extraction yields equal ids
      // across cache eviction and any different page text (including a clipped or gap page) changes it.
      const hashes = await Promise.all(pages.map(page => digest(JSON.stringify(page))));
      const document = validateDocument({ id: identifier(await digest(JSON.stringify([key, hashes]))), paper: scope, revision, parserVersion: PARSER, totalPages: total, pages });
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

const READY_POLL_MS = 50;
const READY_ATTEMPTS = 40;
/**
 * The owner's flow is "open a PDF and ask", so a local whole-document read is expected to be
 * instantaneous next to any model call: the fixture is milliseconds and a large PDF's file read plus
 * sha256 is well under a second. 15 s is ~30x the PDF-readiness bound above and the observed stall
 * never settled at all, so this only ever fires on a read that is not coming back. When it does,
 * preparation fails honestly and nothing is sent; the question stays in the draft. The in-memory
 * loaded-hash cache entry is dropped so a later attempt makes a fresh native read instead of
 * inheriting the hung promise.
 */
const LOADED_BYTES_TIMEOUT_MS = 15_000;
const LOCAL_READ_FAILED = 'The current PDF could not be read locally. Wait for it to load or reopen it; your question is kept.';
const LOCAL_READ_TIMED_OUT = 'The current PDF did not finish loading in time to read it locally. Wait for it to load or reopen it; your question is kept.';
/**
 * Narrow native source access. Paths stay in this adapter and are never sent or persisted.
 * `delay` is injectable so the bounded PDF-readiness wait is deterministic under test;
 * `loadedBytesTimeoutMs` is the same seam for the bounded loaded-bytes read.
 */
export function nativeDocumentSource(zotero: ZoteroHost, reader: () => HostReader | undefined, scope: PaperScope, options: { delay?: (milliseconds: number) => Promise<void>; loadedBytesTimeoutMs?: number } = {}) {
  const loadedVersions = new WeakMap<TextPdf, string>();
  const wait = options.delay ?? ((milliseconds: number) => new Promise<void>(resolve => { globalThis.setTimeout(resolve, milliseconds); }));
  const capture = (signal?: AbortSignal): Promise<DocumentSource> => {
    const work = (async () => {
    try {
      const hostReader = reader();
      const item = hostReader && zotero.Items.get(hostReader.itemID);
      if (!hostReader || !item || item.key !== scope.attachmentKey || item.libraryID !== scope.libraryId) throw new Error();
      const viewOf = () => hostReader._internalReader?._primaryView ?? hostReader._internalReader?._lastView;
      await viewOf()?.initializedPromise;
      // A panel opened before the reader finishes loading would otherwise fail once and leave the
      // context card at "text not ready" until the user reopens or clicks again. Wait, bounded and
      // cancellable, for the native document instead of turning a slow load into a permanent error.
      let pdfDocument = viewOf()?._iframeWindow?.PDFViewerApplication?.pdfDocument;
      for (let attempt = 0; !pdfDocument && attempt < READY_ATTEMPTS; attempt++) {
        if (signal?.aborted) throw cancelled();
        await wait(READY_POLL_MS);
        pdfDocument = viewOf()?._iframeWindow?.PDFViewerApplication?.pdfDocument;
      }
      const pdf = pdfDocument;
      const path = await item.getFilePathAsync?.();
      if (!pdf || !path) throw new Error();
      const io = (globalThis as unknown as { IOUtils: { stat(path: string): Promise<{ size: number; lastModified: number }>; computeHexDigest(path: string, algorithm: 'sha256'): Promise<string> } }).IOUtils;
      const stat = await io.stat(path);
      if (!pdf.getData || !io.computeHexDigest) throw new ReaderError('INVALID_REQUEST', 'The host cannot verify this loaded PDF version. Reopen the PDF before asking.');
      let loadedHash = loadedHashes.get(pdf);
      if (!loadedHash) {
        // Native reader promises do not accept privileged callbacks passed directly to .then().
        // Await the native promise first; attach cache cleanup only to our own realm's promise.
        // The read is bounded: a native `getData()` that never settles fails preparation with its own
        // cause instead of leaving the pending promise cached for every later attempt.
        const pending = bounded(
          (async () => digestBytes(new Uint8Array(await pdf.getData!())))(),
          signal,
          options.loadedBytesTimeoutMs ?? LOADED_BYTES_TIMEOUT_MS,
          LOCAL_READ_TIMED_OUT,
        );
        loadedHash = pending.catch(error => { if (loadedHashes.get(pdf) === loadedHash) loadedHashes.delete(pdf); throw error; });
        loadedHashes.set(pdf, loadedHash);
        // The cache keeps this promise across captures, so a rejection that no consumer is currently
        // awaiting (a capture aborted before it reads the hash) must not be reported as unhandled;
        // every real consumer still observes the rejection itself.
        void loadedHash.catch(() => {});
      }
      const [loadedSha, diskSha] = await Promise.all([loadedHash, io.computeHexDigest(path, 'sha256')]);
      if (loadedSha !== diskSha) throw new ReaderError('INVALID_REQUEST', 'The PDF file changed while this reader was open. Reopen it to load the current version.');
      const revision = { fingerprint: pdf.fingerprints.filter(Boolean).join(':'), size: stat.size, modifiedAt: stat.lastModified, sha256: diskSha };
      const key = JSON.stringify(revision);
      const loaded = loadedVersions.get(pdf);
      if (loaded && loaded !== key) throw new ReaderError('INVALID_REQUEST', 'The PDF file changed. Reopen this PDF before asking again.');
      loadedVersions.set(pdf, key);
      const nativeWindow = viewOf()?._iframeWindow;
      if (!nativeWindow) throw new Error();
      const cu = (globalThis as unknown as { Cu: { cloneInto(value: object, target: object): { pageIndex: number } } }).Cu;
      return { revision, pdf: {
        numPages: pdf.numPages, fingerprints: [...pdf.fingerprints],
        getPageLabels2: () => pdf.getPageLabels2(),
        getPageData: async (options: { pageIndex: number }) => {
          const raw = await pdf.getPageData(cu.cloneInto(options, nativeWindow));
          if (!raw || !Array.isArray(raw.chars)) throw new ReaderError('INVALID_REQUEST', 'The PDF page text could not be extracted.');
          // Zotero 9.0.6 GetPageData unconditionally sets partial=true for basic data before
          // citation/overlay enrichment. Its character extraction is complete (worker module.js).
          // Keep generic text-provider partial failures meaningful; do not forward this different flag.
          const bounds = (raw as typeof raw & { viewBox?: unknown }).viewBox;
          const viewBox = Array.isArray(bounds) ? Array.from(bounds) as unknown[] : [];
          return { chars: Array.from(raw.chars), ...(viewBox.length === 4 && viewBox.every(value => typeof value === 'number' && Number.isFinite(value)) ? { viewBox: viewBox as number[] } : {}) };
        },
      } };
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      throw new ReaderError('INVALID_REQUEST', LOCAL_READ_FAILED);
    }
    })();
    return signal ? interruptible(work, signal) : work;
  };
  return {
    capture,
    validate: async (document: { revision: DocumentRevision }) => {
      const fresh = await capture();
      if (JSON.stringify(fresh.revision) !== JSON.stringify(document.revision)) throw new ReaderError('INVALID_REQUEST', 'The PDF changed during preparation. Reopen it and send again.');
    },
  };
}
