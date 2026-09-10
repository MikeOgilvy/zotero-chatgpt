import { ReaderError, type Citation, type PaperScope, type Rect } from '../../../contracts/src/index.ts';
import { validateCitation } from '../../../contracts/src/validation.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';
/** Zotero 9.0.6 `renderTextSelectionPopup` payload (reader.js:25427-25433, 70462-70484). */
export interface SelectionAnnotation {
  type?: string; color?: string | undefined; sortIndex?: string; pageLabel?: string | undefined;
  position: { pageIndex: number; rects: number[][]; nextPageRects?: number[][] };
  text: string;
}
export interface SelectionPopupEvent { reader: HostReader; doc: Document; append(...nodes: Node[]): void; params: { annotation?: SelectionAnnotation } }
export interface PaperMetadata { title: string; authors: string[]; year?: string; doi?: string }
/**
 * Copies content-compartment arrays with index loops. Calling `map`/`every` on a content array with a
 * chrome callback makes content pass its array back to privileged code, which Gecko refuses.
 */
function copyRects(value: unknown): Rect[] {
  if (!value || typeof value !== 'object') throw new ReaderError('INVALID_REQUEST', 'The selection position is not valid.');
  const source = value as { length: number; [index: number]: unknown };
  const length = Number(source.length);
  if (!Number.isInteger(length) || length <= 0 || length > 512) throw new ReaderError('INVALID_REQUEST', 'The selection position is not valid.');
  const rects: Rect[] = [];
  for (let i = 0; i < length; i++) {
    const entry = source[i] as { length: number; [index: number]: unknown } | undefined;
    if (!entry || Number(entry.length) !== 4) throw new ReaderError('INVALID_REQUEST', 'The selection position is not valid.');
    const rect: number[] = [];
    for (let j = 0; j < 4; j++) { const n = Number(entry[j]); if (typeof entry[j] !== 'number' || !Number.isFinite(n)) throw new ReaderError('INVALID_REQUEST', 'The selection position is not valid.'); rect.push(n); }
    rects.push([rect[0]!, rect[1]!, rect[2]!, rect[3]!]);
  }
  return rects;
}
/** Copies the selection immediately; later focus changes or a new selection cannot alter the citation. */
export function captureSelection(event: SelectionPopupEvent, paper: PaperScope, metadata: PaperMetadata, clock: { uuid: () => string; now: () => string }): Citation {
  const annotation = event.params?.annotation;
  if (!annotation || typeof annotation.text !== 'string' || !annotation.text.trim()) throw new ReaderError('INVALID_REQUEST', 'No usable text selection.');
  const position = annotation.position;
  if (!position || typeof position.pageIndex !== 'number') throw new ReaderError('INVALID_REQUEST', 'The selection position is not valid.');
  // The reader truncates to two pages before this event fires; a partial selection is never sent silently.
  if (position.nextPageRects) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Narrow the selection to a single page; cross-page selections are not supported yet.');
  const pageLabel = typeof annotation.pageLabel === 'string' ? annotation.pageLabel.trim() : '';
  const citation: Citation = {
    id: clock.uuid(),
    paper: { ...paper },
    text: String(annotation.text),
    title: metadata.title,
    authors: [...metadata.authors],
    pageLabel: pageLabel || String(position.pageIndex + 1),
    positions: [{ pageIndex: position.pageIndex, rects: copyRects(position.rects) }],
    capturedAt: clock.now(),
    contextScope: 'selection',
  };
  if (metadata.year) citation.year = metadata.year;
  if (metadata.doi) citation.doi = metadata.doi;
  return validateCitation(citation);
}
/** Jumps to a citation's page position in the open reader of that attachment, or opens the attachment first. */
export async function openCitation(zotero: ZoteroHost, citation: Citation, currentClientId: string): Promise<void> {
  if (citation.paper.clientId !== currentClientId) throw new ReaderError('NOT_FOUND', 'This citation belongs to another reading environment and cannot be opened here.');
  const position = citation.positions[0]!;
  const location = { position: { pageIndex: position.pageIndex, rects: position.rects.map(r => [...r]) } };
  const open = zotero.Reader._readers.find(reader => { const item = zotero.Items.get(reader.itemID); return item?.libraryID === citation.paper.libraryId && item.key === citation.paper.attachmentKey; });
  if (open) { await open.navigate(location); return; }
  const item = zotero.Items.getByLibraryAndKey?.(citation.paper.libraryId, citation.paper.attachmentKey);
  if (!item || typeof item.id !== 'number' || !zotero.Reader.open) throw new ReaderError('NOT_FOUND', 'The attachment for this citation could not be found.');
  await zotero.Reader.open(item.id, location);
}
/** Declared metadata of the paper: the parent item when the PDF is attached to one, else the attachment itself. */
export function paperMetadata(zotero: ZoteroHost, reader: HostReader): PaperMetadata | undefined {
  const attachment = zotero.Items.get(reader.itemID);
  if (!attachment) return undefined;
  const parent = attachment.parentItemID ? zotero.Items.get(attachment.parentItemID) : undefined;
  const source = parent ?? attachment;
  const authors = (source.getCreators?.() ?? []).map(c => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '').filter(Boolean).slice(0, 50);
  const result: PaperMetadata = { title: source.getField('title') || attachment.getField('title') || '', authors };
  const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(source.getField('date') || '')?.[0]; if (year) result.year = year;
  const doi = source.getField('DOI')?.trim(); if (doi) result.doi = doi;
  return result;
}
