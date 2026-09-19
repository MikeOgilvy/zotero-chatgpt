import { describe, expect, it } from 'vitest';
import { DOCUMENT_BRIEF_HEADER, documentBrief, selectionBrief } from '../../packages/core/src/chat/document-brief.ts';
import type { DocumentContext, PaperIdentity } from '../../packages/contracts/src/index.ts';
import { documentA } from '../contracts/document-fixture.ts';
import { paperA } from '../contracts/factories.ts';

const identity: PaperIdentity = {
  title: 'Synthetic Paper A',
  authors: ['Ada Lovelace', ' Grace Hopper '],
  year: '2024',
  doi: '10.1000/synthetic',
  publicationTitle: 'Journal of Synthetic Results',
};

function documentWith(pages: DocumentContext['pages'], totalPages = pages.length): DocumentContext {
  return { ...documentA, totalPages, pages };
}

describe('documentBrief', () => {
  it('names the paper and labels every page it carries', () => {
    const brief = documentBrief(identity, documentWith(documentA.pages));
    expect(brief).not.toBeNull();
    expect(brief?.text.startsWith(DOCUMENT_BRIEF_HEADER)).toBe(true);
    expect(brief?.text).toContain('Paper: Synthetic Paper A');
    expect(brief?.text).toContain('Authors: Ada Lovelace; Grace Hopper');
    expect(brief?.text).toContain('Published in: Journal of Synthetic Results');
    expect(brief?.text).toContain('Year: 2024');
    expect(brief?.text).toContain('DOI: 10.1000/synthetic');
    expect(brief?.text).toContain('[page i]');
    expect(brief?.text).toContain('Definition: x denotes the hidden state.');
    expect(brief?.text).toContain('[page ii]');
    expect(brief?.text).toContain('Theorem: y = x + 7.');
    expect(brief).toMatchObject({ included: 2, totalPages: 2, truncated: false });
  });

  it('stops at the limit, says so in the text and reports the truncation', () => {
    const long = documentWith(documentA.pages.map(page => ({ ...page, text: `${page.text} ${'x'.repeat(400)}` })));
    const brief = documentBrief(identity, long, 520);
    expect(brief).toMatchObject({ included: 1, totalPages: 2, truncated: true });
    expect(brief?.text).toContain('The rest of the PDF was left out');
    expect(brief?.text).toContain('Definition: x denotes the hidden state.');
    expect(brief?.text).not.toContain('Theorem: y = x + 7.');
  });

  it('cuts the first page to fit rather than promising a brief that carries no text', () => {
    const dense = documentWith(documentA.pages.map(page => ({ ...page, text: 'y'.repeat(400) })));
    const brief = documentBrief(identity, dense, 200);
    expect(brief).toMatchObject({ included: 1, totalPages: 2, truncated: true });
    expect(brief?.text).toContain('[page i, partial]');
    expect(brief?.text).toContain('The rest of the PDF was left out');
  });

  it('skips pages with no readable text instead of pasting empty blocks', () => {
    const brief = documentBrief(identity, documentWith([
      { pageIndex: 0, pageLabel: '1', text: '   ', status: 'empty' },
      { pageIndex: 1, pageLabel: '2', text: 'Only this page has text.', status: 'text' },
      { pageIndex: 2, pageLabel: '3', text: 'A partial page.', status: 'text', partial: true },
    ], 5));
    expect(brief).toMatchObject({ included: 2, totalPages: 5, truncated: false });
    expect(brief?.text).toContain('Locally read text from 2 of 5 pages.');
    expect(brief?.text).toContain('[page 3, partial]');
    expect(brief?.text).not.toContain('[page 1]');
  });

  it('returns nothing when the document carried no text at all', () => {
    expect(documentBrief(identity, documentWith([{ pageIndex: 0, pageLabel: '1', text: '', status: 'empty' }], 1))).toBeNull();
    expect(documentBrief(identity, documentWith([], 0))).toBeNull();
  });

  it('falls back to an honest title and page number when the host had neither', () => {
    const brief = documentBrief({ title: '  ', authors: [] }, documentWith([
      { pageIndex: 0, pageLabel: '', text: 'Body.', status: 'text' },
    ], 1));
    expect(brief?.text).toContain('Paper: Untitled');
    expect(brief?.text).not.toContain('Authors:');
    expect(brief?.text).toContain('[page 1]');
  });
});

describe('selectionBrief', () => {
  it('names the paper, the page and the exact original text', () => {
    const text = selectionBrief({ text: 'Definition: x denotes the hidden state.', title: 'Synthetic Paper A', pageLabel: 'i' });
    expect(text.startsWith('Selection from the PDF open in Zotero: Synthetic Paper A (page i)')).toBe(true);
    expect(text.endsWith('Definition: x denotes the hidden state.')).toBe(true);
  });

  it('omits the page when the reader reported none', () => {
    expect(selectionBrief({ text: 'Body.', title: '', pageLabel: '  ' })).toBe('Selection from the PDF open in Zotero: Untitled\n\nBody.');
  });
});

describe('the brief is a local read', () => {
  it('carries no request, model or Codex field, so nothing here can become an Agent call', () => {
    const brief = documentBrief(identity, documentWith(documentA.pages));
    expect(Object.keys(brief ?? {}).sort()).toEqual(['included', 'text', 'totalPages', 'truncated']);
    expect(brief?.text).not.toContain(paperA.attachmentKey);
  });
});
