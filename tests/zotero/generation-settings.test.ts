import { expect, it } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import { settings } from '../contracts/factories.ts';
import { alignSettings, applyComposerChoice, catalogDefaultSettings, composerControls, effortLabel, modelChipLabel, offeredModels, resolveFastTier, settingsCaption } from '../../packages/zotero/src/chat/generation-settings.ts';

const catalog: ModelOption[] = [
  {
    id: 'catalog-default', displayName: 'Catalog Default', isDefault: true,
    supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }, { id: 'high', description: 'Deeper' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Priority service' }, { id: 'flex', name: 'Flex', description: 'Flex service' }],
    defaultServiceTier: 'priority',
  },
  {
    id: 'other-model', displayName: 'Other Model', isDefault: false,
    supportedReasoningEfforts: [{ id: 'low', description: 'Faster' }],
    defaultReasoningEffort: 'low',
    serviceTiers: [],
    defaultServiceTier: null,
  },
];

function option(id: string, displayName: string, overrides: Partial<ModelOption> = {}): ModelOption {
  return {
    id, displayName, isDefault: false,
    supportedReasoningEfforts: [{ id: 'medium', description: 'Balanced' }],
    defaultReasoningEffort: 'medium',
    serviceTiers: [], defaultServiceTier: null,
    ...overrides,
  };
}

/**
 * The live `model/list` order captured from a real signed-in account (screenshot 2026-09-13):
 * GPT-5.6-Sol first, GPT-6-Astra second, then Terra/Luna, then the removed GPT-5.5 and Spark.
 * The newest model is not the server's first entry, so the picker must rank its own families.
 */
const liveModels: ModelOption[] = [
  option('gpt-5.6-sol', 'GPT-5.6-Sol'),
  option('gpt-6-astra', 'GPT-6-Astra', { isDefault: true }),
  option('gpt-5.6-terra', 'GPT-5.6-Terra'),
  option('gpt-5.6-luna', 'GPT-5.6-Luna'),
  option('gpt-5.5', 'GPT-5.5'),
  option('gpt-5.3-codex-spark', 'GPT-5.3-Codex-Spark'),
];

/** The embedded catalog's ids in its own order, including the families that must not be offered. */
const embeddedModels: ModelOption[] = [
  option('gpt-6-astra', 'GPT-6-Astra'),
  option('gpt-5.6-sol', 'GPT-5.6-Sol'),
  option('gpt-5.6-terra', 'GPT-5.6-Terra'),
  option('gpt-5.6-luna', 'GPT-5.6-Luna'),
  option('gpt-daybreak-blue-latest', 'GPT-Daybreak-Blue'),
  option('gpt-daybreak-red-latest', 'GPT-Daybreak-Red'),
  option('gpt-5.5', 'GPT-5.5'),
  option('gpt-5.4', 'GPT-5.4'),
  option('gpt-5.4-mini', 'GPT-5.4-Mini'),
  option('gpt-5.2', 'GPT-5.2'),
  option('codex-auto-review', 'Codex Auto Review'),
];

const offeredIds = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

it('defaults to the newest offered model rather than the server array head or the isDefault flag', () => {
  expect(catalogDefaultSettings(liveModels)).toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  expect(catalogDefaultSettings(embeddedModels)).toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  // No GPT-6/GPT-5.6 family is present, so the working list is kept instead of emptied.
  expect(catalogDefaultSettings(catalog)).toEqual({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' });
  expect(catalogDefaultSettings([])).toBeNull();
});

it('returns gpt-6-astra regardless of the order the runtime pages the catalog in', () => {
  const expected = { model: 'gpt-6-astra', serviceTier: null, effort: 'medium' };
  const reversed = [...liveModels].reverse();
  const shuffled = [liveModels[3]!, liveModels[5]!, liveModels[1]!, liveModels[0]!, liveModels[4]!, liveModels[2]!];
  const astraLast = [...liveModels.filter(model => model.id !== 'gpt-6-astra'), liveModels[1]!];
  for (const input of [liveModels, reversed, shuffled, astraLast]) {
    expect(catalogDefaultSettings(input)).toEqual(expected);
  }
});

it('offers only the GPT-6 and GPT-5.6 families, newest first, ignoring the runtime order', () => {
  for (const input of [liveModels, embeddedModels]) {
    expect(composerControls(input, null)[0]?.options.map(option => option.value)).toEqual(offeredIds);
  }
  expect(offeredModels(liveModels).map(model => model.id)).toEqual(offeredIds);
  expect(offeredModels(embeddedModels).map(model => model.id)).toEqual(offeredIds);
});

it('keeps an explicit still-offered model and replaces a removed one with the new default', () => {
  const chosen = { model: 'gpt-5.6-terra', serviceTier: null, effort: 'medium' };
  expect(alignSettings(liveModels, chosen)).toEqual(chosen);
  expect(alignSettings(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' }))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  expect(alignSettings(liveModels, { model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' }))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
  expect(alignSettings(liveModels, { model: 'retired-model', serviceTier: null, effort: 'medium' }))
    .toEqual({ model: 'gpt-6-astra', serviceTier: null, effort: 'medium' });
});

it('keeps a legacy conversation usable: its model control shows an offered value, not blank', () => {
  const controls = composerControls(liveModels, { model: 'gpt-5.5', serviceTier: null, effort: 'medium' });
  const modelControl = controls.find(control => control.field === 'model')!;
  expect(modelControl.disabled).toBe(false);
  expect(modelControl.value).toBe('gpt-6-astra');
  expect(modelControl.options.map(option => option.value)).toContain(modelControl.value);
  // The composer button names the model that would be sent, not the removed saved id.
  expect(modelChipLabel({ model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' }, liveModels)).toBe('GPT-6-Astra Medium');
});

it('moves a legacy conversation to the new default on its next send', () => {
  // presenter.currentSettings() calls alignSettings on every send; a new chat calls
  // catalogDefaultSettings. Both must agree on gpt-6-astra for the removed-model conversation.
  const legacy = { model: 'gpt-5.3-codex-spark', serviceTier: null, effort: 'low' };
  expect(alignSettings(liveModels, legacy)).toEqual(catalogDefaultSettings(liveModels));
});

it('returns no default from an empty catalog instead of a hardcoded menu', () => {
  expect(catalogDefaultSettings(catalog)).toEqual({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' });
  expect(catalogDefaultSettings([])).toBeNull();
});

it('keeps a still-supported combo when aligning, including an explicit catalog-default speed', () => {
  expect(alignSettings(catalog, settings)).toEqual(settings);
  expect(alignSettings(catalog, { ...settings, serviceTier: null, effort: null })).toEqual({ ...settings, serviceTier: null, effort: null });
});

it('on model change, drops unsupported speed/effort to the new model defaults and never maps speed onto effort', () => {
  const next = applyComposerChoice(catalog, settings, 'model', 'other-model');
  expect(next).toEqual({ model: 'other-model', serviceTier: null, effort: 'low' });
  expect(next.effort).not.toBe('priority');
  expect(applyComposerChoice(catalog, settings, 'speed', 'flex')).toEqual({ ...settings, serviceTier: 'flex' });
  expect(applyComposerChoice(catalog, { ...settings, serviceTier: 'flex' }, 'speed', '')).toEqual({ ...settings, serviceTier: null });
  expect(applyComposerChoice(catalog, settings, 'effort', 'high')).toEqual({ ...settings, effort: 'high' });
});

it('builds three independent controls from the selected model, with Default when a field is null', () => {
  const withExtras = composerControls(catalog, settings);
  expect(withExtras.map(c => c.field)).toEqual(['model', 'speed', 'effort']);
  expect(withExtras[0]).toMatchObject({ label: 'Model', value: 'catalog-default', disabled: false });
  expect(withExtras[0]?.options.map(o => o.value)).toEqual(['catalog-default', 'other-model']);
  expect(withExtras[1]).toMatchObject({ label: 'Speed', value: 'priority', disabled: false });
  expect(withExtras[1]?.options).toEqual([
    { value: '', label: 'Default' },
    { value: 'flex', label: 'Fast' },
    { value: 'priority', label: 'Priority' },
  ]);
  expect(withExtras[2]?.options.map(o => o.value)).toEqual(['', 'medium', 'high']);

  const noTiers = composerControls(catalog, { model: 'other-model', serviceTier: null, effort: 'low' });
  expect(noTiers[1]).toMatchObject({ label: 'Speed', value: '', disabled: true });
  expect(noTiers[1]?.options).toEqual([{ value: '', label: 'Default' }]);
  expect(noTiers[2]?.disabled).toBe(false);

  const empty = composerControls([], null);
  expect(empty.every(c => c.disabled)).toBe(true);
});

it('labels a frozen snapshot from the catalog without rewriting it when the menu later changes', () => {
  const frozen = settingsCaption(settings, catalog);
  expect(frozen).toBe('Catalog Default · Priority · medium');
  expect(settingsCaption({ ...settings, serviceTier: null, effort: null }, catalog)).toBe('Catalog Default · Default · Default');
  expect(settingsCaption({ ...settings, serviceTier: 'flex' }, catalog)).toBe('Catalog Default · Fast · medium');
  expect(settingsCaption(settings, [catalog[1]!])).toBe('catalog-default · priority · medium');
});

it('maps product Fast onto a fast-named catalog tier, else the catalog’s fast-like tier', () => {
  expect(resolveFastTier(catalog[0])).toEqual({ id: 'flex', name: 'Flex' });
  const withFast = {
    ...catalog[0]!,
    serviceTiers: [
      { id: 'priority', name: 'Priority', description: '' },
      { id: 'fast-lane', name: 'Fast', description: '' },
    ],
  };
  expect(resolveFastTier(withFast)).toEqual({ id: 'fast-lane', name: 'Fast' });
  expect(resolveFastTier(catalog[1])).toBeUndefined();
});

it('prints catalog effort ids with Cursor-like names only when those ids exist', () => {
  expect(effortLabel('low')).toBe('Low');
  expect(effortLabel('xhigh')).toBe('Extra High');
  expect(effortLabel('extra_high')).toBe('Extra High');
  expect(effortLabel(null)).toBe('Default');
  expect(effortLabel('custom-tier')).toBe('custom-tier');
});

it('labels the model chip as model + effort + Fast without inventing missing tiers', () => {
  expect(modelChipLabel(null, catalog)).toBe('Model');
  expect(modelChipLabel(settings, catalog)).toBe('Catalog Default Medium');
  expect(modelChipLabel({ ...settings, serviceTier: 'flex', effort: 'high' }, catalog)).toBe('Catalog Default High Fast');
  expect(modelChipLabel({ model: 'other-model', serviceTier: null, effort: 'low' }, catalog)).toBe('Other Model Low');
});
