import type { ImageAttachment } from './index.ts';
import { LIMITS } from './validation.ts';

/**
 * The one place raw bytes become an {@link ImageAttachment}. Both the composer's clipboard/drop
 * handling and the Zotero file/image ports need this exact conversion (size cap, magic sniff, bare
 * name, data URL), so it lives in `contracts` rather than in either caller. It is deliberately not
 * a file service: one pure function, no host access.
 */
const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46];
const PDF = [0x25, 0x50, 0x44, 0x46];

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

/** A validated attachment, or `undefined` when the bytes are empty, oversize or not a known image. */
export function imageFromBytes(input: { id: string; name: string; bytes: Uint8Array }): ImageAttachment | undefined {
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > LIMITS.imageBytes) return undefined;
  const mime = sniffImageMime(input.bytes);
  if (!mime) return undefined;
  const name = input.name.split(/[/\\]/u).at(-1)?.trim() || 'image';
  if (name.toLowerCase().endsWith('.pdf')) return undefined;
  return { id: input.id, name, mime, dataUrl: `data:${mime};base64,${toBase64(input.bytes)}` };
}
