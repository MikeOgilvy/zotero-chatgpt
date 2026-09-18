import type { PaperIdentity, PaperScope } from '../../packages/contracts/src/index.ts';
import { readerContext, type ReaderContext } from '../../packages/zotero/src/reader/context.ts';

/**
 * The one reader context a presenter is bound to, built the way the composition root builds it:
 * the durable `PaperScope` is the identity, and the display title is also the frozen paper identity
 * unless a test wants the two to differ.
 */
export function presenterContext(paper: PaperScope, title: string, identity: PaperIdentity = { title, authors: [] }): ReaderContext {
  return readerContext({ attachment: { title, key: paper.attachmentKey, libraryID: paper.libraryId }, paper, identity });
}
