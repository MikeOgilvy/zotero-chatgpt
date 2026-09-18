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
 * Two sources feed the offerable set, and both are id-driven:
 *
 * - The pinned catalog embedded in the runtime binary (GPT-6 and GPT-5.6 today), which is available
 *   even before the runtime starts because the Preferences window can be opened first.
 * - The runtime's live `model/list`, which is the only source that can report the GPT-5.3 Spark
 *   family. Those ids are not in the bundled catalog; they become selectable once the runtime
 *   reports them and are then persisted in the allowlist so they keep working.
 *
 * The pane never invents an id: with no live list it shows only the bundled families and says the
 * Spark models come from the runtime. Excluded families (GPT-5.5, GPT-5.4, GPT-5.2, the daybreak
 * ids and the auto-review agent) never become candidates, however they arrive.
 */

/** Exact model-id shape: runtime ids contain `.`, `-` and `_`, so the skill `identifier` shape is too strict. */
export const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

/**
 * Family membership is derived from the exact reported id, never from a per-family list of guessed
 * ids. The boundary group keeps near misses (`gpt-60`, `gpt-5.60-sol`) out, and the Spark marker is
 * required for GPT-5.3 so a plain `gpt-5.3` or `gpt-5.3-codex` is not offered.
 */
const BUNDLED_FAMILY = /^gpt-(?:6|5\.6)(?:$|[-.])/u;
const SPARK_FAMILY = /^gpt-5\.3(?:$|[-.])/u;
const SPARK_MARKER = /spark/iu;

/** True for exactly the ids the allowlist may offer: GPT-6, GPT-5.6, and the GPT-5.3 Spark family. */
export function isOfferableModelId(id: string): boolean {
  return BUNDLED_FAMILY.test(id) || (SPARK_FAMILY.test(id) && SPARK_MARKER.test(id));
}

/**
 * True for the historical picker families (GPT-6 / GPT-5.6) only. The composer keeps the family rule
 * as its fallback when an allowlist leaves nothing offerable; the Spark family is allowlist-only.
 */
export function isBundledFamilyModelId(id: string): boolean { return BUNDLED_FAMILY.test(id); }

const ACRONYMS: Readonly<Record<string, string>> = { gpt: 'GPT', ai: 'AI' };
function titleCase(part: string): string {
  const acronym = ACRONYMS[part.toLowerCase()];
  return acronym ?? (part.length ? part.charAt(0).toUpperCase() + part.slice(1) : part);
}
/**
 * A readable label derived from the exact id. The pinned catalog has no display names and the live
 * `model/list` display names are not persisted, so every label here is local to this reader and
 * derived from the id it names — never a fabricated product name.
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

/**
 * The picker's ordering: the pinned newest-first rank leads, then everything else by id, so a new
 * sibling of either family cannot silently land ahead of the pinned newest model and the server's
 * array order is never trusted. (`gpt-6-astra` is first regardless of how the runtime pages the
 * catalog.)
 */
function offerRank(id: string): number {
  const index = DEFAULT_ALLOWED_MODEL_IDS.indexOf(id);
  return index === -1 ? DEFAULT_ALLOWED_MODEL_IDS.length : index;
}
function compareOfferRank(a: string, b: string): number { return offerRank(a) - offerRank(b) || a.localeCompare(b); }
/**
 * The exact ids the composer may offer from a live catalog, newest-first. This is the whole offer
 * policy in one place — which ids are eligible, their order, and what happens when a stored list has
 * nothing offerable left:
 *
 * - With an enforced allowlist, exactly the catalog ids it names, in rank order (including ids
 *   outside the historical families).
 * - Otherwise the historical GPT-6 / GPT-5.6 family rule, in rank order.
 * - A list whose ids have all left the live catalog degrades to the family rule rather than blanking
 *   a working picker; only when even that yields nothing is the raw catalog order kept.
 *
 * The composer renders this list and nothing else; the stored record is never rewritten here.
 */
export function offeredModelIds(catalogIds: readonly string[], allowedIds?: readonly string[]): string[] {
  const ranked = (ids: readonly string[]): string[] => [...ids].sort(compareOfferRank);
  if (allowedIds !== undefined) {
    const offered = catalogIds.filter(id => allowedIds.includes(id));
    if (offered.length) return ranked(offered);
  }
  const family = catalogIds.filter(isBundledFamilyModelId);
  return family.length ? ranked(family) : [...catalogIds];
}

export interface ModelCandidate { id: string; name: string }

/**
 * Every model the pane may offer, in a stable order: the bundled catalog's offerable families first
 * (newest listed first), then any runtime-reported id in those families that the catalog lacks — in
 * practice the GPT-5.3 Spark models. Excluded families are filtered out on both paths, and an id is
 * never repeated, so a live list that echoes a catalog id does not duplicate a row.
 */
export function modelCandidates(liveModelIds: readonly string[] = []): ModelCandidate[] {
  const ids = Object.keys(PINNED_MODEL_CATALOG.models).filter(isOfferableModelId);
  const known = new Set(ids);
  for (const id of liveModelIds) {
    if (known.has(id) || !isOfferableModelId(id)) continue;
    known.add(id);
    ids.push(id);
  }
  return ids.map(id => ({ id, name: modelLabel(id) }));
}

/**
 * The exact ids a record allows. An absent field means the default set; duplicates are collapsed.
 * Ids that the pane no longer offers are preserved, so an unknown or removed model never turns into
 * an error or a silent drop. This is the record-level honesty guarantee; the picker enforcement in
 * `enforcedAllowedModelIds` is what keeps an offerable set restricted.
 */
export function allowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] {
  return [...new Set((allowedModels ?? defaultAllowedModels()).map(model => model.id))];
}

/**
 * The ids a stored record must keep even though this build cannot offer them (a family the owner
 * saved before it was excluded): stored, de-duplicated, in stored order. The pane has no row for
 * these, so a save must carry them through instead of dropping them; they are never offered.
 */
export function unofferableAllowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] {
  return allowedModelIds(allowedModels).filter(id => !isOfferableModelId(id));
}

/**
 * The models the picker may offer from a runtime catalog: the offerable allowed ids the catalog
 * contains, in the catalog's own order. Pure, so it can be unit-tested without a runtime.
 */
export function resolveAllowedModels(models: readonly ModelOption[], allowedModels: readonly AllowedModel[] | undefined): ModelOption[] {
  const allowed = new Set(allowedModelIds(allowedModels).filter(isOfferableModelId));
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
 * default (so the pre-existing family rule stays exactly as it was), otherwise the offerable ids to
 * offer. A stale id the picker no longer offers is filtered out, and a list with nothing offerable
 * left degrades to `undefined` — the family default — rather than blanking the picker or letting an
 * excluded family back in. The stored record itself is never rewritten by this call.
 */
export function enforcedAllowedModelIds(allowedModels: readonly AllowedModel[] | undefined): string[] | undefined {
  if (isDefaultAllowedModels(allowedModels)) return undefined;
  const ids = allowedModelIds(allowedModels).filter(isOfferableModelId);
  return ids.length ? ids : undefined;
}

/**
 * The union of the offerable bundled candidates, any offerable id the runtime reports, and any
 * saved offerable id neither source lists (for example a Spark selection saved before the runtime
 * stopped), in a stable order. The pane renders exactly these rows; a stored id from an excluded
 * family is never resurrected here, but `allowedModelIds` still preserves it in the record.
 */
export function modelChoices(allowedModels: readonly AllowedModel[] | undefined, liveModelIds: readonly string[] = []): ModelCandidate[] {
  const candidates = modelCandidates(liveModelIds);
  const known = new Set(candidates.map(candidate => candidate.id));
  const extras: ModelCandidate[] = [];
  for (const model of allowedModels ?? []) {
    if (!isOfferableModelId(model.id) || known.has(model.id)) continue;
    known.add(model.id);
    extras.push({ id: model.id, name: modelLabel(model.id) });
  }
  return [...candidates, ...extras];
}
