import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  attachmentsFromClipboard, attachmentsFromItems, clipboardHasImage, clipboardHasText, geckoClipboardHasImage, imageFromBytes, imagesFromClipboard,
  imagesFromClipboardItems, pluginClipboardAccess, readGeckoClipboardImage, resolveGeckoClipboardAccess,
  type ClipboardImageItem,
} from '../../../packages/zotero/src/chat/pick-images.ts';
import { TINY_PNG_DATA_URL } from '../../contracts/factories.ts';

const PNG_ID = '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b20';
const PNG = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
const PNG_ATTACHMENT = {
  id: PNG_ID,
  name: 'screenshot.png',
  mime: 'image/png' as const,
  dataUrl: TINY_PNG_DATA_URL,
};

function fakeGeckoClipboard(flavors: Record<string, Uint8Array>, tools?: { decodeImageFromArrayBuffer: () => unknown; encodeImage: () => unknown }) {
  const available = Object.keys(flavors);
  const Ci = {
    nsIClipboard: { kGlobalClipboard: 1 },
    nsITransferable: {},
    nsIInputStream: {},
    nsIBinaryInputStream: {},
    nsISupportsCString: {},
  };
  const transferable = {
    flavors: [] as string[],
    init() { /* load context unused in tests */ },
    addDataFlavor(flavor: string) { this.flavors.push(flavor); },
    getTransferData(flavor: string, data: { value?: unknown }) {
      const bytes = flavors[flavor];
      if (!bytes) throw new Error('flavor missing');
      // Chunked so a flavor above the argument-count limit (the 2 MiB cap tests) still encodes.
      let text = '';
      for (let index = 0; index < bytes.length; index += 4096) text += String.fromCharCode(...bytes.subarray(index, index + 4096));
      data.value = { data: text };
    },
  };
  return {
    Cc: {
      '@mozilla.org/widget/transferable;1': { createInstance: () => transferable },
      '@mozilla.org/widget/clipboard;1': {
        getService: () => ({
          kGlobalClipboard: 1,
          hasDataMatchingFlavors: (list: string[]) => list.some(flavor => available.includes(flavor)),
          getData: () => undefined,
        }),
      },
      ...(tools ? { '@mozilla.org/image/tools;1': { getService: () => tools } } : {}),
    },
    Ci,
    Services: {
      clipboard: {
        kGlobalClipboard: 1,
        hasDataMatchingFlavors: (list: string[]) => list.some(flavor => available.includes(flavor)),
        getData: (trans: typeof transferable) => {
          trans.getTransferData = transferable.getTransferData.bind(transferable);
        },
      },
    },
  };
}

it('accepts PNG bytes as a data-URL image attachment and rejects a PDF', () => {
  const image = imageFromBytes({
    id: PNG_ID,
    name: 'figure.png',
    bytes: PNG,
  });
  expect(image).toEqual({
    id: PNG_ID,
    name: 'figure.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  });
  const pdf = new TextEncoder().encode('%PDF-1.4 fake');
  expect(imageFromBytes({ id: '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b21', name: 'paper.pdf', bytes: pdf })).toBeUndefined();
});

it('turns clipboard image items into the same data-URL attachment', async () => {
  const file = new File([PNG], 'screenshot.png', { type: 'image/png' });
  const images = await imagesFromClipboardItems([
    { kind: 'file', type: 'image/png', getAsFile: () => file },
    { kind: 'string', type: 'text/plain', getAsFile: () => null },
  ], () => PNG_ID);
  expect(images).toEqual([PNG_ATTACHMENT]);
});

it('treats a macOS public.png flavor as a screenshot even when items are empty', async () => {
  expect(clipboardHasImage({ items: [], files: [], types: ['public.png'] })).toBe(true);
  expect(clipboardHasImage({ items: [], files: [], types: ['text/plain'] })).toBe(false);
  const file = new File([PNG], 'screenshot.png', { type: 'image/png' });
  const images = await imagesFromClipboard({
    items: [],
    files: [],
    types: ['public.png'],
    mozItemCount: 1,
    mozTypesAt: () => ['public.png'],
    mozGetDataAt: (type: string) => type === 'public.png' ? file : null,
  }, () => PNG_ID);
  expect(images).toEqual([PNG_ATTACHMENT]);
});

it('refuses an input image above the documented 2 MiB bound instead of downscaling it', () => {
  const oversize = new Uint8Array(2 * 1024 * 1024 + 1); oversize.set([0x89, 0x50, 0x4e, 0x47]);
  expect(imageFromBytes({ id: PNG_ID, name: 'huge.png', bytes: oversize })).toBeUndefined();
  const empty = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  expect(imageFromBytes({ id: PNG_ID, name: 'header-only.png', bytes: empty })).toMatchObject({ mime: 'image/png', name: 'header-only.png' });
});

it('captures every pasted image file before the paste data store can be invalidated', async () => {
  const first = new File([PNG], 'one.png', { type: 'image/png' });
  const second = new File([PNG], 'two.png', { type: 'image/png' });
  let live = true;
  const item = (file: File): ClipboardImageItem => ({ kind: 'file', type: 'image/png', getAsFile: () => (live ? file : null) });
  let index = 0;
  // Gecko drops access to a paste event's data store once the handler returns, so a second
  // getAsFile() after an await returns null and that image silently disappears.
  const pending = imagesFromClipboardItems([item(first), item(second)], () => index++ === 0 ? PNG_ID : '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b21');
  live = false;
  const images = await pending;
  expect(images.map(image => image.name)).toEqual(['one.png', 'two.png']);
});

it('renders the shipped item-pane icon with valid paint values and a visible mark', () => {
  const svg = readFileSync(resolve(import.meta.dirname, '../../../packages/zotero/assets/icon.svg'), 'utf8');
  expect(svg).toContain('viewBox="0 0 16 16"');
  // Gecko ignores a presentation attribute whose value is not a single valid paint, so a
  // pasted "context-fill currentColor" made the previous icon render as nothing.
  const paints = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/gu)].map(match => match[1]!);
  expect(paints.length).toBeGreaterThan(0);
  for (const paint of paints) expect(['none', 'context-fill', 'context-stroke', 'currentColor']).toContain(paint);
  expect(svg).toMatch(/fill="context-fill"/u);
  // The mark is a hollow page outline with a text rule and a spark, so the frame needs the
  // even-odd rule to punch its interior out; a single solid subpath would be a plain block.
  expect(svg).toContain('fill-rule="evenodd"');
  const subpaths = [...svg.matchAll(/[MZ]/gu)].length;
  expect(subpaths).toBeGreaterThanOrEqual(8);
});
it('reads an nsIClipboard transferable image when DOM items are empty', () => {
  const host = fakeGeckoClipboard({ 'image/png': PNG, 'public.png': PNG });
  expect(geckoClipboardHasImage(host)).toBe(true);
  expect(geckoClipboardHasImage(fakeGeckoClipboard({ 'text/unicode': new Uint8Array([65]) }))).toBe(false);
  expect(readGeckoClipboardImage(host, () => PNG_ID).images).toEqual([PNG_ATTACHMENT]);
});

it('resolves Gecko clipboard access from a parent chrome window', () => {
  const host = fakeGeckoClipboard({ 'image/png': PNG });
  const iframe = { parent: host } as unknown as Window;
  expect(resolveGeckoClipboardAccess(iframe)).toBe(host);
});

it('treats only text flavors as an insertable text paste', () => {
  expect(clipboardHasText({ types: ['text/plain', 'image/png'] })).toBe(true);
  expect(clipboardHasText({ mozItemCount: 1, mozTypesAt: () => ['text/html'] })).toBe(true);
  expect(clipboardHasText({ items: [], files: [], types: [] })).toBe(false);
  expect(clipboardHasText({ types: ['public.png'] })).toBe(false);
  expect(clipboardHasText(null)).toBe(false);
});

it('has no privileged pasteboard in a content realm and returns nothing instead of guessing', () => {
  // The reader iframe realm has no Cc/Services; only the plugin realm can read the pasteboard.
  expect(pluginClipboardAccess()).toBeNull();
  expect(readGeckoClipboardImage(pluginClipboardAccess(), () => PNG_ID).images).toEqual([]);
});

// A paste that carried an image and attached nothing used to look exactly like a paste that did
// nothing at all: the owner's only evidence was a draft that stayed empty. These pin the honest
// outcomes, and the caps and formats themselves are unchanged.
const oversizePng = () => { const bytes = new Uint8Array(2 * 1024 * 1024 + 1); bytes.set([0x89, 0x50, 0x4e, 0x47]); return bytes; };
const tiff = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const pngBytes = () => PNG;

it('names the reason a pasted DOM image was refused instead of dropping it silently', async () => {
  const item = (bytes: Uint8Array<ArrayBuffer>) => [{ kind: 'file', type: 'image/png', getAsFile: () => new File([bytes], 'screenshot.png', { type: 'image/png' }) }];
  expect(await attachmentsFromItems(item(oversizePng()), () => PNG_ID)).toEqual({ images: [], refused: 'too-large' });
  expect(await attachmentsFromItems(item(new TextEncoder().encode('%PDF-1.7')), () => PNG_ID)).toEqual({ images: [], refused: 'unsupported' });
  expect(await attachmentsFromItems(item(pngBytes()), () => PNG_ID)).toEqual({ images: [PNG_ATTACHMENT] });
  // An empty pasteboard and a text-only pasteboard are not refusals: there is nothing to report.
  expect(await attachmentsFromItems([], () => PNG_ID)).toEqual({ images: [] });
  expect(await attachmentsFromClipboard({ items: [], files: [], types: ['text/plain'] }, () => PNG_ID)).toEqual({ images: [] });
  // A good image beside a refused one still attaches, and the refusal is still reported.
  const mixed = await attachmentsFromItems([...item(pngBytes()), ...item(oversizePng())], () => PNG_ID);
  expect(mixed.images).toEqual([PNG_ATTACHMENT]);
  expect(mixed.refused).toBe('too-large');
});

it('recognizes a screenshot the pasteboard only offers as TIFF and converts it when imgITools can encode PNG', () => {
  // Without an encoder the TIFF is an honest refusal. With imgITools the same bytes become PNG.
  const host = fakeGeckoClipboard({ 'image/tiff': tiff });
  expect(geckoClipboardHasImage(host)).toBe(true);
  expect(readGeckoClipboardImage(host, () => PNG_ID)).toEqual({ images: [], refused: 'unsupported' });
  const converting = fakeGeckoClipboard({ 'image/tiff': tiff }, {
    decodeImageFromArrayBuffer: () => ({ kind: 'tiff' }),
    encodeImage: () => ({ data: String.fromCharCode(...PNG) }),
  });
  expect(readGeckoClipboardImage(converting, () => PNG_ID).images).toEqual([PNG_ATTACHMENT]);
  const large = fakeGeckoClipboard({ 'image/png': oversizePng() });
  expect(readGeckoClipboardImage(large, () => PNG_ID)).toEqual({ images: [], refused: 'too-large' });
  expect(readGeckoClipboardImage(fakeGeckoClipboard({ 'text/unicode': Uint8Array.from([65]) }), () => PNG_ID)).toEqual({ images: [] });
  expect(readGeckoClipboardImage(fakeGeckoClipboard({ 'image/tiff': tiff, 'image/png': PNG }), () => PNG_ID)).toEqual({ images: [PNG_ATTACHMENT] });
});
