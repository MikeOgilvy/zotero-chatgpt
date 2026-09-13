import { ReaderError, paperId, type Citation, type DocumentContext, type DocumentPage } from '../../../contracts/src/index.ts';
import { validateDocument } from '../../../contracts/src/document.ts';
import { validateCitation } from '../../../contracts/src/validation.ts';
import { clone } from '../../../contracts/src/clone.ts';
import type { ContextBudget } from '../codex/model-capabilities.ts';
export interface ContextPlan {
  mode: 'full' | 'focused' | 'multi-pass';
  documents: DocumentContext[];
  coverage: { totalPages: number; selectedPages: number[]; reason: string };
  budget: ContextBudget;
}
export interface ContextPlanInput { document: DocumentContext; question: string; citations?: Citation[]; budget: ContextBudget }
const PLACEHOLDER_ID = '00000000-0000-8000-8000-000000000000';
/**
 * Text sent (in the same UTF-8-bytes-as-tokens estimate `size` uses) when the model window is
 * unknown. 32 ki is a deliberately cautious floor: every pinned catalog window is >= 272000, a
 * classic small chat window is 8-32 ki, and 32 ki still holds a question-focused or multi-pass
 * fragment large enough to be useful. It is a local bound, not a claim about the real window, so the
 * report must say fit was not asserted; anything past this simply goes unplanned until a real window
 * is known. The caller's own history/instruction reservations are not subtracted because an unknown
 * capacity exposes no trustworthy reservation total.
 */
export const UNKNOWN_TEXT_BUDGET_TOKENS = 32 * 1024;
function size(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).length; }
/** Explicit disclosure of pages the source itself could not supply or only supplied in part. */
function gapSummary(source: DocumentContext): string {
  const gaps = source.pages.filter(page => page.status !== 'text' || page.partial);
  if (!gaps.length) return '';
  const shown = gaps.slice(0, 12).map(page => `${page.pageLabel} (${page.status === 'text' ? 'partial text' : `no text: ${page.status}`})`);
  return ` Recorded source gaps: ${shown.join(', ')}${gaps.length > 12 ? `, and ${gaps.length - 12} more` : ''}.`;
}
/** Explicit disclosure of authorized pages a focused selection leaves out. */
function excludedSummary(source: DocumentContext, pages: DocumentPage[]): string {
  const included = new Set(pages.map(page => page.pageIndex));
  const excluded = source.pages.filter(page => !included.has(page.pageIndex));
  if (!excluded.length) return '';
  const labels = excluded.slice(0, 12).map(page => page.pageLabel);
  return ` Excluded pages: ${labels.join(', ')}${excluded.length > 12 ? `, and ${excluded.length - 12} more` : ''}.`;
}
function tooSmall(): never { throw new ReaderError('PAYLOAD_TOO_LARGE', 'The available context budget cannot hold a source fragment and its provenance. No text was dropped.'); }
function part(source: DocumentContext, pages: DocumentPage[]): DocumentContext { return { ...source, id: PLACEHOLDER_ID, sourceId: source.sourceId ?? source.id, pages }; }
async function identified(source: DocumentContext, pages: DocumentPage[], index: number): Promise<DocumentContext> {
  const value = part(source, pages);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ version: 1, index, document: value })));
  const raw = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('').slice(0, 32).split('');
  raw[12] = '8'; raw[16] = (8 | (parseInt(raw[16]!, 16) & 3)).toString(16);
  const hex = raw.join(''); return { ...value, id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` };
}
/** Delimiters stay attached to the preceding paragraph, making reassembly exact. */
function paragraphs(text: string): string[] {
  const result: string[] = []; let start = 0;
  for (const match of text.matchAll(/\n[ \t]*\n(?:[ \t]*\n)*/gu)) { const end = match.index + match[0].length; result.push(text.slice(start, end)); start = end; }
  if (start < text.length) result.push(text.slice(start)); return result;
}
function splitPage(source: DocumentContext, page: DocumentPage, limit: number): { pages: DocumentPage[]; dividedParagraph: boolean } {
  if (size(part(source, [page])) <= limit) return { pages: [page], dividedParagraph: false };
  if (page.status !== 'text') tooSmall();
  const make = (text: string): DocumentPage => ({ ...page, text, partial: true });
  const fits = (text: string) => size(part(source, [make(text)])) <= limit;
  const output: DocumentPage[] = []; let pending = ''; let dividedParagraph = false;
  const flush = () => { if (pending) { if (!pending.trim()) tooSmall(); output.push(make(pending)); pending = ''; } };
  for (const block of paragraphs(page.text)) {
    let paragraph = block;
    if (fits(pending + paragraph)) { pending += paragraph; continue; }
    if (pending && !pending.trim()) { paragraph = pending + paragraph; pending = ''; } else flush();
    if (fits(paragraph)) { pending = paragraph; continue; }
    dividedParagraph = true;
    const characters = [...paragraph]; let offset = 0;
    while (offset < characters.length) {
      let low = 1, high = characters.length - offset, length = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (fits(characters.slice(offset, offset + middle).join(''))) { length = middle; low = middle + 1; } else high = middle - 1;
      }
      if (!length) tooSmall();
      pending = characters.slice(offset, offset + length).join(''); offset += length;
      if (offset < characters.length) flush();
    }
  }
  flush(); if (!output.length) tooSmall(); return { pages: output, dividedParagraph };
}
function queryTerms(question: string): string[] {
  const normalized = question.normalize('NFKC').toLowerCase();
  const stop = new Set(['what', 'when', 'where', 'which', 'this', 'that', 'with', 'from', 'does', 'mean', 'explain', 'definition', 'equation', 'theorem', 'paper', 'document', 'about', 'there', 'their', 'would', 'could', 'should', 'have', 'into', 'show']);
  const terms = (normalized.match(/[\p{L}\p{N}_]+/gu) ?? []).filter(term => term.length > 2 && !stop.has(term));
  for (const phrase of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...phrase]; for (let i = 0; i + 1 < chars.length; i++) terms.push(chars.slice(i, i + 2).join(''));
  }
  return [...new Set(terms)].slice(0, 128);
}
function localQuestion(question: string, citations: Citation[]): boolean {
  if (/\b(?:whole|entire|overall|overview|summari[sz]e|all\s+(?:pages|sections|results|assumptions|limitations))\b|整篇|全文|整本|全书|所有|全部|总体|整体|概述|总结|通读/u.test(question.toLowerCase())) return false;
  return citations.length > 0 || /\b(?:define|definition|equation|theorem|proof|lemma|figure|table|section|why|how|what is|what does)\b|定义|公式|定理|证明|引理|这里|这个|为什么|如何|是什么|含义|第.{0,8}[页章]/u.test(question.toLowerCase());
}
export async function planContext(input: ContextPlanInput): Promise<ContextPlan> {
  const source = validateDocument(input.document); const budget = clone(input.budget);
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 64 * 1024) throw new ReaderError('INVALID_REQUEST', 'The reading question is invalid.');
  // A document with no extractable text is the one case where there is genuinely nothing to supply.
  if (!source.pages.some(page => page.status === 'text')) throw new ReaderError('INVALID_REQUEST', 'This document has no extractable text: every authorized page is empty or failed extraction. Nothing was sent.');
  const unknownWindow = budget.accuracy === 'unknown' || budget.textBudgetTokens === null;
  const limit = unknownWindow ? UNKNOWN_TEXT_BUDGET_TOKENS : budget.textBudgetTokens;
  if (limit === null || !Number.isSafeInteger(limit) || limit <= 0) tooSmall();
  const citations = (input.citations ?? []).map(validateCitation).filter(citation => paperId(citation.paper) === paperId(source.paper));
  const authorizedPages = [...source.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const coverage = (pages: DocumentPage[], reason: string) => ({ totalPages: source.totalPages, selectedPages: [...new Set(pages.map(page => page.pageIndex))].sort((a, b) => a - b), reason });
  const gaps = gapSummary(source);
  const unverified = unknownWindow ? ' Model capacity or retained history is unknown; fit was not asserted.' : '';
  if (size(source) <= limit) return { mode: 'full', documents: [source], coverage: coverage(source.pages, `All authorized source pages fit within the conservative estimate.${gaps}${unverified}`), budget };
  const fragments: DocumentPage[] = []; let dividedParagraph = false;
  for (const page of authorizedPages) { const split = splitPage(source, page, limit); fragments.push(...split.pages); dividedParagraph ||= split.dividedParagraph; }
  const selectedPages = new Set(citations.flatMap(citation => citation.positions.map(position => position.pageIndex)));
  const terms = queryTerms(input.question);
  const score = (page: DocumentPage): number => {
    const body = page.text.normalize('NFKC').toLowerCase(); const matches = terms.filter(term => body.includes(term)).length;
    const quoted = citations.some(citation => citation.positions.some(position => position.pageIndex === page.pageIndex) && body.includes(citation.text.normalize('NFKC').toLowerCase()));
    const definition = matches > 0 && /\b(?:definition|defined|means|denote|assume|theorem)\b|定义|记为|称为|假设|定理/u.test(body);
    return (selectedPages.has(page.pageIndex) ? 1000 : 0) + (quoted ? 1000 : 0) + matches * 10 + (definition ? 100 : 0);
  };
  if (localQuestion(input.question, citations)) {
    const bestByPage = new Map<number, DocumentPage>();
    for (const fragment of fragments) { const prior = bestByPage.get(fragment.pageIndex); if (!prior || score(fragment) > score(prior)) bestByPage.set(fragment.pageIndex, fragment); }
    const ranked = [...bestByPage.values()].filter(page => score(page) > 0).sort((a, b) => score(b) - score(a) || a.pageIndex - b.pageIndex);
    const chosen: DocumentPage[] = [];
    for (const page of ranked) if (size(part(source, [...chosen, page])) <= limit) chosen.push(page);
    if (chosen.length && [...selectedPages].filter(index => authorizedPages.some(page => page.pageIndex === index)).every(index => chosen.some(page => page.pageIndex === index))) {
      chosen.sort((a, b) => a.pageIndex - b.pageIndex);
      return { mode: 'focused', documents: [await identified(source, chosen, 0)], coverage: coverage(chosen, `Partial, question-focused coverage selected by local term matching, selected citations and definitions; other authorized pages were not included.${excludedSummary(source, chosen)}${gaps}${unverified}`), budget };
    }
  }
  if (unknownWindow) {
    // No usable window and no question match: supply a bounded selection instead of throwing, but keep
    // it a single document so it never becomes a persistable multi-pass plan that needs a real budget.
    const bounded: DocumentPage[] = [];
    for (const fragment of fragments) { if (size(part(source, [...bounded, fragment])) > limit) break; bounded.push(fragment); }
    if (!bounded.length) tooSmall();
    return { mode: 'focused', documents: [await identified(source, bounded, 0)], coverage: coverage(bounded, `Model context window is unknown; a bounded selection was supplied and fit was not asserted.${excludedSummary(source, bounded)}${gaps}`), budget };
  }
  const groups: DocumentPage[][] = []; let pending: DocumentPage[] = [];
  for (const page of fragments) {
    if (pending.some(item => item.pageIndex === page.pageIndex) || size(part(source, [...pending, page])) > limit) { if (pending.length) groups.push(pending); pending = []; }
    pending.push(page);
  }
  if (pending.length) groups.push(pending);
  if (groups.length > 256) throw new ReaderError('PAYLOAD_TOO_LARGE', 'This source needs more than 256 reading passes at the current budget. No text was dropped, but the request was not sent.');
  const documents = await Promise.all(groups.map((pages, index) => identified(source, pages, index)));
  return { mode: 'multi-pass', documents, coverage: coverage(fragments, `All authorized pages are partitioned into reading passes.${dividedParagraph ? ' Oversized paragraphs were divided at Unicode character boundaries and marked partial.' : ' Oversized pages were divided at paragraph boundaries and marked partial.'}${gaps}`), budget };
}
