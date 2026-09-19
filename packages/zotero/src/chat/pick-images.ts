import type { ImageAttachment } from '../../../contracts/src/index.ts';
import { imageFromBytes, sniffImageMime } from '../../../contracts/src/image.ts';
import { LIMITS } from '../../../contracts/src/validation.ts';

/** DOM `image/*` plus macOS pasteboard UTIs. TIFF is converted by requesting `image/png` from nsIClipboard. */
export const CLIPBOARD_IMAGE_FLAVORS = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'public.png', 'public.jpeg', 'public.jpg', 'public.gif', 'public.webp',
] as const;
/**
 * macOS screenshots are offered as TIFF. Asking for it after the attachable flavors is what turns a
 * silent no-op into either a converted PNG (when imgITools can encode one) or an honest refusal.
 */
export const UNSUPPORTED_IMAGE_FLAVORS = ['image/tiff', 'public.tiff'] as const;
/** Every flavor a native clipboard read may ask for, in preference order. */
export const REQUESTED_IMAGE_FLAVORS = [...CLIPBOARD_IMAGE_FLAVORS, ...UNSUPPORTED_IMAGE_FLAVORS] as const;
/** Why a gesture that really did carry image bytes attached nothing. Both answers keep the caps. */
export type ClipboardImageRefusal = 'too-large' | 'unsupported';
/**
 * The outcome of one clipboard image read. `refused` is set only when image bytes were actually
 * there and were not attachable, so a caller can report an honest reason instead of leaving the
 * owner with a paste that appears to have done nothing. An empty pasteboard stays silent.
 */
export interface ClipboardImageRead { images: ImageAttachment[]; refused?: ClipboardImageRefusal }

export function isClipboardImageFlavor(type: string): boolean {
  const normalized = type.toLowerCase();
  if (normalized.startsWith('image/') && normalized !== 'image/svg+xml' && !normalized.includes('tiff')) return true;
  return normalized === 'public.png' || normalized === 'public.jpeg' || normalized === 'public.jpg'
    || normalized === 'public.gif' || normalized === 'public.webp';
}

function screenshotName(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'screenshot.jpg';
  if (normalized.includes('gif')) return 'screenshot.gif';
  if (normalized.includes('webp')) return 'screenshot.webp';
  return 'screenshot.png';
}

export interface ClipboardImageItem {
  kind?: string;
  type: string;
  getAsFile(): File | Blob | null;
}

export interface ClipboardLike {
  items?: Iterable<ClipboardImageItem> | ArrayLike<ClipboardImageItem>;
  files?: ArrayLike<File>;
  types?: Iterable<string> | ArrayLike<string>;
  mozItemCount?: number;
  mozTypesAt?(index: number): ArrayLike<string> | { item(index: number): string; length: number };
  mozGetDataAt?(type: string, index: number): unknown;
}

async function bytesFromBlob(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

function listedTypes(data: ClipboardLike): string[] {
  const types: string[] = [];
  if (data.types) {
    for (const type of Array.from(data.types as ArrayLike<string>)) {
      if (typeof type === 'string') types.push(type);
    }
  }
  if (typeof data.mozItemCount === 'number' && data.mozItemCount > 0 && typeof data.mozTypesAt === 'function') {
    const moz = data.mozTypesAt(0);
    if (moz && typeof moz === 'object' && 'length' in moz) {
      const list = moz;
      for (let index = 0; index < list.length; index++) {
        const type = 'item' in list && typeof list.item === 'function' ? list.item(index) : (list as ArrayLike<string>)[index];
        if (typeof type === 'string') types.push(type);
      }
    }
  }
  return [...new Set(types)];
}

function itemFromUnknown(value: unknown, type: string): ClipboardImageItem | undefined {
  if (value instanceof Blob) {
    return { kind: 'file', type: value.type || (isClipboardImageFlavor(type) ? 'image/png' : type), getAsFile: () => value };
  }
  if (value && typeof value === 'object' && 'getAsFile' in value && typeof value.getAsFile === 'function') {
    return { kind: 'file', type, getAsFile: () => (value as ClipboardImageItem).getAsFile() };
  }
  return undefined;
}

/** Clipboard `image/*` / PNG items → the same data-URL attachment used on send. */
export async function attachmentsFromItems(
  items: Iterable<ClipboardImageItem>,
  uuid: () => string,
): Promise<ClipboardImageRead> {
  // Collect every File synchronously: Gecko invalidates a paste event's data store once the
  // handler returns, so a getAsFile() call after the first await yields null and the image is
  // silently lost (most visibly when several images are pasted or dropped together).
  const files: Array<{ file: File | Blob; type: string; name?: string }> = [];
  for (const item of items) {
    if (item.kind && item.kind !== 'file') continue;
    if (!isClipboardImageFlavor(item.type) && !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    const name = 'name' in file && typeof file.name === 'string' ? file.name : undefined;
    files.push({ file, type: item.type, ...(name ? { name } : {}) });
  }
  const images: ImageAttachment[] = []; let refused: ClipboardImageRefusal | undefined;
  for (const entry of files) {
    const bytes = await bytesFromBlob(entry.file);
    const name = entry.name?.trim() || screenshotName(entry.type);
    const image = attachmentFromBytes({ id: uuid(), name, bytes });
    if (image) { images.push(image); continue; }
    // The bytes were read and refused: say which cap refused them, never silently drop the paste.
    refused ??= bytes.byteLength === 0 || bytes.byteLength > LIMITS.imageBytes ? 'too-large' : 'unsupported';
  }
  return { images, ...(refused ? { refused } : {}) };
}

export async function imagesFromClipboardItems(
  items: Iterable<ClipboardImageItem>,
  uuid: () => string,
): Promise<ImageAttachment[]> {
  return (await attachmentsFromItems(items, uuid)).images;
}

/** One attachment, or `undefined` with the reason kept by the caller's refusal bookkeeping. */
function attachmentFromBytes(input: { id: string; name: string; bytes: Uint8Array }): ImageAttachment | undefined {
  return input.bytes.byteLength === 0 || input.bytes.byteLength > LIMITS.imageBytes ? undefined : imageFromBytes(input);
}

function itemsFromClipboard(data: ClipboardLike | null | undefined): ClipboardImageItem[] {
  if (!data) return [];
  const items: ClipboardImageItem[] = [];
  if (data.items) {
    items.push(...Array.from(data.items as ArrayLike<ClipboardImageItem>));
  }
  if (!items.some(item => isClipboardImageFlavor(item.type)) && data.files) {
    for (const file of Array.from(data.files)) {
      items.push({ kind: 'file', type: file.type || 'image/png', getAsFile: () => file });
    }
  }
  if (!items.some(item => isClipboardImageFlavor(item.type)) && typeof data.mozGetDataAt === 'function') {
    for (const type of listedTypes(data)) {
      if (!isClipboardImageFlavor(type)) continue;
      const item = itemFromUnknown(data.mozGetDataAt(type, 0), type);
      if (item) items.push(item);
    }
  }
  return items;
}

export function clipboardHasImage(data: ClipboardLike | null | undefined): boolean {
  if (!data) return false;
  return itemsFromClipboard(data).some(item => isClipboardImageFlavor(item.type))
    || listedTypes(data).some(isClipboardImageFlavor);
}

/** True when the paste gesture carries text, so a reader paste of plain text keeps its default. */
export function clipboardHasText(data: ClipboardLike | null | undefined): boolean {
  if (!data) return false;
  return listedTypes(data).some(type => type.toLowerCase().startsWith('text/'));
}

export async function imagesFromClipboard(
  data: ClipboardLike | null | undefined,
  uuid: () => string,
): Promise<ImageAttachment[]> {
  return (await attachmentsFromClipboard(data, uuid)).images;
}

/** The refusal-aware form of {@link imagesFromClipboard}, used by the composer's paste handling. */
export function attachmentsFromClipboard(
  data: ClipboardLike | null | undefined,
  uuid: () => string,
): Promise<ClipboardImageRead> {
  return attachmentsFromItems(itemsFromClipboard(data), uuid);
}

interface GeckoClipboardService {
  kGlobalClipboard?: number;
  hasDataMatchingFlavors?(flavors: string[] | string, lengthOrWhich?: number, which?: number): boolean;
  getData?(transferable: GeckoTransferable, which?: number): void;
  /** Writing route, used to put the current PDF on the clipboard as a file (see `clipboard-file.ts`). */
  setData?(transferable: unknown, owner: unknown, which: number): void;
}

interface GeckoTransferable {
  init?(context: unknown): void;
  addDataFlavor?(flavor: string): void;
  getTransferData?(flavor: string, data: { value?: unknown }, length?: { value?: number }): void;
}

interface GeckoComponentFactory {
  createInstance?(iface: unknown): unknown;
  getService?(iface: unknown): unknown;
}

export interface GeckoClipboardAccess {
  Cc?: Record<string, GeckoComponentFactory | undefined>;
  Ci?: Record<string, unknown>;
  Services?: { clipboard?: GeckoClipboardService };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

/** The pasteboard behind an access bundle, whichever way this realm reaches it. */
export function clipboardService(access: GeckoClipboardAccess | null | undefined): GeckoClipboardService | undefined {
  if (access?.Services?.clipboard) return access.Services.clipboard;
  const service = access?.Cc?.['@mozilla.org/widget/clipboard;1']?.getService?.(access.Ci?.nsIClipboard);
  if (!service || typeof service !== 'object') return undefined;
  return service;
}

function flavorsMatch(clipboard: GeckoClipboardService, flavors: string[]): boolean {
  if (typeof clipboard.hasDataMatchingFlavors !== 'function') return false;
  const which = clipboard.kGlobalClipboard ?? 1;
  try {
    const modern = clipboard.hasDataMatchingFlavors(flavors, which);
    if (typeof modern === 'boolean') return modern;
  } catch { /* older (flavors, length, which) */ }
  try {
    return !!clipboard.hasDataMatchingFlavors(flavors, flavors.length, which);
  } catch {
    return false;
  }
}

export function geckoClipboardHasImage(access: GeckoClipboardAccess | null | undefined): boolean {
  const clipboard = clipboardService(access);
  if (!clipboard) return false;
  return flavorsMatch(clipboard, [...REQUESTED_IMAGE_FLAVORS]);
}

/** Reader iframe first, then parent chrome / globalThis. Cc lives on privileged Zotero windows. */
export function resolveGeckoClipboardAccess(win: Window | null | undefined): GeckoClipboardAccess | null {
  const seen = new Set<unknown>();
  const queue: unknown[] = [win, globalThis];
  try { if (win?.parent) queue.push(win.parent); } catch { /* cross-origin */ }
  try { if (win?.top) queue.push(win.top); } catch { /* cross-origin */ }
  for (const candidate of queue) {
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    const access = candidate as GeckoClipboardAccess;
    if (access.Services?.clipboard || access.Cc?.['@mozilla.org/widget/clipboard;1']) return access;
  }
  return win ? win as GeckoClipboardAccess : null;
}

// The plugin realm (presenter) is the only place these privileged globals exist; a reader iframe
// content realm has neither Cc nor Services, so a paste there can never reach the pasteboard.
declare const Cc: Record<string, { createInstance?(iface: unknown): unknown; getService?(iface: unknown): unknown }> | undefined;
declare const Ci: Record<string, unknown> | undefined;
declare const Services: { clipboard?: GeckoClipboardService } | undefined;

/**
 * Privileged clipboard access in the plugin realm. macOS screenshots are offered as TIFF, which only
 * this route converts because nsIClipboard is asked for `image/png`; the reader iframe cannot help.
 */
export function pluginClipboardAccess(): GeckoClipboardAccess | null {
  const access: GeckoClipboardAccess = {
    ...(typeof Cc === 'undefined' ? {} : { Cc }),
    ...(typeof Ci === 'undefined' ? {} : { Ci }),
    ...(typeof Services === 'undefined' ? {} : { Services }),
  };
  return clipboardService(access) ? access : null;
}

function bytesFromBinaryString(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function callRecord(record: Record<string, unknown>, name: string, args: unknown[]): unknown {
  const fn = record[name];
  if (typeof fn !== 'function') return undefined;
  return Reflect.apply(fn, record, args) as unknown;
}

function bytesFromTransferValue(value: unknown, access: GeckoClipboardAccess): Uint8Array | undefined {
  if (!value) return undefined;
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const record = asRecord(value);
  if (!record) return undefined;
  if (typeof record.data === 'string') return bytesFromBinaryString(record.data);
  if (typeof record.available === 'function' && typeof record.readByteArray === 'function') {
    const count = Number(callRecord(record, 'available', []));
    if (!Number.isFinite(count) || count <= 0) return undefined;
    const raw = callRecord(record, 'readByteArray', [count]);
    if (raw instanceof Uint8Array) return raw;
    if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
  }
  if (typeof record.available === 'function') {
    const binary = asRecord(access.Cc?.['@mozilla.org/binaryinputstream;1']?.createInstance?.(access.Ci?.nsIBinaryInputStream));
    if (binary && typeof binary.setInputStream === 'function' && typeof binary.readByteArray === 'function') {
      callRecord(binary, 'setInputStream', [value]);
      return bytesFromTransferValue(binary, access);
    }
  }
  const tools = asRecord(access.Cc?.['@mozilla.org/image/tools;1']?.getService?.(access.Ci?.imgITools));
  if (tools && typeof tools.encodeImage === 'function') {
    try {
      return bytesFromTransferValue(callRecord(tools, 'encodeImage', [value, 'image/png']), access);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function createTransferable(access: GeckoClipboardAccess): GeckoTransferable | undefined {
  const created = access.Cc?.['@mozilla.org/widget/transferable;1']?.createInstance?.(access.Ci?.nsITransferable);
  if (!created || typeof created !== 'object') return undefined;
  return created;
}

function readGeckoClipboardBytes(access: GeckoClipboardAccess): Uint8Array | undefined {
  const clipboard = clipboardService(access);
  const transferable = createTransferable(access);
  if (!clipboard || !transferable || typeof clipboard.getData !== 'function' || typeof transferable.getTransferData !== 'function') return undefined;
  transferable.init?.(null);
  for (const flavor of REQUESTED_IMAGE_FLAVORS) transferable.addDataFlavor?.(flavor);
  try {
    clipboard.getData(transferable, clipboard.kGlobalClipboard ?? 1);
  } catch {
    return undefined;
  }
  const held = (flavor: string): Uint8Array | undefined => {
    const holder: { value?: unknown } = {};
    if (typeof transferable.getTransferData !== 'function') return undefined;
    try {
      transferable.getTransferData(flavor, holder);
    } catch {
      return undefined;
    }
    return bytesFromTransferValue(holder.value, access);
  };
  // Attachable flavors first: an image the sidebar accepts is never passed over for one it does not.
  for (const flavor of CLIPBOARD_IMAGE_FLAVORS) {
    const bytes = held(flavor);
    if (bytes && sniffImageMime(bytes)) return bytes;
  }
  // macOS screenshots are TIFF. Convert through imgITools when that encoder is present; otherwise
  // return the TIFF bytes so the caller can name an honest refusal instead of a silent no-op.
  for (const flavor of UNSUPPORTED_IMAGE_FLAVORS) {
    const bytes = held(flavor);
    if (!bytes?.length) continue;
    const converted = pngFromTiff(bytes, access);
    if (converted && sniffImageMime(converted)) return converted;
    return bytes;
  }
  return undefined;
}

function pngFromTiff(bytes: Uint8Array, access: GeckoClipboardAccess): Uint8Array | undefined {
  const tools = asRecord(access.Cc?.['@mozilla.org/image/tools;1']?.getService?.(access.Ci?.imgITools));
  if (!tools) return undefined;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const container = callRecord(tools, 'decodeImageFromArrayBuffer', [buffer, 'image/tiff']);
    return bytesFromTransferValue(callRecord(tools, 'encodeImage', [container, 'image/png']), access);
  } catch {
    return undefined;
  }
}

/** Privileged Gecko/Zotero clipboard. Never logs flavor payloads. */
export function readGeckoClipboardImage(
  access: GeckoClipboardAccess | null | undefined,
  uuid: () => string,
): ClipboardImageRead {
  if (!access) return { images: [] };
  const bytes = readGeckoClipboardBytes(access);
  if (!bytes) return { images: [] };
  const image = imageFromBytes({ id: uuid(), name: 'screenshot.png', bytes });
  if (image) return { images: [image] };
  // The bytes were really on the pasteboard; the refusal names why they were not attached.
  return { images: [], refused: bytes.byteLength > LIMITS.imageBytes ? 'too-large' : 'unsupported' };
}