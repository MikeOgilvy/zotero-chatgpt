import type { ModelOption, RuntimeSnapshot } from '../../../contracts/src/runtime.ts';
import { record } from './transport.ts';
export function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Protocol string invalid'); return value; }
function nullableString(value: unknown) { return value === null ? null : string(value); }
function modalities(value: unknown): Array<'text' | 'image'> | undefined {
  if (!Array.isArray(value) || value.length > 8) return undefined;
  const result: Array<'text' | 'image'> = [];
  for (const raw of value) { const item: unknown = raw; if (item !== 'text' && item !== 'image') return undefined; if (!result.includes(item)) result.push(item); }
  return result;
}
/**
 * One catalog entry. `hidden` is the runtime's own "not user-selectable" marker (deprecated or
 * internal models); dropped here with no plugin-side list of its own, so the picker can only ever
 * offer models this account may actually select. `isDefault` is kept for the CLI's start-up
 * preference but is not the newest model, so the composer derives its own default from list order.
 */
export function parseModel(value: unknown): ModelOption | null {
  const model = record(value);
  if (typeof model.hidden !== 'boolean' || typeof model.isDefault !== 'boolean' || !Array.isArray(model.supportedReasoningEfforts) || !Array.isArray(model.serviceTiers)) throw new Error('Protocol model invalid');
  if (model.hidden) return null;
  const inputModalities = modalities(model.inputModalities);
  const parsed = {
    id: string(model.model), displayName: string(model.displayName), isDefault: model.isDefault,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map(value => { const effort = record(value); return { id: string(effort.reasoningEffort), description: string(effort.description) }; }),
    defaultReasoningEffort: nullableString(model.defaultReasoningEffort),
    serviceTiers: model.serviceTiers.map(value => { const tier = record(value); return { id: string(tier.id), name: string(tier.name), description: string(tier.description) }; }),
    defaultServiceTier: nullableString(model.defaultServiceTier),
    ...(inputModalities !== undefined ? { inputModalities } : {}),
  };
  if (!parsed.id || (parsed.defaultReasoningEffort !== null && !parsed.supportedReasoningEfforts.some(e => e.id === parsed.defaultReasoningEffort)) || (parsed.defaultServiceTier !== null && !parsed.serviceTiers.some(t => t.id === parsed.defaultServiceTier))) throw new Error('Protocol model defaults invalid');
  return parsed;
}
/** Provider support is descriptive; it does not enable a tool or grant task permissions. */
export function parseProviderCapabilities(value: unknown): RuntimeSnapshot['capabilities'] {
  try {
    const source = record(value); const { imageGeneration, namespaceTools, webSearch } = source;
    if (typeof imageGeneration !== 'boolean' || typeof namespaceTools !== 'boolean' || typeof webSearch !== 'boolean') return undefined;
    return { imageGeneration, namespaceTools, webSearch };
  } catch { return undefined; }
}
interface RateWindow { usedPercent: number; resetsAt: number | null; windowMinutes: number | null }
interface RateBucket { primary?: RateWindow; secondary?: RateWindow }
export type RateLimitBuckets = Map<string, RateBucket>;
function limitId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/u.test(value)) throw new Error('Invalid limit id'); return value;
}
function count(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid limit count'); return value;
}
function windowOf(value: unknown, previous?: RateWindow): RateWindow | undefined {
  if (value == null) return previous ? { ...previous } : undefined;
  const source = record(value);
  return {
    usedPercent: count(source.usedPercent, 0, 2147483647),
    resetsAt: source.resetsAt == null ? previous?.resetsAt ?? null : count(source.resetsAt, 0, 8640000000000),
    windowMinutes: source.windowDurationMins == null ? previous?.windowMinutes ?? null : count(source.windowDurationMins, 1),
  };
}
function bucketOf(value: unknown, key: string, previous?: RateBucket): RateBucket {
  const source = record(value); if (source.limitId != null && limitId(source.limitId) !== key) throw new Error('Mismatched limit id');
  const primary = windowOf(source.primary, previous?.primary); const secondary = windowOf(source.secondary, previous?.secondary);
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) };
}
/** Only window measurements survive; names, plans, credit balances and account metadata do not. */
export function parseRateLimits(value: unknown): RateLimitBuckets | null {
  try {
    const source = record(value); const result: RateLimitBuckets = new Map();
    if (source.rateLimitsByLimitId != null) {
      const entries = Object.entries(record(source.rateLimitsByLimitId)); if (entries.length > 64) return null;
      for (const [key, value] of entries) result.set(limitId(key), bucketOf(value, key));
    } else if (source.rateLimits != null) {
      const legacy = record(source.rateLimits); const key = legacy.limitId == null ? 'codex' : limitId(legacy.limitId); result.set(key, bucketOf(legacy, key));
    }
    return result;
  } catch { return null; }
}
export function mergeRateLimitNotice(value: unknown, previous: RateLimitBuckets | null): RateLimitBuckets | null {
  try {
    const source = record(record(value).rateLimits);
    const key = source.limitId != null ? limitId(source.limitId) : !previous?.size || previous.has('codex') ? 'codex' : previous.size === 1 ? previous.keys().next().value : undefined;
    if (!key) return null;
    const result = new Map(previous); result.set(key, bucketOf(source, key, previous?.get(key))); if (result.size > 64) return null; return result;
  } catch { return null; }
}
export function visibleRateLimits(value: RateLimitBuckets | null): RuntimeSnapshot['rateLimits'] {
  if (!value) return undefined;
  const rows: NonNullable<RuntimeSnapshot['rateLimits']> = [];
  [...value.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([key, bucket], index) => {
    const name = key === 'codex' ? 'Codex' : key === 'codex-spark' ? 'Codex Spark' : `Limit ${index + 1}`;
    for (const phase of ['primary', 'secondary'] as const) { const window = bucket[phase]; if (window) rows.push({ label: `${name} · ${phase}`, ...window }); }
  });
  return rows.length ? rows : undefined;
}
