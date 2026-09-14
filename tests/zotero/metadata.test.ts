import { describe, expect, it } from 'vitest';
import * as core from '../../packages/core/src/context/bibliography.ts';
import * as reader from '../../packages/zotero/src/reader/metadata.ts';

/**
 * The reader module is now a re-export of the shared core module: `core` cannot import `zotero`, and
 * `codex/reader-policy.ts` needs the same formatter for the model payload. This test pins that the
 * reader's existing import path still exposes the identical functions rather than a second copy that
 * could drift. The formatting behaviour itself is covered in `tests/core/bibliography.test.ts`.
 */
describe('reader metadata re-export', () => {
  it('exposes the same functions and constants as the shared core module', () => {
    for (const name of ['bibliographyBlock', 'bibliographyView', 'paperIdentityOf', 'capText', 'capList'] as const)
      expect(reader[name]).toBe(core[name]);
    for (const name of ['ABSTRACT_LIMIT', 'METADATA_FIELD_LIMIT', 'TAG_LIMIT', 'TAGS_LIMIT', 'MAX_PEOPLE', 'PERSON_LIMIT', 'YEAR_LIMIT', 'DOI_LIMIT'] as const)
      expect(reader[name]).toBe(core[name]);
    expect(reader.BIBLIOGRAPHY_KEYS).toBe(core.BIBLIOGRAPHY_KEYS);
  });
  it('still formats through the reader path', () => {
    expect(reader.bibliographyBlock({ title: 'Synthetic', authors: ['Ada'], publisher: 'Synthetic Press' }))
      .toBe('Title: Synthetic\nAuthors: Ada\nPublisher: Synthetic Press');
  });
});
