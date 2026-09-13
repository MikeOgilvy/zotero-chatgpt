import type { UsageReport } from '../../../contracts/src/index.ts';
import { getPinnedModelCapabilities } from '../../../core/src/codex/model-capabilities.ts';

export interface ContextUsage {
  /** Input tokens from the last runtime usage report; never reconstructed from message text. */
  usedTokens: number;
  window: number | null;
  provenance: 'runtime-reported' | 'pinned-catalog' | 'unknown';
}

/**
 * The runtime reports usage per turn, so this is the last reported input size, not a live count.
 * It stays null for a different model to avoid attributing another model's report to this one.
 */
export function currentContextUsage(modelId: string | null | undefined, usage: UsageReport | null | undefined): ContextUsage | null {
  if (!modelId || !usage || usage.model !== modelId) return null;
  const reported = usage.contextWindow;
  const pinned = getPinnedModelCapabilities(modelId)?.contextWindow ?? null;
  const window = reported ?? pinned;
  return { usedTokens: usage.last.inputTokens, window, provenance: reported != null ? 'runtime-reported' : pinned != null ? 'pinned-catalog' : 'unknown' };
}

export function formatContextTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

export function contextUsageLabel(usage: ContextUsage | null): string {
  if (!usage) return 'Context unknown';
  return usage.window === null ? `Context ${formatContextTokens(usage.usedTokens)} tokens · window unknown` : `Context ${formatContextTokens(usage.usedTokens)} / ${formatContextTokens(usage.window)} tokens`;
}

export function contextUsageTitle(usage: ContextUsage | null): string {
  if (!usage) return 'Current context is unknown: the runtime has not reported usage for this model.';
  const used = usage.usedTokens.toLocaleString('en-US');
  const tail = 'This is the last report, not remaining context.';
  if (usage.window === null) return `Last runtime usage report: ${used} input tokens; the model window is unknown. ${tail}`;
  const window = usage.window.toLocaleString('en-US');
  const origin = usage.provenance === 'runtime-reported' ? 'runtime reported' : 'bundled catalog estimate';
  return `Last runtime usage report: ${used} input tokens; model window ${window} (${origin}). ${tail}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Used/window when a window is known; null means no proportion can be shown honestly. */
export function contextRingRatio(usage: ContextUsage | null): number | null {
  if (!usage || usage.window === null || usage.window <= 0) return null;
  return Math.min(1, Math.max(0, usage.usedTokens / usage.window));
}

export interface ContextRing { element: HTMLElement; update(usage: ContextUsage | null): void }
/**
 * A small ring instead of a text chip. The ring is a state indicator, not a loading affordance:
 * with no honest proportion (no runtime report for this model, or no window known) it draws a
 * complete, unbroken ring in a neutral tone; once a window is known the ring is released into a
 * used/window arc. The numbers live in the hover title and the accessible name, so no token figure
 * occupies the composer's control row.
 */
export function mountContextRing(parent: HTMLElement): ContextRing {
  const doc = parent.ownerDocument;
  const element = doc.createElementNS(HTML_NS, 'span');
  element.className = 'zcr-context-ring'; element.dataset.zcrContextUsage = ''; element.setAttribute('role', 'status');
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of [['viewBox', '0 0 20 20'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['focusable', 'false']] as const) svg.setAttribute(name, value);
  const circle = (className: string) => {
    const node = doc.createElementNS(SVG_NS, 'circle');
    node.setAttribute('class', className); node.setAttribute('cx', '10'); node.setAttribute('cy', '10'); node.setAttribute('r', String(RING_RADIUS)); node.setAttribute('fill', 'none');
    return node;
  };
  const track = circle('zcr-context-ring-track');
  const fill = circle('zcr-context-ring-fill');
  fill.setAttribute('transform', 'rotate(-90 10 10)');
  svg.append(track, fill); element.append(svg); parent.append(element);
  const update = (usage: ContextUsage | null) => {
    const ratio = contextRingRatio(usage);
    element.dataset.zcrContextState = ratio === null ? 'unknown' : usage!.provenance;
    // Unknown has no proportion to draw, so the whole stroke stays whole: no dash pattern means no
    // gap, which reads as a deliberately solid "unknown" ring rather than an empty placeholder.
    if (ratio === null) fill.setAttribute('stroke-dasharray', 'none');
    else fill.setAttribute('stroke-dasharray', `${(RING_CIRCUMFERENCE * ratio).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
    const title = contextUsageTitle(usage);
    if (element.title !== title) element.title = title;
    if (element.getAttribute('aria-label') !== title) element.setAttribute('aria-label', title);
  };
  update(null);
  return { element, update };
}
