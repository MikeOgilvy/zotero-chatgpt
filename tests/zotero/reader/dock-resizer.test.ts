import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { applyDockWidth, bindDockResize, mountReaderDock } from '../../../packages/zotero/src/reader/dock.ts';
import { clampSidebarWidth, sidebarWidthBounds } from '../../../packages/zotero/src/reader/layout.ts';

function readerDocument(): Document {
  const win = new Window({ url: 'https://reader.test/' });
  const doc = win.document as unknown as Document;
  doc.body.innerHTML = [
    '<div id="reader-ui"><div class="toolbar"><button class="find">Find</button></div></div>',
    '<div id="split-view"><div id="primary-view" class="primary-view"></div></div>',
  ].join('');
  return doc;
}

/** The fake host clamps like `ReaderLayoutController` so the resizer sees the applied width. */
function setup(options: { width?: number; available?: number } = {}) {
  const doc = readerDocument();
  const { dock } = mountReaderDock(doc)!;
  const resizer = dock.querySelector<HTMLElement>('[data-zchatgpt-resizer]')!;
  let width = options.width ?? 400;
  let available = options.available ?? 1440;
  applyDockWidth(doc, width);
  const applied: number[] = [];
  const unbind = bindDockResize(resizer, {
    currentWidth: () => width,
    setWidth: next => { applied.push(next); width = clampSidebarWidth(next, available); applyDockWidth(doc, width); },
    measureAvailableWidth: () => available,
  });
  const view = doc.defaultView!;
  const key = (name: string, init: KeyboardEventInit = {}, target: EventTarget = resizer) =>
    target.dispatchEvent(new view.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
  return {
    doc, dock, resizer, applied, key, unbind,
    getWidth: () => width,
    setAvailable: (next: number) => { available = next; },
  };
}

it('exposes the resizer as a focusable vertical separator with the clamp bounds', () => {
  const { resizer } = setup({ width: 400, available: 1440 });
  const { min, max } = sidebarWidthBounds(1440);
  expect(resizer.getAttribute('role')).toBe('separator');
  expect(resizer.getAttribute('aria-orientation')).toBe('vertical');
  expect(resizer.getAttribute('tabindex')).toBe('0');
  expect(resizer.getAttribute('aria-valuemin')).toBe(String(min));
  expect(resizer.getAttribute('aria-valuemax')).toBe(String(max));
  expect(resizer.getAttribute('aria-valuenow')).toBe('400');
});

it('widens with ArrowLeft and narrows with ArrowRight through one coalesced host write', async () => {
  const { key, applied, getWidth } = setup({ width: 400 });
  expect(key('ArrowLeft')).toBe(false);
  await vi.waitFor(() => expect(applied).toEqual([416]));
  expect(getWidth()).toBe(416);
  key('ArrowRight');
  await vi.waitFor(() => expect(applied).toEqual([416, 400]));
  expect(getWidth()).toBe(400);
});

it('uses a 64px step with Shift and clamps at the sidebar bounds', async () => {
  const { key, applied, getWidth, resizer } = setup({ width: 400, available: 1440 });
  key('ArrowLeft', { shiftKey: true });
  await vi.waitFor(() => expect(applied).toEqual([464]));
  key('ArrowRight', { shiftKey: true });
  await vi.waitFor(() => expect(applied).toEqual([464, 400]));

  key('End');
  await vi.waitFor(() => expect(getWidth()).toBe(1080));
  expect(resizer.getAttribute('aria-valuenow')).toBe('1080');
  key('ArrowLeft');
  await vi.waitFor(() => expect(getWidth()).toBe(1080));
  expect(resizer.getAttribute('aria-valuenow')).toBe('1080');

  key('Home');
  await vi.waitFor(() => expect(getWidth()).toBe(320));
  expect(resizer.getAttribute('aria-valuenow')).toBe('320');
  key('ArrowRight');
  await vi.waitFor(() => expect(getWidth()).toBe(320));
  expect(resizer.getAttribute('aria-valuenow')).toBe('320');
});

it('reports the temporary clamp when the reader strip is too narrow for the minimum', () => {
  const { resizer } = setup({ width: 400, available: 600 });
  expect(resizer.getAttribute('aria-valuemin')).toBe('240');
  expect(resizer.getAttribute('aria-valuemax')).toBe('240');
  expect(resizer.getAttribute('aria-valuenow')).toBe('240');
});

it('refreshes the value range when the reader strip resizes', () => {
  const { resizer, setAvailable, doc } = setup({ width: 400, available: 1440 });
  setAvailable(600);
  doc.defaultView!.dispatchEvent(new doc.defaultView!.Event('resize'));
  expect(resizer.getAttribute('aria-valuemax')).toBe('240');
  expect(resizer.getAttribute('aria-valuenow')).toBe('240');
});

it('leaves unrelated keys and reserved modifier combinations to the host', async () => {
  const { key, applied } = setup({ width: 400 });
  for (const name of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'a']) {
    expect(key(name)).toBe(true);
  }
  key('ArrowLeft', { ctrlKey: true });
  key('ArrowLeft', { metaKey: true });
  key('ArrowLeft', { altKey: true });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(applied).toEqual([]);
});

it('does not resize while a text field or focusable control inside the dock owns keys', async () => {
  const { key, applied, resizer } = setup({ width: 400 });
  // Defensive: the handler lives on the separator, but a control nested in it must keep arrow keys.
  const input = resizer.ownerDocument.createElement('input');
  resizer.append(input);
  expect(key('ArrowLeft', {}, input)).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(applied).toEqual([]);
  input.remove();
});

it('coalesces rapid arrow presses into one width change per frame', async () => {
  const { key, applied, getWidth } = setup({ width: 400 });
  key('ArrowLeft');
  key('ArrowLeft');
  expect(applied).toEqual([]);
  await vi.waitFor(() => expect(applied).toHaveLength(1));
  expect(applied[0]).toBe(432);
  expect(getWidth()).toBe(432);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(applied).toEqual([432]);
});

it('keeps the pointer drag path working and stops resizing after unbind', async () => {
  const { key, applied, resizer, getWidth, doc, unbind } = setup({ width: 400 });
  const view = doc.defaultView!;
  resizer.dispatchEvent(new view.PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1000, pointerId: 7 }));
  doc.dispatchEvent(new view.PointerEvent('pointermove', { bubbles: true, clientX: 900, pointerId: 7 }));
  doc.dispatchEvent(new view.PointerEvent('pointerup', { bubbles: true, clientX: 900, pointerId: 7 }));
  expect(getWidth()).toBe(500);
  expect(applied.at(-1)).toBe(500);

  const before = applied.length;
  unbind();
  key('ArrowLeft');
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(applied).toHaveLength(before);
});
