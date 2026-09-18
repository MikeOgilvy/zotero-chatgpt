import type { ImageAttachment } from '../../../contracts/src/index.ts';
import type { PickedFile } from '../../../contracts/src/workspace.ts';
import { LIMITS, validateImageAttachment, validateOutputImage } from '../../../contracts/src/validation.ts';
import { boundary, contentFingerprint, fail, fileExtension, IMAGE_FILE_EXTENSIONS, IMAGE_FILE_PATTERNS, TEXT_FILE_EXTENSIONS, TEXT_FILE_PATTERNS, bareName, createNativeFiles, type NativeFileOptions } from '../library/native-files.ts';

/**
 * The file actions of the reference surface. Choosing, reading and exporting local files is file IO,
 * not PDF reading, so it lives on the write/IO side of the Zotero adapter; the read port
 * (`library/reference.ts`) stays free of `pickFile`/`exportImage`. Both share the concrete host
 * primitives in `library/native-files.ts`; nothing here invents a second file service.
 */
export interface LibraryFileActions {
  pickFile(): Promise<PickedFile>;
  exportImage(image: ImageAttachment): Promise<void>;
}

/** The reference-port options the file actions also need: the scope id and the clock. */
export interface FileActionOptions extends NativeFileOptions { clientId: string; now?(): string }

export function createFileActions(zotero: unknown, options: FileActionOptions): LibraryFileActions {
  const files = createNativeFiles(zotero, options);
  const now = () => options.now?.() ?? new Date().toISOString();
  return {
    // Explicitly chosen files, attached as real content rather than as a reference to a file the
    // model would have to open itself. The extension chooses the route and the bytes then have to
    // prove it, and the chosen path is dropped here: what leaves this port is a bare file name plus
    // either decoded UTF-8 text (reference context) or a validated image attachment. The model never
    // receives a filesystem path, cannot request a different one, and reads the body as data.
    pickFile: () => boundary(async () => {
      const picker = files.picker('Attach files', 'file');
      picker.appendFilter('Images', IMAGE_FILE_PATTERNS); picker.appendFilter('Text', TEXT_FILE_PATTERNS); picker.appendFilter('All files', '*');
      if (await picker.show() !== picker.returnOK) return { references: [], images: [] };
      const paths = picker.files?.length ? [...picker.files] : (picker.file ? [picker.file] : []);
      if (!paths.length) fail('No file was selected.');
      const references: PickedFile['references'] = [];
      const images: ImageAttachment[] = [];
      for (const path of paths) {
        const name = bareName(path, 'attachment'); const extension = fileExtension(name);
        if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
          images.push(await files.image(await files.read(path, LIMITS.imageBytes), name));
          continue;
        }
        if (!(TEXT_FILE_EXTENSIONS as readonly string[]).includes(extension)) fail(`Attach a text file (${TEXT_FILE_EXTENSIONS.slice(0, 6).join(', ')}, …) or an image (${IMAGE_FILE_EXTENSIONS.join(', ')}).`);
        const bytes = await files.read(path, LIMITS.referenceTextBytes);
        let body: string;
        try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { fail('This file is not UTF-8 text, so it cannot become text context. Attach a text file or an image.'); }
        if (!body.trim()) fail('This file has no text to attach.');
        // A misnamed binary would otherwise reach the model as mojibake. The readable whitespace
        // controls (`\t`, `\n`, `\r`) stay; any other C0 control byte is treated as proof of binary.
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body)) fail('This file looks like binary data, so it cannot become text context.');
        references.push({ id: `file-${options.clientId}-${contentFingerprint(bytes)}`, kind: 'file', label: name, text: body, capturedAt: now() });
      }
      if (images.length > LIMITS.imagesPerRequest) fail(`Choose at most ${LIMITS.imagesPerRequest} images at a time.`);
      return { references, images };
    }, 'The selected file could not be read.'),
    exportImage: original => boundary(async () => {
      const image = original.origin?.kind === 'generated' ? validateOutputImage(original) : validateImageAttachment(original);
      const bytes = Uint8Array.from(atob(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)), char => char.charCodeAt(0));
      await files.decode(bytes, image.mime);
      const picker = files.picker('Export image', 'save', image.name); picker.appendFilter('Image', `*.${image.mime === 'image/jpeg' ? 'jpg' : image.mime.slice('image/'.length)}`);
      const result = await picker.show(); if (result !== picker.returnOK && result !== picker.returnReplace) return;
      if (!picker.file) fail('No export file was selected.'); await files.write(picker.file, bytes);
    }, 'The image could not be exported.'),
  };
}
