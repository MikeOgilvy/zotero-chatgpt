import type { Citation, DocumentContext, PaperIdentity, PaperScope } from '../../../contracts/src/index.ts';
import { paperIdentityOf } from '../../../core/src/context/bibliography.ts';
import type { DocumentProgress, DocumentSource, ReaderDocumentCache } from './document.ts';
import type { HostReader, ZoteroHost } from './host-types.ts';
import { paperMetadata } from './selection.ts';

/**
 * The one aggregation of "the PDF the reader currently has open": host attachment identity, durable
 * `PaperScope` identity, the frozen bibliographic identity, the last completed local read (its text
 * and the frozen file revision `prepared.revision`), the requested physical page range and the local
 * read status. It composes `PaperScope`, `DocumentContext` and `ReaderDocumentCache` — it never
 * extracts PDF text or computes a revision/hash of its own.
 *
 * Ownership: the presenter holds exactly one of these in `PresenterState.document`, and both the
 * Chat turn and the Agent (task/reading) turn read that same object. There is no second copy.
 *
 * Deliberately not aggregated here: the live view anchor (page, scroll offset, zoom, dock width).
 * Those are per-view DOM state owned by `reader-pane.ts` / `layout.ts` and are captured on demand by
 * `capturePosition`; copying them into an attachment-scoped context would create a second owner for
 * a value the reader itself already keeps. `range` below is the *requested* page range (what the
 * sidebar asks to read), not a mirror of the anchor the PDF viewer happens to be on.
 */

/** Host-facing identity of the open attachment. The title is display copy; key + library are identity. */
export interface AttachmentIdentity { title: string; key: string; libraryID: number }

/** The durable paper identity an attachment belongs to: profile clientId + library + attachment key. */
export function paperScope(clientId: string, attachment: AttachmentIdentity): PaperScope {
  return { clientId, libraryId: attachment.libraryID, attachmentKey: attachment.key };
}

/** The open attachment's host identity, or undefined when the reader's item is gone. */
export function attachmentIdentity(zotero: ZoteroHost, reader: HostReader): AttachmentIdentity | undefined {
  const item = zotero.Items.get(reader.itemID);
  return item && { title: item.getField('title'), key: item.key, libraryID: item.libraryID };
}

/** The local read/prepare state the sidebar reports for the current PDF. */
export interface ReaderContext {
  attachment: AttachmentIdentity;
  paper: PaperScope;
  identity: PaperIdentity;
  /** The last completed local read for this attachment and range; null before one completes. */
  prepared: DocumentContext | null;
  /** Requested physical page range, 1-based inclusive; null means the whole document. */
  range: [number, number] | null;
  /** The `extensions.zchatgpt.automaticPdfText` opt-in, re-read at every request boundary. */
  enabled: boolean;
  /** First-send disclosure still owed for this attachment; cleared once acknowledged. */
  disclosure: boolean;
  phase: 'idle' | 'preparing' | 'ready' | 'error';
  progress: DocumentProgress;
  error: string | null;
}

/**
 * Build a context for one attachment. Without a live host reader (tests, history opens) the
 * attachment's display title falls back to the frozen identity title; key and library always come
 * from the durable `PaperScope`, so the identity itself is never invented.
 */
export function readerContext(input: { attachment?: AttachmentIdentity; paper: PaperScope; identity: PaperIdentity }): ReaderContext {
  return {
    attachment: input.attachment ?? { title: input.identity.title, key: input.paper.attachmentKey, libraryID: input.paper.libraryId },
    paper: input.paper,
    identity: input.identity,
    prepared: null,
    range: null,
    enabled: false,
    disclosure: false,
    phase: 'idle',
    progress: { done: 0, total: 0 },
    error: null,
  };
}

/**
 * Freeze everything the reader knows about this attachment into one context. The identity field list,
 * caps and "absent stays absent" rule belong to `paperIdentityOf`, so the sidebar card, the
 * `@`-reference listing and the reading JSON all describe the same paper the same way.
 */
export function readerContextFor(zotero: ZoteroHost, attachment: AttachmentIdentity, reader: HostReader | undefined, clientId: string): ReaderContext {
  const metadata = reader ? paperMetadata(zotero, reader) : undefined;
  return readerContext({
    attachment,
    paper: paperScope(clientId, attachment),
    identity: paperIdentityOf(metadata ?? { title: '', authors: [] }, metadata?.title.trim() || attachment.title || 'PDF attachment'),
  });
}

/**
 * The citation the sidebar treats as the active source. The selection itself lives on the draft,
 * which is the one writable owner (and what gets persisted); this only applies the rule, so the
 * reader context does not grow a second copy that could drift. A frozen selection is the last one
 * the draft carries; when the draft has none, the newest recorded turn still carrying one wins.
 */
export function activeCitation(draft: readonly Citation[], history: readonly { citations?: readonly Citation[] }[]): Citation | null {
  const selected = draft.at(-1);
  if (selected) return selected;
  for (let i = history.length - 1; i >= 0; i--) {
    const recorded = history[i]?.citations?.at(-1);
    if (recorded) return recorded;
  }
  return null;
}

/**
 * The presenter's document port. It composes the one `ReaderDocumentCache` and the native source for
 * this attachment; extraction, page reads and the file revision/hash check stay in `reader/document.ts`.
 */
export interface DocumentServices {
  prepare(signal: AbortSignal, progress: (p: DocumentProgress) => void, range?: readonly [number, number]): Promise<DocumentContext>;
  validate(document: DocumentContext): Promise<void>;
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
  needsDisclosure?(): boolean;
  acknowledge?(): void;
}

/** The `extensions.zchatgpt.automaticPdfText` opt-in and the first-send disclosure flag. */
export interface AutomaticTextPreference {
  read(): boolean;
  write(enabled: boolean): void;
  disclosureSeen(): boolean;
  markDisclosureSeen(): void;
}

/** The host port behind `DocumentServices`: one cache for the plugin, one source for this attachment. */
export function nativeDocumentServices(input: {
  paper: PaperScope;
  source: { capture: (signal?: AbortSignal) => Promise<DocumentSource>; validate: (document: DocumentContext) => Promise<void> };
  cache(): ReaderDocumentCache | undefined;
  automaticText: AutomaticTextPreference;
}): DocumentServices {
  return {
    readEnabled: () => input.automaticText.read(),
    writeEnabled: enabled => input.automaticText.write(enabled),
    needsDisclosure: () => !input.automaticText.disclosureSeen(),
    acknowledge: () => input.automaticText.markDisclosureSeen(),
    prepare: async (signal, progress, range) => {
      const captured = await input.source.capture(signal);
      const cache = input.cache();
      if (!cache) throw new Error('PDF preparation is unavailable.');
      return cache.read(input.paper, captured, signal, progress, range);
    },
    validate: input.source.validate,
  };
}
