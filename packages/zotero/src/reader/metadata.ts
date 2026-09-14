import type { PaperIdentity } from '../../../contracts/src/index.ts';

/**
 * Pure bibliography formatting for the reader, and the shape the Zotero layer reads from the host.
 *
 * No DOM, no Zotero and no Node: the caller passes fields it already read (see `selection.ts`), and
 * these functions only decide how they are spelled, truncated and frozen. The field names mirror
 * Zotero's own item field names because each value comes from exactly one `getField` call; Zotero
 * 9.0.6's bundled global schema (`resources/app/omni.ja` → `…/resource/schema/global/schema.json`)
 * declares `publicationTitle`, `journalAbbreviation`, `bookTitle`, `conferenceName`,
 * `proceedingsTitle`, `university`, `institution`, `volume`, `issue`, `pages`, `publisher`, `ISBN`,
 * `ISSN`, `language` and `abstractNote`, and `getField` returns `''` for a field that is valid but
 * unset on the item type (`item.js:283-288`), so a bare field never becomes a fabricated value.
 */

/** Every single-line field is capped the same way the contracts cap it (LIMITS.metadataFieldChars). */
export const METADATA_FIELD_LIMIT = 512;
/** Abstract is the one long field; the contracts accept LIMITS.abstractChars = 2048. */
export const ABSTRACT_LIMIT = 2000;
export const TAG_LIMIT = 128;
export const TAGS_LIMIT = 24;
/** Mirrors contracts LIMITS.authors / LIMITS.authorChars for both author and editor lists. */
export const MAX_PEOPLE = 50;
export const PERSON_LIMIT = 256;
export const YEAR_LIMIT = 16;
export const DOI_LIMIT = 256;

/**
 * Bibliographic fields read from a Zotero parent item (or the attachment when it stands alone).
 * `title`/`authors` exist for every paper; every other field is absent unless Zotero declared a value.
 */
export interface PaperMetadata {
  title: string;
  authors: string[];
  editors?: string[];
  year?: string;
  doi?: string;
  itemType?: string;
  publicationTitle?: string;
  journalAbbreviation?: string;
  bookTitle?: string;
  conferenceName?: string;
  proceedingsTitle?: string;
  university?: string;
  institution?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  isbn?: string;
  issn?: string;
  language?: string;
  abstractNote?: string;
  tags?: string[];
}

/** Fixed order for both the model block and the sidebar card, independent of object key order. */
export const BIBLIOGRAPHY_KEYS = ['itemType', 'publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'year', 'volume', 'issue', 'pages', 'publisher', 'university', 'institution', 'doi', 'isbn', 'issn', 'language', 'editors', 'tags', 'abstractNote'] as const;
export type BibliographyFieldKey = typeof BIBLIOGRAPHY_KEYS[number];

/** One field of the sidebar card. `known: false` carries no value on purpose. */
export interface BibliographyField { key: BibliographyFieldKey; known: boolean; value?: string; truncated?: true }
export interface BibliographyView { title: string; authors: string[]; fields: BibliographyField[] }

const FIELD_LABELS: Record<BibliographyFieldKey, string> = {
  itemType: 'Item type', publicationTitle: 'Journal', journalAbbreviation: 'Journal abbrev.',
  bookTitle: 'Book', conferenceName: 'Conference', proceedingsTitle: 'Proceedings', publisher: 'Publisher',
  university: 'University', institution: 'Institution', year: 'Year', volume: 'Volume', issue: 'Issue',
  pages: 'Pages', doi: 'DOI', isbn: 'ISBN', issn: 'ISSN', language: 'Language', editors: 'Editors',
  tags: 'Tags', abstractNote: 'Abstract',
};
const FIELD_LIMITS: Record<BibliographyFieldKey, number> = {
  ...Object.fromEntries(BIBLIOGRAPHY_KEYS.map(key => [key, METADATA_FIELD_LIMIT])) as Record<BibliographyFieldKey, number>,
  year: YEAR_LIMIT, doi: DOI_LIMIT, abstractNote: ABSTRACT_LIMIT,
};

/** Collapses every whitespace run to one space so one field always occupies one line. Non-strings are absent. */
function normalize(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}
function normalizeList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(normalize).filter(Boolean);
}
/** At most `limit` code points, ellipsis included, so the result always fits the contract limit. */
function truncate(value: string, limit: number): { text: string; truncated: boolean } {
  const points = [...value];
  if (points.length <= limit) return { text: value, truncated: false };
  return { text: `${points.slice(0, limit - 1).join('')}…`, truncated: true };
}
/** Never throws on a null/primitive: illegal input reads as "no metadata". */
function asMetadata(value: PaperMetadata): PaperMetadata {
  return value && typeof value === 'object' ? value : ({} as PaperMetadata);
}
function fieldValue(metadata: PaperMetadata, key: BibliographyFieldKey): string {
  if (!metadata || typeof metadata !== 'object') return '';
  if (key === 'editors') return normalizeList(metadata.editors).join('; ');
  if (key === 'tags') return normalizeList(metadata.tags).join('; ');
  return normalize((metadata as unknown as Record<string, unknown>)[key]);
}

/**
 * Compact bibliographic block for model context: `Label: value` lines, unknown fields omitted (no
 * "Journal: unknown" noise), in `BIBLIOGRAPHY_KEYS` order after Title and Authors. The abstract is
 * truncated to `ABSTRACT_LIMIT` code points with one trailing ellipsis; every other field to
 * `METADATA_FIELD_LIMIT`. Returns `''` when nothing is known.
 */
export function bibliographyBlock(metadata: PaperMetadata): string {
  const source = asMetadata(metadata);
  const lines: string[] = [];
  const push = (label: string, value: string, limit: number) => {
    const text = normalize(value);
    if (text) lines.push(`${label}: ${truncate(text, limit).text}`);
  };
  push('Title', normalize(source.title), METADATA_FIELD_LIMIT);
  push('Authors', normalizeList(source.authors).join('; '), METADATA_FIELD_LIMIT);
  for (const key of BIBLIOGRAPHY_KEYS) push(FIELD_LABELS[key], fieldValue(source, key), FIELD_LIMITS[key]);
  return lines.join('\n');
}

/**
 * Stable structure for the sidebar card. `fields` always holds every declared key once, in
 * `BIBLIOGRAPHY_KEYS` order, so the view can render "what this paper is" and know which fields the
 * reader actually read (`known`) rather than guessing from a missing line in prose.
 */
export function bibliographyView(metadata: PaperMetadata): BibliographyView {
  const source = asMetadata(metadata);
  return {
    title: normalize(source.title),
    authors: normalizeList(source.authors),
    fields: BIBLIOGRAPHY_KEYS.map(key => {
      const value = fieldValue(source, key);
      if (!value) return { key, known: false };
      const cut = truncate(value, FIELD_LIMITS[key]);
      return { key, known: true, value: cut.text, ...(cut.truncated ? { truncated: true as const } : {}) };
    }),
  };
}

/**
 * Freezes the extracted fields into the shared `PaperIdentity`. Absent fields stay absent (they are
 * hashed verbatim by hashVersion 2, so injecting a default would change a rebuilt request's hash),
 * and every value is capped to what `validatePaperIdentity` accepts. `fallbackTitle` is the caller's
 * existing title chain (attachment filename, "PDF attachment"): the contracts require a non-empty
 * title, so the caller must pass one.
 */
export function paperIdentityOf(metadata: PaperMetadata, fallbackTitle = ''): PaperIdentity {
  const source = asMetadata(metadata);
  const people = (value: unknown) => normalizeList(value).slice(0, MAX_PEOPLE).map(name => truncate(name, PERSON_LIMIT).text);
  const result: PaperIdentity = {
    title: truncate(normalize(source.title) || normalize(fallbackTitle), METADATA_FIELD_LIMIT).text,
    authors: people(source.authors),
  };
  for (const key of ['itemType', 'publicationTitle', 'journalAbbreviation', 'bookTitle', 'conferenceName', 'proceedingsTitle', 'publisher', 'university', 'institution', 'volume', 'issue', 'pages', 'isbn', 'issn', 'language'] as const) {
    const value = normalize(source[key]);
    if (value) result[key] = truncate(value, METADATA_FIELD_LIMIT).text;
  }
  const year = normalize(source.year); if (year) result.year = truncate(year, YEAR_LIMIT).text;
  const doi = normalize(source.doi); if (doi) result.doi = truncate(doi, DOI_LIMIT).text;
  const editors = people(source.editors); if (editors.length) result.editors = editors;
  const tags = normalizeList(source.tags).slice(0, TAGS_LIMIT).map(tag => truncate(tag, TAG_LIMIT).text); if (tags.length) result.tags = tags;
  const abstractNote = normalize(source.abstractNote); if (abstractNote) result.abstractNote = truncate(abstractNote, ABSTRACT_LIMIT).text;
  return result;
}
