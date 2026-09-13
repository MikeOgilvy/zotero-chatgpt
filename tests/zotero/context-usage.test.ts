import { expect, it } from 'vitest';
import type { UsageReport } from '../../packages/contracts/src/index.ts';
import { contextUsageLabel, currentContextUsage, formatContextTokens } from '../../packages/zotero/src/chat/context-view.ts';

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
