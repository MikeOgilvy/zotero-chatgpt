import { describe, expect, it } from 'vitest';
import {
  ABSTRACT_LIMIT, BIBLIOGRAPHY_KEYS, MAX_PEOPLE, TAG_LIMIT, TAGS_LIMIT,
  bibliographyBlock, bibliographyView, paperIdentityOf, type PaperMetadata,
} from '../../packages/zotero/src/reader/metadata.ts';

const full: PaperMetadata = {
  title: 'A Synthetic Study of Nothing',
  authors: ['Ada Lovelace', 'Grace Hopper'],
  editors: ['Editor Person'],
  year: '2024',
  doi: '10.1000/synthetic',
  itemType: 'journalArticle',
  publicationTitle: 'Journal of Synthetic Results',
  journalAbbreviation: 'J. Synth. Res.',
  volume: '12',
  issue: '3',
  pages: '45-67',
  publisher: 'Synthetic Press',
  language: 'en',
  abstractNote: 'We study nothing.',
  tags: ['synthetic', 'test'],
};

describe('bibliographyBlock', () => {
  it('keeps only known fields, in a fixed order, and omits every unknown one', () => {
    expect(bibliographyBlock({ title: 'Only a Title', authors: [] })).toBe('Title: Only a Title');
    expect(bibliographyBlock(full)).toBe([
      'Title: A Synthetic Study of Nothing',
      'Authors: Ada Lovelace; Grace Hopper',
      'Item type: journalArticle',
      'Journal: Journal of Synthetic Results',
      'Journal abbrev.: J. Synth. Res.',
      'Year: 2024',
      'Volume: 12',
      'Issue: 3',
      'Pages: 45-67',
      'Publisher: Synthetic Press',
      'DOI: 10.1000/synthetic',
      'Language: en',
      'Editors: Editor Person',
      'Tags: synthetic; test',
      'Abstract: We study nothing.',
    ].join('\n'));
  });
  it('never emits a placeholder for a field it did not read', () => {
    const block = bibliographyBlock({ title: 'T', authors: [] });
    for (const word of ['unknown', 'n/a', 'none', 'Journal', 'DOI']) expect(block).not.toContain(word);
  });
  it('normalizes whitespace so one field stays on one line', () => {
    expect(bibliographyBlock({ title: '  A\n  title\twith   spaces ', authors: [' A\nB '] })).toBe('Title: A title with spaces\nAuthors: A B');
  });
  it('truncates a long abstract deterministically, by code point, with one ellipsis', () => {
    const abstractNote = '文'.repeat(ABSTRACT_LIMIT + 500);
    const once = bibliographyBlock({ title: 'T', authors: [], abstractNote });
    const twice = bibliographyBlock({ title: 'T', authors: [], abstractNote });
    expect(once).toBe(twice);
    const line = once.split('\n').find(entry => entry.startsWith('Abstract: '))!.slice('Abstract: '.length);
    expect([...line]).toHaveLength(ABSTRACT_LIMIT);
    expect(line.endsWith('…')).toBe(true);
    expect(bibliographyBlock({ title: 'T', authors: [], abstractNote: 'x'.repeat(ABSTRACT_LIMIT) })).toBe(`Title: T\nAbstract: ${'x'.repeat(ABSTRACT_LIMIT)}`);
  });
  it('is empty and safe for missing or illegal input instead of throwing', () => {
    expect(bibliographyBlock({ title: '', authors: [] })).toBe('');
    expect(bibliographyBlock(undefined as unknown as PaperMetadata)).toBe('');
    expect(bibliographyBlock({ title: 7, authors: 'Ada' } as unknown as PaperMetadata)).toBe('');
  });
});

describe('bibliographyView', () => {
  it('reports every declared field exactly once, in a stable order, with a known flag', () => {
    const view = bibliographyView(full);
    expect(view.fields.map(field => field.key)).toEqual([...BIBLIOGRAPHY_KEYS]);
    expect(view.fields.every(field => typeof field.known === 'boolean')).toBe(true);
    const known = Object.fromEntries(view.fields.map(field => [field.key, field.known]));
    expect(known).toEqual({ itemType: true, publicationTitle: true, journalAbbreviation: true, bookTitle: false, conferenceName: false, proceedingsTitle: false, publisher: true, university: false, institution: false, year: true, volume: true, issue: true, pages: true, doi: true, isbn: false, issn: false, language: true, editors: true, tags: true, abstractNote: true });
    expect(view.title).toBe('A Synthetic Study of Nothing');
    expect(view.authors).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });
  it('omits the value of an unknown field and marks a truncated value', () => {
    const view = bibliographyView({ title: 'T', authors: [], abstractNote: 'x'.repeat(ABSTRACT_LIMIT + 1) });
    const abstract = view.fields.find(field => field.key === 'abstractNote')!;
    expect(abstract).toMatchObject({ known: true, truncated: true });
    expect([...(abstract.value as string)]).toHaveLength(ABSTRACT_LIMIT);
    const missing = view.fields.find(field => field.key === 'doi')!;
    expect(missing).toEqual({ key: 'doi', known: false });
  });
  it('does not list a book title or a conference name it never read, and lists the one it did', () => {
    const conference = bibliographyView({ title: 'T', authors: [], itemType: 'conferencePaper', conferenceName: 'NeurIPS', proceedingsTitle: 'NeurIPS 36' });
    expect(conference.fields.find(field => field.key === 'conferenceName')).toEqual({ key: 'conferenceName', known: true, value: 'NeurIPS' });
    expect(conference.fields.find(field => field.key === 'bookTitle')).toEqual({ key: 'bookTitle', known: false });
  });
});

describe('paperIdentityOf', () => {
  it('keeps the verified fields and never fills an absent one', () => {
    const identity = paperIdentityOf(full);
    expect(identity).toEqual({
      title: 'A Synthetic Study of Nothing', authors: ['Ada Lovelace', 'Grace Hopper'], year: '2024', doi: '10.1000/synthetic',
      itemType: 'journalArticle', publicationTitle: 'Journal of Synthetic Results', journalAbbreviation: 'J. Synth. Res.',
      volume: '12', issue: '3', pages: '45-67', publisher: 'Synthetic Press', language: 'en', abstractNote: 'We study nothing.',
      tags: ['synthetic', 'test'], editors: ['Editor Person'],
    });
    const bare = paperIdentityOf({ title: '', authors: [] }, 'Standalone.pdf');
    expect(bare).toEqual({ title: 'Standalone.pdf', authors: [] });
  });
  it('caps lists and text to what the contracts accept', () => {
    const identity = paperIdentityOf({
      title: 'T', authors: Array.from({ length: MAX_PEOPLE + 5 }, () => 'A'.repeat(400)),
      tags: Array.from({ length: TAGS_LIMIT + 5 }, () => 't'.repeat(TAG_LIMIT + 5)),
      editors: Array.from({ length: MAX_PEOPLE + 5 }, () => 'E'.repeat(400)),
      abstractNote: 'a'.repeat(ABSTRACT_LIMIT + 5), volume: 'v'.repeat(4000),
    });
    expect(identity.authors).toHaveLength(MAX_PEOPLE);
    expect(identity.authors[0]!).toHaveLength(256);
    expect(identity.editors).toHaveLength(MAX_PEOPLE);
    expect(identity.tags).toHaveLength(TAGS_LIMIT);
    expect(identity.tags![0]!).toHaveLength(TAG_LIMIT);
    expect([...identity.abstractNote!]).toHaveLength(ABSTRACT_LIMIT);
    expect(identity.volume!).toHaveLength(512);
  });
  it('treats illegal input as no metadata rather than throwing', () => {
    expect(paperIdentityOf({ title: 'T', authors: [], tags: 4, editors: null } as unknown as PaperMetadata)).toEqual({ title: 'T', authors: [] });
  });
});
