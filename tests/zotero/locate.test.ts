import { expect, it } from 'vitest';
import {
  locateQuoteOnPage,
  normalizeQuote,
  type LocateChar,
  type LocatePage,
} from '../../packages/zotero/src/reader/locate.ts';

const viewBox = [0, 0, 600, 800] as const;

/** Deterministic page text: one inline box per character, one line per array entry. */
function pageFromLines(pageIndex: number, lines: string[], box: readonly number[] = viewBox): LocatePage {
  const chars: LocateChar[] = [];
  let top = 700;
  lines.forEach((line, lineIndex) => {
    let left = 50;
    const glyphs = [...line];
    glyphs.forEach((c, charIndex) => {
      const char: LocateChar = { c, rect: [left, top, left + 8, top + 12], inlineRect: [left, top, left + 8, top + 12] };
      if (charIndex === glyphs.length - 1 && lineIndex < lines.length - 1) char.lineBreakAfter = true;
      chars.push(char);
      left += 8;
    });
    top -= 20;
  });
  return { pageIndex, chars, viewBox: box };
}

it('normalizes model-supplied quote titles defensively and rejects unusable ones', () => {
  expect(normalizeQuote('  exact   words\nacross lines ')).toBe('exact words across lines');
  expect(normalizeQuote('a')).toBeNull();
  expect(normalizeQuote('q'.repeat(401))).toBeNull();
  expect(normalizeQuote('bad\u0000quote')).toBeNull();
  expect(normalizeQuote(undefined)).toBeNull();
  expect(normalizeQuote(42)).toBeNull();
});

it('locates a contiguous quote on the cited page and returns line rectangles', () => {
  const page = pageFromLines(2, ['the prior is fixed', 'and the posterior follows']);
  const outcome = locateQuoteOnPage(page, normalizeQuote('prior is fixed and the posterior')!);
  expect(outcome.status).toBe('located');
  if (outcome.status !== 'located') return;
  expect(outcome.position.pageIndex).toBe(2);
  expect(outcome.position.rects.length).toBeGreaterThan(0);
  for (const rect of outcome.position.rects) expect(rect[2]).toBeGreaterThan(rect[0]);
});

it('is case- and accent-sensitive and refuses a quote that is not on the supplied page', () => {
  const page = pageFromLines(0, ['Alpha beta gamma']);
  expect(locateQuoteOnPage(page, 'alpha beta').status).toBe('unresolved');
  expect(locateQuoteOnPage(page, 'missing words').status).toBe('unresolved');
});

it('refuses an ambiguous quote rather than guessing which occurrence to highlight', () => {
  const page = pageFromLines(0, ['repeat me', 'then repeat me again']);
  const outcome = locateQuoteOnPage(page, 'repeat me');
  expect(outcome).toEqual({ status: 'unresolved', reason: 'ambiguous' });
});

it('refuses a partial glyph match at either quote boundary', () => {
  // A single ligature char carrying more than one code unit must not be highlighted partially.
  const box = (left: number, c: string): LocateChar => ({ c, rect: [left, 0, left + 8, 10], inlineRect: [left, 0, left + 8, 10] });
  const startMidGlyph: LocatePage = { pageIndex: 0, chars: [box(0, 'fi'), box(8, 'n'), box(16, 'e')], viewBox };
  expect(locateQuoteOnPage(startMidGlyph, 'in').status).toBe('unresolved');
  const endMidGlyph: LocatePage = { pageIndex: 0, chars: [box(0, 'a'), box(8, 'fi')], viewBox };
  expect(locateQuoteOnPage(endMidGlyph, 'af').status).toBe('unresolved');
  // The whole ligature is an allowed, unambiguous match.
  expect(locateQuoteOnPage(startMidGlyph, 'fin').status).toBe('located');
});

it('refuses incomplete geometry instead of fabricating a highlight rectangle', () => {
  const noChars = locateQuoteOnPage({ pageIndex: 0, chars: [] }, 'anything');
  expect(noChars.status === 'unresolved' ? noChars.reason : 'located').toBe('invalid-geometry');
  const outside = pageFromLines(0, ['outside the box'], [0, 0, 10, 10]);
  expect(locateQuoteOnPage(outside, 'outside').status).toBe('unresolved');
  const missingViewBox: LocatePage = { pageIndex: 0, chars: [{ c: 'x', rect: [0, 0, 8, 8], inlineRect: [0, 0, 8, 8] }] };
  expect(locateQuoteOnPage(missingViewBox, 'x').status).toBe('unresolved');
});
