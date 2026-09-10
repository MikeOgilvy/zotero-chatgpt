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
function defaultModel(models: readonly ModelOption[]): ModelOption | undefined {
  return models.find(model => model.isDefault) ?? models[0];
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

export function composerControls(models: readonly ModelOption[], settings: GenerationSettings | null): ComposerControl[] {
  const selected = settings ? modelOf(models, settings.model) : undefined;
  const modelOptions = models.map(model => ({ value: model.id, label: model.displayName }));
  const speedOptions: ComposerOption[] = [{ value: '', label: 'Default' }, ...(selected?.serviceTiers.map(tier => ({ value: tier.id, label: tier.name || tier.id })) ?? [])];
  const effortOptions: ComposerOption[] = [{ value: '', label: 'Default' }, ...(selected?.supportedReasoningEfforts.map(effort => ({ value: effort.id, label: effort.id })) ?? [])];
  const ready = models.length > 0 && !!selected;
  return [
    { field: 'model', label: 'Model', value: settings?.model ?? '', options: modelOptions, disabled: !ready },
    { field: 'speed', label: 'Speed', value: encode(settings?.serviceTier ?? null), options: ready ? speedOptions : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.serviceTiers.length ?? 0) === 0 },
    { field: 'effort', label: 'Reasoning', value: encode(settings?.effort ?? null), options: ready ? effortOptions : [{ value: '', label: 'Default' }], disabled: !ready || (selected?.supportedReasoningEfforts.length ?? 0) === 0 },
  ];
}

export function settingsCaption(settings: GenerationSettings, models: readonly ModelOption[]): string {
  const model = modelOf(models, settings.model);
  const modelName = model?.displayName ?? settings.model;
  const speed = settings.serviceTier === null ? 'Default' : (model?.serviceTiers.find(tier => tier.id === settings.serviceTier)?.name ?? settings.serviceTier);
  const effort = settings.effort === null ? 'Default' : settings.effort;
  return `${modelName} · ${speed} · ${effort}`;
}
