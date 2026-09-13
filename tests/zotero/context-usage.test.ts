import { expect, it } from 'vitest';
import { Window } from 'happy-dom';
import type { UsageReport } from '../../packages/contracts/src/index.ts';
import { contextRingRatio, contextUsageLabel, contextUsageTitle, currentContextUsage, formatContextTokens, mountContextRing } from '../../packages/zotero/src/chat/context-view.ts';

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
  expect(currentContextUsage('gpt-5.6-sol', usage({ contextWindow: null }))).toEqual({ usedTokens: 12345, window: 372000, provenance: 'pinned-catalog' });
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
  const doc = new Window({ url: 'https://zcr.test/' }).document as unknown as Document;
  const host = doc.createElement('div'); doc.body.append(host);
  return { ring: mountContextRing(host), host };
}

it('paints the ring from a runtime window without inventing a ratio when the window is unknown', () => {
  const { ring, host } = ringHost();
  // Unknown window: neutral state, an empty arc, and the honest title on hover and by name.
  expect(ring.element.dataset.zcrContextState).toBe('unknown');
  expect(ring.element.querySelector('.zcr-context-ring-fill')!.getAttribute('stroke-dasharray')).toBe('0.00 50.27');
  expect(ring.element.title).toBe(contextUsageTitle(null));
  expect(ring.element.getAttribute('aria-label')).toBe(contextUsageTitle(null));
  expect(host.contains(ring.element)).toBe(true);

  // Runtime-reported window: the arc fills by used/window.
  ring.update(currentContextUsage('gpt-5.6-sol', usage()));
  expect(ring.element.dataset.zcrContextState).toBe('runtime-reported');
  const reported = ring.element.querySelector('.zcr-context-ring-fill')!.getAttribute('stroke-dasharray')!.split(' ').map(Number);
  expect(reported[0]! / reported[1]!).toBeCloseTo(12345 / 372000, 4);
  expect(ring.element.title).toContain('runtime reported');

  // Pinned catalog window: a labelled estimate, never passed off as a runtime measurement.
  ring.update(currentContextUsage('gpt-5.6-sol', usage({ contextWindow: null })));
  expect(ring.element.dataset.zcrContextState).toBe('pinned-catalog');
  expect(ring.element.title).toContain('bundled catalog estimate');

  // A full window caps the arc at one full circumference rather than overdrawing the ring.
  ring.update({ usedTokens: 999_999, window: 372000, provenance: 'runtime-reported' });
  expect(contextRingRatio({ usedTokens: 999_999, window: 372000, provenance: 'runtime-reported' })).toBe(1);
  expect(ring.element.querySelector('.zcr-context-ring-fill')!.getAttribute('stroke-dasharray')).toBe('50.27 50.27');
});
