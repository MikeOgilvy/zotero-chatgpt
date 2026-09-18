import { MIN_SIDEBAR_WIDTH, sidebarWidthBounds } from './layout.ts';

export const DOCK_ATTR = 'data-zchatgpt-dock';
export const DOCK_WIDTH_VAR = '--zchatgpt-dock-width';
export const DOCK_OPEN_CLASS = 'zchatgpt-dock-open';
/** One arrow press; Shift+Arrow moves four times as far. */
export const DOCK_RESIZE_STEP = 16;
export const DOCK_RESIZE_STEP_LARGE = 64;

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
  pin('background', 'var(--material-background, var(--color-background, Canvas))');
  pin('color', 'var(--fill-primary, CanvasText)');
  pin('font-family', 'inherit');
  pin('font-size', '13px');
  pin('line-height', '1.4');
}

/**
 * Zotero 9.0.6's reader FocusManager installs a CAPTURE-phase `keydown` listener on the same
 * reader window our dock is mounted into, and before the event reaches the composer target it
 * runs (resource/reader/reader.js:72538, `FocusManager._handleKeyDown`):
 *   if (pressedNextKey(e) && !e.target.closest('[contenteditable], input[type="text"], .preview-popup')) {
 *     e.preventDefault(); this.tabToItem();
 *   }
 * and the mirror branch for ArrowLeft (reader.js:72541). Because capture runs on the window
 * first, our `<textarea>` composer would lose the caret and the reader would switch panes.
 * `closest('[contenteditable]')` matches any ancestor that merely carries the attribute, whatever
 * its value, so an explicit non-editable `contenteditable="false"` on the dock exempts every
 * control inside it; form controls are unaffected by an ancestor's contenteditable state and keep
 * native editing. Do not remove: without it ArrowLeft/ArrowRight in the composer stop moving the
 * caret, and the dock splitter's own ArrowLeft/ArrowRight binding sees `defaultPrevented`.
 */
function exemptFromReaderFocusManager(dock: HTMLElement): void {
  dock.setAttribute('contenteditable', 'false');
}

/**
 * Zotero 9.0.6's reader KeyboardManager binds a CAPTURE-phase `keydown` on the same reader window
 * (resource/reader/reader.js:72687) and gates a family of reader shortcuts on
 * `isTextBox(event.target)` (resource/reader/reader.js:27222):
 *
 *   function isTextBox(node) {
 *     return ['INPUT'].includes(node.nodeName) && node.type === 'text'
 *       || node.getAttribute('contenteditable') === 'true';
 *   }
 *
 * Unlike the FocusManager guard above (reader.js:72538), this predicate reads the TARGET itself
 * (not an ancestor) and requires the literal value `true`, so the dock's
 * `contenteditable="false"` marker does NOT satisfy it. Our composer is a `<textarea>` (no `type`),
 * the history field is `<input type="search">`, and the capture page field / reference page ranges
 * are `<input type="number">`; none has `type === 'text'`, so all three shapes fail the predicate.
 * Zotero then enters its target-based `!isTextBox(event.target)` blocks: Cmd/Ctrl-ArrowLeft/Right
 * navigates the PDF instead of moving the caret (reader.js:72770), Cmd/Ctrl-A is hijacked
 * (reader.js:72898), and `r`/`l` start read-aloud (reader.js:73039) while `h`/`s` switch the reader
 * tool (reader.js:73033/:73036, both inside reader.js:73001).
 *
 * The sibling Delete/Backspace branch (reader.js:72950) is NOT this predicate: it returns early on
 * `event.target.closest('input, .label-popup')`, so `<input>` targets (search and number) are
 * already excluded there by tag. Our `<textarea>` composer is not, but a `contenteditable`
 * exemption does not affect that branch either way — it only re-encodes the `isTextBox` clause.
 *
 * The narrowest exemption that satisfies the predicate is the predicate's own second clause:
 * `contenteditable="true"` on the individual controls the user types text into. `input
 * [type="text"]` already passes the first clause; `<textarea>`, search fields and number fields do
 * not. Only our own dock subtree is scanned, and only `<textarea>`/`input[type="search"]`/`input
 * [type="number"]` are touched — selects, buttons and the dock's own chrome are left alone. The
 * attribute is only added when the control does not already carry a `contenteditable` value, and
 * it is never removed or overwritten, so this cannot fight the chat view's own DOM writes.
 *
 * Engine note: `contenteditable` is an enumerated attribute on every HTML element, but form
 * controls have their own editing model, so the intent is for the value to be inert for editing
 * and to change only how Zotero classifies the event target. That is the expectation, not a
 * verified fact for Gecko (this host is Gecko 140.12.0 / Zotero 9.0.6); it must be confirmed on a
 * real reader host for each shape in {@link TYPING_CONTROL_SELECTOR}, including a number field
 * (the automatable matrix is owned by the host-test workstream, not this module).
 */

/** Text-typing controls whose event target Zotero's `isTextBox` predicate misses. */
const TYPING_CONTROL_SELECTOR = 'textarea, input[type="search"], input[type="number"]';
/** `isTextBox` (reader.js:27222) accepts only this exact value. */
const TEXTBOX_EXEMPT_VALUE = 'true';

/** Cleanup handles for the scoped observers, keyed by the dock element they watch. */
const typingControlObservers = new WeakMap<HTMLElement, () => void>();

/** Fill in the exemption only where the view did not already set its own `contenteditable`. */
function exemptTypingControl(control: Element): void {
  if (!control.hasAttribute('contenteditable')) control.setAttribute('contenteditable', TEXTBOX_EXEMPT_VALUE);
}

function exemptTypingControls(root: ParentNode): void {
  for (const control of root.querySelectorAll(TYPING_CONTROL_SELECTOR)) exemptTypingControl(control);
}

/**
 * The composer, its popovers and other fields are mounted after the dock element exists, so an
 * initial sweep is not enough. A MutationObserver scoped to the dock marks matching controls as
 * they are added (including ones nested in a newly added subtree). The observer is never given
 * attribute callbacks, and it only fills in a missing value, so it is immune to the chat view's
 * updates and cannot overwrite attributes the view sets on its own elements.
 */
function observeTypingControls(dock: HTMLElement): void {
  if (typingControlObservers.has(dock)) return;
  exemptTypingControls(dock);
  const view = dock.ownerDocument.defaultView;
  const Observer = (view as unknown as { MutationObserver?: typeof MutationObserver } | null)?.MutationObserver;
  if (!Observer) return;
  const observer = new Observer(records => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (element.matches(TYPING_CONTROL_SELECTOR)) exemptTypingControl(element);
        exemptTypingControls(element);
      }
    }
  });
  observer.observe(dock, { childList: true, subtree: true });
  typingControlObservers.set(dock, () => { observer.disconnect(); typingControlObservers.delete(dock); });
}

export function mountReaderDock(doc: Document): { dock: HTMLElement; body: HTMLElement } | undefined {
  const split = readerContentRoot(doc);
  const toolbar = doc.querySelector('.toolbar');
  if (!split || !toolbar) return undefined;
  const existing = split.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (existing) {
    exemptFromReaderFocusManager(existing);
    observeTypingControls(existing);
    markDockOpen(doc, split);
    const current = Number.parseFloat(existing.style.width || existing.style.flexBasis);
    paintDockColumn(existing, Number.isFinite(current) && current > 0 ? current : undefined);
    return { dock: existing, body: existing.querySelector<HTMLElement>('[data-zchatgpt-dock-body]') ?? existing };
  }
  const dock = createHtmlElement(doc, 'aside');
  dock.className = 'zchatgpt-dock zchatgpt-paper';
  dock.setAttribute(DOCK_ATTR, '');
  dock.setAttribute('role', 'complementary');
  dock.setAttribute('aria-label', 'Codex');
  exemptFromReaderFocusManager(dock);
  const resizer = createHtmlElement(doc, 'div');
  resizer.className = 'zchatgpt-dock-resizer';
  resizer.dataset.zchatgptResizer = '';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize Codex sidebar');
  resizer.setAttribute('tabindex', '0');
  const body = createHtmlElement(doc, 'div');
  body.className = 'zchatgpt-dock-body';
  body.dataset.zchatgptDockBody = '';
  dock.append(resizer, body);
  paintDockColumn(dock);
  split.append(dock);
  markDockOpen(doc, split);
  observeTypingControls(dock);
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
  measureAvailableWidth(): number;
}

/** The dock sits on the right, so ArrowLeft widens it and ArrowRight narrows it. */
const RESIZE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** Text fields and focusable controls keep their own key handling instead of resizing the dock. */
function reservesResizeKeys(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!element || typeof element !== 'object' || !('tagName' in element)) return false;
  const tag = String(element.tagName ?? '').toLowerCase();
  if (element.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a') return true;
  // Only a genuinely editable ancestor reserves the keys. The dock carries an explicit
  // `contenteditable="false"` marker for Zotero's FocusManager guard (see mountReaderDock), so a
  // bare `[contenteditable]` match would wrongly treat the dock's own splitter as a text field.
  return typeof element.closest === 'function' && element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]') !== null;
}

/** Pointer capture and keyboard resizing so the reader stays reachable without a mouse.
 * Width changes are coalesced into one host.setWidth per animation frame: applying a width
 * captures the PDF position and re-zooms, which is too expensive to run per event on a busy drag.
 * Pointer release (and every keyboard press) flushes the final position exactly once, so no move
 * is dropped. `host.setWidth` is the only write path, so keyboard and pointer both persist the
 * width and re-anchor the PDF identically. */
export function bindDockResize(resizer: HTMLElement, host: DockResizeHost): () => void {
  const doc = resizer.ownerDocument;
  const view = doc.defaultView;
  const frame: (run: () => void) => number = typeof view?.requestAnimationFrame === 'function'
    ? run => view.requestAnimationFrame(() => run())
    : run => (view?.setTimeout(run, 16) ?? setTimeout(run, 16)) as unknown as number;
  const drop = (handle: number) => { if (typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle); else view?.clearTimeout(handle); };
  // Screen readers need the same temporary clamp the controller applies, not the raw remembered wish.
  const syncAria = () => {
    const { min, max } = sidebarWidthBounds(host.measureAvailableWidth());
    const apply = (name: string, value: number) => resizer.setAttribute(name, String(value));
    apply('aria-valuemin', min);
    apply('aria-valuemax', max);
    apply('aria-valuenow', Math.min(Math.max(Math.round(host.currentWidth()), min), max));
  };
  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let pendingWidth: number | null = null;
  let handle: number | null = null;
  const flush = () => { if (pendingWidth === null) return; const width = pendingWidth; pendingWidth = null; host.setWidth(width); syncAria(); };
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
    settle();
    dragging = true;
    startX = event.clientX;
    startWidth = host.currentWidth();
    try { resizer.setPointerCapture(event.pointerId); } catch { /* happy-dom / older Gecko */ }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!RESIZE_KEYS.has(event.key) || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (reservesResizeKeys(event.target)) return;
    const step = event.shiftKey ? DOCK_RESIZE_STEP_LARGE : DOCK_RESIZE_STEP;
    const next = event.key === 'Home' ? sidebarWidthBounds(host.measureAvailableWidth()).min
      : event.key === 'End' ? sidebarWidthBounds(host.measureAvailableWidth()).max
        : (pendingWidth ?? host.currentWidth()) + (event.key === 'ArrowLeft' ? step : -step);
    event.preventDefault();
    schedule(next);
  };
  // A width applied outside this binding (open, viewport clamp) still refreshes aria-valuenow.
  const Observer = (view as unknown as { ResizeObserver?: typeof ResizeObserver } | null)?.ResizeObserver;
  const dock = resizer.parentElement;
  const observer = dock && typeof Observer === 'function' ? new Observer(() => syncAria()) : undefined;
  if (observer && dock) observer.observe(dock);
  resizer.addEventListener('pointerdown', onDown);
  resizer.addEventListener('keydown', onKeyDown);
  view?.addEventListener?.('resize', syncAria);
  syncAria();
  return () => {
    dragging = false;
    if (handle !== null) { drop(handle); handle = null; }
    pendingWidth = null;
    observer?.disconnect();
    resizer.removeEventListener('pointerdown', onDown);
    resizer.removeEventListener('keydown', onKeyDown);
    view?.removeEventListener?.('resize', syncAria);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
  };
}

export function unmountReaderDock(doc: Document): void {
  const dock = doc.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (dock) typingControlObservers.get(dock)?.();
  dock?.remove();
  doc.getElementById('split-view')?.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.classList.remove(DOCK_OPEN_CLASS);
  doc.body.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.style.removeProperty(DOCK_WIDTH_VAR);
}

export function injectReaderStyles(doc: Document, assets?: { stylesheet?: string; katex?: string }): void {
  const head = doc.head ?? doc.documentElement;
  if (!doc.querySelector('style[data-zchatgpt-sidebar-css]')) {
    const css = createHtmlElement(doc, 'style');
    css.setAttribute('data-zchatgpt-sidebar-css', '');
    head.append(css);
    css.append(doc.createTextNode(__ZCHATGPT_SIDEBAR_CSS__));
  }
  if (assets?.katex && !doc.querySelector('link[data-zchatgpt-katex-css]')) {
    const katex = createHtmlElement(doc, 'link') as HTMLLinkElement;
    katex.rel = 'stylesheet';
    katex.href = assets.katex;
    katex.dataset.zchatgptKatexCss = '';
    head.append(katex);
  }
}
