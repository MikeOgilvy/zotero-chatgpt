import { expect, it } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import type { AllowedModel } from '../../packages/contracts/src/workspace.ts';
import {
  DEFAULT_ALLOWED_MODEL_IDS, MODEL_ID, allowedModelIds, defaultAllowedModels, enforcedAllowedModelIds, isDefaultAllowedModels, isOfferableModelId, modelCandidates, modelChoices, modelLabel, resolveAllowedModels,
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

it('offers only the GPT-6 and GPT-5.6 families from the bundled catalog, newest listed first', () => {
  const candidates = modelCandidates();
  expect(candidates.map(candidate => candidate.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  expect(candidates[0]).toEqual({ id: 'gpt-6-astra', name: 'GPT-6 Astra' });
  expect(candidates.at(-1)).toEqual({ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' });
  // The catalog still carries the excluded ids for capability lookups; the picker just never offers them.
  for (const excluded of ['gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'codex-auto-review']) {
    expect(PINNED_MODEL_CATALOG.models[excluded as keyof typeof PINNED_MODEL_CATALOG.models], excluded).toBeDefined();
    expect(candidates.map(candidate => candidate.id), excluded).not.toContain(excluded);
  }
});

it('derives family membership from the exact id and stays strict about it', () => {
  for (const id of ['gpt-6-astra', 'gpt-6', 'gpt-6-terra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark', 'gpt-5.3-spark']) {
    expect(isOfferableModelId(id), id).toBe(true);
  }
  for (const id of ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-daybreak-blue-latest', 'gpt-daybreak-red-latest', 'codex-auto-review', 'gpt-60', 'gpt-5.60-sol', 'gpt-5.3', 'gpt-5.3-codex', 'gpt-5.30-spark', 'gpt-7-future', '']) {
    expect(isOfferableModelId(id), id).toBe(false);
  }
});

it('adds runtime-reported GPT-5.3 Spark ids and never an excluded family', () => {
  const live = ['gpt-5.6-sol', 'gpt-5.3-codex-spark', 'gpt-5.5', 'gpt-5.4', 'codex-auto-review', 'gpt-daybreak-blue-latest'];
  expect(modelCandidates(live).map(candidate => candidate.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark']);
  expect(modelCandidates(live).at(-1)).toEqual({ id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' });
  // A live id already in the catalog is never duplicated.
  expect(modelCandidates(['gpt-6-astra', 'gpt-6-astra']).map(candidate => candidate.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
});

it('resolves the allowed set against a runtime catalog without leaking excluded families', () => {
  const catalog = [model('gpt-5.5'), model('gpt-6-astra', 'GPT-6-Astra'), model('gpt-5.6-sol'), model('gpt-5.4')];
  // The default allowlist keeps only its own ids, in the catalog's own order.
  expect(resolveAllowedModels(catalog, undefined).map(entry => entry.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol']);
  // An explicit allowlist is authoritative, but an id the picker no longer offers must not leak back in.
  const allowed: AllowedModel[] = [{ id: 'gpt-5.5', name: 'GPT-5.5' }, { id: 'gpt-6-astra', name: 'GPT-6 Astra' }];
  expect(resolveAllowedModels(catalog, allowed).map(entry => entry.id)).toEqual(['gpt-6-astra']);
  // An allowed id the account does not offer is never invented.
  expect(resolveAllowedModels(catalog, [{ id: 'gpt-7-future', name: 'GPT-7 Future' }])).toEqual([]);
});

it('preserves unknown or removed allowed ids in the record without offering them', () => {
  const stored: AllowedModel[] = [{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }, { id: 'gpt-retired-x', name: 'GPT Retired X' }];
  // The honesty guarantee: an id the picker no longer knows is preserved, never dropped or errored.
  expect(allowedModelIds(stored)).toEqual(['gpt-6-astra', 'gpt-retired-x']);
  // The pane renders only offerable ids, so a removed family does not come back as a row.
  expect(modelChoices(stored).map(candidate => candidate.id)).toEqual(modelCandidates().map(candidate => candidate.id));
  // The picker enforces only the still-offerable part.
  expect(enforcedAllowedModelIds(stored)).toEqual(['gpt-6-astra']);
  expect(modelChoices(undefined)).toEqual(modelCandidates());
});

it('keeps a saved Spark id as a row without inventing one when no runtime has reported it', () => {
  const stored: AllowedModel[] = [...defaultAllowedModels(), { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' }, { id: 'gpt-5.5', name: 'GPT-5.5' }];
  expect(modelChoices(stored).map(candidate => candidate.id)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark']);
  expect(modelChoices(stored).some(candidate => candidate.id === 'gpt-5.5')).toBe(false);
  // With no live list and no saved Spark id, no Spark row is created from nothing.
  expect(modelChoices(undefined).some(candidate => candidate.id.startsWith('gpt-5.3'))).toBe(false);
});

it('accepts exact dotted runtime ids and rejects malformed ones', () => {
  for (const id of ['gpt-6-astra', 'gpt-5.6-luna', 'codex-auto-review']) expect(MODEL_ID.test(id), id).toBe(true);
  for (const id of ['', '.starts-with-dot', 'has space', 'x'.repeat(129)]) expect(MODEL_ID.test(id), id).toBe(false);
  expect(modelLabel('codex-auto-review')).toBe('Codex Auto Review');
  expect(modelLabel('gpt-daybreak-blue-latest')).toBe('GPT Daybreak Blue Latest');
  expect(modelLabel('gpt-5.3-codex-spark')).toBe('GPT-5.3 Codex Spark');
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
  const withSpark = [...defaultAllowedModels(), { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' }];
  expect(isDefaultAllowedModels(withSpark)).toBe(false);
  expect(enforcedAllowedModelIds(withSpark)).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.3-codex-spark']);
});

it('keeps an excluded id out of the picker and degrades to the family default when nothing is left', () => {
  // A stale entry is filtered; the still-offerable part of the list survives untouched.
  expect(enforcedAllowedModelIds([{ id: 'gpt-6-astra', name: 'a' }, { id: 'gpt-5.5', name: 'b' }])).toEqual(['gpt-6-astra']);
  expect(enforcedAllowedModelIds([{ id: 'gpt-5.6-luna', name: 'a' }, { id: 'codex-auto-review', name: 'b' }, { id: 'gpt-5.4', name: 'c' }])).toEqual(['gpt-5.6-luna']);
  // A list with nothing offerable left degrades to the family default instead of blanking the picker.
  expect(enforcedAllowedModelIds([{ id: 'gpt-5.5', name: 'a' }, { id: 'gpt-5.2', name: 'b' }])).toBeUndefined();
  expect(enforcedAllowedModelIds([{ id: 'gpt-retired-x', name: 'a' }])).toBeUndefined();
  // Nothing is dropped from the record itself: only the picker enforcement narrows.
  expect(allowedModelIds([{ id: 'gpt-5.5', name: 'a' }, { id: 'gpt-5.2', name: 'b' }])).toEqual(['gpt-5.5', 'gpt-5.2']);
});
