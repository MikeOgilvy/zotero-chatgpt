import { expect, it, vi } from 'vitest';
import { buildContextBudget, getPinnedModelCapabilities, parseThreadUsage } from '../../packages/core/src/codex/model-capabilities.ts';

it('uses the exact pinned model default window rather than its optional maximum', () => {
  expect(getPinnedModelCapabilities('gpt-5.4')).toMatchObject({ contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'], provenance: 'pinned-catalog', runtimeVersion: '0.144.1' });
  expect(getPinnedModelCapabilities('gpt-5.6-sol')).toMatchObject({ contextWindow: 372000, maxContextWindow: 372000 });
});

it.each(['gpt-5.6-sol-future', 'GPT-5.6-Sol', ' gpt-5.6-sol', 'unlisted-model', '__proto__'])('leaves unmatched model %s unknown', model => {
  expect(getPinnedModelCapabilities(model)).toBeNull();
});

it('does not reuse a catalog after the declared binary identity changes', async () => {
  vi.resetModules();
  vi.doMock('../../runtime/manifest.ts', () => ({ PINNED_RUNTIME: { codexVersion: '0.144.1', sha256: 'different-binary' } }));
  try {
    const changed = await import('../../packages/core/src/codex/model-capabilities.ts');
    expect(changed.getPinnedModelCapabilities('gpt-5.6-sol')).toBeNull();
  } finally { vi.doUnmock('../../runtime/manifest.ts'); vi.resetModules(); }
});

const last = { inputTokens: 1200, cachedInputTokens: 800, outputTokens: 100, reasoningOutputTokens: 40, totalTokens: 1300 };
const total = { inputTokens: 9200, cachedInputTokens: 1800, outputTokens: 1500, reasoningOutputTokens: 400, totalTokens: 10700 };
const usage = () => ({ threadId: 'synthetic-thread', turnId: 'synthetic-turn', tokenUsage: { last: { ...last }, total: { ...total }, modelContextWindow: 353400 } });

it('keeps last and cumulative token usage separate and strips unrelated data', () => {
  const params = usage();
  const parsed = parseThreadUsage({ method: 'thread/tokenUsage/updated', params: { ...params, privateData: 'discard' } });
  expect(parsed).toEqual({ threadId: 'synthetic-thread', turnId: 'synthetic-turn', last, total, modelContextWindow: 353400 });
  params.tokenUsage.last.inputTokens = 0;
  expect(parsed?.last.inputTokens).toBe(1200);
});

it('accepts a notification payload and preserves an absent reported window as unknown', () => {
  expect(parseThreadUsage({ ...usage(), tokenUsage: { last, total, modelContextWindow: null } })?.modelContextWindow).toBeNull();
  expect(parseThreadUsage({ ...usage(), tokenUsage: { last, total } })?.modelContextWindow).toBeNull();
});

it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '12'])('rejects unsafe token counts %s instead of publishing false usage', bad => {
  expect(parseThreadUsage({ ...usage(), tokenUsage: { ...usage().tokenUsage, last: { ...last, inputTokens: bad } } })).toBeNull();
});

it('ignores unrelated notifications and malformed identities or usage shapes', () => {
  for (const value of [null, [], {}, { method: 'item/started', params: usage() }, { ...usage(), threadId: '' }, { ...usage(), tokenUsage: { last } }, { ...usage(), tokenUsage: { last, total, modelContextWindow: -1 } }]) expect(parseThreadUsage(value)).toBeNull();
});

const budgetInput = { modelId: 'gpt-5.4', historyTokens: 0, instructionBytes: 1000, workflowBytes: 500, imageCount: 0, questionBytes: 100, outputReserve: 16000 };

it('reserves instructions, workflow, history, question, output and safety before admitting source text', () => {
  const budget = buildContextBudget({ ...budgetInput, reportedWindow: 100000, historyTokens: 20000 });
  expect(budget).toMatchObject({ capacity: 100000, provenance: 'runtime-reported', accuracy: 'estimate', textBudgetTokens: 42400, reservations: { history: 20000, instructions: 1000, workflow: 500, images: 0, question: 100, output: 16000, safety: 20000, total: 57600 } });
});

it('labels a pinned capacity as an estimate and never substitutes the larger maximum', () => {
  expect(buildContextBudget(budgetInput)).toMatchObject({ capacity: 272000, provenance: 'pinned-catalog', accuracy: 'estimate', textBudgetTokens: 200000 });
});

it('keeps unlisted-model capacity unknown until a valid runtime window is supplied', () => {
  expect(buildContextBudget({ ...budgetInput, modelId: 'unlisted-model' })).toMatchObject({ capacity: null, provenance: 'unknown', accuracy: 'unknown', textBudgetTokens: null });
  expect(buildContextBudget({ ...budgetInput, modelId: 'unlisted-model', reportedWindow: 100000 })).toMatchObject({ capacity: 100000, provenance: 'runtime-reported', textBudgetTokens: 62400 });
});

it('does not treat missing history measurements as an empty conversation', () => {
  const withoutHistory = { modelId: 'gpt-5.4', instructionBytes: 1000, workflowBytes: 500, imageCount: 0, questionBytes: 100, outputReserve: 16000 };
  expect(buildContextBudget(withoutHistory)).toMatchObject({ capacity: 272000, accuracy: 'unknown', textBudgetTokens: null, reservations: { history: null, total: null } });
});

it('accounts for image allowance while clearly marking its unmeasured cost', () => {
  const budget = buildContextBudget({ ...budgetInput, reportedWindow: 100000, imageCount: 2 });
  expect(budget.reservations.images).toBe(32768);
  expect(budget.textBudgetTokens).toBe(29632);
  expect(budget.assumptions).toContain('image-token-cost-unmeasured');
  expect(budget.accuracy).toBe('estimate');
});

it('clamps exhausted budgets to zero and reports the overload without dropping reservations', () => {
  expect(buildContextBudget({ ...budgetInput, reportedWindow: 1000, historyTokens: 5000 })).toMatchObject({ textBudgetTokens: 0, overBudget: true, reservations: { total: 22800 } });
});

it.each([
  { questionBytes: -1 }, { instructionBytes: 1.5 }, { workflowBytes: Infinity }, { imageCount: -1 },
  { historyTokens: NaN }, { reportedWindow: 0 }, { reportedWindow: Infinity }, { outputReserve: -1 },
  { historyTokens: Number.MAX_SAFE_INTEGER, workflowBytes: Number.MAX_SAFE_INTEGER },
])('rejects invalid or overflowing budget inputs %j', patch => {
  expect(() => buildContextBudget({ ...budgetInput, ...patch })).toThrow(RangeError);
});
