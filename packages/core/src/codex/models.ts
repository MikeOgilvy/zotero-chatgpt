import type { ModelOption } from '../../../contracts/src/runtime.ts';
import { record } from './transport.ts';
export function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Protocol string invalid'); return value; }
function nullableString(value: unknown) { return value === null ? null : string(value); }
export function parseModel(value: unknown): ModelOption | null {
  const model = record(value);
  if (typeof model.hidden !== 'boolean' || typeof model.isDefault !== 'boolean' || !Array.isArray(model.supportedReasoningEfforts) || !Array.isArray(model.serviceTiers)) throw new Error('Protocol model invalid');
  if (model.hidden) return null;
  const parsed = {
    id: string(model.model), displayName: string(model.displayName), isDefault: model.isDefault,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map(value => { const effort = record(value); return { id: string(effort.reasoningEffort), description: string(effort.description) }; }),
    defaultReasoningEffort: nullableString(model.defaultReasoningEffort),
    serviceTiers: model.serviceTiers.map(value => { const tier = record(value); return { id: string(tier.id), name: string(tier.name), description: string(tier.description) }; }),
    defaultServiceTier: nullableString(model.defaultServiceTier),
  };
  if (!parsed.id || (parsed.defaultReasoningEffort !== null && !parsed.supportedReasoningEfforts.some(e => e.id === parsed.defaultReasoningEffort)) || (parsed.defaultServiceTier !== null && !parsed.serviceTiers.some(t => t.id === parsed.defaultServiceTier))) throw new Error('Protocol model defaults invalid');
  return parsed;
}
