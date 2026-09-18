import { ReaderError, type Citation, type GenerationSettings, type ImageAttachment, type PaperIdentity, type PaperScope, type Rect, type RequestMode, type SendInput } from './index.ts';
import { validateDocument, validateRevision } from './document.ts';
import { validateBatch, validateContextReport, validateReferenceInput, validateWorkflow } from './workspace-validation.ts';
// Limits are first-version engineering choices from the contracts appendix.
export const LIMITS = { payloadBytes: 256 * 1024, citationCodePoints: 8000, citationsPerRequest: 4, questionCodePoints: 4000, titleChars: 1024, authors: 50, authorChars: 256, rectsPerPage: 512, imagesPerRequest: 4, imageBytes: 2 * 1024 * 1024, metadataFieldChars: 512, abstractChars: 2048, metadataTags: 24, metadataTagChars: 128,
  /**
   * Bound on one reference's text snapshot, including `@chat` snapshots and text files attached by
   * the owner. It is deliberately the same bound the payload check uses, because reference text
   * travels inside the request body (`validateSendInput` strips `document`, not `references`), so a
   * larger attachment could not be sent anyway. An oversized file is refused, never truncated.
   */
  referenceTextBytes: 48 * 1024 } as const;
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/]+={0,2}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ATTACHMENT_KEY = /^[A-Z0-9]{8}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
function invalid(message: string): never { throw new ReaderError('INVALID_REQUEST', message); }
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!keys.includes(key)) invalid(`${label} has an unexpected field`);
  return object;
}
function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== 'string') invalid(`${label} must be text`);
  const length = [...value].length;
  if (length < min || length > max) invalid(`${label} length is out of range`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) invalid(`${label} contains control characters`);
  return value;
}
function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid(`${label} must be an identifier`);
  return value;
}
function optionalText(value: unknown, label: string, max: number): string | undefined {
  return value === undefined ? undefined : text(value, label, max, 1);
}
export function validatePaperScope(value: unknown): PaperScope {
  const paper = record(value, ['clientId', 'libraryId', 'attachmentKey'], 'paper');
  if (typeof paper.libraryId !== 'number' || !Number.isSafeInteger(paper.libraryId) || paper.libraryId < 0) invalid('paper.libraryId must be a non-negative integer');
  if (typeof paper.attachmentKey !== 'string' || !ATTACHMENT_KEY.test(paper.attachmentKey)) invalid('paper.attachmentKey must be a Zotero item key');
  return { clientId: uuid(paper.clientId, 'paper.clientId'), libraryId: paper.libraryId, attachmentKey: paper.attachmentKey };
}
function rect(value: unknown): Rect {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) invalid('citation rect must be four finite numbers');
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}
export function validateCitation(value: unknown): Citation {
  const citation = record(value, ['id', 'paper', 'text', 'title', 'authors', 'year', 'doi', 'pageLabel', 'positions', 'capturedAt', 'contextScope', 'sourceRevision', 'documentRevision'], 'citation');
  if (!Array.isArray(citation.authors) || citation.authors.length > LIMITS.authors) invalid('citation.authors is out of range');
  if (!Array.isArray(citation.positions) || citation.positions.length !== 1) invalid('citation must cover exactly one page');
  const position = record(citation.positions[0], ['pageIndex', 'rects'], 'citation.positions[0]');
  if (typeof position.pageIndex !== 'number' || !Number.isSafeInteger(position.pageIndex) || position.pageIndex < 0) invalid('citation page index must be a non-negative integer');
  if (!Array.isArray(position.rects) || position.rects.length === 0 || position.rects.length > LIMITS.rectsPerPage) invalid('citation rects are out of range');
  if (citation.contextScope !== 'selection') invalid('citation.contextScope must be selection');
  if (typeof citation.capturedAt !== 'string' || !ISO_DATE.test(citation.capturedAt)) invalid('citation.capturedAt must be an ISO 8601 UTC timestamp');
  const result: Citation = {
    id: uuid(citation.id, 'citation.id'),
    paper: validatePaperScope(citation.paper),
    text: text(citation.text, 'citation.text', LIMITS.citationCodePoints, 1),
    title: text(citation.title, 'citation.title', LIMITS.titleChars),
    authors: citation.authors.map(author => text(author, 'citation.authors[]', LIMITS.authorChars, 1)),
    pageLabel: text(citation.pageLabel, 'citation.pageLabel', 32),
    positions: [{ pageIndex: position.pageIndex, rects: position.rects.map(rect) }],
    capturedAt: citation.capturedAt,
    contextScope: 'selection',
  };
  const year = optionalText(citation.year, 'citation.year', 16); if (year !== undefined) result.year = year;
  const doi = optionalText(citation.doi, 'citation.doi', 256); if (doi !== undefined) result.doi = doi;
  if (citation.sourceRevision !== undefined) {
    const revision = record(citation.sourceRevision, ['size', 'modifiedAt'], 'citation.sourceRevision');
    if (typeof revision.size !== 'number' || !Number.isSafeInteger(revision.size) || revision.size < 0) invalid('citation.sourceRevision.size must be a non-negative integer');
    result.sourceRevision = { size: revision.size, modifiedAt: text(revision.modifiedAt, 'citation.sourceRevision.modifiedAt', 64, 1) };
  }
  if (citation.documentRevision !== undefined) result.documentRevision = validateRevision(citation.documentRevision);
  return result;
}
export function validateImageAttachment(value: unknown): ImageAttachment { return checkedImage(value, LIMITS.imageBytes); }
export function validateOutputImage(value: unknown): ImageAttachment { return checkedImage(value, 16 * 1024 * 1024); }
function checkedImage(value: unknown, maxBytes: number): ImageAttachment {
  const image = record(value, ['id', 'name', 'mime', 'dataUrl', 'origin'], 'image');
  const name = text(image.name, 'image.name', 256, 1);
  if (/[/\\]|\.\./u.test(name) || name.toLowerCase().endsWith('.pdf')) invalid('image.name must be a bare image filename');
  if (typeof image.mime !== 'string' || !IMAGE_MIME.includes(image.mime as typeof IMAGE_MIME[number])) invalid('image.mime must be png, jpeg, webp, or gif');
  if (typeof image.dataUrl !== 'string' || !DATA_URL.test(image.dataUrl)) invalid('image.dataUrl must be an inline data URL');
  const mime = image.mime as ImageAttachment['mime'];
  const matched = image.dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,/u);
  if (!matched || matched[1] !== mime) invalid('image.dataUrl MIME must match image.mime');
  const encoded = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const bytes = Math.floor(encoded.length * 3 / 4) - padding;
  if (bytes <= 0 || bytes > maxBytes) invalid('image is larger than the reader accepts');
  const result: ImageAttachment = { id: uuid(image.id, 'image.id'), name, mime, dataUrl: image.dataUrl };
  if (image.origin !== undefined) {
    const origin = record(image.origin, ['kind', 'model', 'paper', 'pageIndex', 'revision'], 'image.origin');
    if (origin.kind === 'generated') result.origin = { kind: 'generated', ...(origin.model !== undefined ? { model: text(origin.model, 'image model', 128, 1) } : {}) };
    else if (origin.kind === 'paper') {
      if (typeof origin.pageIndex !== 'number' || !Number.isSafeInteger(origin.pageIndex) || origin.pageIndex < 0) invalid('Invalid image page');
      result.origin = { kind: 'paper', paper: validatePaperScope(origin.paper), pageIndex: origin.pageIndex, revision: validateRevision(origin.revision) };
    } else invalid('Unknown image origin');
  }
  return result;
}
export function validateSettings(value: unknown): GenerationSettings {
  const settings = record(value, ['model', 'serviceTier', 'effort'], 'settings');
  if (!('serviceTier' in settings) || !('effort' in settings)) invalid('settings must state serviceTier and effort');
  const tier = settings.serviceTier === null ? null : text(settings.serviceTier, 'settings.serviceTier', 64, 1);
  const effort = settings.effort === null ? null : text(settings.effort, 'settings.effort', 64, 1);
  return { model: text(settings.model, 'settings.model', 128, 1), serviceTier: tier, effort };
}
/**
 * Request routing mode. Only the two explicit values are accepted. An absent mode is not rewritten
 * here: `validateSendInput` keeps it absent so a legacy request round-trips unchanged, and D3 fixes
 * its meaning as `'chat'` wherever it is consumed (hash input, presentation).
 */
function requestMode(value: unknown): RequestMode {
  if (value !== 'chat' && value !== 'agent') invalid('request.mode must be chat or agent');
  return value;
}
/** Returns a checked copy or throws a ReaderError carrying INVALID_REQUEST or PAYLOAD_TOO_LARGE. */
export function validateSendInput(value: unknown): SendInput {
  let withoutImages: unknown = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rest = { ...(value as Record<string, unknown>) };
    delete rest.images;
    delete rest.document;
    if (Array.isArray(rest.references)) rest.references = rest.references.map((ref: unknown) => { if (!ref || typeof ref !== 'object') return ref; const result = { ...(ref as Record<string, unknown>) }; delete result.document; return result; });
    withoutImages = rest;
  }
  let serialized: string;
  try { serialized = JSON.stringify(withoutImages) ?? ''; } catch { invalid('request is not serializable'); }
  if (new TextEncoder().encode(serialized).length > LIMITS.payloadBytes) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The request is larger than the reader accepts; select less text.');
  const input = record(value, ['requestId', 'conversationId', 'action', 'question', 'citations', 'settings', 'paper', 'images', 'document', 'workflow', 'references', 'batch', 'contextReport', 'mode'], 'request');
  if (input.action !== 'explain' && input.action !== 'ask') invalid('request.action must be explain or ask');
  if (!Array.isArray(input.citations) || input.citations.length > LIMITS.citationsPerRequest) invalid('request.citations is out of range');
  const question = text(input.question, 'request.question', LIMITS.questionCodePoints);
  if (input.action === 'explain' && input.citations.length === 0) invalid('explain requires at least one citation');
  if (input.action === 'ask' && question.trim().length === 0) invalid('ask requires a question');
  const citations = input.citations.map(validateCitation);
  if (new Set(citations.map(c => c.id)).size !== citations.length) invalid('request.citations repeat an identifier');
  const result: SendInput = { requestId: uuid(input.requestId, 'request.requestId'), conversationId: uuid(input.conversationId, 'request.conversationId'), action: input.action, question, citations, settings: validateSettings(input.settings), ...(input.mode !== undefined ? { mode: requestMode(input.mode) } : {}) };
  if (input.paper !== undefined) result.paper = validatePaperIdentity(input.paper);
  if (input.document !== undefined) result.document = validateDocument(input.document);
  if (input.workflow !== undefined) result.workflow = validateWorkflow(input.workflow);
  if (input.batch !== undefined) result.batch = validateBatch(input.batch);
  if (input.contextReport !== undefined) result.contextReport = validateContextReport(input.contextReport);
  if (input.references !== undefined) {
    if (!Array.isArray(input.references) || input.references.length > 16) invalid('Too many references');
    result.references = input.references.map(validateReferenceInput);
    if (new Set(result.references.map(ref => ref.id)).size !== result.references.length) invalid('Repeated reference identity');
  }
  if (input.images !== undefined) {
    if (!Array.isArray(input.images) || input.images.length > LIMITS.imagesPerRequest) invalid('request.images is out of range');
    const images = input.images.map(validateImageAttachment);
    if (new Set(images.map(image => image.id)).size !== images.length) invalid('request.images repeat an identifier');
    if (images.length) result.images = images;
  }
  return result;
}
/**
 * Checked copy of a paper identity. Optional bibliographic fields are only copied when the caller
 * provided them; a missing field stays missing so a rebuilt request hashes byte for byte the same
 * object. `tags: []` is preserved as an explicit empty array for the same reason.
 */
export function validatePaperIdentity(value: unknown): PaperIdentity {
  const paper = record(value, ['title', 'authors', 'year', 'doi', 'itemType', 'publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'university', 'institution', 'volume', 'issue', 'pages', 'publisher', 'isbn', 'issn', 'language', 'abstractNote', 'tags', 'editors'], 'request.paper');
  if (!Array.isArray(paper.authors) || paper.authors.length > LIMITS.authors) invalid('request.paper.authors is out of range');
  const result: PaperIdentity = {
    title: text(paper.title, 'request.paper.title', LIMITS.titleChars, 1),
    authors: paper.authors.map(author => text(author, 'request.paper.authors[]', LIMITS.authorChars, 1)),
  };
  const year = optionalText(paper.year, 'request.paper.year', 16); if (year !== undefined) result.year = year;
  const doi = optionalText(paper.doi, 'request.paper.doi', 256); if (doi !== undefined) result.doi = doi;
  // Zotero declared fields read from the host; all restricted to the metadata field limit (512).
  for (const key of ['itemType', 'publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'university', 'institution', 'volume', 'issue', 'pages', 'publisher', 'isbn', 'issn', 'language'] as const) {
    const field = optionalText(paper[key], `request.paper.${key}`, LIMITS.metadataFieldChars); if (field !== undefined) result[key] = field;
  }
  const abstractNote = optionalText(paper.abstractNote, 'request.paper.abstractNote', LIMITS.abstractChars); if (abstractNote !== undefined) result.abstractNote = abstractNote;
  if (paper.tags !== undefined) {
    if (!Array.isArray(paper.tags) || paper.tags.length > LIMITS.metadataTags) invalid('request.paper.tags is out of range');
    result.tags = paper.tags.map(tag => text(tag, 'request.paper.tags[]', LIMITS.metadataTagChars, 1));
  }
  if (paper.editors !== undefined) {
    if (!Array.isArray(paper.editors) || paper.editors.length > LIMITS.authors) invalid('request.paper.editors is out of range');
    result.editors = paper.editors.map(editor => text(editor, 'request.paper.editors[]', LIMITS.authorChars, 1));
  }
  return result;
}
