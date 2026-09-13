import { expect, it } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import type { AllowedModel } from '../../packages/contracts/src/workspace.ts';
import {
  DEFAULT_ALLOWED_MODEL_IDS, MODEL_ID, allowedModelIds, defaultAllowedModels, enforcedAllowedModelIds, isDefaultAllowedModels, modelCandidates, modelChoices, modelLabel, resolveAllowedModels,
} from '../../packages/core/src/workspace/allowed-models.ts';
import { PINNED_MODEL_CATALOG } from '../../runtime/model-capabilities.ts';

function model(id: string, displayName = id): ModelOption {
  return { id, displayName, isDefault: false, supportedReasoningEfforts: [], defaultReasoningEffort: null, serviceTiers: [], defaultServiceTier: null };
}

it('defaults to exactly the GPT-6 + GPT-5.6 set the composer offered before the setting existed', () => {
  expect(DEFAULT_ALLOWED_MODEL_IDS).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  expect(defaultAllowedModels()).toEqual([
    { id: 'gpt-6-astra', name: 'GPT-6 Astra' },
    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
  ]);
  // An absent field means the default set; duplicates never widen it.
  expect(allowedModelIds(undefined)).toEqual([...DEFAULT_ALLOWED_MODEL_IDS]);
  expect(allowedModelIds([{ id: 'gpt-6-astra', name: 'x' }, { id: 'gpt-6-astra', name: 'y' }])).toEqual(['gpt-6-astra']);
});

it('offers every model the bundled pinned catalog knows about, newest listed first', () => {
  const candidates = modelCandidates();
  expect(candidates.map(candidate => candidate.id)).toEqual(Object.keys(PINNED_MODEL_CATALOG.models));
  expect(candidates[0]).toEqual({ id: 'gpt-6-astra', name: 'GPT-6 Astra' });
  expect(candidates.some(candidate => candidate.id === 'gpt-daybreak-blue-latest')).toBe(true);
  expect(candidates).toHaveLength(11);
});

it('resolves the allowed set against a runtime catalog without inventing models', () => {
  const catalog = [model('gpt-5.5'), model('gpt-6-astra', 'GPT-6-Astra'), model('gpt-5.6-sol'), model('gpt-5.4')];
  // The default allowlist keeps only its own ids, in the catalog's own order.
  expect(resolveAllowedModels(catalog, undefined).map(entry => entry.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol']);
  // An explicit allowlist is authoritative: it adds a non-family model and drops a default one.
  const allowed: AllowedModel[] = [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }];
  expect(resolveAllowedModels(catalog, allowed).map(entry => entry.id)).toEqual(['gpt-5.5', 'gpt-6-astra']);
  // An allowed id the account does not offer is never invented.
  expect(resolveAllowedModels(catalog, [{ id: 'gpt-7-future', name: 'GPT-7 Future' }])).toEqual([]);
});

it('preserves unknown or removed allowed ids instead of dropping them or erroring', () => {
  const stored: AllowedModel[] = [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-retired-x', name: 'GPT Retired X' }];
  expect(allowedModelIds(stored)).toEqual(['gpt-6-astra', 'gpt-retired-x']);
  // The pane renders the catalog first and keeps the preserved extra as its own row.
  const choices = modelChoices(stored);
  expect(choices.slice(0, modelCandidates().length).map(candidate => candidate.id)).toEqual(modelCandidates().map(candidate => candidate.id));
  expect(choices.at(-1)).toEqual({ id: 'gpt-retired-x', name: 'GPT Retired X' });
  expect(modelChoices(undefined)).toEqual(modelCandidates());
});

it('accepts exact dotted runtime ids and rejects malformed ones', () => {
  for (const id of ['gpt-6-astra', 'gpt-5.6-luna', 'codex-auto-review']) expect(MODEL_ID.test(id), id).toBe(true);
  for (const id of ['', '.starts-with-dot', 'has space', 'x'.repeat(129)]) expect(MODEL_ID.test(id), id).toBe(false);
  expect(modelLabel('codex-auto-review')).toBe('Codex Auto Review');
  expect(modelLabel('gpt-daybreak-blue-latest')).toBe('GPT Daybreak Blue Latest');
});

it('leaves the pre-existing family rule in force until the owner edits the allowlist', () => {
  // Absent and freshly-materialised default both stay "untouched", so the picker keeps the GPT-6 /
  // GPT-5.6 family rule — including a family sibling this build has never seen.
  expect(isDefaultAllowedModels(undefined)).toBe(true);
  expect(isDefaultAllowedModels(defaultAllowedModels())).toBe(true);
  expect(enforcedAllowedModelIds(undefined)).toBeUndefined();
  expect(enforcedAllowedModelIds(defaultAllowedModels())).toBeUndefined();
  // Reordering or duplicating the same set is still the default.
  expect(isDefaultAllowedModels([...defaultAllowedModels()].reverse())).toBe(true);
  // The moment the owner removes or adds a model the explicit ids take over.
  const narrowed = defaultAllowedModels().filter(entry => entry.id !== 'gpt-5.6-luna');
  expect(isDefaultAllowedModels(narrowed)).toBe(false);
  expect(enforcedAllowedModelIds(narrowed)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra']);
  const widened = [...defaultAllowedModels(), { id: 'gpt-5.5', name: 'GPT-5.5' }];
  expect(isDefaultAllowedModels(widened)).toBe(false);
  expect(enforcedAllowedModelIds(widened)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);
});
