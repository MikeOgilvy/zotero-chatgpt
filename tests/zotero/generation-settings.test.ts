import { expect, it } from 'vitest';
import type { ModelOption } from '../../packages/contracts/src/runtime.ts';
import { settings } from '../contracts/factories.ts';
import { alignSettings, applyComposerChoice, catalogDefaultSettings, composerControls, effortLabel, modelChipLabel, resolveFastTier, settingsCaption } from '../../packages/zotero/src/chat/generation-settings.ts';

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

it('takes catalog defaults from the default model, not a hardcoded menu', () => {
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
