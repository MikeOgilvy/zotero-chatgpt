/**
 * The text an owner hands to another application when Chat mode hosts the real ChatGPT web app.
 *
 * Chat mode does not send this text anywhere: the web application owns its own conversation, and no
 * supported mechanism exists to inject context into it. What this host can do honestly is prepare the
 * current paper — the identity it already froze, plus the text it read locally from the PDF — as a
 * plain text block the owner pastes into the application themselves. Nothing here reads a file, calls
 * a model, or reaches the network; the caller decides where the string goes.
 */
import type { DocumentContext, PaperIdentity } from '../../../contracts/src/index.ts';

/** Characters of page text a brief carries before it stops and says so. */
export const DOCUMENT_BRIEF_LIMIT = 12000;
/** The marker the brief itself carries, so a pasted block explains where it came from. */
export const DOCUMENT_BRIEF_HEADER = 'Context from the PDF open in Zotero:';

export interface DocumentBrief {
  /** The whole block, ready for the clipboard. */
  text: string;
  /** Pages whose text is in the block, and how many pages the document has. */
  included: number;
  totalPages: number;
  /** True when the block stops before the document does; `text` then says which pages are missing. */
  truncated: boolean;
}

function describe(identity: PaperIdentity): string {
  const lines = [`Paper: ${identity.title.trim() || 'Untitled'}`];
  const authors = identity.authors.map(author => author.trim()).filter(Boolean);
  if (authors.length > 0) lines.push(`Authors: ${authors.join('; ')}`);
  const where = identity.publicationTitle ?? identity.bookTitle ?? identity.conferenceName ?? identity.journalAbbreviation;
  if (where) lines.push(`Published in: ${where}`);
  if (identity.year) lines.push(`Year: ${identity.year}`);
  if (identity.doi) lines.push(`DOI: ${identity.doi}`);
  return lines.join('\n');
}

/**
 * Build the brief from a prepared document. Returns null when the document carries no page text at
 * all: an owner who is told "the whole PDF is in your clipboard" must not receive an empty promise.
 */
export function documentBrief(identity: PaperIdentity, document: DocumentContext, limit: number = DOCUMENT_BRIEF_LIMIT): DocumentBrief | null {
  const withText = document.pages.filter(page => page.status === 'text' && page.text.trim().length > 0);
  if (withText.length === 0) return null;
  const head = [
    DOCUMENT_BRIEF_HEADER,
    describe(identity),
    `Locally read text from ${withText.length} of ${document.totalPages} pages.`,
    '',
  ].join('\n');
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const page of withText) {
    const block = `[page ${page.pageLabel || page.pageIndex + 1}${page.partial ? ', partial' : ''}]\n${page.text.trim()}`;
    if (used + block.length > limit) {
      truncated = true;
      break;
    }
    parts.push(block);
    used += block.length + 2;
  }
  // A single dense page can be longer than the whole limit. A brief that names the paper and then
  // carries no text at all would be a false promise, so the first page is cut to fit instead and the
  // block says it is partial — the honest version of "here is as much as fits".
  if (parts.length === 0 && withText.length > 0) {
    const page = withText[0]!;
    const label = page.pageLabel || String(page.pageIndex + 1);
    const room = limit - `[page ${label}, partial]\n`.length;
    if (room > 0) parts.push(`[page ${label}, partial]\n${page.text.trim().slice(0, room)}`);
    truncated = true;
  }
  const tail = truncated ? '\n\n[The rest of the PDF was left out so the pasted text stays small.]' : '';
  return { text: `${head}${parts.join('\n\n')}${tail}`, included: parts.length, totalPages: document.totalPages, truncated };
}

/**
 * A selection the reader itself reported through Zotero's selection event, as pasteable text: this is
 * the citation the sidebar already froze, not a second read of the reader's DOM.
 */
export function selectionBrief(citation: { text: string; title: string; pageLabel: string }): string {
  const title = citation.title.trim() || 'Untitled';
  const page = citation.pageLabel.trim();
  return [`Selection from the PDF open in Zotero: ${title}${page ? ` (page ${page})` : ''}`, '', citation.text].join('\n');
}
