import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  clipboardHasImage, clipboardHasText, geckoClipboardHasImage, imageFromBytes, imagesFromClipboard,
  imagesFromClipboardItems, imagesFromGeckoClipboard, pluginClipboardAccess, resolveGeckoClipboardAccess,
  type ClipboardImageItem,
} from '../../packages/zotero/src/chat/pick-images.ts';
import { TINY_PNG_DATA_URL } from '../contracts/factories.ts';

const PNG_ID = '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b20';
const PNG = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
const PNG_ATTACHMENT = {
  id: PNG_ID,
  name: 'screenshot.png',
  mime: 'image/png' as const,
  dataUrl: TINY_PNG_DATA_URL,
};

function fakeGeckoClipboard(flavors: Record<string, Uint8Array>) {
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
      data.value = {
        data: String.fromCharCode(...bytes),
      };
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
  const svg = readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/icon.svg'), 'utf8');
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
it('reads an nsIClipboard transferable image when DOM items are empty', async () => {
  const host = fakeGeckoClipboard({ 'image/png': PNG, 'public.png': PNG });
  expect(geckoClipboardHasImage(host)).toBe(true);
  expect(geckoClipboardHasImage(fakeGeckoClipboard({ 'text/unicode': new Uint8Array([65]) }))).toBe(false);
  const images = await imagesFromGeckoClipboard(host, () => PNG_ID);
  expect(images).toEqual([PNG_ATTACHMENT]);
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

it('has no privileged pasteboard in a content realm and returns nothing instead of guessing', async () => {
  // The reader iframe realm has no Cc/Services; only the plugin realm can read the pasteboard.
  expect(pluginClipboardAccess()).toBeNull();
  expect(await imagesFromGeckoClipboard(pluginClipboardAccess(), () => PNG_ID)).toEqual([]);
});
