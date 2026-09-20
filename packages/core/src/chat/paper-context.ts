/**
 * The text an owner copies from the sidebar's paper toolbar: the *bibliographic* facts of the paper
 * the reader has open, plus its abstract.
 *
 * It is deliberately not the PDF. `documentBrief` is what the automatic ChatGPT context sends, and
 * it carries locally read page text. This module carries only what the frozen `PaperIdentity` already
 * holds — the fields the reader read from the Zotero parent item — so a manual copy can never smuggle
 * page text, a selection, a previous answer or a coverage/status string into the clipboard.
 *
 * Pure and host-free: the caller passes the identity it froze, and every rule below is about spelling,
 * cleaning and omission. Nothing here reads a file, calls a model, or touches the network.
 */
import type { PaperIdentity } from '../../../contracts/src/index.ts';

/** Labels already on a DOI: Zotero stored the identifier, not the browser address. */
const DOI_PREFIXES: readonly RegExp[] = [
  /^doi:\s*/iu,
  /^https?:\/\/(?:dx\.)?doi\.org\//iu,
  /^urn:doi:/iu,
  /^info:doi\//iu,
];

/**
 * Removes a resolver/`doi:` label and surrounding whitespace, looping so a doubly wrapped value
 * (`https://doi.org/doi:10.1/…`) still comes out bare. The suffix itself is never rewritten.
 */
export function normalizeDoi(value: string): string {
  let doi = typeof value === 'string' ? value.trim() : '';
  for (let guard = 0; guard < DOI_PREFIXES.length + 1; guard += 1) {
    const before = doi;
    for (const prefix of DOI_PREFIXES) doi = doi.replace(prefix, '').trim();
    if (doi === before) break;
  }
  return doi.replace(/\s+/gu, '');
}

/** An HTML start/end tag tied to a real element name, so `x < 5` and `a > b` survive untouched. */
const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^<>]*)?\/?>/gu;
const BLOCK_END = /<\/(?:p|div|li|h[1-6]|blockquote|section|tr|td|th)\s*>/giu;
const LINE_BREAK = /<br\s*\/?\s*>/giu;
const ENTITY = /&(?:#(?:x[0-9a-fA-F]+|[0-9]+)|[a-zA-Z][a-zA-Z0-9]*);/gu;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'' };

/** Decodes the handful of entities a Zotero abstract realistically carries; an unknown one is kept. */
function decodeEntities(value: string): string {
  return value.replace(ENTITY, match => {
    const body = match.slice(1, -1);
    if (body.startsWith('#')) {
      const hex = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try { return String.fromCodePoint(code); } catch { return match; }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Turns a stored abstract into plain pasteable text without executing or fetching anything: markup
 * is dropped, paragraph boundaries become blank lines, runs of spaces/tabs collapse, and line
 * contents are trimmed. Unicode, math text and meaningful line breaks are preserved — the result is
 * still the author's abstract, not a summary and not the first paragraphs of the PDF.
 */
export function cleanAbstract(value: string): string {
  if (typeof value !== 'string') return '';
  const text = decodeEntities(
    value.replace(/\r\n?/gu, '\n').replace(LINE_BREAK, '\n').replace(BLOCK_END, '\n\n').replace(HTML_TAG, ' '),
  );
  return text
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** One-line fields collapse every whitespace run, so a value can never wrap into a second `Label:` line. */
function oneLine(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

/**
 * The real publication carrier for this item type. A journal article reads its journal; a conference
 * paper its proceedings; a thesis its university. Nothing is invented for a type that carries none,
 * and a bare PDF (no `itemType`) never gets a fabricated journal name.
 */
export function publicationOf(identity: PaperIdentity): string {
  const itemType = (identity.itemType ?? '').toLowerCase();
  const order: Array<keyof PaperIdentity> = itemType.includes('conference')
    ? ['proceedingsTitle', 'conferenceName', 'publicationTitle', 'journalAbbreviation', 'bookTitle', 'publisher']
    : itemType.includes('book')
      ? ['bookTitle', 'publisher', 'publicationTitle']
      : itemType.includes('thesis')
        ? ['university', 'institution', 'publisher']
        : itemType.includes('report')
          ? ['institution', 'publisher']
          : ['publicationTitle', 'journalAbbreviation', 'proceedingsTitle', 'conferenceName', 'bookTitle', 'university', 'institution', 'publisher'];
  for (const key of order) {
    const value = oneLine(identity[key]);
    if (value) return value;
  }
  return '';
}

/**
 * True when the identity carries something a bibliography can prove: a declared item type, an author,
 * a carrier, a year, a DOI or an abstract. A bare PDF whose only value is the attachment filename
 * proves nothing, so a copy of it is refused rather than dressing up a file name as a citation.
 */
export function hasBibliographicIdentity(identity: PaperIdentity): boolean {
  if (oneLine(identity.itemType)) return true;
  if (Array.isArray(identity.authors) && identity.authors.some(author => oneLine(author))) return true;
  return Boolean(oneLine(identity.year) || oneLine(identity.doi) || oneLine(identity.abstractNote) || publicationOf(identity));
}

export interface PaperContext {
  /** The whole block, ready for the clipboard. */
  text: string;
  /** The field labels actually written, in order, for honest feedback. */
  fields: string[];
  /** False when the stored item carried no abstract; the block then has no `Abstract:` section. */
  hasAbstract: boolean;
}

/**
 * Build the pasteable block. Returns null when the frozen identity proves no bibliographic fact — the
 * caller reports "nothing to copy" instead of copying a placeholder. Missing fields are omitted
 * entirely (no `N/A`, no `Unknown`, no empty labels), and an absent abstract creates no section.
 */
export function paperContext(identity: PaperIdentity): PaperContext | null {
  if (!identity || typeof identity !== 'object' || !hasBibliographicIdentity(identity)) return null;
  const title = oneLine(identity.title);
  const authors = (Array.isArray(identity.authors) ? identity.authors : []).map(oneLine).filter(Boolean);
  const publication = publicationOf(identity);
  const year = oneLine(identity.year);
  const doi = normalizeDoi(oneLine(identity.doi));
  const abstract = oneLine(identity.abstractNote) ? cleanAbstract(identity.abstractNote!) : '';

  const lines: string[] = [];
  const fields: string[] = [];
  const push = (label: string, value: string) => { if (value) { lines.push(`${label}: ${value}`); fields.push(label); } };
  push('Title', title);
  push('Authors', authors.join('; '));
  push('Publication', publication);
  push('Year', year);
  push('DOI', doi);
  if (!lines.length && !abstract) return null;
  if (abstract) fields.push('Abstract');
  const head = lines.join('\n');
  const text = abstract ? (head ? `${head}\n\nAbstract:\n${abstract}` : `Abstract:\n${abstract}`) : head;
  return { text, fields, hasAbstract: Boolean(abstract) };
}
