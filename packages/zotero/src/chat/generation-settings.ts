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
 * The newest model the runtime offers. `model/list` (requested with includeHidden: false) is paged
 * newest-first by the pinned binary — observed order GPT-5.6-Sol/Terra/Luna, GPT-5.5,
 * GPT-5.3-Codex-Spark — so the first visible entry is the newest. The catalog's `isDefault` flag
 * describes the CLI's own start-up preference and can lag behind, so it is never the default here.
 */
function newestModel(models: readonly ModelOption[]): ModelOption | undefined {
  return models[0];
}
function defaultModel(models: readonly ModelOption[]): ModelOption | undefined {
  return newestModel(models);
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
  const model = modelOf(models, settings.model) ?? defaultModel(models);
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
  const selected = settings ? modelOf(models, settings.model) : undefined;
  const modelOptions = models.map(model => ({ value: model.id, label: model.displayName }));
  const effortOptions: ComposerOption[] = [{ value: '', label: 'Default' }, ...(selected?.supportedReasoningEfforts.map(effort => ({ value: effort.id, label: effortLabel(effort.id) })) ?? [])];
  const ready = models.length > 0 && !!selected;
  return [
    { field: 'model', label: 'Model', value: settings?.model ?? '', options: modelOptions, disabled: !ready },
    { field: 'speed', label: 'Speed', value: encode(settings?.serviceTier ?? null), options: ready ? speedOptions(selected) : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.serviceTiers.length ?? 0) === 0 },
    { field: 'effort', label: 'Reasoning', value: encode(settings?.effort ?? null), options: ready ? effortOptions : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.supportedReasoningEfforts.length ?? 0) === 0 },
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
  const model = modelOf(models, settings.model);
  const parts = [model?.displayName ?? settings.model];
  if (settings.effort) parts.push(effortLabel(settings.effort));
  const fast = resolveFastTier(model);
  if (fast && settings.serviceTier === fast.id) parts.push('Fast');
  return parts.join(' ');
}

export function pickerSummary(settings: GenerationSettings | null, models: readonly ModelOption[]): string {
  return modelChipLabel(settings, models);
}
