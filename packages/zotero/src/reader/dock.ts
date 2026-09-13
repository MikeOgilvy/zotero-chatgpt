import { MIN_SIDEBAR_WIDTH } from './layout.ts';

export const DOCK_ATTR = 'data-zcr-dock';
export const DOCK_WIDTH_VAR = '--zcr-dock-width';
export const DOCK_OPEN_CLASS = 'zcr-dock-open';

function createHtmlElement(doc: Document, tag: string): HTMLElement {
  return doc.createElement(tag);
}

export function readerContentRoot(doc: Document): HTMLElement | null {
  return doc.getElementById('split-view');
}

function markDockOpen(doc: Document, split: HTMLElement): void {
  split.classList.add(DOCK_OPEN_CLASS);
  doc.documentElement.classList.add(DOCK_OPEN_CLASS);
  doc.body.classList.add(DOCK_OPEN_CLASS);
}

/** Inline flex so the PDF column shrinks before the injected stylesheet paints. */
function paintDockColumn(dock: HTMLElement, width?: number): void {
  const basis = width !== undefined ? Math.round(width) : MIN_SIDEBAR_WIDTH;
  const value = `${basis}px`;
  const pin = (name: string, next: string) => { dock.style.setProperty(name, next, 'important'); };
  pin('display', 'flex');
  pin('flex-direction', 'row');
  pin('flex-grow', '0');
  pin('flex-shrink', '0');
  pin('flex-basis', value);
  pin('width', value);
  pin('min-width', `${MIN_SIDEBAR_WIDTH}px`);
  pin('height', '100%');
  pin('align-self', 'stretch');
  pin('writing-mode', 'horizontal-tb');
  pin('direction', 'ltr');
  pin('unicode-bidi', 'isolate');
  pin('overflow', 'hidden');
  pin('box-sizing', 'border-box');
  pin('background', 'var(--material-background, var(--color-background, #fff))');
  pin('color', 'var(--fill-primary, CanvasText)');
  pin('font-family', 'inherit');
  pin('font-size', '13px');
  pin('line-height', '1.4');
}

export function mountReaderDock(doc: Document): { dock: HTMLElement; body: HTMLElement } | undefined {
  const split = readerContentRoot(doc);
  const toolbar = doc.querySelector('.toolbar');
  if (!split || !toolbar) return undefined;
  const existing = split.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (existing) {
    markDockOpen(doc, split);
    const current = Number.parseFloat(existing.style.width || existing.style.flexBasis);
    paintDockColumn(existing, Number.isFinite(current) && current > 0 ? current : undefined);
    return { dock: existing, body: existing.querySelector<HTMLElement>('[data-zcr-dock-body]') ?? existing };
  }
  const dock = createHtmlElement(doc, 'aside');
  dock.className = 'zcr-dock zcr-paper';
  dock.setAttribute(DOCK_ATTR, '');
  dock.setAttribute('role', 'complementary');
  dock.setAttribute('aria-label', 'Codex');
  const resizer = createHtmlElement(doc, 'div');
  resizer.className = 'zcr-dock-resizer';
  resizer.dataset.zcrResizer = '';
  const body = createHtmlElement(doc, 'div');
  body.className = 'zcr-dock-body';
  body.dataset.zcrDockBody = '';
  dock.append(resizer, body);
  paintDockColumn(dock);
  split.append(dock);
  markDockOpen(doc, split);
  return { dock, body };
}

export function applyDockWidth(doc: Document, width: number): void {
  const value = `${Math.round(width)}px`;
  doc.documentElement.style.setProperty(DOCK_WIDTH_VAR, value);
  const dock = doc.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (!dock) return;
  paintDockColumn(dock, Math.round(width));
}

export interface DockResizeHost {
  currentWidth(): number;
  setWidth(cssPixels: number): void;
}

/** Pointer-captured drag so moving into the PDF iframe still changes dock width.
 * Moves are coalesced into one width change per animation frame: applying a width captures the
 * PDF position and re-zooms, which is too expensive to run per pointer event on a busy drag.
 * The release always flushes the final position exactly once, so no move is dropped. */
export function bindDockResize(resizer: HTMLElement, host: DockResizeHost): () => void {
  const doc = resizer.ownerDocument;
  const view = doc.defaultView;
  const frame: (run: () => void) => number = typeof view?.requestAnimationFrame === 'function'
    ? run => view.requestAnimationFrame(() => run())
    : run => (view?.setTimeout(run, 16) ?? setTimeout(run, 16)) as unknown as number;
  const drop = (handle: number) => { if (typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle); else view?.clearTimeout(handle); };
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let pendingWidth: number | null = null;
  let handle: number | null = null;
  const flush = () => { if (pendingWidth === null) return; const width = pendingWidth; pendingWidth = null; host.setWidth(width); };
  const schedule = (width: number) => {
    pendingWidth = width;
    if (handle === null) handle = frame(() => { handle = null; flush(); });
  };
  const settle = () => {
    if (handle !== null) { drop(handle); handle = null; }
    flush();
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    schedule(startWidth + (startX - event.clientX));
  };
  const onUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    settle();
    try { resizer.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
  };
  const onDown = (event: PointerEvent) => {
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = host.currentWidth();
    try { resizer.setPointerCapture(event.pointerId); } catch { /* happy-dom / older Gecko */ }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  };
  resizer.addEventListener('pointerdown', onDown);
  return () => {
    dragging = false;
    if (handle !== null) { drop(handle); handle = null; }
    pendingWidth = null;
    resizer.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
  };
}

export function unmountReaderDock(doc: Document): void {
  doc.querySelector(`[${DOCK_ATTR}]`)?.remove();
  doc.getElementById('split-view')?.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.classList.remove(DOCK_OPEN_CLASS);
  doc.body.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.style.removeProperty(DOCK_WIDTH_VAR);
}

export function injectReaderStyles(doc: Document, assets?: { stylesheet?: string; katex?: string }): void {
  const head = doc.head ?? doc.documentElement;
  if (!doc.querySelector('style[data-zcr-sidebar-css]')) {
    const css = createHtmlElement(doc, 'style');
    css.setAttribute('data-zcr-sidebar-css', '');
    head.append(css);
    css.append(doc.createTextNode(__ZCR_SIDEBAR_CSS__));
  }
  if (assets?.katex && !doc.querySelector('link[data-zcr-katex-css]')) {
    const katex = createHtmlElement(doc, 'link') as HTMLLinkElement;
    katex.rel = 'stylesheet';
    katex.href = assets.katex;
    katex.dataset.zcrKatexCss = '';
    head.append(katex);
  }
}
