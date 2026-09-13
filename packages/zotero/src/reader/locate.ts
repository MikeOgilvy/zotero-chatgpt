import type { Rect } from '../../../contracts/src/index.ts';

/**
 * Pure quote locator for the frozen-revision page text.
 *
 * Model output is untrusted: a quote is only ever used as a literal search string against the
 * native page characters, and the result is rejected unless the match is unique, contiguous,
 * inside one supplied page and backed by complete in-viewBox glyph geometry. Nothing here reads
 * the network, the library or a live viewer; callers decide what to do with the rectangles.
 */
export interface LocateChar {
  c: string;
  rect?: readonly number[];
  inlineRect?: readonly number[];
  ignorable?: boolean;
  isolated?: boolean;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
}
export interface LocatePage { pageIndex: number; chars: readonly LocateChar[]; viewBox?: readonly number[] }
export interface LocatedPosition { pageIndex: number; rects: Rect[] }
export type LocateOutcome =
  | { status: 'located'; position: LocatedPosition }
  | { status: 'unresolved'; reason: 'not-found' | 'ambiguous' | 'incomplete-text' | 'invalid-geometry' };

/** Defensive upper bound; the prompt asks the model for at most 200 characters. */
export const MAX_QUOTE_CODEPOINTS = 400;
const MAX_PAGE_TEXT = 2_000_000;
const MAX_RECTS = 1000;
const LIMIT = 1_000_000;

/** Collapse whitespace and reject control text, empty or oversized quotes. Returns null, not a guess. */
export function normalizeQuote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const length = [...collapsed].length;
  if (length < 2 || length > MAX_QUOTE_CODEPOINTS) return null;
  if (/[\u0000-\u001f\u007f]/u.test(collapsed)) return null;
  return collapsed;
}

function bounds(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < LIMIT)) return null;
  const [x1, y1, x2, y2] = value as unknown as Rect;
  return x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

/** Merge consecutive character boxes into line rectangles, refusing any box outside the page viewBox. */
export function lineRects(chars: readonly LocateChar[], viewBox: unknown): Rect[] | null {
  const box = bounds(viewBox); if (!box || !chars.length) return null;
  const results: Rect[] = []; let line: Rect | null = null;
  for (const char of chars) {
    const inline = bounds(char.inlineRect); const glyph = bounds(char.rect);
    if (!inline || !glyph || inline[0] < box[0] - 1 || inline[1] < box[1] - 1 || inline[2] > box[2] + 1 || inline[3] > box[3] + 1) return null;
    line = line ? [Math.min(line[0], inline[0]), Math.min(line[1], inline[1]), Math.max(line[2], inline[2]), Math.max(line[3], inline[3])] : inline;
    if (char.lineBreakAfter) { results.push(line); line = null; }
  }
  if (line) results.push(line);
  return results.length && results.length <= MAX_RECTS ? results.map(rect => rect.map(value => Math.round(value * 1000) / 1000) as Rect) : null;
}

function unresolved(reason: Extract<LocateOutcome, { status: 'unresolved' }>['reason']): LocateOutcome { return { status: 'unresolved', reason }; }

/**
 * Locate one exact quote on one page. The page must be the citation's own page, so a located
 * highlight can never point at text from another page or another document revision.
 */
export function locateQuoteOnPage(page: LocatePage, quote: string): LocateOutcome {
  if (!Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0) return unresolved('invalid-geometry');
  if (!Array.isArray(page.chars)) return unresolved('incomplete-text');
  // `Array.isArray` widens a readonly array to `any[]`; assert the declared element type back.
  const chars = page.chars as readonly LocateChar[];
  if (!Array.isArray(page.viewBox) || bounds(page.viewBox) === null) return unresolved('invalid-geometry');
  if (typeof quote !== 'string' || quote.length < 2 || quote.length > MAX_QUOTE_CODEPOINTS) return unresolved('not-found');

  let text = '';
  const offsets: Array<{ charIndex: number; glyph: boolean }> = [];
  const append = (value: string, charIndex: number, glyph = false) => {
    for (const c of value.normalize('NFC')) {
      const normalized = /\s/u.test(c) ? ' ' : c;
      if (normalized === ' ' && (!text || text.endsWith(' '))) continue;
      text += normalized;
      for (let index = 0; index < normalized.length; index++) offsets.push({ charIndex, glyph });
    }
  };
  for (let charIndex = 0; charIndex < chars.length; charIndex++) {
    const char = chars[charIndex]!;
    if (typeof char.c !== 'string' || char.c.length > 64) return unresolved('incomplete-text');
    if (!char.ignorable) {
      append(char.c, charIndex, true);
      if (char.spaceAfter || char.lineBreakAfter || char.paragraphBreakAfter) append(' ', charIndex);
    }
    if (text.length > MAX_PAGE_TEXT) return unresolved('incomplete-text');
  }

  const matches: number[] = []; let from = 0;
  while (from < text.length) { const at = text.indexOf(quote, from); if (at < 0) break; matches.push(at); from = at + 1; }
  if (!matches.length) return unresolved('not-found');
  if (matches.length > 1) return unresolved('ambiguous');

  const start = offsets[matches[0]!]; const end = offsets[matches[0]! + quote.length - 1];
  if (!start || !end) return unresolved('invalid-geometry');
  const sameGlyph = (a: { charIndex: number; glyph: boolean } | undefined, b: { charIndex: number; glyph: boolean } | undefined) =>
    Boolean(a?.glyph && b?.glyph && a.charIndex === b.charIndex);
  if (sameGlyph(offsets[matches[0]! - 1], start) || sameGlyph(offsets[matches[0]! + quote.length], end)) return unresolved('invalid-geometry');

  const matched = chars.slice(start.charIndex, end.charIndex + 1);
  if (matched.some(char => char.isolated) && matched.some(char => !char.isolated && !char.ignorable)) return unresolved('invalid-geometry');
  const rects = lineRects(matched, page.viewBox);
  if (!rects?.length) return unresolved('invalid-geometry');
  return { status: 'located', position: { pageIndex: page.pageIndex, rects } };
}
