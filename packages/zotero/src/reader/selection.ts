import { ReaderError, type Citation, type PaperIdentity, type PaperScope, type Rect } from '../../../contracts/src/index.ts';
import { validateCitation } from '../../../contracts/src/validation.ts';
import type { HostItem, HostReader, ZoteroHost } from './host-types.ts';
import { nativeDocumentSource } from './document.ts';
import { ABSTRACT_LIMIT, MAX_PEOPLE, METADATA_FIELD_LIMIT, PERSON_LIMIT, TAG_LIMIT, TAGS_LIMIT, capList, capText, paperIdentityOf, type PaperMetadata } from '../../../core/src/context/bibliography.ts';
export type { PaperMetadata } from '../../../core/src/context/bibliography.ts';
/** Zotero 9.0.6 `renderTextSelectionPopup` payload (reader.js:25427-25433, 70462-70484). */
export interface SelectionAnnotation {
  type?: string; color?: string | undefined; sortIndex?: string; pageLabel?: string | undefined;
  position: { pageIndex: number; rects: number[][]; nextPageRects?: number[][] };
  text: string;
}
export interface SelectionPopupEvent { reader: HostReader; doc: Document; append(...nodes: Node[]): void; params: { annotation?: SelectionAnnotation } }
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
/** Start this at selection time; waiting for a later click must not change the source version. */
export async function freezeCitationVersion(zotero: ZoteroHost, reader: HostReader, citation: Citation): Promise<Citation> {
  const snapshot = validateCitation(citation);
  const source = await nativeDocumentSource(zotero, () => reader, snapshot.paper).capture();
  return { ...snapshot, documentRevision: source.revision };
}
/** Opens the right attachment and validates the loaded bytes before using saved coordinates. */
export async function openCitation(zotero: ZoteroHost, citation: Citation, currentClientId: string): Promise<void> {
  if (citation.paper.clientId !== currentClientId) throw new ReaderError('NOT_FOUND', 'This citation belongs to another reading environment and cannot be opened here.');
  const position = citation.positions[0]!;
  let open = zotero.Reader._readers.find(reader => { const item = zotero.Items.get(reader.itemID); return item?.libraryID === citation.paper.libraryId && item.key === citation.paper.attachmentKey; });
  if (!open) {
    const item = zotero.Items.getByLibraryAndKey?.(citation.paper.libraryId, citation.paper.attachmentKey);
    if (!item || typeof item.id !== 'number' || !zotero.Reader.open) throw new ReaderError('NOT_FOUND', 'The attachment for this citation could not be found.');
    open = await zotero.Reader.open(item.id) || undefined;
  }
  if (!open) throw new ReaderError('NOT_FOUND', 'The citation reader could not be opened.');
  if (!citation.documentRevision) { await open.navigate({ pageIndex: position.pageIndex }); return; }
  const current = await nativeDocumentSource(zotero, () => open, citation.paper).capture();
  if (JSON.stringify(current.revision) !== JSON.stringify(citation.documentRevision)) throw new ReaderError('INVALID_REQUEST', 'The cited PDF version changed. Reopen and select the passage again.');
  const next = citation.positions[1];
  await open.navigate({ position: {
    pageIndex: position.pageIndex,
    rects: position.rects.map(r => [...r]),
    ...(next ? { nextPageRects: next.rects.map(r => [...r]) } : {}),
  } });
}
/**
 * Zotero item fields read from the parent item (or the attachment when it stands alone). Every field
 * below `title`/`authors` was verified to exist in Zotero 9.0.6's bundled global schema (see
 * `metadata.ts`); `isbn`/`issn` map Zotero's `ISBN`/`ISSN`. A field that `getField` refuses on this
 * item type returns `''` (`item.js:283-288`) and is omitted — never guessed.
 */
const METADATA_FIELDS = ['publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'university', 'institution', 'volume', 'issue', 'pages', 'publisher', 'language'] as const;
/** `getField` can throw on an unloaded item or an unavailable field; a refusal is an absent field. */
function readField(item: HostItem, name: string): string {
  try { const value = item.getField(name); return typeof value === 'string' ? value.trim() : ''; } catch { return ''; }
}
function readCreators(item: HostItem): NonNullable<ReturnType<NonNullable<HostItem['getCreators']>>> {
  try { const creators = item.getCreators?.(); return Array.isArray(creators) ? creators : []; } catch { return []; }
}
function readTags(item: HostItem): Array<{ tag: string }> {
  try { const tags = item.getTags?.(); return Array.isArray(tags) ? tags : []; } catch { return []; }
}
function creatorName(creator: { firstName?: string; lastName?: string; name?: string }): string {
  return [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.name || '';
}
/** Declared metadata of the paper: the parent item when the PDF is attached to one, else the attachment itself. */
export function paperMetadata(zotero: ZoteroHost, reader: HostReader): PaperMetadata | undefined {
  const attachment = zotero.Items.get(reader.itemID);
  if (!attachment) return undefined;
  const parent = attachment.parentItemID ? zotero.Items.get(attachment.parentItemID) : undefined;
  return paperMetadataOf(attachment, parent ?? attachment);
}
/**
 * The same read, from items the caller already resolved. Kept separate so the sidebar's clipboard
 * copy can re-read one frozen attachment by library+key without inventing a `HostReader` for it.
 */
export function paperMetadataOf(attachment: HostItem, source: HostItem): PaperMetadata {
  const creators = readCreators(source);
  const authors = capList(creators.filter(creator => !creator.creatorType || creator.creatorType === 'author').map(creatorName).filter(Boolean), MAX_PEOPLE, PERSON_LIMIT);
  const result: PaperMetadata = { title: readField(source, 'title') || readField(attachment, 'title') || '', authors };
  // `itemType` is a host property, not a `getField` field (`item.js:143-145`). The PDF's own type is
  // 'attachment', which says nothing bibliographic, so it is never reported.
  const itemType = typeof source.itemType === 'string' ? source.itemType.trim() : '';
  if (itemType && itemType !== 'attachment') result.itemType = capText(itemType, METADATA_FIELD_LIMIT);
  for (const field of METADATA_FIELDS) { const value = readField(source, field); if (value) result[field] = capText(value, METADATA_FIELD_LIMIT); }
  const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(readField(source, 'date'))?.[0]; if (year) result.year = year;
  const doi = readField(source, 'DOI'); if (doi) result.doi = capText(doi, 256);
  const isbn = readField(source, 'ISBN'); if (isbn) result.isbn = capText(isbn, METADATA_FIELD_LIMIT);
  const issn = readField(source, 'ISSN'); if (issn) result.issn = capText(issn, METADATA_FIELD_LIMIT);
  const abstractNote = readField(source, 'abstractNote'); if (abstractNote) result.abstractNote = capText(abstractNote, ABSTRACT_LIMIT);
  const editors = capList(creators.filter(creator => creator.creatorType === 'editor').map(creatorName).filter(Boolean), MAX_PEOPLE, PERSON_LIMIT);
  if (editors.length) result.editors = editors;
  const tags = capList(readTags(source).map(entry => entry.tag), TAGS_LIMIT, TAG_LIMIT);
  if (tags.length) result.tags = tags;
  return result;
}
/**
 * Re-read the bibliographic identity of one attachment addressed by its frozen `PaperScope`. Returns
 * null when the attachment or its parent is no longer in the library, so the caller keeps what it
 * already froze instead of copying a stranger's metadata. Read-only: nothing is written, no reader
 * tab is opened and no PDF text is touched.
 */
export function paperIdentityFor(zotero: ZoteroHost, paper: PaperScope): PaperIdentity | null {
  const attachment = zotero.Items.getByLibraryAndKey?.(paper.libraryId, paper.attachmentKey);
  if (!attachment) return null;
  const parent = attachment.parentItemID ? zotero.Items.get(attachment.parentItemID) : undefined;
  const metadata = paperMetadataOf(attachment, parent ?? attachment);
  return paperIdentityOf(metadata, metadata.title.trim() || readField(attachment, 'title') || 'PDF attachment');
}
