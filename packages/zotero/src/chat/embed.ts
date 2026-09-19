/**
 * Chat mode's surface is the real ChatGPT web application, not a reimplementation.
 *
 * Chat and Agent stay operationally separate: Agent runs the bundled Codex runtime behind the
 * `AgentExecutor`, while Chat hosts `chatgpt.com` itself so the conversation, streaming, history,
 * model picker, uploads and the account session all belong to the web app. Nothing here issues a
 * model request, reads a credential, or touches the Codex task/session lifecycle.
 *
 * Why a chrome `<browser>` and not an `iframe`: `chatgpt.com` refuses framing (X-Frame-Options /
 * CSP frame-ancestors) and busts out of frames, and a XUL element cannot be created inside the
 * reader's HTML document at all ("Component is not available"; the host probe in
 * `tests/host/embed-driver.js` records both). Zotero's own remote-page surfaces are chrome
 * `<browser>` elements created in a *XUL* document — the reader tab uses `src` and the viewer window
 * `Zotero.openInViewer()` uses `loadURI`. This module does the first of those, in the main window,
 * and paints the result over the sidebar region the dock reserves for it: the host probe records the
 * same URL loading through `src` while a `loadURI` against a freshly created browser is dropped.
 *
 * The page is never unloaded to hide it: `hide()` only stops painting, so switching Chat -> Agent
 * and back, or closing and reopening the sidebar, keeps the ChatGPT session and the open
 * conversation. The document is destroyed only when the window goes away.
 */

/** Marks the chrome browser so host tests and diagnostics can address it without private state. */
export const CHAT_EMBED_ATTR = 'data-zchatgpt-embed-browser';
/** Marks the HTML box the browser is painted in; the box, not the browser, carries the geometry. */
export const CHAT_EMBED_CONTAINER_ATTR = 'data-zchatgpt-embed-container';
/** The application Chat mode hosts. No API key, no custom base URL, no token is involved. */
export const CHAT_APP_URL = 'https://chatgpt.com/';
/** Free/stale-layout safety net while the surface is painted, in milliseconds. */
const SYNC_INTERVAL_MS = 500;
/**
 * Where the box sits while the sidebar is not showing it. The application is not unloaded then — the
 * session, the cookies and the open conversation are the whole point of hosting it — so the box is
 * kept off-screen at a real size rather than collapsed, which is what keeps its document live.
 */
const PARKED_LEFT = -20000;
const PARKED_WIDTH = 480;
const PARKED_HEIGHT = 720;

/** The subset of Zotero's XUL `<browser>` this module drives. */
interface ChromeBrowser extends Element {
  currentURI: { spec: string } | null;
  contentTitle: string;
  webProgress: { isLoadingDocument: boolean } | null;
  webNavigation?: { reload(flags: number): void } | null;
  reloadWithFlags?(flags: number): void;
  style: CSSStyleDeclaration;
  setAttribute(name: string, value: string): void;
}

export interface ChatEmbedSnapshot {
  /** The application document currently in the surface, or null before the first navigation. */
  url: string | null;
  /** True while the browser reports a document still loading. */
  loading: boolean;
  /** True once a document is present and settled; the page's own script wrote its title. */
  loaded: boolean;
}

export interface ChatEmbedSurface {
  /**
   * Paint the surface over `anchor`, an element inside the dock. `frame` is the chrome element that
   * hosts the document `anchor` lives in (the reader's own `<browser>`), because rects measured in
   * that document are relative to its viewport, not to the window this surface is painted in.
   */
  show(anchor: Element, frame: Element | null): void;
  /** Stop painting without unloading the page, keeping the session and the open conversation. */
  hide(): void;
  /** Re-measure and repaint; safe to call on any host layout or tab change. */
  sync(): void;
  /** Force a fresh navigation of the application document. */
  reload(): void;
  snapshot(): ChatEmbedSnapshot;
  destroy(): void;
}

interface Rect { left: number; top: number; width: number; height: number }

function xulDocument(doc: Document): { createXULElement(tag: string): Element } {
  const candidate = doc as unknown as { createXULElement?(tag: string): Element };
  if (typeof candidate.createXULElement !== 'function') throw new Error('The embedded Chat surface needs a XUL document.');
  return candidate as { createXULElement(tag: string): Element };
}

/** Border widths so a host element's content box, not its border box, is the origin. */
function contentOrigin(element: Element): { x: number; y: number } {
  const box = element as Element & { clientLeft?: number; clientTop?: number };
  return { x: box.clientLeft ?? 0, y: box.clientTop ?? 0 };
}

function rectOf(element: Element): Rect | null {
  let rect: DOMRect;
  try { rect = element.getBoundingClientRect(); } catch { return null; }
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width < 1 || rect.height < 1) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * Create the Chat surface in `win`. Construction creates the browser, parks it off-screen at a real
 * size and starts the one navigation to the application; painting only moves the box.
 */
export function createChatEmbedSurface(win: Window, url: string = CHAT_APP_URL): ChatEmbedSurface {
  const doc = win.document;
  const browser = xulDocument(doc).createXULElement('browser') as ChromeBrowser;
  // The attribute set Zotero's own remote-page viewer carries; without it the document stays at
  // about:blank, which the host probe demonstrates for the same element without them.
  browser.setAttribute('type', 'content');
  browser.setAttribute('remote', 'false');
  browser.setAttribute('disableglobalhistory', 'true');
  browser.setAttribute('maychangeremoteness', 'true');
  browser.setAttribute('messagemanagergroup', 'zchatgpt');
  browser.setAttribute('class', 'zchatgpt-embed-browser');
  browser.setAttribute(CHAT_EMBED_ATTR, '');
  browser.setAttribute('data-zchatgpt-embed-state', 'idle');
  browser.setAttribute('aria-label', 'ChatGPT');
  browser.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  // The browser hangs off an HTML div rather than the window root: the main window is a XUL document,
  // and an HTML div is the box whose geometry CSS actually controls there — the host probe loads the
  // application in exactly this shape and not in a zero-sized or window-root one.
  const container = doc.createElement('div');
  container.setAttribute(CHAT_EMBED_CONTAINER_ATTR, '');
  container.style.cssText = `position:fixed;left:${PARKED_LEFT}px;top:0px;width:${PARKED_WIDTH}px;height:${PARKED_HEIGHT}px;overflow:hidden;border:0;margin:0;padding:0;z-index:2147483000;background:#fff;`;
  // `src` is the navigation Zotero's own reader tab uses, and it is set before the element is
  // connected so the document and the frame are created together. It is also why the application
  // loads while the surface is parked: the ChatGPT session, its cookies and its open conversation
  // belong to this document, and the dock being closed is not a reason to unload them.
  browser.setAttribute('data-zchatgpt-embed-state', 'loading');
  browser.setAttribute('src', url);
  container.append(browser);
  (doc.body ?? doc.documentElement).append(container);

  /** Navigate an already-loaded document again, preferring the browser's own reload. */
  const renavigate = (): void => {
    browser.setAttribute('data-zchatgpt-embed-state', 'loading');
    try {
      if (typeof browser.webNavigation?.reload === 'function') { browser.webNavigation.reload(0); return; }
      if (typeof browser.reloadWithFlags === 'function') { browser.reloadWithFlags(0); return; }
    } catch { /* the flags-based path is not available, so navigate from the URL below */ }
    browser.setAttribute('src', url);
  };

  let anchor: Element | null = null;
  let frame: Element | null = null;
  let painted: string | null = null;
  let destroyed = false;
  let timer: number | null = null;
  let resizeObserver: { disconnect(): void } | null = null;
  // The size the application's own layout is given. It is the parked size until the dock paints, and
  // keeps the last painted size afterwards so hiding and showing does not resize the document.
  let box: { width: number; height: number } = { width: PARKED_WIDTH, height: PARKED_HEIGHT };

  const topDocument = win.document;

  /** Move the box out of the way without unloading it: a rendered box is what keeps it live. */
  function park(): void {
    container.style.left = `${PARKED_LEFT}px`;
    container.style.top = '0px';
    container.style.width = `${box.width}px`;
    container.style.height = `${box.height}px`;
  }

  /** Pin the surface to the anchor's live rect, or stop painting when that rect is gone. */
  const sync = (): void => {
    if (destroyed) return;
    if (!anchor || !anchor.isConnected) { retract(); return; }
    const anchorRect = rectOf(anchor);
    if (!anchorRect) { retract(); return; }
    let originX = 0;
    let originY = 0;
    if (frame) {
      const frameRect = rectOf(frame);
      if (!frameRect) { retract(); return; }
      const origin = contentOrigin(frame);
      originX = frameRect.left + origin.x;
      originY = frameRect.top + origin.y;
    }
    const next: Rect = {
      left: Math.round(originX + anchorRect.left),
      top: Math.round(originY + anchorRect.top),
      width: Math.round(anchorRect.width),
      height: Math.round(anchorRect.height),
    };
    // A dock that is not on the selected tab is hidden by Zotero, so its frame measures zero and the
    // surface must not keep floating over whatever the user is actually looking at.
    if (next.left >= win.innerWidth || next.top >= win.innerHeight) { retract(); return; }
    const key = `${next.left}:${next.top}:${next.width}:${next.height}`;
    if (key === painted) return;
    painted = key;
    box = { width: next.width, height: next.height };
    container.style.left = `${next.left}px`;
    container.style.top = `${next.top}px`;
    container.style.width = `${next.width}px`;
    container.style.height = `${next.height}px`;
    browser.setAttribute('data-zchatgpt-embed-painted', `${next.width}x${next.height}`);
  };

  /** Stop painting; the page and its session stay exactly as they are. */
  function retract(): void {
    if (painted === null) return;
    painted = null;
    browser.setAttribute('data-zchatgpt-embed-painted', '');
    park();
  }

  const observe = (): void => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    const view = topDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null;
    const Observer = view?.ResizeObserver;
    if (typeof Observer !== 'function') return;
    const observer = new Observer(() => sync());
    const watched = new Set<Element>();
    if (anchor) watched.add(anchor);
    if (frame) watched.add(frame);
    for (const element of watched) observer.observe(element);
    resizeObserver = observer;
  };

  const tick = (): void => {
    if (destroyed) { stopTimer(); return; }
    sync();
    const loading = browser.webProgress?.isLoadingDocument ?? false;
    const current = browser.currentURI?.spec ?? null;
    const loaded = Boolean(current) && !loading && String(browser.contentTitle ?? '').length > 0;
    browser.setAttribute('data-zchatgpt-embed-state', loading ? 'loading' : loaded ? 'loaded' : 'idle');
  };

  const stopTimer = (): void => { if (timer !== null) { win.clearInterval(timer); timer = null; } };

  const surface: ChatEmbedSurface = {
    show(nextAnchor, nextFrame) {
      if (destroyed) return;
      const changed = anchor !== nextAnchor || frame !== (nextFrame ?? null);
      anchor = nextAnchor;
      frame = nextFrame ?? null;
      if (changed) observe();
      sync();
      // The frame can be re-laid-out by anything (window resize, dock resize, tab switch, reader
      // toolbar rewrap) and two of those are not observable from this window, so a slow poll keeps
      // the surface on its anchor while it is painted. It stops as soon as nothing is painted.
      if (timer === null) timer = win.setInterval(tick, SYNC_INTERVAL_MS);
    },
    hide() { anchor = null; frame = null; resizeObserver?.disconnect(); resizeObserver = null; stopTimer(); retract(); },
    sync,
    reload() { renavigate(); },
    snapshot() {
      return {
        url: browser.currentURI?.spec ?? null,
        loading: browser.webProgress?.isLoadingDocument ?? false,
        loaded: browser.getAttribute('data-zchatgpt-embed-state') === 'loaded',
      };
    },
    destroy() {
      destroyed = true;
      surface.hide();
      container.remove();
    },
  };
  return surface;
}
