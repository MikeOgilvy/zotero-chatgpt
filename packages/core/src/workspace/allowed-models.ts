import type { ModelOption } from '../../../contracts/src/runtime.ts';
import type { AllowedModel } from '../../../contracts/src/workspace.ts';
import { PINNED_MODEL_CATALOG } from '../../../../runtime/model-capabilities.ts';

/**
 * The persisted model allowlist: which models the composer may offer.
 *
 * This module is the single source of truth for the default set, the candidate list the native
 * Preferences pane renders, and the resolver the picker consumes. It deliberately lives in core so
 * the store, the pane and the composer all agree without a second list.
 *
 * Honest boundary: the candidate list is the model catalog embedded in the pinned runtime binary,
 * not the account's live `model/list` entitlements. The Preferences window can be opened before the
 * runtime is started (and starting one just to draw a form would be a side effect), so the pane
 * cannot show live entitlements; it does not claim to. A model the account is entitled to but that
 * is absent from the pinned catalog therefore cannot be selected in the pane.
 */

/** Exact model-id shape: runtime ids contain `.`, `-` and `_`, so the skill `identifier` shape is too strict. */
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

const ACRONYMS: Readonly<Record<string, string>> = { gpt: 'GPT', ai: 'AI' };
function titleCase(part: string): string {
  const acronym = ACRONYMS[part.toLowerCase()];
  return acronym ?? (part.length ? part.charAt(0).toUpperCase() + part.slice(1) : part);
}
/**
 * A readable label derived from the exact id. The pinned catalog has no display names and the live
 * `model/list` display names are not persisted, so every label here is local to this reader.
 */
export function modelLabel(id: string): string {
  const words = id.split(/[-_]/u).filter(Boolean).map(titleCase);
  if (words.length >= 2 && words[0] === 'GPT' && /^\d/u.test(words[1]!)) return `${words[0]}-${words.slice(1).join(' ')}`;
  return words.join(' ');
}

/**
 * The default allowlist: GPT-6-Astra plus the GPT-5.6 family, exactly the set the composer offered
 * before this setting existed (see `chat/generation-settings.ts`). Newest first.
 */
export const DEFAULT_ALLOWED_MODEL_IDS: readonly string[] = ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
export function defaultAllowedModels(): AllowedModel[] {
  return DEFAULT_ALLOWED_MODEL_IDS.map(id => ({ id, name: modelLabel(id) }));
}

export interface ModelCandidate { id: string; name: string }

/** Every model the bundled pinned catalog knows about, in catalog order (newest listed first). */
export function modelCandidates(): ModelCandidate[] {
  return Object.keys(PINNED_MODEL_CATALOG.models).map(id => ({ id, name: modelLabel(id) }));
}

/**
 * The exact ids a record allows. An absent field means the default set; duplicates are collapsed.
 * Ids that the pane no longer knows about are preserved, so an unknown or removed model never
 * turns into an error or a silent drop.
 */
export function allowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] {
  return [...new Set((allowedModels ?? defaultAllowedModels()).map(model => model.id))];
}

/**
 * The models the picker may offer from a runtime catalog: exactly the allowed ids the catalog
 * contains, in the catalog's own order. This is the resolver the composer wiring consumes; it is
 * deliberately pure so it can be unit-tested without a runtime.
 */
export function resolveAllowedModels(models: readonly ModelOption[], allowedModels: readonly AllowedModel[] | undefined): ModelOption[] {
  const allowed = new Set(allowedModelIds(allowedModels));
  return models.filter(model => allowed.has(model.id));
}

/**
 * True while the stored list is still exactly the untouched default. This is what keeps the
 * historical GPT-6 / GPT-5.6 family rule in force for anyone who never opened the setting —
 * including a family sibling the pinned catalog does not list — while an edited list becomes
 * authoritative over the picker.
 */
export function isDefaultAllowedModels(allowedModels: readonly AllowedModel[] | undefined): boolean {
  if (allowedModels === undefined) return true;
  const ids = allowedModelIds(allowedModels);
  return ids.length === DEFAULT_ALLOWED_MODEL_IDS.length && DEFAULT_ALLOWED_MODEL_IDS.every(id => ids.includes(id));
}

/**
 * The allowlist the picker should enforce: `undefined` while the stored list is the untouched
 * default (so the pre-existing family rule stays exactly as it was), otherwise the exact ids to
 * offer. The composer wiring passes this straight to `offeredModels(models, allowedIds)`.
 */
export function enforcedAllowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] | undefined {
  return isDefaultAllowedModels(allowedModels) ? undefined : allowedModelIds(allowedModels);
}

/**
 * The union of the pinned candidates and any stored id the catalog no longer lists, in a stable
 * order (catalog first, then preserved extras). The pane renders exactly these rows.
 */
export function modelChoices(allowedModels: readonly AllowedModel[] | undefined): ModelCandidate[] {
  const candidates = modelCandidates();
  const known = new Set(candidates.map(candidate => candidate.id));
  const extras = (allowedModels ?? []).filter(model => !known.has(model.id)).map(model => ({ id: model.id, name: model.name }));
  return [...candidates, ...extras];
}
