import { ReaderError, type ImageAttachment } from '../../../contracts/src/index.ts';
import { imageFromBytes } from '../../../contracts/src/image.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { validateImageAttachment } from '../../../contracts/src/validation.ts';

/**
 * The concrete host primitives that touch the local filesystem or an image decoder. They are shared
 * by the read port (page capture renders an image) and the file actions (`actions/files.ts`, which
 * choose/read/export files). This is deliberately a handful of named operations, not a generic
 * file-service abstraction: there is one host, one file picker and one image decoder.
 */
export interface LibraryFilePicker {
  modeOpen: number; modeOpenMultiple: number; modeSave: number; returnOK: number; returnReplace: number;
  defaultString: string; file?: string; files?: string[];
  init(window: Window, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show: () => Promise<number>;
}
export interface LibraryFileIO {
  stat(path: string): Promise<{ size: number; type?: string }>;
  read(path: string, options: { maxBytes: number }): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<unknown>;
}
export interface NativeGlobals {
  ChromeUtils?: { importESModule(uri: string): { FilePicker?: new () => LibraryFilePicker } };
  IOUtils?: LibraryFileIO;
  Cu?: { cloneInto(value: object, target: object, options?: { wrapReflectors?: boolean }): object; waiveXrays?(value: object): object };
  Cc?: Record<string, { getService(type: unknown): { decodeImageFromArrayBuffer(bytes: ArrayBuffer, mime: string): { width: number; height: number } } }>;
  Ci?: { imgITools?: unknown };
}
export interface NativeFileOptions {
  uuid(): string;
  getWindow?(): Window | undefined;
  createFilePicker?(): LibraryFilePicker;
  io?: LibraryFileIO;
  decodeImage?(bytes: Uint8Array, mime: ImageAttachment['mime']): Promise<{ width: number; height: number }>;
}
export interface NativeFiles {
  globals(): NativeGlobals;
  window(): Window | undefined;
  picker(title: string, kind: 'save' | 'file', name?: string): LibraryFilePicker;
  read(path: string, maximum: number): Promise<Uint8Array>;
  decode(bytes: Uint8Array, mime: ImageAttachment['mime']): Promise<{ width: number; height: number }>;
  image(bytes: Uint8Array, name: string, origin?: ImageAttachment['origin']): Promise<ImageAttachment>;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export function fail(message: string, code: ConstructorParameters<typeof ReaderError>[0] = 'INVALID_REQUEST'): never { throw new ReaderError(code, message); }
export async function boundary<T>(work: () => Promise<T>, message: string): Promise<T> {
  try { return await work(); } catch (error) { if (error instanceof ReaderError) throw error; fail(message); }
}
export function bareName(name: string, fallback: string): string {
  const file = name.split(/[/\\]/u).at(-1)?.trim().replace(/\.\./gu, '_').replace(/[\u0000-\u001f]/gu, '') || fallback;
  return [...file].slice(0, 220).join('');
}
export function fileExtension(name: string): string { return /\.([a-z0-9]+)$/iu.exec(name)?.[1]?.toLowerCase() ?? ''; }
/**
 * Cheap 32-bit FNV-1a over the bytes just read. Its only job is to keep the same file from being
 * attached twice under two ids, and to keep two same-named files apart inside one draft; it is not a
 * security hash and is never used as a document identity or a content-address.
 */
export function contentFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;
export const TEXT_FILE_EXTENSIONS = [
  'txt', 'text', 'md', 'markdown', 'rst', 'org',
  'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env', 'log',
  'xml', 'html', 'htm', 'xhtml', 'svg', 'tex', 'latex', 'bib', 'ris', 'srt', 'vtt',
  'py', 'ipynb', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'tsx', 'jsx', 'css', 'scss', 'less',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'r', 'rmd', 'jl', 'm', 'mm', 'java', 'kt', 'scala', 'groovy', 'gradle',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'pl', 'lua', 'swift', 'dart', 'sql', 'graphql', 'proto',
] as const;
export const IMAGE_FILE_PATTERNS = IMAGE_FILE_EXTENSIONS.map(extension => `*.${extension}`).join('; ');
export const TEXT_FILE_PATTERNS = TEXT_FILE_EXTENSIONS.map(extension => `*.${extension}`).join('; ');

export function createNativeFiles(zotero: unknown, options: NativeFileOptions): NativeFiles {
  const z = zotero as { getMainWindow?(): Window | undefined };
  const globals = () => globalThis as unknown as NativeGlobals;
  const window = () => options.getWindow?.() ?? z.getMainWindow?.();
  const io = () => options.io ?? globals().IOUtils ?? fail('Native file access is unavailable.', 'UNSUPPORTED_INTERACTION');
  const picker = (title: string, kind: 'save' | 'file', name = '') => {
    const chosen = options.createFilePicker?.() ?? (() => {
      const FilePicker = globals().ChromeUtils?.importESModule('chrome://zotero/content/modules/filePicker.mjs').FilePicker;
      return FilePicker ? new FilePicker() : fail('The native file picker is unavailable.', 'UNSUPPORTED_INTERACTION');
    })();
    const owner = window(); if (!owner) fail('Open a Zotero window before choosing a file.', 'UNSUPPORTED_INTERACTION');
    chosen.init(owner, title, kind === 'save' ? chosen.modeSave : chosen.modeOpenMultiple);
    if (name) chosen.defaultString = bareName(name, 'export.txt');
    return chosen;
  };
  const read = async (path: string, maximum: number): Promise<Uint8Array> => {
    const files = io(); const stat = await files.stat(path);
    // A directory or a device would make `size` meaningless and could hang a native read, so only a
    // regular file is ever read; the check is skipped when the host cannot report a type.
    if (stat.type !== undefined && stat.type !== 'regularFile') fail('Choose a regular file, not a folder.');
    if (!Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > maximum) fail('The selected file is empty or exceeds the supported size limit.', 'PAYLOAD_TOO_LARGE');
    const bytes = await files.read(path, { maxBytes: maximum + 1 });
    if (!bytes.length || bytes.length > maximum) fail('The selected file exceeds the supported size limit.', 'PAYLOAD_TOO_LARGE');
    return bytes;
  };
  const decode = async (bytes: Uint8Array, mime: ImageAttachment['mime']) => {
    if (options.decodeImage) return options.decodeImage(bytes, mime);
    const native = globals(); const owner = window() as unknown as NativeGlobals | undefined;
    const cc = owner?.Cc ?? native.Cc; const ci = owner?.Ci ?? native.Ci;
    const tools = cc?.['@mozilla.org/image/tools;1']?.getService(ci?.imgITools);
    if (!tools) fail('Native image validation is unavailable.', 'UNSUPPORTED_INTERACTION');
    return tools.decodeImageFromArrayBuffer(new Uint8Array(bytes).buffer, mime);
  };
  const image = async (bytes: Uint8Array, name: string, origin?: ImageAttachment['origin']): Promise<ImageAttachment> => {
    const value = imageFromBytes({ id: options.uuid(), name: bareName(name, 'image.png'), bytes });
    if (!value) fail('Choose a valid PNG, JPEG, GIF or WebP image within the image size limit.');
    const dimensions = await decode(bytes, value.mime);
    if (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1) fail('The selected image could not be decoded.');
    return validateImageAttachment({ ...value, ...(origin ? { origin: clone(origin) } : {}) });
  };
  return { globals, window, picker, read, decode, image, write: async (path, bytes) => { await io().write(path, bytes); } };
}
