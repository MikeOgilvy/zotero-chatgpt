import { expect, it } from 'vitest';
import { planContext } from '../../packages/core/src/context/planner.ts';
import { buildContextBudget } from '../../packages/core/src/codex/model-capabilities.ts';
import type { DocumentContext } from '../../packages/contracts/src/index.ts';
import { citationA, paperA } from '../contracts/factories.ts';

const source = (pages: string[]): DocumentContext => ({ id: 'abcdef01-0000-4000-8000-000000000001', paper: paperA, revision: { fingerprint: 'synthetic-v1', size: 10000, modifiedAt: 1000 }, parserVersion: 'synthetic-1', totalPages: pages.length, pages: pages.map((text, pageIndex) => ({ pageIndex, pageLabel: String(pageIndex + 1), text, status: 'text' })) });
const budget = (window = 3000) => buildContextBudget({ modelId: 'gpt-5.4', reportedWindow: window, historyTokens: 0, instructionBytes: 0, workflowBytes: 0, imageCount: 0, questionBytes: 0, outputReserve: 0 });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

it('includes every authorized page when its complete serialized context fits', async () => {
  const document = source(['Definition on page one.', 'Result on page two.']);
  const plan = await planContext({ document, question: 'Summarize the whole paper', budget: budget(10000) });
  expect(plan.mode).toBe('full'); expect(plan.documents).toEqual([document]);
  expect(plan.coverage).toMatchObject({ totalPages: 2, selectedPages: [0, 1] });
});

it('uses selected pages and matching definitions for a local question and reports partial coverage', async () => {
  const document = source(['Definition: Lyapunov stability means bounded response. ' + 'd'.repeat(300), ...Array.from({ length: 4 }, (_, i) => `Unrelated experiment ${i}. ` + 'x'.repeat(900))]);
  document.pages[3]!.text = 'Lyapunov stability is used in this selected equation. ' + 's'.repeat(300);
  const selection = { ...citationA, text: 'Lyapunov stability', positions: [{ pageIndex: 3, rects: [[0, 0, 10, 10] as [number, number, number, number]] }] };
  const plan = await planContext({ document, question: 'What is Lyapunov stability in this equation?', citations: [selection], budget: budget(2500) });
  expect(plan.mode).toBe('focused'); expect(plan.documents).toHaveLength(1);
  expect(plan.coverage.selectedPages).toEqual(expect.arrayContaining([0, 3])); expect(plan.coverage.selectedPages.length).toBeLessThan(5);
  expect(plan.coverage.reason).toMatch(/partial|focused/i); expect(bytes(plan.documents[0])).toBeLessThanOrEqual(plan.budget.textBudgetTokens!);
});

it('partitions all authorized content for a broad question instead of using only the abstract', async () => {
  const document = source(Array.from({ length: 7 }, (_, i) => `Page ${i}: ` + String(i).repeat(900)));
  const plan = await planContext({ document, question: 'Summarize the entire document, including all limitations', budget: budget() });
  expect(plan.mode).toBe('multi-pass'); expect(plan.documents.length).toBeGreaterThan(1);
  expect(plan.documents.flatMap(part => part.pages)).toEqual(document.pages);
  expect(plan.coverage.selectedPages).toEqual([0, 1, 2, 3, 4, 5, 6]);
  for (const part of plan.documents) expect(bytes(part)).toBeLessThanOrEqual(plan.budget.textBudgetTokens!);
});

it('splits oversized pages at paragraph boundaries without dropping or duplicating text', async () => {
  const text = ['A'.repeat(500), 'B'.repeat(500), 'C'.repeat(500)].join('\n\n'); const document = source([text]);
  const plan = await planContext({ document, question: 'Read the whole document', budget: budget(1500) });
  expect(plan.mode).toBe('multi-pass'); expect(plan.documents.length).toBeGreaterThan(1);
  expect(plan.documents.flatMap(part => part.pages).map(page => page.text).join('')).toBe(text);
  for (const part of plan.documents) {
    expect(part.pages[0]?.partial).toBe(true); expect(part.sourceId).toBe(document.id); expect(bytes(part)).toBeLessThanOrEqual(plan.budget.textBudgetTokens!);
    expect(part.pages[0]?.text.trim()).toMatch(/^(?:A+|B+|C+)$/u);
  }
});

it('uses Unicode-safe fallback for a single oversized paragraph and discloses that division', async () => {
  const document = source(['数学🙂'.repeat(500)]);
  const plan = await planContext({ document, question: 'Explain the entire text', budget: budget(1500) });
  expect(plan.documents.flatMap(part => part.pages).map(page => page.text).join('')).toBe(document.pages[0]!.text);
  expect(plan.coverage.reason).toMatch(/paragraph/i);
  for (const part of plan.documents) { expect(part.pages[0]?.partial).toBe(true); expect(part.pages[0]?.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u); }
});

it('makes part identities deterministic and sensitive to source revision', async () => {
  const document = source(['x'.repeat(1500), 'y'.repeat(1500)]); const input = { document, question: 'Summarize all pages', budget: budget(2000) };
  const first = await planContext(input); const again = await planContext(input);
  expect(again.documents.map(part => part.id)).toEqual(first.documents.map(part => part.id));
  expect(new Set(first.documents.map(part => part.id)).size).toBe(first.documents.length);
  const revised = await planContext({ ...input, document: { ...document, revision: { ...document.revision, modifiedAt: 1001 } } });
  expect(revised.documents.map(part => part.id)).not.toEqual(first.documents.map(part => part.id));
});

it('never expands an authorized page range and keeps extraction gaps visible', async () => {
  const document = source(['one', 'two', 'three', 'four']); document.pages = [{ ...document.pages[1]!, text: '', status: 'error' }, document.pages[3]!];
  const plan = await planContext({ document, question: 'Summarize the whole document', budget: budget(10000) });
  expect(plan.documents.flatMap(part => part.pages).map(page => page.pageIndex)).toEqual([1, 3]);
  expect(plan.coverage).toMatchObject({ totalPages: 4, selectedPages: [1, 3] });
  expect(plan.documents[0]?.pages[0]?.status).toBe('error');
});

it('supplies bounded context with an unverified-fit note when the model window is unknown', async () => {
  const document = source(['x'.repeat(40_000)]);
  const unknown = buildContextBudget({ modelId: 'unlisted', instructionBytes: 0, workflowBytes: 0, imageCount: 0, questionBytes: 0 });
  expect(unknown.accuracy).toBe('unknown');
  const plan = await planContext({ document, question: 'What is the meaning?', budget: unknown });
  expect(plan.mode).not.toBe('multi-pass'); expect(plan.documents).toHaveLength(1);
  expect(plan.coverage.reason).toMatch(/unknown|not asserted|unverified/i);
  // The planner's documented unknown-window bound; the document is strictly larger, so this is a real bound.
  expect(bytes(plan.documents[0])).toBeLessThanOrEqual(32 * 1024);
  expect(bytes(plan.documents[0])).toBeLessThan(bytes(document));
});
it('still refuses a budget that leaves no room for any source fragment', async () => {
  const document = source(['Some text.']);
  await expect(planContext({ document, question: 'Read', budget: { ...budget(), textBudgetTokens: 2 } })).rejects.toThrow();
});
it('refuses a document with no extractable text at all', async () => {
  const document = source(['', '']);
  document.pages = [
    { pageIndex: 0, pageLabel: '1', text: '', status: 'empty' },
    { pageIndex: 1, pageLabel: '2', text: '', status: 'error' },
  ];
  await expect(planContext({ document, question: 'Explain this', budget: budget(10000) })).rejects.toThrow(/no extractable text/i);
});
it('discloses locally unread page gaps in the coverage reason', async () => {
  const document = source(['Alpha '.repeat(4000)]);
  document.pages.push({ pageIndex: 9, pageLabel: '10', text: '', status: 'error' });
  document.totalPages = 10;
  const plan = await planContext({ document, question: 'Summarize the entire document', budget: budget(3000) });
  expect(plan.mode).toBe('multi-pass');
  expect(plan.coverage.reason).toMatch(/page 10|no text|unread|gap/i);
});

it('keeps leading paragraph whitespace attached to text when dividing a large first paragraph', async () => {
  const document = source(['\n\n' + 'Leading text. '.repeat(400)]);
  const plan = await planContext({ document, question: 'Read the whole document', budget: budget(1500) });
  expect(plan.documents.flatMap(part => part.pages).map(page => page.text).join('')).toBe(document.pages[0]!.text);
  expect(plan.documents.every(part => part.pages.every(page => page.text.trim()))).toBe(true);
});
