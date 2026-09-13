import type { GenerationSettings } from '../../../contracts/src/index.ts';
import type { ModelOption } from '../../../contracts/src/runtime.ts';

export type ComposerField = 'model' | 'speed' | 'effort';
export interface ComposerOption { value: string; label: string }
export interface ComposerControl {
  field: ComposerField;
  label: string;
  value: string;
  options: ComposerOption[];
  disabled: boolean;
}

function modelOf(models: readonly ModelOption[], id: string): ModelOption | undefined {
  return models.find(model => model.id === id);
}

/**
 * The picker offers only the account's GPT-6 and GPT-5.6 families. Ordering is derived from this
 * explicit rank rather than the server's array: the live `model/list` (includeHidden: false) lists
 * GPT-5.6-Sol first and GPT-6-Astra second, so the array head is not the newest model. Unknown
 * members of either family still rank behind these four, sorted by id, so a new sibling cannot
 * silently land ahead of the pinned newest model.
 */
const OFFERED_MODEL_RANK = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'] as const;
const OFFERED_MODEL_FAMILY = /^gpt-(?:6|5\.6)(?:$|[-.])/u;

function offeredRank(id: string): number {
  const index = OFFERED_MODEL_RANK.indexOf(id as (typeof OFFERED_MODEL_RANK)[number]);
  return index === -1 ? OFFERED_MODEL_RANK.length : index;
}

/**
 * The models the picker may offer, newest-first. Every other family stays in the runtime snapshot
 * for capability lookups and historical message captions but never appears in the menu. When the
 * account offers none of the two families, the full list is kept rather than emptying a working
 * picker; that also keeps synthetic catalogs (and offline tests) usable.
 */
export function offeredModels(models: readonly ModelOption[]): ModelOption[] {
  const offered = models.filter(model => OFFERED_MODEL_FAMILY.test(model.id));
  if (!offered.length) return models.slice();
  return offered.slice().sort((a, b) => offeredRank(a.id) - offeredRank(b.id) || a.id.localeCompare(b.id));
}

/**
 * The newest model the picker can offer. The catalog's `isDefault` flag describes the CLI's own
 * start-up preference and can lag behind, so it is never the default here, and `gpt-6-astra` is
 * first regardless of the order the runtime pages the catalog in.
 */
function defaultModel(models: readonly ModelOption[]): ModelOption | undefined {
  return offeredModels(models)[0];
}
function encode(value: string | null): string { return value ?? ''; }
function supportedTier(model: ModelOption, tier: string | null): boolean {
  return tier === null || model.serviceTiers.some(option => option.id === tier);
}
function supportedEffort(model: ModelOption, effort: string | null): boolean {
  return effort === null || model.supportedReasoningEfforts.some(option => option.id === effort);
}

export function catalogDefaultSettings(models: readonly ModelOption[]): GenerationSettings | null {
  const model = defaultModel(models);
  return model ? { model: model.id, serviceTier: model.defaultServiceTier, effort: model.defaultReasoningEffort } : null;
}

/** Keep a still-legal combo; if the model or a field is gone, show that model's catalog defaults. */
export function alignSettings(models: readonly ModelOption[], settings: GenerationSettings): GenerationSettings {
  const offered = offeredModels(models);
  const model = modelOf(offered, settings.model) ?? offered[0];
  if (!model) return settings;
  return {
    model: model.id,
    serviceTier: supportedTier(model, settings.serviceTier) ? settings.serviceTier : model.defaultServiceTier,
    effort: supportedEffort(model, settings.effort) ? settings.effort : model.defaultReasoningEffort,
  };
}

export function applyComposerChoice(models: readonly ModelOption[], current: GenerationSettings, field: ComposerField, raw: string): GenerationSettings {
  if (field === 'model') return alignSettings(models, { ...current, model: raw || current.model });
  if (field === 'speed') return { ...current, serviceTier: raw === '' ? null : raw };
  return { ...current, effort: raw === '' ? null : raw };
}

/** Prefer a catalog tier named Fast; otherwise the first fast-like id/name (flex/turbo/plus). Never invent a missing id. */
export function resolveFastTier(model: ModelOption | undefined): { id: string; name: string } | undefined {
  if (!model) return undefined;
  const named = model.serviceTiers.find(tier => /^fast$/iu.test(tier.id) || /^fast$/iu.test(tier.name));
  const match = named ?? model.serviceTiers.find(tier => /fast|flex|turbo|plus/iu.test(`${tier.id} ${tier.name}`));
  return match ? { id: match.id, name: match.name } : undefined;
}

function speedOptions(model: ModelOption | undefined): ComposerOption[] {
  const options: ComposerOption[] = [{ value: '', label: 'Default' }];
  if (!model) return options;
  const fast = resolveFastTier(model);
  if (fast) options.push({ value: fast.id, label: 'Fast' });
  for (const tier of model.serviceTiers) {
    if (fast && tier.id === fast.id) continue;
    options.push({ value: tier.id, label: tier.name || tier.id });
  }
  return options;
}

function speedLabel(model: ModelOption | undefined, tier: string | null): string {
  if (tier === null) return 'Default';
  const fast = resolveFastTier(model);
  if (fast && fast.id === tier) return 'Fast';
  return model?.serviceTiers.find(option => option.id === tier)?.name ?? tier;
}

export function composerControls(models: readonly ModelOption[], settings: GenerationSettings | null): ComposerControl[] {
  const offered = offeredModels(models);
  // A draft/conversation can still hold a model the picker no longer offers; align it first so the
  // model field shows an offered value instead of a blank selection.
  const current = settings ? alignSettings(models, settings) : null;
  const selected = current ? modelOf(offered, current.model) : undefined;
  const modelOptions = offered.map(model => ({ value: model.id, label: model.displayName }));
  const effortOptions: ComposerOption[] = [{ value: '', label: 'Default' }, ...(selected?.supportedReasoningEfforts.map(effort => ({ value: effort.id, label: effortLabel(effort.id) })) ?? [])];
  const ready = offered.length > 0 && !!selected;
  return [
    { field: 'model', label: 'Model', value: current?.model ?? '', options: modelOptions, disabled: !ready },
    { field: 'speed', label: 'Speed', value: encode(current?.serviceTier ?? null), options: ready ? speedOptions(selected) : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.serviceTiers.length ?? 0) === 0 },
    { field: 'effort', label: 'Reasoning', value: encode(current?.effort ?? null), options: ready ? effortOptions : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.supportedReasoningEfforts.length ?? 0) === 0 },
  ];
}

export function settingsCaption(settings: GenerationSettings, models: readonly ModelOption[]): string {
  const model = modelOf(models, settings.model);
  const modelName = model?.displayName ?? settings.model;
  const speed = speedLabel(model, settings.serviceTier);
  const effort = settings.effort === null ? 'Default' : settings.effort;
  return `${modelName} · ${speed} · ${effort}`;
}

export function effortLabel(id: string | null): string {
  if (!id) return 'Default';
  const key = id.toLowerCase().replace(/[_\s-]/gu, '');
  if (key === 'none') return 'None';
  if (key === 'low') return 'Low';
  if (key === 'medium') return 'Medium';
  if (key === 'high') return 'High';
  if (key === 'xhigh' || key === 'extrahigh') return 'Extra High';
  return id;
}

export function modelChipLabel(settings: GenerationSettings | null, models: readonly ModelOption[]): string {
  if (!settings) return 'Model';
  // The button must name the model the composer would actually send, so a saved model the picker
  // no longer offers is shown as its aligned replacement rather than a stale, unselectable id.
  const current = alignSettings(models, settings);
  const model = modelOf(offeredModels(models), current.model);
  const parts = [model?.displayName ?? current.model];
  if (current.effort) parts.push(effortLabel(current.effort));
  const fast = resolveFastTier(model);
  if (fast && current.serviceTier === fast.id) parts.push('Fast');
  return parts.join(' ');
}

export function pickerSummary(settings: GenerationSettings | null, models: readonly ModelOption[]): string {
  return modelChipLabel(settings, models);
}
