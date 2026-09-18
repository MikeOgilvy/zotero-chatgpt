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

export interface ContextRing {
  element: HTMLElement;
  /**
   * Detail affordance for the last request. The caller fills it with the concrete coverage report;
   * the ring owns visibility, focus wiring and nothing else. It is never placed inside the ring, so
   * the ring's own text stays empty.
   */
  details: HTMLElement;
  update(usage: ContextUsage | null): void;
  /**
   * Publishes the last request's coverage report. `null` means no request has been sent yet: the
   * disclosure stays unavailable rather than inventing coverage the runtime never reported.
   */
  report(content: HTMLElement | null): void;
}
let ringSerial = 0;
/**
 * A small ring instead of a text chip. The ring is a state indicator, not a loading affordance:
 * with no honest proportion (no runtime report for this model, or no window known) it draws a
 * complete, unbroken ring in a neutral tone; once a window is known the ring is released into a
 * used/window arc. The numbers live in the hover title and the accessible name, so no token figure
 * occupies the composer's control row. Once a request has been sent the hover title is replaced by
 * the caller's coverage disclosure, which is reachable by keyboard focus as well as hover.
 */
export function mountContextRing(parent: HTMLElement): ContextRing {
  const doc = parent.ownerDocument;
  const element = doc.createElementNS(HTML_NS, 'span');
  element.className = 'zchatgpt-context-ring'; element.dataset.zchatgptContextUsage = ''; element.setAttribute('role', 'status');
  // Hover-only would exclude keyboard users, so the ring is a tab stop with the disclosure as its
  // description. The disclosure holds no interactive content: it is a tooltip, never a menu.
  element.tabIndex = 0;
  const details = doc.createElement('div');
  details.className = 'zchatgpt-context-details'; details.hidden = true; details.setAttribute('role', 'tooltip');
  details.id = `zchatgpt-context-details-${++ringSerial}`;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of [['viewBox', '0 0 20 20'], ['width', '16'], ['height', '16'], ['aria-hidden', 'true'], ['focusable', 'false']] as const) svg.setAttribute(name, value);
  const circle = (className: string) => {
    const node = doc.createElementNS(SVG_NS, 'circle');
    node.setAttribute('class', className); node.setAttribute('cx', '10'); node.setAttribute('cy', '10'); node.setAttribute('r', String(RING_RADIUS)); node.setAttribute('fill', 'none');
    return node;
  };
  const track = circle('zchatgpt-context-ring-track');
  const fill = circle('zchatgpt-context-ring-fill');
  fill.setAttribute('transform', 'rotate(-90 10 10)');
  svg.append(track, fill); element.append(svg); parent.append(element);
  let usageTitle = contextUsageTitle(null);
  let content: HTMLElement | null = null;
  const syncDescription = () => {
    // With a coverage disclosure available, the native title would double up with it on hover, so the
    // ring keeps only the accessible name until the report is cleared. Without one the title stays.
    const title = content === null ? usageTitle : '';
    if (element.title !== title) element.title = title;
    if (element.getAttribute('aria-label') !== usageTitle) element.setAttribute('aria-label', usageTitle);
    if (content === null) { if (element.hasAttribute('aria-describedby')) element.removeAttribute('aria-describedby'); }
    else if (element.getAttribute('aria-describedby') !== details.id) element.setAttribute('aria-describedby', details.id);
  };
  const show = () => { if (content !== null) details.hidden = false; };
  const hide = () => { details.hidden = true; };
  element.addEventListener('mouseenter', show);
  element.addEventListener('mouseleave', hide);
  element.addEventListener('focus', show);
  element.addEventListener('blur', hide);
  element.addEventListener('keydown', event => { if (event.key === 'Escape' && !details.hidden) hide(); });
  const update = (usage: ContextUsage | null) => {
    const ratio = contextRingRatio(usage);
    element.dataset.zchatgptContextState = ratio === null ? 'unknown' : usage!.provenance;
    // Unknown has no proportion to draw, so the whole stroke stays whole: no dash pattern means no
    // gap, which reads as a deliberately solid "unknown" ring rather than an empty placeholder.
    if (ratio === null) fill.setAttribute('stroke-dasharray', 'none');
    else fill.setAttribute('stroke-dasharray', `${(RING_CIRCUMFERENCE * ratio).toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
    usageTitle = contextUsageTitle(usage);
    syncDescription();
  };
  const report = (next: HTMLElement | null) => {
    content = next;
    details.replaceChildren(...(next ? [next] : []));
    hide();
    syncDescription();
  };
  update(null);
  report(null);
  return { element, details, update, report };
}
