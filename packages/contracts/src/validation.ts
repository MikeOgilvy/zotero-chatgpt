import { ReaderError, type Citation, type GenerationSettings, type PaperScope, type Rect, type SendInput } from './index.ts';
// Limits are first-version engineering choices from the contracts appendix.
export const LIMITS = { payloadBytes: 256 * 1024, citationCodePoints: 8000, citationsPerRequest: 4, questionCodePoints: 4000, titleChars: 1024, authors: 50, authorChars: 256, rectsPerPage: 512 } as const;
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
  const citation = record(value, ['id', 'paper', 'text', 'title', 'authors', 'year', 'doi', 'pageLabel', 'positions', 'capturedAt', 'contextScope', 'sourceRevision'], 'citation');
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
  return result;
}
export function validateSettings(value: unknown): GenerationSettings {
  const settings = record(value, ['model', 'serviceTier', 'effort'], 'settings');
  if (!('serviceTier' in settings) || !('effort' in settings)) invalid('settings must state serviceTier and effort');
  const tier = settings.serviceTier === null ? null : text(settings.serviceTier, 'settings.serviceTier', 64, 1);
  const effort = settings.effort === null ? null : text(settings.effort, 'settings.effort', 64, 1);
  return { model: text(settings.model, 'settings.model', 128, 1), serviceTier: tier, effort };
}
/** Returns a checked copy or throws a ReaderError carrying INVALID_REQUEST or PAYLOAD_TOO_LARGE. */
export function validateSendInput(value: unknown): SendInput {
  let serialized: string;
  try { serialized = JSON.stringify(value) ?? ''; } catch { invalid('request is not serializable'); }
  if (new TextEncoder().encode(serialized).length > LIMITS.payloadBytes) throw new ReaderError('PAYLOAD_TOO_LARGE', 'The request is larger than the reader accepts; select less text.');
  const input = record(value, ['requestId', 'conversationId', 'action', 'question', 'citations', 'settings'], 'request');
  if (input.action !== 'explain' && input.action !== 'ask') invalid('request.action must be explain or ask');
  if (!Array.isArray(input.citations) || input.citations.length > LIMITS.citationsPerRequest) invalid('request.citations is out of range');
  const question = text(input.question, 'request.question', LIMITS.questionCodePoints);
  if (input.action === 'explain' && input.citations.length === 0) invalid('explain requires at least one citation');
  if (input.action === 'ask' && question.trim().length === 0) invalid('ask requires a question');
  const citations = input.citations.map(validateCitation);
  if (new Set(citations.map(c => c.id)).size !== citations.length) invalid('request.citations repeat an identifier');
  return { requestId: uuid(input.requestId, 'request.requestId'), conversationId: uuid(input.conversationId, 'request.conversationId'), action: input.action, question, citations, settings: validateSettings(input.settings) };
}
