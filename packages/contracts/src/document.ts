import { ReaderError, type DocumentContext, type DocumentSummary } from './index.ts';
import { validatePaperScope } from './validation.ts';

/** Resource guard, not a model context-window promise. No silent clipping. */
export const DOCUMENT_BYTES = 2 * 1024 * 1024;
function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'The PDF context is invalid.'); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) invalid();
  return result;
}
function label(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.length || value.length > limit || /[\u0000-\u001f]/u.test(value)) invalid();
  return value;
}
export function validateDocument(value: unknown): DocumentContext {
  const doc = record(value, ['id', 'paper', 'revision', 'parserVersion', 'totalPages', 'pages']);
  const id = label(doc.id, 36);
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(id)) invalid();
  const rev = record(doc.revision, ['fingerprint', 'size', 'modifiedAt']);
  if (!Number.isSafeInteger(rev.size) || Number(rev.size) < 0 || !Number.isSafeInteger(rev.modifiedAt) || Number(rev.modifiedAt) < 0) invalid();
  if (!Number.isSafeInteger(doc.totalPages) || Number(doc.totalPages) < 1 || Number(doc.totalPages) > 10_000 || !Array.isArray(doc.pages) || !doc.pages.length || doc.pages.length > Number(doc.totalPages)) invalid();
  let bytes = 0;
  const seen = new Set<number>();
  const pages = doc.pages.map(value => {
    const page = record(value, ['pageIndex', 'pageLabel', 'text', 'status', 'partial']);
    if (page.partial !== undefined && page.partial !== true) invalid();
    const index = Number(page.pageIndex);
    if (typeof page.pageIndex !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= Number(doc.totalPages) || seen.has(index)) invalid();
    seen.add(index);
    if (typeof page.text !== 'string' || !['text', 'empty', 'error'].includes(String(page.status))) invalid();
    if (page.status === 'text' ? !page.text.trim() : page.text !== '') invalid();
    bytes += new TextEncoder().encode(page.text).length;
    if (bytes > DOCUMENT_BYTES) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This PDF exceeds the local text limit. No text was truncated or sent; use a smaller page range.');
    return { pageIndex: index, pageLabel: label(page.pageLabel, 64), text: page.text, status: page.status as DocumentContext['pages'][number]['status'], ...(page.partial ? { partial: true as const } : {}) };
  });
  return { id, paper: validatePaperScope(doc.paper), revision: { fingerprint: label(rev.fingerprint, 256), size: Number(rev.size), modifiedAt: Number(rev.modifiedAt) }, parserVersion: label(doc.parserVersion, 64), totalPages: Number(doc.totalPages), pages };
}
export function documentSummary(doc: DocumentContext): DocumentSummary {
  return { id: doc.id, revision: { ...doc.revision }, parserVersion: doc.parserVersion, totalPages: doc.totalPages,
    pages: doc.pages.map(({ pageIndex, pageLabel, status, partial }) => ({ pageIndex, pageLabel, status, ...(partial ? { partial } : {}) })),
    textBytes: doc.pages.reduce((bytes, page) => bytes + new TextEncoder().encode(page.text).length, 0) };
}
