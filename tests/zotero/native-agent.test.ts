import { expect, it } from 'vitest';
import type { NativeAnnotationCandidate, NativeMetadata } from '../../packages/contracts/src/agent.ts';
import type { DocumentRevision } from '../../packages/contracts/src/index.ts';
import { createNativeAgentPort } from '../../packages/zotero/src/agent/native.ts';
import type { AgentDocumentSource, AgentEnvironment, AgentHostItem, NativeAgentHost } from '../../packages/zotero/src/agent/host.ts';
import { paperA } from '../contracts/factories.ts';

const revision: DocumentRevision = { fingerprint: 'synthetic', size: 1024, modifiedAt: 1000 };
const metadata: NativeMetadata = { itemType: 'journalArticle', title: 'A precise synthetic paper', DOI: '10.1234/example', creators: [{ creatorType: 'author', firstName: 'Ada', lastName: 'Example' }] };
const input = () => ({ paper: { ...paperA }, revision: { ...revision }, quote: 'Alpha beta' });
const target = { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' };
function fixture(pages = ['Alpha beta']) {
  const items = new Map<string, Item>(); let nextID = 10; let transaction = false;
  const downloaded: string[] = []; const removed: string[] = [];
  let translated: unknown[] = [{ ...metadata, attachments: [{ url: 'file:///private/unapproved.pdf' }], notes: [{ note: 'unapproved' }], tags: ['unapproved'], key: 'HOSTILE1', collections: ['HOSTILE2'] }];
  let firstPage = 'A precise synthetic paper\nDOI: 10.1234/example\nAbstract: original research.';
  let mime = 'application/pdf'; let downloadSize = 2048; let oaURLs = [{ url: 'https://repository.example/paper.pdf', version: 'acceptedVersion' }];
  const source: AgentDocumentSource = { revision: { ...revision }, pdf: {
    numPages: pages.length,
    getPageLabels2: () => Promise.resolve(pages.map((_, i) => i === 0 ? 'iv' : String(i + 1))),
    getPageData: ({ pageIndex }) => Promise.resolve({ viewBox: [0, 0, 612, 792], chars: [...pages[pageIndex]!].map((c, offset) => ({ c, offset, rect: [offset * 10, 700, offset * 10 + 10, 710], inlineRect: [offset * 10, 700, offset * 10 + 10, 710], lineBreakAfter: offset === pages[pageIndex]!.length - 1 })) }),
  } };
  class Item implements AgentHostItem {
    id = ++nextID; key = ''; libraryID = paperA.libraryId; parentID: number | null = null; deleted = false;
    dateModified = '2026-09-12 01:00:00'; itemType: string; data: Record<string, unknown> = {}; collections: number[] = []; attachments: number[] = []; editable = true; primaryLoaded = false;
    annotationType = ''; annotationText = ''; annotationComment = ''; annotationColor = ''; annotationPageLabel = ''; annotationSortIndex = ''; annotationPosition = ''; annotationAuthorName = ''; annotationIsExternal = false; attachmentContentType = '';
    constructor(type: string) { this.itemType = type; }
    isAnnotation() { return this.itemType === 'annotation'; }
    isRegularItem() { return !['attachment', 'annotation', 'note'].includes(this.itemType); }
    isPDFAttachment() { return this.itemType === 'attachment' && this.attachmentContentType === 'application/pdf'; }
    isEditable() { return this.editable; }
    getField(field: string) { return typeof this.data[field] === 'string' ? this.data[field] : ''; }
    getCreators() { return (this.data.creators ?? []) as NativeMetadata['creators']; }
    getCreatorsJSON() { return this.getCreators(); }
    getTags() { return []; }
    getCollections() { return [...this.collections]; }
    getAttachments() { return this.attachments.filter(id => !byID(id)?.deleted); }
    getNotes() { return []; }
    getAnnotations() { return [...items.values()].filter(item => item.parentID === this.id && item.isAnnotation()); }
    toJSON() { return { itemType: this.itemType, ...this.data, collections: this.collections, dateModified: this.dateModified }; }
    getFilePathAsync() { return Promise.resolve('/fixture/paper.pdf'); }
    loadPrimaryData() { this.primaryLoaded = true; return Promise.resolve(); }
    fromJSON(json: object) { if (this.key && !this.primaryLoaded) throw new Error('Reserved-key item primary data must be loaded'); this.data = structuredClone(json) as Record<string, unknown>; }
    addToCollection(key: string) { if (key !== 'COLLECT1') throw new Error('Wrong collection'); this.collections.push(1); }
    removeFromCollection(key: string) { if (key !== 'COLLECT1') throw new Error('Wrong collection'); this.collections = this.collections.filter(id => id !== 1); }
    save() { if (!transaction) throw new Error('Expected caller transaction'); items.set(this.key, this); return Promise.resolve(this.id); }
    erase() { if (!transaction) throw new Error('Expected caller transaction'); items.delete(this.key); return Promise.resolve(); }
  }
  const attachment = new Item('attachment'); attachment.key = paperA.attachmentKey; attachment.attachmentContentType = 'application/pdf'; items.set(attachment.key, attachment);
  const byID = (id: number) => [...items.values()].find(item => item.id === id);
  const collection = { id: 1, key: 'COLLECT1', libraryID: paperA.libraryId, deleted: false, isEditable: () => true };
  class Translator {
    identifier: object = {};
    getTranslators() { return Promise.resolve([{ translatorID: 'native-translator' }]); }
    setTranslator() {}
    setIdentifier(value: object) { this.identifier = value; }
    setDocument() {}
    setUserContextId() {}
    setHandler() {}
    translate(options: { libraryID: false; saveAttachments: false }) { if (options.libraryID !== false || options.saveAttachments !== false) throw new Error('Metadata preview attempted a save'); return Promise.resolve(structuredClone(translated)); }
  }
  const host: NativeAgentHost = {
    Item,
    Items: { getByLibraryAndKey: (lib, key) => { const item = items.get(key); return item?.libraryID === lib ? item : false; }, get: id => byID(id), getAsync: id => Promise.resolve(byID(id)!) },
    Collections: { getByLibraryAndKey: (lib, key) => lib === collection.libraryID && key === collection.key ? collection : false, get: id => id === collection.id ? collection : false },
    Libraries: { get: lib => lib === paperA.libraryId ? { editable: true, filesEditable: true } : undefined },
    DB: { executeTransaction: async callback => { if (transaction) throw new Error('Nested transaction would deadlock'); transaction = true; try { return await callback(); } finally { transaction = false; } } },
    Annotations: { saveFromJSON: (parent, raw) => host.DB.executeTransaction(async () => {
      const json = raw as Record<string, unknown>; const item = items.get(String(json.key)) ?? new Item('annotation');
      item.key = String(json.key); item.parentID = parent.id;
      for (const name of ['type', 'text', 'comment', 'color', 'pageLabel', 'sortIndex', 'authorName'] as const) {
        const value = typeof json[name] === 'string' ? json[name].trim().normalize() : '';
        Object.assign(item, { ['annotation' + name[0]!.toUpperCase() + name.slice(1)]: value });
      }
      item.annotationPosition = JSON.stringify(json.position); item.annotationIsExternal = Boolean(json.isExternal);
      await item.save(); return item;
    }) },
    Search: class {
      libraryID = 0; doi = '';
      addCondition(condition: string, _operator: string, value?: string) { if (condition === 'DOI') this.doi = value ?? ''; }
      search() { return Promise.resolve([...items.values()].filter(item => item.libraryID === this.libraryID && !item.deleted && item.isRegularItem() && item.getField('DOI').toLowerCase() === this.doi.toLowerCase()).map(item => item.id)); }
    },
    Reader: { _readers: [] },
    Utilities: { cleanDOI: value => /10\.\d{4,9}\/[^\s]+/i.exec(value)?.[0]?.replace(/[.,;]+$/, '') ?? false, extractIdentifiers: value => [...value.matchAll(/10\.\d{4,9}\/[^\s]+/gi)].map(match => ({ DOI: match[0].replace(/[.,;]+$/, '') })), Internal: { getOpenAccessPDFURLs: () => Promise.resolve(oaURLs) } },
    Translate: { Search: Translator, Web: Translator },
    HTTP: { newCookieContext: () => ({ id: 500, dispose() {} }), request: () => Promise.resolve({ response: {}, status: 200, responseURL: 'https://repository.example/paper' }), download: (url, _path, options) => { if (!options.anon) throw new Error('Expected anonymous download'); downloaded.push(url); return Promise.resolve({ response: {}, status: 200, responseURL: url }); } },
    MIME: { getMIMETypeFromFile: () => Promise.resolve(mime) },
    Attachments: { createTemporaryStorageDirectory: () => Promise.resolve({ path: '/fixture/owned-stage' }), createURLAttachmentFromTemporaryStorageDirectory: options => host.DB.executeTransaction(async () => {
      const item = new Item('attachment'); item.key = 'SAVEDPDF'; item.parentID = options.parentItemID; item.attachmentContentType = options.contentType; item.data.url = options.url;
      await item.save(); byID(options.parentItemID)!.attachments.push(item.id); return item;
    }) },
    PDFWorker: { _enqueue: callback => callback(), _query: () => Promise.resolve({ text: firstPage, extractedPages: 1, totalPages: 8 }) },
  };
  const environment: AgentEnvironment = { join: (...parts) => parts.join('/'), stat: () => Promise.resolve({ size: downloadSize }), read: () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45])), computeHexDigest: () => Promise.resolve('a'.repeat(64)), remove: path => { removed.push(path); return Promise.resolve(); } };
  const port = createNativeAgentPort({ clientId: paperA.clientId, zotero: host, captureDocument: () => Promise.resolve(source), environment });
  return { port, host, source, items, Item, attachment, downloaded, removed, setTranslated: (value: unknown[]) => { translated = value; }, setPDF: (text: string) => { firstPage = text; }, setMIME: (value: string) => { mime = value; }, setSize: (value: number) => { downloadSize = value; }, setOA: (value: typeof oaURLs) => { oaURLs = value; } };
}
async function candidate(f: ReturnType<typeof fixture>): Promise<NativeAnnotationCandidate> {
  const result = await f.port.resolveQuote(input()); if (result.status !== 'resolved') throw new Error('Quote was not resolved'); return result.candidate;
}
async function createPaper(f: ReturnType<typeof fixture>) { return f.port.createItem({ target, key: 'NEWITEM1', metadata }); }

it('resolves the unique real quote to native line rectangles and retains printed page labels', async () => {
  const f = fixture();
  const result = await f.port.resolveQuote({ ...input(), quote: 'Alpha   beta' });
  expect(result).toMatchObject({ status: 'resolved', candidate: { text: 'Alpha beta', pageLabel: 'iv', position: { pageIndex: 0, rects: [[0, 700, 100, 710]] }, sortIndex: '00000|000000|00082' } });
});
it('keeps repeated matches ambiguous and refuses partial extraction', async () => {
  const f = fixture(['Alpha beta Alpha beta']);
  expect(await f.port.resolveQuote(input())).toEqual({ status: 'ambiguous', matches: 2 });
  f.source.pdf.getPageData = () => Promise.resolve({ partial: true, viewBox: [0, 0, 612, 792], chars: [] });
  expect(await f.port.resolveQuote(input())).toEqual({ status: 'unresolved', reason: 'incomplete-text' });
});
it('supports a quote crossing exactly two adjacent pages without inventing a third page position', async () => {
  const f = fixture(['Alpha', 'beta']);
  expect(await f.port.resolveQuote(input())).toMatchObject({ status: 'resolved', candidate: { position: { pageIndex: 0, nextPageRects: [[0, 700, 40, 710]] } } });
});
it('rejects stale source revisions and a different profile before writing annotations', async () => {
  const f = fixture(); const c = await candidate(f); f.source.revision.size++;
  await expect(f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: '' })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  await expect(f.port.resolveQuote({ ...input(), paper: { ...paperA, clientId: 'other-profile' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(f.items.has('ANNOT001')).toBe(false);
});
it('rechecks candidate geometry instead of trusting a supplied annotation rectangle', async () => {
  const f = fixture(); const c = await candidate(f); c.position.rects = [[0, 0, 10, 10]];
  await expect(f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: '' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.items.has('ANNOT001')).toBe(false);
});
it('uses native save without nesting transactions and does not upsert an existing key', async () => {
  const f = fixture(); const c = await candidate(f);
  const saved = await f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: 'Method definition' });
  expect(saved).toMatchObject({ key: 'ANNOT001', text: 'Alpha beta', isExternal: false });
  expect(saved.comment).toContain('AI');
  const human = f.items.get('ANNOT001')!; human.annotationComment = 'Human correction';
  await expect(f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: 'overwrite' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(human.annotationComment).toBe('Human correction');
});
it('only reconciles a prior annotation write against an exact ledger snapshot', async () => {
  const f = fixture(); const c = await candidate(f); const create = { candidate: c, key: 'ANNOT001', type: 'underline' as const, color: '#ffd400', comment: '' };
  const saved = await f.port.createAnnotation(create);
  expect(await f.port.createAnnotation({ ...create, reconcileWith: saved })).toEqual(saved);
  f.items.get('ANNOT001')!.annotationColor = '#ff0000';
  await expect(f.port.createAnnotation({ ...create, reconcileWith: saved })).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('undo leaves a subsequent human edit intact even when dateModified has not advanced', async () => {
  const f = fixture(); const c = await candidate(f);
  const saved = await f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: '' });
  f.items.get('ANNOT001')!.annotationComment = 'Human correction in same second';
  expect(await f.port.deleteAnnotation({ expected: saved })).toMatchObject({ status: 'conflict' });
  expect(f.items.has('ANNOT001')).toBe(true);
});
it('undo deletes only its matching native annotation and preserves the PDF', async () => {
  const f = fixture(); const c = await candidate(f);
  const saved = await f.port.createAnnotation({ candidate: c, key: 'ANNOT001', type: 'highlight', color: '#ffd400', comment: '' });
  expect(await f.port.deleteAnnotation({ expected: saved })).toEqual({ status: 'deleted' });
  expect(await f.port.deleteAnnotation({ expected: saved })).toEqual({ status: 'absent' });
  expect(f.items.has(paperA.attachmentKey)).toBe(true);
});
it('metadata preview returns unsaved allowlisted fields and strips imported child objects', async () => {
  const f = fixture();
  const result = await f.port.previewMetadata({ identifier: 'https://doi.org/10.1234/example' });
  expect(result.candidates).toEqual([metadata]); expect(f.items.size).toBe(1);
});
it('creates only approved metadata in the frozen collection and rejects unapproved fields', async () => {
  const f = fixture(); const saved = await createPaper(f);
  expect(saved).toMatchObject({ key: 'NEWITEM1', metadata, collectionKeys: ['COLLECT1'], attachmentKeys: [] });
  expect(f.items.get('NEWITEM1')!.data).not.toHaveProperty('notes');
  await expect(f.port.createItem({ target, key: 'NEWITEM2', metadata: { ...metadata, notes: [{ note: 'unapproved' }] } as NativeMetadata })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  expect(f.items.has('NEWITEM2')).toBe(false);
});
it('checks DOI duplicates immediately before a new metadata write', async () => {
  const f = fixture(); await createPaper(f);
  expect(await f.port.findDuplicateDOI({ clientId: paperA.clientId, libraryId: paperA.libraryId, doi: 'https://doi.org/10.1234/EXAMPLE' })).toMatchObject([{ key: 'NEWITEM1' }]);
  await expect(f.port.createItem({ target, key: 'NEWITEM2', metadata })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(f.items.has('NEWITEM2')).toBe(false);
});
it('stops before native writes when cancellation was already requested', async () => {
  const f = fixture(); const abort = new AbortController(); abort.abort();
  await expect(f.port.createItem({ target, key: 'NEWITEM1', metadata }, abort.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(f.items.size).toBe(1);
});
it('attaches an OA file only after PDF parsing confirms the target title and DOI on its first page', async () => {
  const f = fixture(); const item = await createPaper(f);
  expect(await f.port.acquireOpenAccessPDF({ item })).toMatchObject({ status: 'attached', articleVersion: 'acceptedVersion', checkedPages: 1, totalPages: 8, attachment: { key: 'SAVEDPDF', parentKey: 'NEWITEM1', sha256: 'a'.repeat(64) } });
  expect(f.downloaded).toEqual(['https://repository.example/paper.pdf']);
});
it('retains correct metadata when the downloaded PDF belongs to a different article', async () => {
  const f = fixture(); const item = await createPaper(f); f.setPDF('A completely different paper\nDOI: 10.4321/wrong');
  expect(await f.port.acquireOpenAccessPDF({ item })).toEqual({ status: 'uncertain', reason: 'identity-unconfirmed' });
  expect(f.items.has('NEWITEM1')).toBe(true); expect(f.items.has('SAVEDPDF')).toBe(false); expect(f.removed).toEqual(['/fixture/owned-stage']);
});
it('rejects supplementary material even when it contains the matching paper title and DOI', async () => {
  const f = fixture(); const item = await createPaper(f); f.setPDF('Supporting information\nA precise synthetic paper\nDOI: 10.1234/example');
  expect(await f.port.acquireOpenAccessPDF({ item })).toEqual({ status: 'uncertain', reason: 'supplementary' });
  expect(f.items.has('SAVEDPDF')).toBe(false);
});
it('rejects login HTML and oversized files without adding an attachment', async () => {
  const f = fixture(); const item = await createPaper(f); f.setMIME('text/html');
  expect(await f.port.acquireOpenAccessPDF({ item })).toEqual({ status: 'unavailable', reason: 'file-type-mismatch' });
  f.setMIME('application/pdf'); f.setSize(100_000_000);
  expect(await f.port.acquireOpenAccessPDF({ item })).toEqual({ status: 'unavailable', reason: 'file-too-large' });
  expect(f.items.has('SAVEDPDF')).toBe(false);
});
it('does not fetch local or credential-bearing URLs from an OA resolver', async () => {
  const f = fixture(); const item = await createPaper(f); f.setOA([{ url: 'http://127.0.0.1/private.pdf', version: 'publishedVersion' }, { url: 'https://user:password@example.com/private.pdf', version: 'publishedVersion' }]);
  expect(await f.port.acquireOpenAccessPDF({ item })).toEqual({ status: 'unavailable', reason: 'no-oa-candidate' }); expect(f.downloaded).toEqual([]);
});
it('checks an OA HTTP redirect target before allowing another network request', async () => {
  const f = fixture(); const item = await createPaper(f); const requested: string[] = [];
  f.host.HTTP.download = (url, _path, options) => {
    requested.push(url);
    if (options.followRedirects !== false) requested.push('http://127.0.0.1/private.pdf');
    return Promise.resolve({ response: {}, status: 302, responseURL: url, getResponseHeader: () => 'http://127.0.0.1/private.pdf' });
  };
  expect(await f.port.acquireOpenAccessPDF({ item })).not.toMatchObject({ status: 'attached' });
  expect(requested).toEqual(['https://repository.example/paper.pdf']);
});
it('refuses a quote that begins in the middle of a single PDF glyph', async () => {
  const f = fixture();
  f.source.pdf.getPageData = () => Promise.resolve({ viewBox: [0, 0, 612, 792], chars: [{ c: 'ffi', rect: [0, 700, 10, 710], inlineRect: [0, 700, 10, 710] }] });
  expect(await f.port.resolveQuote({ ...input(), quote: 'fi' })).toEqual({ status: 'unresolved', reason: 'invalid-geometry' });
});
it('adds an existing duplicate to the approved collection without replacing its other metadata', async () => {
  const f = fixture(); const item = await createPaper(f); f.items.get(item.key)!.collections = [];
  const before = (await f.port.inspectItem(item))!;
  const addition = await f.port.addItemToCollection({ expected: before, target });
  expect(addition).toMatchObject({ added: true, after: { metadata, collectionKeys: ['COLLECT1'] } });
  expect(await f.port.undoCollectionAddition({ expected: addition })).toEqual({ status: 'removed' });
  expect(f.items.get(item.key)!.getCollections()).toEqual([]);
});
it('collection undo preserves a later human metadata edit', async () => {
  const f = fixture(); const item = await createPaper(f); f.items.get(item.key)!.collections = [];
  const addition = await f.port.addItemToCollection({ expected: (await f.port.inspectItem(item))!, target });
  f.items.get(item.key)!.data.extra = 'Human note';
  expect(await f.port.undoCollectionAddition({ expected: addition })).toEqual({ status: 'conflict' });
  expect(f.items.get(item.key)!.getCollections()).toEqual([1]);
});
it('undoing an untouched created item moves it to trash instead of deleting files', async () => {
  const f = fixture(); const item = await createPaper(f);
  expect(await f.port.undoCreatedItem({ expected: item, attachments: [] })).toEqual({ status: 'trashed' });
  expect(f.items.get(item.key)!.deleted).toBe(true); expect(f.removed).toEqual([]);
});
it('created-item undo refuses unrecorded children and edits outside displayed metadata', async () => {
  const f = fixture(); const item = await createPaper(f); f.items.get(item.key)!.data.extra = 'Human note';
  expect(await f.port.undoCreatedItem({ expected: item, attachments: [] })).toEqual({ status: 'conflict' });
  expect(f.items.get(item.key)!.deleted).toBe(false);
});
it('undoing an owned attachment keeps its existing parent item and preserves a subsequent native annotation', async () => {
  const f = fixture(); const item = await createPaper(f); const result = await f.port.acquireOpenAccessPDF({ item });
  if (result.status !== 'attached') throw new Error('Expected attachment');
  const human = new f.Item('annotation'); human.key = 'HUMANANN'; human.parentID = f.items.get(result.attachment.key)!.id; f.items.set(human.key, human);
  expect(await f.port.undoAttachment({ expected: result.attachment })).toEqual({ status: 'conflict' });
  expect(f.items.get(result.attachment.key)!.deleted).toBe(false);
  f.items.delete(human.key);
  expect(await f.port.undoAttachment({ expected: result.attachment })).toEqual({ status: 'trashed' });
  expect(f.items.get(item.key)!.deleted).toBe(false); expect(f.items.get(item.key)!.getAttachments()).toEqual([]); expect(await f.port.inspectAttachment(result.attachment)).toBeNull();
});
