import { describe, expect, it } from 'vitest';
import { captureSelection, paperMetadata, type SelectionPopupEvent } from '../../packages/zotero/src/reader/selection.ts';
import { barPosition, selectionViewRect, type PageGeometry } from '../../packages/zotero/src/reader/selection-actions.ts';
import type { HostReader, ZoteroHost } from '../../packages/zotero/src/reader/host-types.ts';
import { validateCitation } from '../../packages/contracts/src/validation.ts';
import { paperA } from '../contracts/factories.ts';
const clock = { uuid: () => '7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d01', now: () => '2026-09-09T08:00:00.000Z' };
const metadata = { title: 'Synthetic Paper A', authors: ['Synthetic Author'], year: '2026', doi: '10.1000/synthetic' };
// Shapes mirror Zotero 9.0.6 reader.js:70462-70484 (annotation built from selection ranges).
const singlePage: SelectionPopupEvent = { reader: {} as HostReader, doc: {} as Document, append: () => undefined, params: { annotation: { type: 'highlight', color: undefined, sortIndex: '00003|000120|00500', pageLabel: 'iv', position: { pageIndex: 3, rects: [[72, 500.5, 300.25, 512], [72, 488, 210, 499.5]] }, text: '设先验分布为 p(θ)。' } } };
const crossPage: SelectionPopupEvent = { ...singlePage, params: { annotation: { ...singlePage.params.annotation!, position: { pageIndex: 3, rects: [[72, 500.5, 300.25, 512]], nextPageRects: [[72, 700, 300, 712]] }, text: '第三页结尾 第四页开头' } } };
describe('captureSelection', () => {
  it('copies text, page label, single page position and declared metadata into an immutable citation', () => {
    const citation = captureSelection(singlePage, paperA, metadata, clock);
    expect(citation).toMatchObject({ paper: paperA, text: '设先验分布为 p(θ)。', pageLabel: 'iv', title: 'Synthetic Paper A', authors: ['Synthetic Author'], year: '2026', doi: '10.1000/synthetic', contextScope: 'selection' });
    expect(citation.positions).toEqual([{ pageIndex: 3, rects: [[72, 500.5, 300.25, 512], [72, 488, 210, 499.5]] }]);
    expect(citation.positions[0]!.rects).not.toBe(singlePage.params.annotation!.position.rects);
    expect(() => validateCitation(citation)).not.toThrow();
  });
  it('rejects a selection the reader truncated across pages instead of trimming it', () => {
    expect(() => captureSelection(crossPage, paperA, metadata, clock)).toThrow(/一页|page/u);
  });
  it('copies rects by index so content-compartment array methods never run in chrome', () => {
    const deny = (name: string) => ({ value: () => { throw new Error(`must not call ${name}`); } });
    const one = Object.defineProperties([72, 500.5, 300.25, 512], { map: deny('map'), every: deny('every'), forEach: deny('forEach'), filter: deny('filter') });
    const rects = Object.defineProperties([one], { map: deny('map'), every: deny('every'), forEach: deny('forEach') });
    const event = { ...singlePage, params: { annotation: { ...singlePage.params.annotation!, position: { pageIndex: 3, rects } } } };
    expect(captureSelection(event, paperA, metadata, clock).positions[0]!.rects).toEqual([[72, 500.5, 300.25, 512]]);
  });
  it('rejects empty or missing selections and falls back to the page number when no label exists', () => {
    expect(() => captureSelection({ ...singlePage, params: {} }, paperA, metadata, clock)).toThrow();
    expect(() => captureSelection({ ...singlePage, params: { annotation: { ...singlePage.params.annotation!, text: '   ' } } }, paperA, metadata, clock)).toThrow();
    const noLabel = captureSelection({ ...singlePage, params: { annotation: { ...singlePage.params.annotation!, pageLabel: undefined } } }, paperA, metadata, clock);
    expect(noLabel.pageLabel).toBe('4');
  });
  it('reads paper metadata from the parent item when present and from the attachment otherwise', () => {
    const items = new Map<number, { key: string; libraryID: number; parentItemID?: number; getField(name: string): string; getCreators(): Array<{ firstName?: string; lastName?: string; name?: string }> }>();
    items.set(7, { key: 'PARENT01', libraryID: 1, getField: name => ({ title: 'Parent Title', date: '2024-05-01', DOI: '10.1/x' })[name] ?? '', getCreators: () => [{ firstName: 'Ada', lastName: 'Lovelace' }, { name: 'Consortium' }] });
    items.set(8, { key: 'PDFONE01', libraryID: 1, parentItemID: 7, getField: name => ({ title: 'attachment.pdf' })[name] ?? '', getCreators: () => [] });
    items.set(9, { key: 'PDFTWO02', libraryID: 1, getField: name => ({ title: 'Standalone.pdf' })[name] ?? '', getCreators: () => [] });
    const zotero = { Items: { get: (id: number) => items.get(id) } } as unknown as ZoteroHost;
    expect(paperMetadata(zotero, { itemID: 8 } as HostReader)).toEqual({ title: 'Parent Title', authors: ['Ada Lovelace', 'Consortium'], year: '2024', doi: '10.1/x' });
    expect(paperMetadata(zotero, { itemID: 9 } as HostReader)).toEqual({ title: 'Standalone.pdf', authors: [] });
    expect(paperMetadata(zotero, { itemID: 99 } as HostReader)).toBeUndefined();
  });
});
describe('paperMetadata bibliographic extraction', () => {
  type MockItem = { key: string; libraryID: number; parentItemID?: number; itemType?: string; getField(name: string): string; getCreators?(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>; getTags?(): Array<{ tag: string }> };
  function hostOf(items: MockItem[]) { const map = new Map(items.map((item, index) => [index + 1, item])); return { zotero: { Items: { get: (id: number) => map.get(id) } } as unknown as ZoteroHost, map }; }
  const parent: MockItem = {
    key: 'PARENT01', libraryID: 1, itemType: 'journalArticle',
    getField: name => ({ title: 'A Synthetic Study', date: '2024-05-01', DOI: '10.1000/synthetic', publicationTitle: 'Journal of Synthetic Results', journalAbbreviation: 'J. Synth. Res.', volume: '12', issue: '3', pages: '45-67', publisher: 'Synthetic Press', language: 'en', abstractNote: 'We study nothing.', ISSN: '1234-5678' })[name] ?? '',
    getCreators: () => [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }, { firstName: 'Grace', lastName: 'Hopper' }, { firstName: 'Ed', lastName: 'Editor', creatorType: 'editor' }, { firstName: 'Trans', lastName: 'Translator', creatorType: 'translator' }],
    getTags: () => [{ tag: 'synthetic' }, { tag: 'test' }],
  };
  const pdf: MockItem = { key: 'PDFONE01', libraryID: 1, parentItemID: 1, itemType: 'attachment', getField: name => (name === 'title' ? 'attachment.pdf' : ''), getCreators: () => [] };
  it('reads the verified Zotero fields from the parent, splitting authors from editors by creatorType', () => {
    const { zotero } = hostOf([parent, pdf]);
    expect(paperMetadata(zotero, { itemID: 2 } as HostReader)).toEqual({
      title: 'A Synthetic Study', authors: ['Ada Lovelace', 'Grace Hopper'], editors: ['Ed Editor'], year: '2024', doi: '10.1000/synthetic',
      itemType: 'journalArticle', publicationTitle: 'Journal of Synthetic Results', journalAbbreviation: 'J. Synth. Res.',
      volume: '12', issue: '3', pages: '45-67', publisher: 'Synthetic Press', issn: '1234-5678', language: 'en',
      abstractNote: 'We study nothing.', tags: ['synthetic', 'test'],
    });
  });
  it('omits a field the host refuses or leaves empty instead of fabricating one', () => {
    const defensive: MockItem = {
      key: 'PARENT02', libraryID: 1, itemType: 'book',
      getField: name => { if (name === 'volume') throw new Error('Unsupported field'); if (name === 'title') return 'A Book'; return ''; },
      getCreators: () => { throw new Error('Creator data unavailable'); },
      getTags: () => { throw new Error('Tag data unavailable'); },
    };
    const { zotero } = hostOf([defensive]);
    expect(paperMetadata(zotero, { itemID: 1 } as HostReader)).toEqual({ title: 'A Book', authors: [], itemType: 'book' });
  });
  it('never reports the attachment item type or a value the host did not declare', () => {
    const bare: MockItem = { key: 'PDFTWO02', libraryID: 1, itemType: 'attachment', getField: () => '' };
    const { zotero } = hostOf([bare]);
    expect(paperMetadata(zotero, { itemID: 1 } as HostReader)).toEqual({ title: '', authors: [] });
  });
  it('caps author, editor and tag lists to the contract limits', () => {
    const crowded: MockItem = {
      key: 'PARENT03', libraryID: 1, itemType: 'journalArticle', getField: name => (name === 'title' ? 'Crowded' : ''),
      getCreators: () => [...Array.from({ length: 55 }, (_, i) => ({ firstName: `Author${i}`, lastName: 'X', creatorType: 'author' })), ...Array.from({ length: 55 }, (_, i) => ({ firstName: `Editor${i}`, lastName: 'X', creatorType: 'editor' }))],
      getTags: () => Array.from({ length: 30 }, (_, i) => ({ tag: `tag-${i}-${'x'.repeat(200)}` })),
    };
    const { zotero } = hostOf([crowded]);
    const metadata = paperMetadata(zotero, { itemID: 1 } as HostReader)!;
    expect(metadata.authors).toHaveLength(50); expect(metadata.editors).toHaveLength(50);
    expect(metadata.tags).toHaveLength(24);
    expect(metadata.tags!.every(tag => [...tag].length <= 128)).toBe(true);
  });
});
describe('selection geometry', () => {
  // PDF user space is y-up; the viewport transform flips it. Zotero normalizes min/max (reader.js:69376-69378).
  const geometry: PageGeometry = {
    pageRect: () => ({ left: 100, top: 40 }),
    toViewport: (_page, [x1, y1, x2, y2]) => [x1 * 2, (800 - y2) * 2, x2 * 2, (800 - y1) * 2],
    frameOffset: () => ({ left: 10, top: 41 }),
  };
  it('converts PDF rects to reader-document CSS pixels through the page, viewport and iframe offsets', () => {
    const rect = selectionViewRect(geometry, 3, [[72, 500, 300, 512], [72, 488, 210, 500]]);
    // union in PDF space: [72, 488, 300, 512] → viewport [144, 576, 600, 624] → + page (100,40) → + frame (10,41)
    expect(rect).toEqual({ left: 254, top: 657, right: 710, bottom: 705 });
  });
  it('returns null when the page is not laid out', () => {
    expect(selectionViewRect({ ...geometry, pageRect: () => undefined }, 3, [[0, 0, 1, 1]])).toBeNull();
  });
  it('places the bar centered above the selection, clamped inside the view, and below the native popup when there is no room above', () => {
    const view = { left: 10, top: 41, right: 810, bottom: 641 };
    const selection = { left: 254, top: 300, right: 710, bottom: 348 };
    expect(barPosition(selection, { width: 200, height: 28 }, view, null)).toEqual({ left: 382, top: 264 });
    expect(barPosition({ ...selection, left: 20, right: 60 }, { width: 200, height: 28 }, view, null)).toEqual({ left: 14, top: 264 });
    expect(barPosition({ ...selection, left: 760, right: 800 }, { width: 200, height: 28 }, view, null)).toEqual({ left: 606, top: 264 });
    const nearTop = { left: 254, top: 50, right: 710, bottom: 80 };
    expect(barPosition(nearTop, { width: 200, height: 28 }, view, { left: 400, top: 100, right: 598, bottom: 220 })).toEqual({ left: 382, top: 228 });
    expect(barPosition(nearTop, { width: 200, height: 28 }, view, null)).toEqual({ left: 382, top: 88 });
  });
  it('avoids a native popup that flipped above the selection and keeps the bar inside the view', () => {
    const view = { left: 10, top: 41, right: 810, bottom: 641 };
    const bar = { width: 200, height: 28 };
    const flipped = { left: 400, top: 430, right: 598, bottom: 550 };
    const nearBottom = { left: 254, top: 560, right: 710, bottom: 600 };
    // Above would overlap the flipped native panel; below the selection still fits.
    expect(barPosition(nearBottom, bar, view, flipped)).toEqual({ left: 382, top: 608 });
    const flushBottom = { left: 254, top: 610, right: 710, bottom: 635 };
    const nativeAbove = { left: 400, top: 480, right: 598, bottom: 600 };
    // No vertical gap remains; sit to the left of the selection, still fully in view.
    expect(barPosition(flushBottom, bar, view, nativeAbove)).toEqual({ left: 46, top: 609 });
    const leftBottom = { left: 20, top: 610, right: 80, bottom: 635 };
    expect(barPosition(leftBottom, bar, view, { left: 20, top: 490, right: 218, bottom: 600 })).toEqual({ left: 88, top: 609 });
    const rightBottom = { left: 740, top: 610, right: 800, bottom: 635 };
    expect(barPosition(rightBottom, bar, view, { left: 600, top: 490, right: 798, bottom: 600 })).toEqual({ left: 532, top: 609 });
  });
});
