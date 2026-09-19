import { Window as HappyWindow } from 'happy-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CHAT_APP_URL, CHAT_EMBED_ATTR, CHAT_EMBED_CONTAINER_ATTR, createChatEmbedSurface } from '../../../packages/zotero/src/chat/embed.ts';

const XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
const reload = vi.fn();
/** Where the surface parks while the sidebar is not showing it; off-screen at a real size. */
const PARKED_LEFT = '-20000px';

interface Rect { left: number; top: number; width: number; height: number }

/**
 * A XUL main window only as far as this module is concerned: a document that can create XUL
 * elements, with the navigation members a `<browser>` carries. The module asks for no privileged
 * service — the application is loaded by naming it in `src`.
 */
function chromeWindow(): { win: Window; doc: Document } {
  const win = new HappyWindow({ url: 'chrome://zotero/content/zoteroPane.xhtml' });
  const doc = win.document as unknown as Document & { createXULElement?(tag: string): Element };
  doc.createXULElement = (tag: string) => {
    // happy-dom has no XUL element interfaces, so the browser is an HTML element carrying the
    // browser's own members. What this module actually depends on from Gecko is exactly those
    // members plus `style`, which is why the substitution is enough for the arithmetic here.
    const node = doc.createElement('div') as unknown as Element & { currentURI: unknown; webProgress: unknown; contentTitle: unknown; webNavigation: unknown };
    if (tag === 'browser') {
      node.currentURI = null;
      node.webProgress = { isLoadingDocument: true };
      node.contentTitle = '';
      node.webNavigation = { reload };
    }
    return node;
  };
  // happy-dom's Window is a structural subset of the DOM one; the module only uses document,
  // innerWidth/innerHeight and the timer pair.
  return { win: win as unknown as Window, doc };
}

function place(element: Element, rect: Rect): Element {
  element.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) });
  return element;
}

function element(doc: Document, rect: Rect): Element {
  const node = place(doc.createElementNS(XUL, 'vbox'), rect);
  doc.documentElement.append(node);
  return node;
}

/** The dock's own elements: the slot the surface covers, and the frame whose document holds it. */
function sidebar(doc: Document): { slot: Element; frame: Element } {
  return {
    slot: element(doc, { left: 10, top: 20, width: 300, height: 500 }),
    frame: element(doc, { left: 100, top: 50, width: 900, height: 700 }),
  };
}

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('creates a parked browser with the attribute set Zotero\'s own remote surfaces use, and names the application in src', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`)!;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  expect(browser).toBeTruthy();
  expect(container).toBeTruthy();
  expect(container.contains(browser)).toBe(true);
  expect(browser.getAttribute('type')).toBe('content');
  expect(browser.getAttribute('maychangeremoteness')).toBe('true');
  expect(browser.getAttribute('remote')).toBe('false');
  expect(browser.getAttribute('data-zchatgpt-embed-state')).toBe('loading');
  // The document loads while the surface is parked: the session and the open conversation belong to
  // it, and the dock not being open is not a reason to unload them.
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('480px');
  expect(browser.hasAttribute('data-zchatgpt-embed-painted')).toBe(false);
  surface.destroy();
});

it('paints the box over the slot rect mapped through the frame whose document the slot lives in', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  expect(container.style.left).toBe('110px');
  expect(container.style.top).toBe('70px');
  expect(container.style.width).toBe('300px');
  expect(container.style.height).toBe('500px');
  // The browser fills the box, and the paint marker names the rectangle the host can read back.
  expect(browser.style.width).toBe('100%');
  expect(browser.getAttribute('data-zchatgpt-embed-painted')).toBe('300x500');
  // Painting never navigates: src is set once, at construction.
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
});

it('does not paint over a slot or frame that measures nothing', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  // The dock is still laying out, which is the state the reader is in for the first frame.
  place(slot, { left: 10, top: 20, width: 0, height: 0 });
  surface.show(slot, frame);
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('480px');
  // Zotero hides a tab it is not showing, and a hidden frame measures zero; the surface must not keep
  // floating over whatever the reader is actually looking at.
  place(slot, { left: 10, top: 20, width: 300, height: 500 });
  place(frame, { left: 0, top: 0, width: 0, height: 0 });
  surface.sync();
  expect(container.style.left).toBe(PARKED_LEFT);
  surface.destroy();
});

it('parks the box, keeping the session, when the slot is hidden or the dock unmounts', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  const container = doc.querySelector(`[${CHAT_EMBED_CONTAINER_ATTR}]`) as HTMLElement;
  const { slot, frame } = sidebar(doc);
  surface.show(slot, frame);
  expect(container.style.width).toBe('300px');
  // Hiding is painting-only: the application keeps its size, its document and its session.
  surface.hide();
  expect(container.style.left).toBe(PARKED_LEFT);
  expect(container.style.width).toBe('300px');
  expect(browser.getAttribute('data-zchatgpt-embed-painted')).toBe('');
  expect(container.isConnected).toBe(true);
  expect(browser.getAttribute('src')).toBe(CHAT_APP_URL);
  surface.destroy();
  expect(container.isConnected).toBe(false);
});

it('reloads the application through the browser\'s own navigation without discarding the surface', () => {
  const { win, doc } = chromeWindow();
  const surface = createChatEmbedSurface(win);
  const browser = doc.querySelector(`[${CHAT_EMBED_ATTR}]`) as HTMLElement;
  surface.reload();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(browser.getAttribute('data-zchatgpt-embed-state')).toBe('loading');
  expect(surface.snapshot().loaded).toBe(false);
  expect(browser.isConnected).toBe(true);
  surface.destroy();
});
