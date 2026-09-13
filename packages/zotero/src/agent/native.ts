import { clone } from '../../../contracts/src/clone.ts';
import { NATIVE_ANNOTATION_PROVENANCE, NativeAgentError, type NativeAcquisitionResult, type NativeAgentPort, type NativeAnnotationCandidate, type NativeAnnotationPosition, type NativeAnnotationSnapshot, type NativeCreator, type NativeItemRef, type NativeItemSnapshot, type NativeMetadata } from '../../../contracts/src/agent.ts';
import type { DocumentRevision, PaperScope, Rect } from '../../../contracts/src/index.ts';
import { nativeDocumentSource } from '../reader/document.ts';
import type { ZoteroHost } from '../reader/host-types.ts';
import { lineRects } from '../reader/locate.ts';
import type { AgentDocumentSource, AgentEnvironment, AgentHostItem, AgentHTTPOptions, AgentHTTPResponse, AgentPageChar, NativeAgentHost } from './host.ts';

export interface NativeAgentOptions {
  clientId: string;
  zotero: NativeAgentHost;
  captureDocument?(paper: PaperScope, signal?: AbortSignal): Promise<AgentDocumentSource>;
  environment?: AgentEnvironment;
}
const KEY = /^[A-Z0-9]{8}$/u;
const TYPES = new Set(['journalArticle', 'conferencePaper', 'preprint', 'book', 'bookSection', 'report', 'thesis', 'webpage']);
const FIELDS = ['DOI', 'url', 'date', 'publicationTitle', 'bookTitle', 'conferenceName', 'volume', 'issue', 'pages', 'publisher', 'place', 'ISBN', 'abstractNote', 'language'] as const;
const AI_PREFIX = NATIVE_ANNOTATION_PROVENANCE;
const MAX_PAGES = 256;
const MAX_TEXT = 2_000_000;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
function fail(code: ConstructorParameters<typeof NativeAgentError>[0], message: string): never { throw new NativeAgentError(code, message); }
function checkSignal(signal?: AbortSignal): void { if (signal?.aborted) fail('CANCELLED', 'Task cancelled before the next native operation.'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT', 'Expected a structured native task input.'); return value as Record<string, unknown>; }
function string(value: unknown, max = 8192): string { if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail('INVALID_INPUT', 'Invalid native task text.'); return value.trim().normalize('NFC'); }
function key(value: unknown): string { if (typeof value !== 'string' || !KEY.test(value)) fail('INVALID_INPUT', 'Invalid reserved Zotero key.'); return value; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
function revisionMatches(expected: DocumentRevision, actual: DocumentRevision): boolean {
  return expected.fingerprint === actual.fingerprint && expected.size === actual.size && expected.modifiedAt === actual.modifiedAt
    && (!('sha256' in expected) || expected.sha256 === (actual as DocumentRevision & { sha256?: string }).sha256);
}
function normalizedText(value: string): string { return value.normalize('NFC').replace(/\s+/gu, ' ').trim(); }
function normalizedTitle(value: string): string { return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function publicURL(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return null;
    if (/^(?:0|10|127)\./u.test(host) || /^169\.254\./u.test(host) || /^192\.168\./u.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./u.test(host) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./u.test(host) || /^2(?:2[4-9]|[3-5]\d)\./u.test(host) || host.includes(':')) return null;
    return url.href;
  } catch { return null; }
}
function rect(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1_000_000)) return null;
  const [x1, y1, x2, y2] = value as Rect;
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}
function position(value: unknown): NativeAnnotationPosition {
  const p = object(value);
  if (!Number.isSafeInteger(p.pageIndex) || (p.pageIndex as number) < 0 || !Array.isArray(p.rects) || !p.rects.length || p.rects.length > 1000) fail('INVALID_INPUT', 'Invalid annotation position.');
  const parseRects = (values: unknown[]): Rect[] => values.map(value => rect(value) ?? fail('INVALID_INPUT', 'Invalid annotation rectangle.'));
  const result: NativeAnnotationPosition = { pageIndex: p.pageIndex as number, rects: parseRects(p.rects) };
  if (p.nextPageRects !== undefined) {
    if (!Array.isArray(p.nextPageRects) || !p.nextPageRects.length || p.nextPageRects.length > 1000) fail('INVALID_INPUT', 'Invalid second-page annotation position.');
    result.nextPageRects = parseRects(p.nextPageRects);
  }
  return result;
}
async function waitRead<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkSignal(signal); if (!signal) return work;
  let abort = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(new NativeAgentError('CANCELLED', 'Task cancelled before the next native operation.')); signal.addEventListener('abort', abort, { once: true }); })]); }
  finally { signal.removeEventListener('abort', abort); }
}
async function boundary<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) { if (error instanceof NativeAgentError) throw error; fail('UNAVAILABLE', 'The native operation could not be completed.'); }
}
function nativeEnvironment(): AgentEnvironment {
  const native = globalThis as unknown as { IOUtils: Omit<AgentEnvironment, 'join'>; PathUtils: Pick<AgentEnvironment, 'join'> };
  return { join: (...parts) => native.PathUtils.join(...parts), stat: path => native.IOUtils.stat(path), read: path => native.IOUtils.read(path), remove: (path, options) => native.IOUtils.remove(path, options), computeHexDigest: (path, algorithm) => native.IOUtils.computeHexDigest(path, algorithm) };
}

/** Native methods only; no script execution, approval state, task ledger or model-selected paths. */
export function createNativeAgentPort(options: NativeAgentOptions): NativeAgentPort {
  const z = options.zotero; const environment = options.environment ?? nativeEnvironment();
  const readURL = async (url: string, signal?: AbortSignal, path?: string): Promise<AgentHTTPResponse> => {
    let current = publicURL(url);
    for (let redirects = 0; redirects < 6; redirects++) {
      if (!current) fail('INVALID_INPUT', 'The requested URL is outside the permitted web scope.');
      const requested = current;
      const response = await requestWithSignal(signal, options => path
        ? z.HTTP.download(requested, path, { ...options, followRedirects: false })
        // Zotero HTTP also follows HTML meta refreshes; numRedirects=3 disables that branch.
        : z.HTTP.request('GET', requested, { ...options, responseType: 'document', followRedirects: false, numRedirects: 3 }));
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.getResponseHeader?.('Location');
        current = location ? publicURL(new URL(location, requested).href) : null;
        continue;
      }
      if (response.status < 200 || response.status >= 300) fail('UNAVAILABLE', 'The web request did not return a successful response.');
      const finalURL = publicURL(response.responseURL || requested); if (!finalURL) fail('INVALID_INPUT', 'The response URL is outside the permitted web scope.');
      return { response: response.response, status: response.status, responseURL: finalURL };
    }
    fail('UNAVAILABLE', 'The article link redirected too many times.');
  };
  const scope = (value: { clientId: string; libraryId: number }) => {
    if (value.clientId !== options.clientId || !Number.isSafeInteger(value.libraryId) || value.libraryId < 1 || !z.Libraries.get(value.libraryId)) fail('INVALID_INPUT', 'The native task belongs to another profile or library.');
  };
  const paper = (value: PaperScope): AgentHostItem => {
    scope(value); key(value.attachmentKey);
    const item = z.Items.getByLibraryAndKey(value.libraryId, value.attachmentKey);
    if (!item || item.deleted || !item.isPDFAttachment()) fail('NOT_FOUND', 'The task PDF is no longer available.');
    return item;
  };
  const capture = options.captureDocument ? (p: PaperScope, signal?: AbortSignal) => options.captureDocument!(p, signal) : ((p: PaperScope, signal?: AbortSignal) => {
    const source = nativeDocumentSource(z as unknown as ZoteroHost, () => z.Reader._readers.find(r => { const item = z.Items.get(r.itemID); return item && item.key === p.attachmentKey && item.libraryID === p.libraryId; }), p);
    // The native wrapper retains the full GetPageData response, including chars and viewBox.
    return source.capture(signal) as unknown as Promise<AgentDocumentSource>;
  });
  const cleanDOI = (value: string): string => { const doi = z.Utilities.cleanDOI(value); return doi ? doi.toLowerCase() : ''; };
  const readMetadata = (value: unknown, strict: boolean): NativeMetadata => {
    const raw = object(value);
    if (strict && Object.keys(raw).some(k => !['itemType', 'title', 'creators', ...FIELDS].includes(k))) fail('INVALID_INPUT', 'Metadata contains fields outside the approved import scope.');
    const type = string(raw.itemType); if (!TYPES.has(type)) fail('INVALID_INPUT', 'This item type is not supported for task imports.');
    const title = string(raw.title); if (!title) fail('INVALID_INPUT', 'Verified metadata must have a title.');
    if (raw.creators !== undefined && (!Array.isArray(raw.creators) || raw.creators.length > 100)) fail('INVALID_INPUT', 'Invalid metadata creators.');
    const creators: NativeCreator[] = [];
    for (const value of (raw.creators ?? []) as unknown[]) {
      const creator = object(value);
      if (strict && Object.keys(creator).some(k => !['creatorType', 'firstName', 'lastName', 'name'].includes(k))) fail('INVALID_INPUT', 'Invalid metadata creator fields.');
      if (creator.creatorType !== undefined && creator.creatorType !== 'author' && creator.creatorType !== 'editor') { if (strict) fail('INVALID_INPUT', 'Unsupported creator role.'); continue; }
      const c: NativeCreator = { creatorType: creator.creatorType === 'editor' ? 'editor' : 'author' };
      if (creator.name) c.name = string(creator.name, 512);
      else { if (creator.firstName) c.firstName = string(creator.firstName, 512); if (creator.lastName) c.lastName = string(creator.lastName, 512); }
      if (c.name || c.lastName) creators.push(c);
    }
    const result: NativeMetadata = { itemType: type as NativeMetadata['itemType'], title, creators };
    for (const field of FIELDS) {
      if (raw[field] === undefined || raw[field] === '') continue;
      const value = string(raw[field], field === 'abstractNote' ? 32768 : 8192);
      if (!value) continue;
      if (field === 'DOI') { const doi = cleanDOI(value); if (!doi) { if (strict) fail('INVALID_INPUT', 'Invalid metadata DOI.'); continue; } result.DOI = doi; }
      else if (field === 'url') { const url = publicURL(value); if (!url) { if (strict) fail('INVALID_INPUT', 'Invalid metadata URL.'); continue; } result.url = url; }
      else result[field] = value;
    }
    return result;
  };
  const itemSnapshot = (item: AgentHostItem): NativeItemSnapshot => {
    const raw: Record<string, unknown> = { itemType: item.itemType, title: item.getField('title'), creators: item.getCreatorsJSON() };
    for (const field of FIELDS) { const value = item.getField(field); if (value) raw[field] = value; }
    return { clientId: options.clientId, libraryId: item.libraryID, key: item.key, metadata: readMetadata(raw, false),
      collectionKeys: item.getCollections().map(id => z.Collections.get(id)).filter(c => !!c).map(c => c.key).sort(),
      attachmentKeys: item.getAttachments().map(id => z.Items.get(id)).filter(i => !!i).map(i => i.key).sort(), dateModified: item.dateModified, contentSignature: canonical(item.toJSON()) };
  };
  const getItem = (ref: NativeItemRef): AgentHostItem | null => { scope(ref); key(ref.key); const item = z.Items.getByLibraryAndKey(ref.libraryId, ref.key); return item && !item.deleted && item.isRegularItem() ? item : null; };
  const annotationSnapshot = (p: PaperScope, item: AgentHostItem): NativeAnnotationSnapshot | null => {
    const parent = paper(p);
    if (item.deleted || !item.isAnnotation() || item.parentID !== parent.id || !['highlight', 'underline'].includes(item.annotationType)) return null;
    return { paper: clone(p), key: item.key, type: item.annotationType as 'highlight' | 'underline', text: item.annotationText ?? '', comment: item.annotationComment ?? '', color: item.annotationColor ?? '', pageLabel: item.annotationPageLabel ?? '', sortIndex: item.annotationSortIndex ?? '', position: position(JSON.parse(item.annotationPosition ?? '{}')), authorName: item.annotationAuthorName ?? '', isExternal: item.annotationIsExternal, tags: item.getTags().map(t => t.tag).sort(), dateModified: item.dateModified };
  };
  const inspectAnnotation: NativeAgentPort['inspectAnnotation'] = (input, signal) => boundary(async () => {
    checkSignal(signal); paper(input.paper); key(input.key);
    const item = z.Items.getByLibraryAndKey(input.paper.libraryId, input.key); if (!item) return null;
    await item.loadAllData?.(); checkSignal(signal); return annotationSnapshot(input.paper, item);
  });
  const resolveQuote: NativeAgentPort['resolveQuote'] = (value, signal) => boundary(async () => {
    checkSignal(signal); const input = clone(value); paper(input.paper);
    const quote = normalizedText(string(input.quote, 16000)); if (quote.length < 2) fail('INVALID_INPUT', 'Choose a nonempty original passage for annotation.');
    const source = await waitRead(capture(input.paper, signal), signal);
    if (!revisionMatches(input.revision, source.revision)) fail('SOURCE_CHANGED', 'The PDF changed after the task was prepared.');
    const total = source.pdf.numPages;
    if (!Number.isSafeInteger(total) || total < 1 || total > 10000) fail('UNAVAILABLE', 'The PDF page count is unavailable.');
    if (input.pageIndexes !== undefined && (!Array.isArray(input.pageIndexes) || !input.pageIndexes.length || input.pageIndexes.some(n => !Number.isSafeInteger(n) || n < 0 || n >= total))) fail('INVALID_INPUT', 'Choose valid physical PDF pages.');
    const indexes = input.pageIndexes ? [...new Set(input.pageIndexes)].sort((a, b) => a - b) : Array.from({ length: total }, (_, i) => i);
    if (indexes.length > MAX_PAGES) return { status: 'unresolved', reason: 'range-required' };
    const labels = await waitRead(source.pdf.getPageLabels2(), signal);
    const pages = new Map<number, { chars: AgentPageChar[]; viewBox: number[] }>();
    const offsets: Array<{ pageIndex: number; charIndex: number; glyph: boolean }> = []; let text = ''; let previousPage = -2;
    const append = (value: string, pageIndex: number, charIndex: number, glyph = false) => {
      for (const c of value.normalize('NFC')) {
        const normalized = /\s/u.test(c) ? ' ' : c;
        if (normalized === ' ' && (!text || text.endsWith(' '))) continue;
        text += normalized; for (let i = 0; i < normalized.length; i++) offsets.push({ pageIndex, charIndex, glyph });
      }
    };
    for (const pageIndex of indexes) {
      checkSignal(signal);
      let page;
      try { page = await waitRead(source.pdf.getPageData({ pageIndex }), signal); } catch (error) { if (error instanceof NativeAgentError) throw error; return { status: 'unresolved', reason: 'incomplete-text' }; }
      if (page.partial || !Array.isArray(page.chars)) return { status: 'unresolved', reason: 'incomplete-text' };
      pages.set(pageIndex, page);
      if (previousPage !== -2) append(previousPage + 1 === pageIndex ? ' ' : '\u0000', pageIndex, 0);
      for (let charIndex = 0; charIndex < page.chars.length; charIndex++) {
        const char = page.chars[charIndex]!; if (typeof char.c !== 'string' || char.c.length > 64) return { status: 'unresolved', reason: 'incomplete-text' };
        if (!char.ignorable) { append(char.c, pageIndex, charIndex, true); if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) append(' ', pageIndex, charIndex); }
        if (text.length > MAX_TEXT) return { status: 'unresolved', reason: 'range-required' };
      }
      previousPage = pageIndex;
      if (text.length > MAX_TEXT) return { status: 'unresolved', reason: 'range-required' };
    }
    const matches: number[] = []; let from = 0;
    while (from < text.length) { const at = text.indexOf(quote, from); if (at < 0) break; matches.push(at); from = at + 1; }
    if (!matches.length) return { status: 'unresolved', reason: 'not-found' };
    if (matches.length > 1) return { status: 'ambiguous', matches: matches.length };
    const start = offsets[matches[0]!]!; const end = offsets[matches[0]! + quote.length - 1]!;
    const sameGlyph = (a: typeof start | undefined, b: typeof start) => a?.glyph && b.glyph && a.pageIndex === b.pageIndex && a.charIndex === b.charIndex;
    if (sameGlyph(offsets[matches[0]! - 1], start) || sameGlyph(offsets[matches[0]! + quote.length], end)) return { status: 'unresolved', reason: 'invalid-geometry' };
    if (end.pageIndex - start.pageIndex > 1) return { status: 'unresolved', reason: 'unsupported-span' };
    const selected: Array<{ pageIndex: number; rects: Rect[] }> = [];
    for (let pageIndex = start.pageIndex; pageIndex <= end.pageIndex; pageIndex++) {
      const page = pages.get(pageIndex); if (!page) return { status: 'unresolved', reason: 'unsupported-span' };
      const chars = page.chars.slice(pageIndex === start.pageIndex ? start.charIndex : 0, pageIndex === end.pageIndex ? end.charIndex + 1 : undefined);
      if (chars.some(c => c.isolated) && chars.some(c => !c.isolated && !c.ignorable)) return { status: 'unresolved', reason: 'invalid-geometry' };
      const rects = lineRects(chars, page.viewBox); if (!rects?.length) return { status: 'unresolved', reason: 'invalid-geometry' };
      selected.push({ pageIndex, rects });
    }
    const first = selected[0]!; const page = pages.get(first.pageIndex)!; const top = Math.max(0, page.viewBox[3]! - page.viewBox[1]! - Math.max(...first.rects.map(r => r[3])));
    if (start.charIndex > 999999 || top > 99999) return { status: 'unresolved', reason: 'invalid-geometry' };
    const resolvedPosition: NativeAnnotationPosition = { pageIndex: first.pageIndex, rects: first.rects };
    if (selected[1]) resolvedPosition.nextPageRects = selected[1].rects;
    const candidate: NativeAnnotationCandidate = { source: input, text: quote, pageLabel: labels?.[first.pageIndex] || String(first.pageIndex + 1), position: resolvedPosition, sortIndex: `${String(first.pageIndex).padStart(5, '0')}|${String(start.charIndex).padStart(6, '0')}|${String(Math.floor(top)).padStart(5, '0')}` };
    const fresh = await waitRead(capture(input.paper, signal), signal);
    if (!revisionMatches(input.revision, fresh.revision)) fail('SOURCE_CHANGED', 'The PDF changed during quote validation.');
    return { status: 'resolved', candidate };
  });
  const findDuplicateDOI: NativeAgentPort['findDuplicateDOI'] = (input, signal) => boundary(async () => {
    checkSignal(signal); scope(input); const doi = cleanDOI(string(input.doi)); if (!doi) fail('INVALID_INPUT', 'A valid DOI is required for duplicate lookup.');
    const search = new z.Search(); search.libraryID = input.libraryId;
    search.addCondition('joinMode', 'any'); search.addCondition('DOI', 'contains', doi); search.addCondition('extra', 'contains', doi);
    const ids = await waitRead(search.search(), signal); if (ids.length > 1000) fail('UNAVAILABLE', 'Duplicate lookup returned too many candidates.');
    const results: NativeItemSnapshot[] = [];
    for (const id of ids) { const item = await z.Items.getAsync(id); await item.loadAllData?.(); checkSignal(signal); if (item.libraryID !== input.libraryId || item.deleted || !item.isRegularItem()) continue; const existing = item.getField('DOI') || item.getExtraField?.('DOI') || ''; if (cleanDOI(existing) === doi) results.push(itemSnapshot(item)); }
    return results;
  });
  const inspectItem: NativeAgentPort['inspectItem'] = (input, signal) => boundary(async () => { checkSignal(signal); const item = getItem(input); if (!item) return null; await item.loadAllData?.(); checkSignal(signal); return itemSnapshot(item); });
  const inspectAttachment: NativeAgentPort['inspectAttachment'] = (input, signal) => boundary(async () => {
    checkSignal(signal); scope(input); key(input.key);
    const attachment = z.Items.getByLibraryAndKey(input.libraryId, input.key);
    if (!attachment || attachment.deleted || !attachment.isPDFAttachment() || !attachment.parentID) return null;
    await attachment.loadAllData?.(); const parent = z.Items.get(attachment.parentID); if (!parent || parent.deleted) return null;
    const path = await attachment.getFilePathAsync(); if (!path) fail('UNAVAILABLE', 'The recorded PDF file is unavailable.');
    const sha256 = await environment.computeHexDigest(path, 'sha256'); checkSignal(signal);
    return { clientId: options.clientId, libraryId: attachment.libraryID, key: attachment.key, parentKey: parent.key, url: attachment.getField('url'), contentType: 'application/pdf', sha256, contentSignature: canonical(attachment.toJSON()) };
  });
  const port: NativeAgentPort = {
    resolveQuote, inspectAnnotation, findDuplicateDOI, inspectItem, inspectAttachment,
    createAnnotation: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); key(input.key); const attachment = paper(input.candidate.source.paper);
      if (!attachment.isEditable()) fail('NOT_EDITABLE', 'The task PDF does not allow annotation writes.');
      if (!['highlight', 'underline'].includes(input.type) || !/^#[0-9a-f]{6}$/u.test(input.color)) fail('INVALID_INPUT', 'Choose a valid native annotation style.');
      const comment = `${AI_PREFIX}${input.comment ? '\n' + string(input.comment, 8000) : ''}`;
      const existing = z.Items.getByLibraryAndKey(attachment.libraryID, input.key);
      if (existing) {
        const current = await inspectAnnotation({ paper: input.candidate.source.paper, key: input.key });
        if (input.reconcileWith && current && equal(current, input.reconcileWith) && current.type === input.type && current.color === input.color && current.comment === comment && current.text === input.candidate.text && equal(current.position, input.candidate.position)) return current;
        fail('CONFLICT', 'The reserved annotation key is already in use.');
      }
      if (input.reconcileWith) fail('CONFLICT', 'The earlier annotation output is missing; it was not recreated.');
      const resolved = await resolveQuote(input.candidate.source, signal);
      if (resolved.status !== 'resolved' || !equal(resolved.candidate, input.candidate)) fail('CONFLICT', 'The proposed annotation no longer matches the PDF.');
      checkSignal(signal);
      if (z.Items.getByLibraryAndKey(attachment.libraryID, input.key)) fail('CONFLICT', 'The reserved annotation key is already in use.');
      try {
        // saveFromJSON owns saveTx. An outer executeTransaction would deadlock in Zotero 9.0.6.
        const saved = await z.Annotations.saveFromJSON(attachment, { key: input.key, type: input.type, text: resolved.candidate.text, comment, color: input.color, pageLabel: resolved.candidate.pageLabel, sortIndex: resolved.candidate.sortIndex, position: resolved.candidate.position, isExternal: false, tags: [] }, { skipSelect: true });
        const snapshot = annotationSnapshot(input.candidate.source.paper, saved); if (snapshot) return snapshot;
      } catch { /* A DB commit may precede a notifier failure. Reconcile by the reserved key. */ }
      fail('WRITE_UNCERTAIN', 'Annotation save was not confirmed. Reconcile its reserved key before retrying.');
    }),
    deleteAnnotation: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); paper(expected.paper); key(expected.key);
      return z.DB.executeTransaction(async () => {
        checkSignal(signal); const item = z.Items.getByLibraryAndKey(expected.paper.libraryId, expected.key); if (!item) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal);
        const current = annotationSnapshot(expected.paper, item);
        if (!current || current.isExternal || !current.comment.startsWith(AI_PREFIX) || !item.isEditable() || !equal(current, expected)) return { status: 'conflict', current };
        try { await item.erase(); } catch { fail('WRITE_UNCERTAIN', 'Annotation removal was not confirmed. Reconcile its key before retrying.'); }
        return { status: 'deleted' };
      });
    }),
    previewMetadata: (value, signal) => boundary(async () => {
      checkSignal(signal); const identifier = string(value.identifier, 8192); if (!identifier) fail('INVALID_INPUT', 'Enter a DOI or a public article link.');
      const identifiers = z.Utilities.extractIdentifiers(identifier);
      if (identifiers.length > 1) fail('INVALID_INPUT', 'Preview one identifier at a time within the task list.');
      const cookieContext = z.HTTP.newCookieContext();
      try {
        const translator = identifiers.length ? new z.Translate.Search() : new z.Translate.Web();
        translator.setUserContextId(cookieContext.id);
        if (identifiers.length) (translator as InstanceType<NativeAgentHost['Translate']['Search']>).setIdentifier(identifiers[0]!);
        else {
          const url = publicURL(identifier); if (!url) fail('INVALID_INPUT', 'Enter a DOI or a public article link.');
          const response = await readURL(url, signal);
          if (!publicURL(response.responseURL)) fail('INVALID_INPUT', 'The article link redirected outside the permitted web scope.');
          (translator as InstanceType<NativeAgentHost['Translate']['Web']>).setDocument(response.response as Document);
        }
        // A multi-item page is a candidate list, not authority to expand collection scope.
        translator.setHandler('select', (_object, _items, done) => done({}));
        const translators = await waitRead(translator.getTranslators(), signal); if (!translators.length) return { identifier, source: identifiers.length ? 'identifier' : 'web', candidates: [] };
        translator.setTranslator(identifiers.length ? translators : translators[0]!);
        const results = await waitRead(translator.translate({ libraryID: false, saveAttachments: false }), signal);
        if (results.length > 20) fail('UNAVAILABLE', 'Metadata lookup returned too many candidates.');
        const candidates = results.map(result => readMetadata(result, false));
        const expectedDOI = identifiers[0]?.DOI && cleanDOI(identifiers[0].DOI);
        if (expectedDOI && candidates.some(c => c.DOI !== expectedDOI)) fail('CONFLICT', 'The returned metadata does not match the requested DOI.');
        return { identifier, source: identifiers.length ? 'identifier' : 'web', candidates };
      } finally { cookieContext.dispose(); }
    }),
    createItem: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); scope(input.target); key(input.key); key(input.target.collectionKey);
      const metadata = readMetadata(input.metadata, true);
      return z.DB.executeTransaction(async () => {
        checkSignal(signal);
        const collection = z.Collections.getByLibraryAndKey(input.target.libraryId, input.target.collectionKey);
        if (!collection || collection.deleted || collection.libraryID !== input.target.libraryId) fail('NOT_FOUND', 'The approved target collection is no longer available.');
        if (!collection.isEditable() || !z.Libraries.get(input.target.libraryId)?.editable) fail('NOT_EDITABLE', 'The approved target collection is read-only.');
        if (z.Items.getByLibraryAndKey(input.target.libraryId, input.key)) fail('CONFLICT', 'The reserved item key is already in use.');
        if (metadata.DOI && (await findDuplicateDOI({ ...input.target, doi: metadata.DOI }, signal)).length) fail('CONFLICT', 'An item with this DOI already exists in the target library.');
        checkSignal(signal);
        const item = new z.Item(metadata.itemType); item.libraryID = input.target.libraryId; item.key = input.key; await item.loadPrimaryData(); checkSignal(signal); item.fromJSON(metadata); item.addToCollection(input.target.collectionKey);
        try { await item.save({ skipSelect: true }); return itemSnapshot(item); }
        catch { fail('WRITE_UNCERTAIN', 'Metadata save was not confirmed. Reconcile the reserved key before retrying.'); }
      });
    }),
    addItemToCollection: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); scope(input.target); key(input.target.collectionKey);
      if (input.target.clientId !== input.expected.clientId || input.target.libraryId !== input.expected.libraryId) fail('INVALID_INPUT', 'An existing item cannot be moved across libraries by this task.');
      return z.DB.executeTransaction(async () => {
        const item = getItem(input.expected); const collection = z.Collections.getByLibraryAndKey(input.target.libraryId, input.target.collectionKey);
        if (!item || !collection || collection.deleted) fail('NOT_FOUND', 'The existing item or target collection is unavailable.');
        await item.loadAllData?.(); checkSignal(signal);
        const before = itemSnapshot(item);
        if (!equal(before, input.expected)) fail('CONFLICT', 'The existing item changed before collection assignment.');
        if (!item.isEditable() || !collection.isEditable()) fail('NOT_EDITABLE', 'The existing item or target collection is read-only.');
        if (before.collectionKeys.includes(collection.key)) return { before, after: before, collectionKey: collection.key, added: false };
        item.addToCollection(collection.key);
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Collection assignment was not confirmed. Inspect the item before retrying.'); }
        return { before, after: itemSnapshot(item), collectionKey: collection.key, added: true };
      });
    }),
    undoCollectionAddition: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); key(expected.collectionKey);
      return z.DB.executeTransaction(async () => {
        const item = getItem(expected.after); if (!item || !expected.added) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal); const current = itemSnapshot(item);
        if (!current.collectionKeys.includes(expected.collectionKey)) return { status: 'absent' };
        if (!item.isEditable() || !equal(current, expected.after)) return { status: 'conflict' };
        item.removeFromCollection(expected.collectionKey);
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Collection removal was not confirmed. Inspect the item before retrying.'); }
        return { status: 'removed' };
      });
    }),
    undoCreatedItem: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); const item = getItem(input.expected); if (!item) return { status: 'absent' };
      await item.loadAllData?.(); checkSignal(signal);
      if (!equal(itemSnapshot(item), input.expected) || item.getNotes(true).length || !item.isEditable()) return { status: 'conflict' };
      if (!equal(input.expected.attachmentKeys, input.attachments.map(a => a.key).sort())) return { status: 'conflict' };
      for (const expected of input.attachments) {
        if (expected.clientId !== options.clientId || expected.libraryId !== item.libraryID || expected.parentKey !== item.key) return { status: 'conflict' };
        const attachment = z.Items.getByLibraryAndKey(item.libraryID, expected.key); if (!attachment || attachment.parentID !== item.id || !attachment.isPDFAttachment()) return { status: 'conflict' };
        await attachment.loadAllData?.(); checkSignal(signal);
        if (attachment.getAnnotations().length || canonical(attachment.toJSON()) !== expected.contentSignature) return { status: 'conflict' };
        const path = await attachment.getFilePathAsync(); if (!path || await environment.computeHexDigest(path, 'sha256') !== expected.sha256) return { status: 'conflict' };
      }
      return z.DB.executeTransaction(async () => {
        checkSignal(signal);
        if (!equal(itemSnapshot(item), input.expected) || item.getNotes(true).length) return { status: 'conflict' };
        for (const expected of input.attachments) { const attachment = z.Items.getByLibraryAndKey(item.libraryID, expected.key); if (!attachment || attachment.getAnnotations().length || canonical(attachment.toJSON()) !== expected.contentSignature) return { status: 'conflict' }; }
        // Native trash is reversible and retains all stored files. Never erase a parent item.
        item.deleted = true;
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Moving the created item to trash was not confirmed.'); }
        return { status: 'trashed' };
      });
    }),
    undoAttachment: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); const current = await inspectAttachment(expected, signal);
      if (!current) return { status: 'absent' };
      if (!equal(current, expected)) return { status: 'conflict' };
      return z.DB.executeTransaction(async () => {
        const attachment = z.Items.getByLibraryAndKey(expected.libraryId, expected.key); if (!attachment || attachment.deleted) return { status: 'absent' };
        await attachment.loadAllData?.(); checkSignal(signal);
        if (!attachment.isEditable() || attachment.getAnnotations().length || canonical(attachment.toJSON()) !== expected.contentSignature) return { status: 'conflict' };
        attachment.deleted = true;
        try { await attachment.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Moving the task PDF to trash was not confirmed.'); }
        return { status: 'trashed' };
      });
    }),
    acquireOpenAccessPDF: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.item); const item = getItem(expected);
      if (!item) fail('NOT_FOUND', 'The approved metadata item is no longer available.');
      await item.loadAllData?.(); checkSignal(signal);
      if (!equal(itemSnapshot(item), expected)) fail('CONFLICT', 'The metadata item changed before PDF acquisition.');
      if (!item.isEditable() || !z.Libraries.get(item.libraryID)?.filesEditable) fail('NOT_EDITABLE', 'The target library does not allow stored PDF attachments.');
      if (item.getAttachments().some(id => { const attachment = z.Items.get(id); return attachment && attachment.isPDFAttachment(); })) return { status: 'unavailable', reason: 'existing-pdf' };
      const doi = expected.metadata.DOI && cleanDOI(expected.metadata.DOI); if (!doi) return { status: 'unavailable', reason: 'no-doi' };
      const urls = await waitRead(z.Utilities.Internal.getOpenAccessPDFURLs(doi, { timeout: 15000 }), signal);
      const candidates = urls.slice(0, 6).map(row => ({ url: publicURL(row.url), version: row.version })).filter((row): row is { url: string; version: string | undefined } => !!row.url);
      if (!candidates.length) return { status: 'unavailable', reason: 'no-oa-candidate' };
      let result: NativeAcquisitionResult = { status: 'unavailable', reason: 'download-failed' };
      for (const candidate of candidates) {
        checkSignal(signal);
        const directory = (await z.Attachments.createTemporaryStorageDirectory()).path;
        const path = environment.join(directory, 'verified.pdf'); let writing = false;
        try {
          const response = await readURL(candidate.url, signal, path);
          if (!publicURL(response.responseURL)) continue;
          checkSignal(signal);
          const stat = await environment.stat(path);
          if (!Number.isSafeInteger(stat.size) || stat.size < 5 || stat.size > MAX_PDF_BYTES) { result = { status: 'unavailable', reason: 'file-too-large' }; continue; }
          if (await z.MIME.getMIMETypeFromFile(path) !== 'application/pdf') { result = { status: 'unavailable', reason: 'file-type-mismatch' }; continue; }
          const bytes = await environment.read(path); checkSignal(signal);
          const buf = new Uint8Array(bytes).buffer;
          // This verified host worker action accepts bytes without creating a library attachment.
          const data = object(await waitRead(z.PDFWorker._enqueue(() => z.PDFWorker._query('getFulltext', { buf, maxPages: 1 }, [buf]), false), signal));
          const text = typeof data.text === 'string' ? data.text : '';
          if (/\b(?:supplementary\s+(?:material|information|data|appendix)|supporting\s+information)\b/iu.test(text.slice(0, 1500))) { result = { status: 'uncertain', reason: 'supplementary' }; continue; }
          const title = normalizedTitle(expected.metadata.title); const matchedDOI = z.Utilities.extractIdentifiers(text).some(identifier => identifier.DOI && cleanDOI(identifier.DOI) === doi);
          if (title.length < 16 || !normalizedTitle(text).includes(title) || !matchedDOI || data.extractedPages !== 1 || !Number.isSafeInteger(data.totalPages) || (data.totalPages as number) < 1) { result = { status: 'uncertain', reason: 'identity-unconfirmed' }; continue; }
          const sha256 = await environment.computeHexDigest(path, 'sha256');
          if (!/^[a-f0-9]{64}$/u.test(sha256)) fail('UNAVAILABLE', 'PDF integrity could not be checked.');
          checkSignal(signal);
          if (!equal(itemSnapshot(item), expected)) fail('CONFLICT', 'The metadata item changed during PDF acquisition.');
          writing = true;
          const attachment = await z.Attachments.createURLAttachmentFromTemporaryStorageDirectory({ directory, filename: 'verified.pdf', libraryID: item.libraryID, parentItemID: item.id, title: candidate.version === 'acceptedVersion' ? 'Accepted version' : candidate.version === 'submittedVersion' ? 'Submitted version' : 'Full text', url: response.responseURL, contentType: 'application/pdf', saveOptions: { skipSelect: true } });
          return { status: 'attached', attachment: { clientId: options.clientId, libraryId: attachment.libraryID, key: attachment.key, parentKey: item.key, url: response.responseURL, contentType: 'application/pdf', sha256, contentSignature: canonical(attachment.toJSON()) }, articleVersion: candidate.version ?? 'unknown', checkedPages: 1, totalPages: data.totalPages as number };
        } catch (error) {
          if (writing) fail('WRITE_UNCERTAIN', 'The PDF attachment write was not confirmed. Inspect the parent item before retrying.');
          if (error instanceof NativeAgentError && ['CANCELLED', 'CONFLICT'].includes(error.code)) throw error;
          checkSignal(signal);
        } finally { await environment.remove(directory, { recursive: true, ignoreAbsent: true }); }
      }
      return result;
    }),
  };
  return port;
}

/** Lower-level host HTTP retains cancellation and anonymous options; Attachments.downloadFile drops them. */
async function requestWithSignal<T>(signal: AbortSignal | undefined, run: (options: AgentHTTPOptions) => Promise<T>): Promise<T> {
  checkSignal(signal); let cancel = () => {};
  const abort = () => cancel(); signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await run({ anon: true, timeout: 30000, errorDelayMax: 0, cancellerReceiver: callback => { cancel = callback; if (signal?.aborted) callback(); } });
    checkSignal(signal); return response;
  } catch (error) { checkSignal(signal); throw error; }
  finally { signal?.removeEventListener('abort', abort); }
}
