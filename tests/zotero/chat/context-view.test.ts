import { expect, it } from 'vitest';
import { Window } from 'happy-dom';
import type { UsageReport } from '../../../packages/contracts/src/index.ts';
import { contextRingRatio, contextUsageLabel, contextUsageTitle, currentContextUsage, formatContextTokens, mountContextRing } from '../../../packages/zotero/src/chat/context-view.ts';

const usage = (overrides: Partial<UsageReport> = {}): UsageReport => ({
  model: 'gpt-5.6-sol', contextWindow: 372000,
  last: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
  total: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
  ...overrides,
});

it('reports no context figure when usage is missing or belongs to another model', () => {
  expect(currentContextUsage('gpt-5.6-sol', null)).toBeNull();
  expect(currentContextUsage(null, usage())).toBeNull();
  expect(currentContextUsage('gpt-5.6-sol', usage({ model: 'gpt-5.5' }))).toBeNull();
});

it('reports the last runtime input usage, never remaining context', () => {
  expect(currentContextUsage('gpt-5.6-sol', usage())).toEqual({ usedTokens: 12345, window: 372000, provenance: 'runtime-reported' });
});

it('uses the pinned catalog window only as a fallback and admits an unknown window otherwise', () => {
  expect(currentContextUsage('gpt-5.6-sol', usage({ contextWindow: null }))).toEqual({ usedTokens: 12345, window: 272000, provenance: 'pinned-catalog' });
  expect(currentContextUsage('unknown-model', usage({ model: 'unknown-model', contextWindow: null }))).toEqual({ usedTokens: 12345, window: null, provenance: 'unknown' });
});

it('formats compact token counts and an explicit unknown label', () => {
  expect(formatContextTokens(950)).toBe('950');
  expect(formatContextTokens(12345)).toBe('12.3k');
  expect(formatContextTokens(372000)).toBe('372k');
  expect(contextUsageLabel(null)).toBe('Context unknown');
  expect(contextUsageLabel({ usedTokens: 12345, window: 372000, provenance: 'runtime-reported' })).toBe('Context 12.3k / 372k tokens');
  expect(contextUsageLabel({ usedTokens: 12345, window: null, provenance: 'unknown' })).toBe('Context 12.3k tokens · window unknown');
});

function ringHost() {
  const doc = new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
  const host = doc.createElement('div'); doc.body.append(host);
  return { ring: mountContextRing(host), host };
}

const fillStroke = (ring: { element: HTMLElement }) => ring.element.querySelector('.zchatgpt-context-ring-fill')!.getAttribute('stroke-dasharray');

it('draws a complete solid ring while the context is unknown, never an empty or partial arc', () => {
  const { ring, host } = ringHost();
  // Unknown: one unbroken stroke (no dash pattern, so no gap), no proportion, no numeric text.
  expect(ring.element.dataset.zchatgptContextState).toBe('unknown');
  expect(fillStroke(ring)).toBe('none');
  expect(ring.element.textContent).toBe('');
  expect(ring.element.title).toBe(contextUsageTitle(null));
  expect(ring.element.getAttribute('aria-label')).toBe(contextUsageTitle(null));
  expect(host.contains(ring.element)).toBe(true);
});

it('keeps the solid ring when a runtime usage report exists but the window is unknown', () => {
  const { ring } = ringHost();
  // Honest boundary: a used-token report without a window is still "unknown" for proportion, so the
  // ring stays solid and the tooltip carries the number without implying a share of anything.
  ring.update({ usedTokens: 12300, window: null, provenance: 'unknown' });
  expect(ring.element.dataset.zchatgptContextState).toBe('unknown');
  expect(fillStroke(ring)).toBe('none');
  expect(ring.element.title).toBe('Last runtime usage report: 12,300 input tokens; the model window is unknown. This is the last report, not remaining context.');
  expect(ring.element.getAttribute('aria-label')).toBe(ring.element.title);
  expect(ring.element.getAttribute('aria-label')).not.toContain('%');
});

it('releases the ring into a used/window arc once a window is known', () => {
  const { ring } = ringHost();

  // Runtime-reported window: the arc fills by used/window and the tooltip names the measured origin.
  ring.update(currentContextUsage('gpt-5.6-sol', usage()));
  expect(ring.element.dataset.zchatgptContextState).toBe('runtime-reported');
  const reported = fillStroke(ring)!.split(' ').map(Number);
  expect(reported[0]! / reported[1]!).toBeCloseTo(12345 / 372000, 4);
  expect(ring.element.title).toContain('runtime reported');

  // Pinned catalog window: a labelled estimate, never passed off as a runtime measurement.
  ring.update(currentContextUsage('gpt-5.6-sol', usage({ contextWindow: null })));
  expect(ring.element.dataset.zchatgptContextState).toBe('pinned-catalog');
  expect(ring.element.title).toContain('bundled catalog estimate');
  expect(fillStroke(ring)!.split(' ').map(Number)[0]! / 50.27).toBeCloseTo(12345 / 272000, 4);

  // A full window caps the arc at one full circumference rather than overdrawing the ring.
  ring.update({ usedTokens: 999_999, window: 372000, provenance: 'runtime-reported' });
  expect(contextRingRatio({ usedTokens: 999_999, window: 372000, provenance: 'runtime-reported' })).toBe(1);
  expect(fillStroke(ring)).toBe('50.27 50.27');
});
