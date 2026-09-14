import { describe, expect, it } from 'vitest';
import { ReaderError, type PaperIdentity } from '../../packages/contracts/src/index.ts';
import { LIMITS, validatePaperIdentity } from '../../packages/contracts/src/validation.ts';

function expectCode(run: () => unknown, code: string) {
  try { run(); } catch (error) { expect(error).toBeInstanceOf(ReaderError); expect((error as ReaderError).code).toBe(code); return; }
  throw new Error('expected a ReaderError');
}

const base: PaperIdentity = { title: 'Synthetic Paper A', authors: ['Ada'] };
/** Exactly the declared fields of a journal article, as `reader/selection.ts` would freeze them. */
const extended: PaperIdentity = {
  ...base, year: '2024', doi: '10.1000/synthetic',
  itemType: 'journalArticle', publicationTitle: 'Journal of Synthetic Results', journalAbbreviation: 'J. Synth. Res.',
  volume: '12', issue: '3', pages: '45-67', publisher: 'Synthetic Press', language: 'en',
  abstractNote: 'A synthetic abstract.', tags: ['synthetic', 'test'], editors: ['Editor Person'],
};

describe('paper identity', () => {
  it('keeps the legacy four-field shape and never injects an absent optional field', () => {
    expect(validatePaperIdentity(base)).toEqual(base);
    // hashVersion: 2 reconstruction hashes `paper` verbatim, so a default added here would change it.
    for (const key of ['year', 'doi', 'itemType', 'publicationTitle', 'journalAbbreviation', 'volume', 'issue', 'pages', 'publisher', 'conferenceName', 'university', 'isbn', 'issn', 'language', 'abstractNote', 'tags', 'editors'])
      expect(Object.hasOwn(validatePaperIdentity(base), key)).toBe(false);
  });
  it('accepts the verified bibliographic fields and returns them unchanged', () => {
    expect(validatePaperIdentity(extended)).toEqual(extended);
  });
  it('re-validates its own output byte for byte, which is what a rebuilt request relies on to hash the same', () => {
    // hashInput (sessions/service.ts:463-464) hashes the validated input, and a stored identity is
    // re-validated on load, so canonical key order and presence must survive a second pass.
    for (const value of [extended, base, { ...base, tags: [] as string[] }]) {
      const stored = validatePaperIdentity(value);
      expect(validatePaperIdentity(stored)).toEqual(stored);
      expect(JSON.stringify(validatePaperIdentity(stored))).toBe(JSON.stringify(stored));
    }
  });
  it('preserves an explicit empty array so a rebuilt request hashes the same shape', () => {
    const value = { ...base, tags: [] as string[] };
    expect(validatePaperIdentity(value)).toEqual(value);
    expect(Object.hasOwn(validatePaperIdentity(value), 'tags')).toBe(true);
  });
  it('rejects malformed or over-long bibliographic fields instead of dropping them', () => {
    const bad: Array<[string, unknown]> = [
      ['unknown field', { ...base, journal: 'x' }],
      ['non-string metadata field', { ...base, itemType: 4 }],
      ['empty metadata field', { ...base, volume: '' }],
      ['volume over 512 code points', { ...base, volume: 'v'.repeat(LIMITS.metadataFieldChars + 1) }],
      ['abstract over the limit', { ...base, abstractNote: '文'.repeat(LIMITS.abstractChars + 1) }],
      ['tags not an array', { ...base, tags: 'synthetic' }],
      ['too many tags', { ...base, tags: Array.from({ length: LIMITS.metadataTags + 1 }, (_, i) => `t${i}`) }],
      ['empty tag', { ...base, tags: [''] }],
      ['tag over the limit', { ...base, tags: ['t'.repeat(LIMITS.metadataTagChars + 1)] }],
      ['editors not an array', { ...base, editors: 'Ada' }],
      ['too many editors', { ...base, editors: Array.from({ length: LIMITS.authors + 1 }, () => 'e') }],
      ['empty editor', { ...base, editors: [''] }],
    ];
    for (const [label, value] of bad) { expectCode(() => validatePaperIdentity(value), 'INVALID_REQUEST'); void label; }
  });
  it('rejects an over-long DOI and year as it already did for citations', () => {
    expectCode(() => validatePaperIdentity({ ...base, doi: 'd'.repeat(LIMITS.titleChars) }), 'INVALID_REQUEST');
    expectCode(() => validatePaperIdentity({ ...base, year: '2'.repeat(17) }), 'INVALID_REQUEST');
  });
});
