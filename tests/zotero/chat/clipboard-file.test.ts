import { describe, expect, it, vi } from 'vitest';
import { FILE_FLAVOR, copyFileToClipboard } from '../../../packages/zotero/src/chat/clipboard-file.ts';
import type { GeckoClipboardAccess } from '../../../packages/zotero/src/chat/pick-images.ts';

/** A pasteboard double recording the transferable the writer built and every flavor call on it. */
function pasteboard(options: { failOn?: string; noTransferable?: boolean } = {}) {
  const boom = (name: string) => { if (options.failOn === name) throw new Error('pasteboard refused'); };
  const file = { initWithPath: vi.fn((path: string) => { boom('initWithPath'); void path; }) };
  const transferable = {
    init: vi.fn((context: unknown) => { boom('init'); void context; }),
    addDataFlavor: vi.fn((flavor: string) => { boom('addDataFlavor'); void flavor; }),
    setTransferData: vi.fn((flavor: string, data: unknown, length: number) => { boom('setTransferData'); void flavor; void data; void length; }),
  };
  const setData = vi.fn((...args: unknown[]) => { boom('setData'); void args; });
  const access: GeckoClipboardAccess = {
    Ci: { nsITransferable: {}, nsIFile: {}, nsIClipboard: {} },
    Cc: {
      '@mozilla.org/widget/transferable;1': { createInstance: () => (options.noTransferable ? undefined : transferable) },
      '@mozilla.org/file/local;1': { createInstance: () => file },
    },
    Services: { clipboard: { kGlobalClipboard: 1, setData } },
  };
  return { access, file, transferable, setData };
}

describe('copyFileToClipboard', () => {
  it('writes the file flavor with the nsIFile for the given path and the global clipboard', () => {
    const board = pasteboard();
    expect(copyFileToClipboard('/Users/someone/Library/papers/paper.pdf', board.access)).toBe('copied');
    expect(board.file.initWithPath).toHaveBeenCalledWith('/Users/someone/Library/papers/paper.pdf');
    expect(board.transferable.addDataFlavor).toHaveBeenCalledWith(FILE_FLAVOR);
    // Length 0 asks the transferable to take the length from the file object itself.
    expect(board.transferable.setTransferData).toHaveBeenCalledWith(FILE_FLAVOR, board.file, 0);
    expect(board.setData).toHaveBeenCalledWith(board.transferable, null, 1);
  });

  it('says the realm cannot write files rather than reporting a copy that did not happen', () => {
    const board = pasteboard({ noTransferable: true });
    expect(copyFileToClipboard('/tmp/paper.pdf', board.access)).toBe('unsupported');
    expect(board.setData).not.toHaveBeenCalled();
    // A content realm has no pasteboard at all; that is the same answer, not a failure.
    expect(copyFileToClipboard('/tmp/paper.pdf', null)).toBe('unsupported');
    expect(copyFileToClipboard('/tmp/paper.pdf', { Cc: {} })).toBe('unsupported');
  });

  it('reports a refused write as failed and never as copied', () => {
    expect(copyFileToClipboard('/tmp/paper.pdf', pasteboard({ failOn: 'setTransferData' }).access)).toBe('failed');
    expect(copyFileToClipboard('/tmp/paper.pdf', pasteboard({ failOn: 'setData' }).access)).toBe('failed');
    expect(copyFileToClipboard('', pasteboard().access)).toBe('failed');
  });

  it('shares the image reader\'s clipboard service resolution instead of inventing a second one', () => {
    const viaFactory = pasteboard();
    const getService = vi.fn(() => viaFactory.access.Services!.clipboard);
    const access: GeckoClipboardAccess = {
      Ci: { ...viaFactory.access.Ci },
      Cc: { ...viaFactory.access.Cc, '@mozilla.org/widget/clipboard;1': { getService } },
    };
    // Without Services.clipboard the component factory is asked for the service, exactly as the
    // image-read path does, so a realm where only Cc exists still works.
    expect(copyFileToClipboard('/tmp/paper.pdf', access)).toBe('copied');
    expect(getService).toHaveBeenCalled();
  });
});
