import type { DocumentRevision, PaperScope, Rect } from './index.ts';

/**
 * Contracts for the native Zotero boundary. Two directions are deliberately separate:
 *
 * - `NativeReaderPort` only reads (documents, items, annotations, metadata lookup).
 * - `NativeActionPort` extends it with the writes (annotations, items, collections, acquisition).
 *
 * Actions consume reads, never the other way round: the reader/chat product path never needs an
 * action, so it can be built against `NativeReaderPort` alone.
 */

/** All mutation keys and targets come from the trusted task controller, never model output. */
export interface NativeItemRef { clientId: string; libraryId: number; key: string }
export interface NativeCollectionTarget { clientId: string; libraryId: number; collectionKey: string }
/** Persisted into real Zotero annotations; the historical product name stays literal. */
export const NATIVE_ANNOTATION_PROVENANCE = '[AI · Zotero ChatGPT]';
export interface NativeCollectionAddition { before: NativeItemSnapshot; after: NativeItemSnapshot; collectionKey: string; added: boolean }
export interface NativeQuoteInput {
  paper: PaperScope;
  revision: DocumentRevision;
  quote: string;
  /** Physical zero-based PDF pages. Omission requests every page, subject to explicit limits. */
  pageIndexes?: number[];
}
export interface NativeAnnotationPosition { pageIndex: number; rects: Rect[]; nextPageRects?: Rect[] }
export interface NativeAnnotationCandidate {
  source: NativeQuoteInput;
  text: string;
  pageLabel: string;
  sortIndex: string;
  position: NativeAnnotationPosition;
}
export type NativeQuoteResolution =
  | { status: 'resolved'; candidate: NativeAnnotationCandidate }
  | { status: 'ambiguous'; matches: number }
  | { status: 'unresolved'; reason: 'not-found' | 'incomplete-text' | 'invalid-geometry' | 'range-required' | 'unsupported-span' };
export interface NativeAnnotationSnapshot {
  paper: PaperScope;
  key: string;
  type: 'highlight' | 'underline';
  text: string;
  comment: string;
  color: string;
  pageLabel: string;
  sortIndex: string;
  position: NativeAnnotationPosition;
  authorName: string;
  isExternal: boolean;
  tags: string[];
  dateModified: string;
}
export interface NativeAnnotationCreate {
  candidate: NativeAnnotationCandidate;
  key: string;
  type: 'highlight' | 'underline';
  color: string;
  comment: string;
  /** Existing output may only be returned when it still exactly matches this ledger snapshot. */
  reconcileWith?: NativeAnnotationSnapshot;
}
export type NativeAnnotationDeleteResult =
  | { status: 'deleted' | 'absent' }
  | { status: 'conflict'; current: NativeAnnotationSnapshot | null };
export type NativeItemType = 'journalArticle' | 'conferencePaper' | 'preprint' | 'book' | 'bookSection' | 'report' | 'thesis' | 'webpage';
export interface NativeCreator { creatorType: 'author' | 'editor'; firstName?: string; lastName?: string; name?: string }
/** A bounded metadata allowlist. This cannot carry notes, tags, relations, paths or permissions. */
export interface NativeMetadata {
  itemType: NativeItemType;
  title: string;
  creators: NativeCreator[];
  DOI?: string;
  url?: string;
  date?: string;
  publicationTitle?: string;
  bookTitle?: string;
  conferenceName?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  ISBN?: string;
  abstractNote?: string;
  language?: string;
}
export interface NativeMetadataPreview {
  identifier: string;
  source: 'identifier' | 'web';
  candidates: NativeMetadata[];
}
export interface NativeItemSnapshot extends NativeItemRef {
  metadata: NativeMetadata;
  collectionKeys: string[];
  attachmentKeys: string[];
  dateModified: string;
  /** Canonical full native item JSON, used only to detect subsequent edits; never a model input. */
  contentSignature: string;
}
export interface NativeAttachmentSnapshot extends NativeItemRef {
  parentKey: string;
  url: string;
  contentType: 'application/pdf';
  sha256: string;
  contentSignature: string;
}
export type NativeAcquisitionResult =
  | { status: 'attached'; attachment: NativeAttachmentSnapshot; articleVersion: string; checkedPages: number; totalPages: number }
  | { status: 'unavailable' | 'uncertain'; reason: 'no-doi' | 'no-oa-candidate' | 'existing-pdf' | 'download-failed' | 'file-type-mismatch' | 'identity-unconfirmed' | 'supplementary' | 'file-too-large' };

/**
 * Read-only native Zotero boundary. Stateless: no approval, durable intent or scheduling lives here.
 * A reader/chat build that never writes Zotero only needs this port.
 */
export interface NativeReaderPort {
  resolveQuote(input: NativeQuoteInput, signal?: AbortSignal): Promise<NativeQuoteResolution>;
  inspectAnnotation(input: { paper: PaperScope; key: string }, signal?: AbortSignal): Promise<NativeAnnotationSnapshot | null>;
  previewMetadata(input: { identifier: string }, signal?: AbortSignal): Promise<NativeMetadataPreview>;
  findDuplicateDOI(input: { clientId: string; libraryId: number; doi: string }, signal?: AbortSignal): Promise<NativeItemSnapshot[]>;
  inspectItem(input: NativeItemRef, signal?: AbortSignal): Promise<NativeItemSnapshot | null>;
  inspectAttachment(input: NativeItemRef, signal?: AbortSignal): Promise<NativeAttachmentSnapshot | null>;
}

/**
 * Native write boundary. It extends the read port because every action first re-reads and re-checks
 * the exact state it is about to change. Approval, durable intent, reconciliation and batch
 * scheduling live above it, in `core/tasks`.
 */
export interface NativeActionPort extends NativeReaderPort {
  createAnnotation(input: NativeAnnotationCreate, signal?: AbortSignal): Promise<NativeAnnotationSnapshot>;
  deleteAnnotation(input: { expected: NativeAnnotationSnapshot }, signal?: AbortSignal): Promise<NativeAnnotationDeleteResult>;
  createItem(input: { target: NativeCollectionTarget; key: string; metadata: NativeMetadata }, signal?: AbortSignal): Promise<NativeItemSnapshot>;
  addItemToCollection(input: { expected: NativeItemSnapshot; target: NativeCollectionTarget }, signal?: AbortSignal): Promise<NativeCollectionAddition>;
  undoCollectionAddition(input: { expected: NativeCollectionAddition }, signal?: AbortSignal): Promise<{ status: 'removed' | 'absent' | 'conflict' }>;
  undoCreatedItem(input: { expected: NativeItemSnapshot; attachments: NativeAttachmentSnapshot[] }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  undoAttachment(input: { expected: NativeAttachmentSnapshot }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  acquireOpenAccessPDF(input: { item: NativeItemSnapshot }, signal?: AbortSignal): Promise<NativeAcquisitionResult>;
}
export type NativeOperationErrorCode = 'INVALID_INPUT' | 'SOURCE_CHANGED' | 'NOT_FOUND' | 'NOT_EDITABLE' | 'CONFLICT' | 'CANCELLED' | 'UNAVAILABLE' | 'WRITE_UNCERTAIN';
export class NativeOperationError extends Error {
  constructor(readonly code: NativeOperationErrorCode, message: string) { super(message); this.name = 'NativeOperationError'; }
}
