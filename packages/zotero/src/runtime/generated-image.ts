import { ReaderError, type ImageAttachment } from '../../../contracts/src/index.ts';
import { validateOutputImage } from '../../../contracts/src/validation.ts';
import { checkPath, type FileHost } from './storage.ts';

export interface GeneratedImageCodec { decode(base64: string): Uint8Array; encode(bytes: Uint8Array): string }
export interface GeneratedImageOptions { host: FileHost; allowedOutputDirectories: readonly string[]; codec?: GeneratedImageCodec }
type Mime = 'image/png' | 'image/jpeg' | 'image/webp';
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_BASE64 = 4 * Math.ceil(MAX_BYTES / 3);
const MAX_RESULT = MAX_BASE64 + 64;
function unsupported(): never { throw new ReaderError('UNSUPPORTED_INTERACTION', 'The generated image output could not be verified. Its encoding or file location is unsupported.'); }
function tooLarge(): never { throw new ReaderError('PAYLOAD_TOO_LARGE', 'The generated image exceeds the 16 MiB output limit. It was not resized.'); }
function absolutePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[%\\:\u0000-\u001f]/u.test(value)) unsupported();
  if (value.slice(1).split('/').some(part => !part || part === '.' || part === '..')) unsupported();
  return value;
}
function sniff(bytes: Uint8Array): Mime | null {
  const starts = (magic: number[]) => bytes.length >= magic.length && magic.every((value, i) => bytes[i] === value);
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (starts([255, 216, 255])) return 'image/jpeg';
  if (bytes.length >= 12 && starts([82, 73, 70, 70]) && [87, 69, 66, 80].every((value, i) => bytes[i + 8] === value)) return 'image/webp';
  return null;
}
const nativeCodec: GeneratedImageCodec = {
  decode(value) {
    if (typeof globalThis.atob !== 'function') unsupported();
    const binary = globalThis.atob(value); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
  encode(bytes) {
    if (typeof globalThis.btoa !== 'function') unsupported();
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
    return globalThis.btoa(chunks.join(''));
  },
};
function inline(value: string, codec: GeneratedImageCodec): { bytes: Uint8Array; encoded: string; mime: Mime } {
  if (!value || value.length > MAX_RESULT) { if (value.length > MAX_RESULT) tooLarge(); unsupported(); }
  let encoded = value; let declared: string | undefined;
  if (value.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,/u.exec(value); if (!match) unsupported();
    declared = match[1]; encoded = value.slice(match[0].length);
  }
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded)) unsupported();
  const length = encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (length > MAX_BYTES) tooLarge(); if (length <= 0) unsupported();
  const bytes = codec.decode(encoded);
  // The round trip also rejects noncanonical pad bits and permissive decoder behaviour.
  if (!(bytes instanceof Uint8Array) || bytes.length !== length || codec.encode(bytes) !== encoded) unsupported();
  const mime = sniff(bytes); if (!mime || (declared && declared !== mime)) unsupported();
  return { bytes, encoded, mime };
}
async function verifyAncestors(host: FileHost, directory: string): Promise<void> {
  let current = '/'; if (!await checkPath(host, current, 'directory')) unsupported();
  for (const part of directory.slice(1).split('/')) {
    current = host.join(current, part); if (!await checkPath(host, current, 'directory')) unsupported();
  }
}

/** Only completed native output is decoded. A result string cannot grant filesystem access. */
export function createGeneratedImageLoader(options: GeneratedImageOptions): (item: unknown, model: string) => Promise<ImageAttachment> {
  if (!Array.isArray(options.allowedOutputDirectories) || options.allowedOutputDirectories.length > 32) unsupported();
  const roots = [...new Set(options.allowedOutputDirectories.map(absolutePath))].sort((a, b) => b.length - a.length);
  // Explicit generated-image subdirectories inside an account home are allowed; the account root is not.
  if (roots.some(root => ['account', 'auth', 'credentials', '.ssh', '.codex'].includes(root.split('/').at(-1)!.toLowerCase()))) unsupported();
  const host = options.host; const codec = options.codec ?? nativeCodec;
  return async (value, model) => {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof model !== 'string' || !model.trim() || model.length > 128) unsupported();
      const item = value as Record<string, unknown>;
      if (Object.keys(item).some(key => !['type', 'id', 'status', 'result', 'savedPath', 'revisedPrompt'].includes(key)) || item.type !== 'imageGeneration' || item.status !== 'completed' || typeof item.id !== 'string' || !item.id || item.id.length > 1024 || typeof item.result !== 'string') unsupported();
      if (item.result.length > MAX_RESULT) tooLarge();
      if (item.revisedPrompt !== undefined && item.revisedPrompt !== null && (typeof item.revisedPrompt !== 'string' || item.revisedPrompt.length > 65536)) unsupported();
      let encoded: string; let mime: Mime;
      if (item.savedPath !== undefined && item.savedPath !== null) {
        const path = absolutePath(item.savedPath);
        // Native versions may echo savedPath as result. Other dual encodings are ambiguous.
        if (item.result !== '' && item.result !== path) unsupported();
        const root = roots.find(root => path.startsWith(root + '/')); if (!root) unsupported();
        const extension = /\.([a-z]+)$/iu.exec(path)?.[1]?.toLowerCase();
        if (!extension || !['png', 'jpg', 'jpeg', 'webp'].includes(extension)) unsupported();
        const directory = path.slice(0, path.lastIndexOf('/'));
        await verifyAncestors(host, directory);
        if (!await checkPath(host, path, 'regular')) unsupported();
        const before = await host.io.stat(path); if (!Number.isSafeInteger(before.size) || before.size < 1) unsupported(); if (before.size > MAX_BYTES) tooLarge();
        // Recheck immediately before read. FileHost intentionally exposes no arbitrary path resolver.
        await verifyAncestors(host, directory); if (host.isSymlink(path)) unsupported();
        const bytes = await host.io.read(path);
        if (!(bytes instanceof Uint8Array) || bytes.length !== before.size) unsupported(); if (bytes.length > MAX_BYTES) tooLarge();
        await verifyAncestors(host, directory); if (!await checkPath(host, path, 'regular') || (await host.io.stat(path)).size !== bytes.length) unsupported();
        const detected = sniff(bytes); if (!detected) unsupported();
        if (detected !== (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg')) unsupported();
        mime = detected; encoded = codec.encode(bytes);
      } else {
        ({ encoded, mime } = inline(item.result, codec));
      }
      const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
      return validateOutputImage({ id: host.uuid(), name: `generated-image.${extension}`, mime, dataUrl: `data:${mime};base64,${encoded}`, origin: { kind: 'generated', model: model.trim() } });
    } catch (error) {
      if (error instanceof ReaderError && error.code === 'PAYLOAD_TOO_LARGE') throw error;
      unsupported();
    }
  };
}
