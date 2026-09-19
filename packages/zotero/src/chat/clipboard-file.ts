/**
 * Put a real file on the OS clipboard, so the owner can paste it into the hosted ChatGPT page.
 *
 * Chat mode hosts the actual web application, and this host has no supported way to hand it a file:
 * the application owns its own upload UI, its document is remote, and driving that UI would mean
 * hardcoded selectors against someone else's markup. What Gecko does support is the ordinary file
 * paste: with the PDF on the clipboard, the owner pastes into ChatGPT's own composer and ChatGPT's
 * own upload path attaches the real document. This module only performs that clipboard write.
 *
 * Everything here is injectable, so the flavor handling is unit-testable without a pasteboard.
 */
import { clipboardService, pluginClipboardAccess, type GeckoClipboardAccess } from './pick-images.ts';

/** The one flavor a file paste uses; web content sees it as a `File` in the paste event. */
export const FILE_FLAVOR = 'application/x-moz-file';

export type FileClipboardOutcome = 'copied' | 'unsupported' | 'failed';

interface GeckoTransferable {
  init?(context: unknown): void;
  addDataFlavor?(flavor: string): void;
  setTransferData?(flavor: string, data: unknown, length: number): void;
}

function call(target: unknown, name: string, args: unknown[]): unknown {
  const record = target as Record<string, unknown> | null;
  const method = record ? record[name] : undefined;
  if (typeof method !== 'function') return undefined;
  return Reflect.apply(method, record, args) as unknown;
}

/**
 * Write `path` to the clipboard as a file. `'unsupported'` means this realm has no pasteboard at all
 * (a content realm has neither `Cc` nor `Services`); `'failed'` means the write itself threw. The
 * caller says which of the three happened instead of claiming the file was copied.
 */
export function copyFileToClipboard(path: string, access: GeckoClipboardAccess | null = pluginClipboardAccess()): FileClipboardOutcome {
  if (!path) return 'failed';
  const clipboard = clipboardService(access);
  const components = access?.Cc;
  if (!clipboard || typeof clipboard.setData !== 'function' || !components) return 'unsupported';
  const transferable = components['@mozilla.org/widget/transferable;1']?.createInstance?.(access?.Ci?.nsITransferable) as GeckoTransferable | undefined;
  const file = components['@mozilla.org/file/local;1']?.createInstance?.(access?.Ci?.nsIFile);
  if (!transferable || !file) return 'unsupported';
  try {
    call(transferable, 'init', [null]);
    call(file, 'initWithPath', [path]);
    call(transferable, 'addDataFlavor', [FILE_FLAVOR]);
    // Length 0 lets the transferable take the length from the file object itself.
    call(transferable, 'setTransferData', [FILE_FLAVOR, file, 0]);
    clipboard.setData(transferable, null, clipboard.kGlobalClipboard ?? 1);
    return 'copied';
  } catch {
    return 'failed';
  }
}
