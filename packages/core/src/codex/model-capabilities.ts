import { PINNED_RUNTIME } from '../../../../runtime/manifest.ts';
import { PINNED_MODEL_CATALOG } from '../../../../runtime/model-capabilities.ts';

export interface PinnedModelCapabilities {
  contextWindow: number;
  maxContextWindow: number;
  inputModalities: Array<'text' | 'image'>;
  provenance: 'pinned-catalog';
  runtimeVersion: string;
}

/** Exact ids only. A bundled default is not a report of the active account's capacity. */
export function getPinnedModelCapabilities(exactModelId: string): PinnedModelCapabilities | null {
  if (String(PINNED_MODEL_CATALOG.runtimeVersion) !== String(PINNED_RUNTIME.codexVersion) || String(PINNED_MODEL_CATALOG.runtimeSha256) !== String(PINNED_RUNTIME.sha256)) return null;
  const model = Object.entries(PINNED_MODEL_CATALOG.models).find(([id]) => id === exactModelId)?.[1];
  return model ? { contextWindow: model.contextWindow, maxContextWindow: model.maxContextWindow, inputModalities: [...model.inputModalities], provenance: 'pinned-catalog', runtimeVersion: PINNED_MODEL_CATALOG.runtimeVersion } : null;
}

export interface TokenUsageBreakdown {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}
export interface ThreadUsage {
  threadId: string;
  turnId: string;
  last: TokenUsageBreakdown;
  total: TokenUsageBreakdown;
  modelContextWindow: number | null;
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function breakdown(value: unknown): TokenUsageBreakdown | null {
  const item = record(value); if (!item) return null;
  const { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens } = item;
  if (!isCount(inputTokens) || !isCount(cachedInputTokens) || !isCount(outputTokens) || !isCount(reasoningOutputTokens) || !isCount(totalTokens)) return null;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens };
}
/**
 * Accepts a notification envelope or its params and returns only safe public fields.
 * `total` is cumulative usage, never current context occupancy. `last` is the last
 * runtime usage report; it must not silently stand in for retained history after
 * compaction, a model switch, recovery, or unmeasured appended tool context.
 */
export function parseThreadUsage(notification: unknown): ThreadUsage | null {
  let params = record(notification); if (!params) return null;
  if ('method' in params) {
    if (params.method !== 'thread/tokenUsage/updated') return null;
    params = record(params.params); if (!params) return null;
  }
  const { threadId, turnId } = params;
  if (typeof threadId !== 'string' || !threadId.length || threadId.length > 512 || typeof turnId !== 'string' || !turnId.length || turnId.length > 512) return null;
  const usage = record(params.tokenUsage); if (!usage) return null;
  const last = breakdown(usage.last), total = breakdown(usage.total);
  const modelContextWindow = usage.modelContextWindow ?? null;
  if (!last || !total || (modelContextWindow !== null && (!isCount(modelContextWindow) || !modelContextWindow))) return null;
  return { threadId, turnId, last, total, modelContextWindow };
}

export interface ContextBudgetInput {
  modelId: string;
  /** Only use a report from this request's model and thread; discard stale reports. */
  reportedWindow?: number | null;
  /** A conservative retained-history estimate. Pass zero explicitly for a fresh thread. */
  historyTokens?: number | null;
  instructionBytes: number;
  workflowBytes: number;
  imageCount: number;
  questionBytes: number;
  outputReserve?: number;
}
export interface ContextBudget {
  capacity: number | null;
  provenance: 'pinned-catalog' | 'runtime-reported' | 'unknown';
  accuracy: 'estimate' | 'unknown';
  textBudgetTokens: number | null;
  reservations: {
    history: number | null;
    instructions: number;
    workflow: number;
    images: number;
    question: number;
    output: number;
    safety: number | null;
    total: number | null;
  };
  overBudget: boolean | null;
  assumptions: string[];
}
function count(value: unknown, label: string): number {
  if (!isCount(value)) throw new RangeError(`Invalid ${label} budget`);
  return value;
}
function sum(values: number[]): number { return count(values.reduce((total, value) => total + value, 0), 'total'); }
/**
 * Admission estimate, not tokenizer output or an account-capacity guarantee.
 * UTF-8 bytes are charged one-for-one as a deliberately cautious text heuristic;
 * the caller must include all serialized instructions, selections and wrappers.
 * The 20% margin and 16,384-token image/output allowances are local policy only.
 * Image count alone cannot bound vision cost without dimensions/detail metadata.
 */
export function buildContextBudget(input: ContextBudgetInput): ContextBudget {
  const reported = input.reportedWindow ?? null;
  if (reported !== null && (!isCount(reported) || !reported)) throw new RangeError('Invalid reported window budget');
  const capacity = reported ?? getPinnedModelCapabilities(input.modelId)?.contextWindow ?? null;
  const provenance = reported !== null ? 'runtime-reported' : capacity !== null ? 'pinned-catalog' : 'unknown';
  const history = input.historyTokens == null ? null : count(input.historyTokens, 'history');
  const instructions = count(input.instructionBytes, 'instructions');
  const workflow = count(input.workflowBytes, 'workflow');
  const question = count(input.questionBytes, 'question');
  const images = count(count(input.imageCount, 'image count') * 16384, 'images');
  const output = count(input.outputReserve ?? 16384, 'output');
  const safety = capacity === null ? null : Math.ceil(capacity * 0.2);
  const reserved = sum([instructions, workflow, question, images, output, history ?? 0, safety ?? 0]);
  const total = capacity !== null && history !== null ? reserved : null;
  const assumptions = ['utf8-bytes-as-token-estimate', 'output-reserve-is-policy', 'safety-margin-is-policy'];
  if (provenance === 'pinned-catalog') assumptions.push('pinned-catalog-is-not-account-capacity');
  if (images) assumptions.push('image-token-cost-unmeasured');
  if (history === null) assumptions.push('history-token-cost-unknown');
  if (capacity === null) assumptions.push('model-window-unknown');
  return {
    capacity, provenance, accuracy: total === null ? 'unknown' : 'estimate',
    textBudgetTokens: total === null || capacity === null ? null : Math.max(0, capacity - total),
    reservations: { history, instructions, workflow, images, question, output, safety, total },
    overBudget: total === null || capacity === null ? null : total > capacity,
    assumptions,
  };
}
