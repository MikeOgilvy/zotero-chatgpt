import type { ImageAttachment } from '../../../contracts/src/index.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46];
const PDF = [0x25, 0x50, 0x44, 0x46];
/** DOM `image/*` plus macOS pasteboard UTIs. TIFF is converted by requesting `image/png` from nsIClipboard. */
export const CLIPBOARD_IMAGE_FLAVORS = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'public.png', 'public.jpeg', 'public.jpg', 'public.gif', 'public.webp',
] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.length <= bytes.length && magic.every((value, index) => bytes[index] === value);
}

export function sniffImageMime(bytes: Uint8Array): ImageAttachment['mime'] | undefined {
  if (startsWith(bytes, PDF)) return undefined;
  if (startsWith(bytes, PNG)) return 'image/png';
  if (startsWith(bytes, JPEG)) return 'image/jpeg';
  if (startsWith(bytes, GIF)) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return undefined;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

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
export async function imagesFromClipboardItems(
  items: Iterable<ClipboardImageItem>,
  uuid: () => string,
): Promise<ImageAttachment[]> {
  const images: ImageAttachment[] = [];
  for (const item of items) {
    if (item.kind && item.kind !== 'file') continue;
    if (!isClipboardImageFlavor(item.type) && !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    const bytes = await bytesFromBlob(file);
    const name = ('name' in file && typeof file.name === 'string' && file.name.trim()) ? file.name : screenshotName(item.type);
    const image = imageFromBytes({ id: uuid(), name, bytes });
    if (image) images.push(image);
  }
  return images;
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

export async function imagesFromClipboard(
  data: ClipboardLike | null | undefined,
  uuid: () => string,
): Promise<ImageAttachment[]> {
  return imagesFromClipboardItems(itemsFromClipboard(data), uuid);
}

export function imageFromBytes(input: { id: string; name: string; bytes: Uint8Array }): ImageAttachment | undefined {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) return undefined;
  const mime = sniffImageMime(input.bytes);
  if (!mime) return undefined;
  const name = input.name.split(/[/\\]/u).at(-1)?.trim() || 'image';
  if (name.toLowerCase().endsWith('.pdf')) return undefined;
  return { id: input.id, name, mime, dataUrl: `data:${mime};base64,${toBase64(input.bytes)}` };
}

export interface ImageFilePicker {
  pickFiles(): Promise<Array<{ name: string; bytes: Uint8Array }>>;
  uuid(): string;
}

export async function pickImageAttachments(host: ImageFilePicker): Promise<ImageAttachment[]> {
  const files = await host.pickFiles();
  const images: ImageAttachment[] = [];
  for (const file of files) {
    const image = imageFromBytes({ id: host.uuid(), name: file.name, bytes: file.bytes });
    if (image) images.push(image);
  }
  return images;
}

interface GeckoFilePicker {
  modeOpenMultiple: number;
  returnOK: number;
  init(window: Window, title: string, mode: number): void;
  appendFilters?(filter: number): void;
  appendFilter?(title: string, filter: string): void;
  filterImages?: number;
  show(): Promise<number> | number;
  files?: string[] | { length: number; [index: number]: string };
  file?: string;
}

declare const ChromeUtils: { importESModule?(uri: string): { FilePicker?: new () => GeckoFilePicker } };
declare const IOUtils: { read?(path: string): Promise<Uint8Array> };

async function pathsFromPicker(picker: GeckoFilePicker): Promise<string[]> {
  const shown = await picker.show();
  if (shown !== picker.returnOK) return [];
  if (Array.isArray(picker.files)) return picker.files.filter(path => typeof path === 'string');
  if (picker.files && typeof picker.files.length === 'number') {
    return Array.from({ length: picker.files.length }, (_, index) => picker.files![index]).filter(path => typeof path === 'string');
  }
  return typeof picker.file === 'string' ? [picker.file] : [];
}

/** Zotero/Gecko file picker. Adapter-only: reads bytes and returns attachments. */
export async function geckoPickImageFiles(win: Window): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const FilePicker = ChromeUtils.importESModule?.('chrome://zotero/content/modules/filePicker.mjs')?.FilePicker;
  if (!FilePicker || typeof IOUtils?.read !== 'function') return [];
  const picker = new FilePicker();
  picker.init(win, 'Attach image', picker.modeOpenMultiple);
  if (typeof picker.appendFilters === 'function' && picker.filterImages !== undefined) picker.appendFilters(picker.filterImages);
  else picker.appendFilter?.('Images', '*.png; *.jpg; *.jpeg; *.gif; *.webp');
  const paths = await pathsFromPicker(picker);
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const path of paths) {
    const bytes = await IOUtils.read(path);
    const name = path.split(/[/\\]/u).at(-1) || 'image';
    files.push({ name, bytes });
  }
  return files;
}

interface GeckoClipboardService {
  kGlobalClipboard?: number;
  hasDataMatchingFlavors?(flavors: string[] | string, lengthOrWhich?: number, which?: number): boolean;
  getData?(transferable: GeckoTransferable, which?: number): void;
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

function clipboardService(access: GeckoClipboardAccess | null | undefined): GeckoClipboardService | undefined {
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
  return flavorsMatch(clipboard, [...CLIPBOARD_IMAGE_FLAVORS]);
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
  for (const flavor of CLIPBOARD_IMAGE_FLAVORS) transferable.addDataFlavor?.(flavor);
  try {
    clipboard.getData(transferable, clipboard.kGlobalClipboard ?? 1);
  } catch {
    return undefined;
  }
  for (const flavor of CLIPBOARD_IMAGE_FLAVORS) {
    const holder: { value?: unknown } = {};
    try {
      transferable.getTransferData(flavor, holder);
    } catch {
      continue;
    }
    const bytes = bytesFromTransferValue(holder.value, access);
    if (bytes && sniffImageMime(bytes)) return bytes;
  }
  return undefined;
}

/** Privileged Gecko/Zotero clipboard. Never logs flavor payloads. */
export function imagesFromGeckoClipboard(
  access: GeckoClipboardAccess | null | undefined,
  uuid: () => string,
): Promise<ImageAttachment[]> {
  if (!access) return Promise.resolve([]);
  const bytes = readGeckoClipboardBytes(access);
  if (!bytes) return Promise.resolve([]);
  const image = imageFromBytes({ id: uuid(), name: 'screenshot.png', bytes });
  return Promise.resolve(image ? [image] : []);
}
