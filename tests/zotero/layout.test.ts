import { describe, expect, it } from 'vitest';
import { ReaderLayoutController, clampSidebarWidth, type LayoutHost, type Scale, type ViewPosition } from '../../packages/zotero/src/reader/layout.ts';
function setup(scale: Scale = 125) {
  const state = {
    dock: { collapsed: true, mode: 'notes' as 'notes' | 'item', scrollTop: 47, width: 280 },
    chat: false, pressed: false, available: 1440, desired: 360,
    position: { scale, anchor: { pageIndex: 2, left: 8, top: 90 } },
    zooms: [] as ViewPosition[], applied: [] as number[], remembered: [] as number[],
  };
  let mount = () => Promise.resolve(true);
  const host: LayoutHost = {
    captureDock: () => ({ ...state.dock }), capturePosition: () => structuredClone(state.position),
    showDock: () => { state.dock.collapsed = false; state.dock.mode = 'item'; },
    restoreDock: dock => { state.dock = { ...dock }; },
    mountChat: async () => { const ready = await mount(); if (ready) state.chat = true; return ready; },
    unmountChat: () => { state.chat = false; },
    setZoom: (scale, anchor) => { state.position = { scale, anchor }; state.zooms.push(structuredClone(state.position)); },
    keepAnchor: anchor => { state.position.anchor = { ...anchor }; },
    setActive: active => { state.pressed = active; },
    readDesiredWidth: () => state.desired,
    rememberWidth: width => { state.desired = width; state.remembered.push(width); },
    measureAvailableWidth: () => state.available,
    applyWidth: width => { state.dock.width = width; state.applied.push(width); },
    currentWidth: () => state.dock.width,
  };
  return { state, controller: new ReaderLayoutController(host), deferMount: (fn: typeof mount) => { mount = fn; } };
}
describe('native dock ownership', () => {
  it('opens a dock and restores its preceding mode and current reading anchor', async () => {
    const { state, controller } = setup();
    await controller.toggle();
    expect(state.chat).toBe(true); expect(state.pressed).toBe(true);
    expect(state.position.scale).toBe('page-width');
    state.position.anchor = { pageIndex: 6, left: 12, top: 300 };
    controller.close();
    expect(state.chat).toBe(false); expect(state.pressed).toBe(false);
    expect(state.dock).toEqual({ collapsed: true, mode: 'notes', scrollTop: 47, width: 280 });
    expect(state.position).toEqual({ scale: 125, anchor: { pageIndex: 6, left: 12, top: 300 } });
  });
  it.each(['auto', 'page-fit', 'page-width'] as const)('preserves native %s zoom mode', async scale => {
    const { state, controller } = setup(scale); await controller.toggle(); controller.close();
    expect(state.zooms).toEqual([]);
  });
  it('respects a manual zoom while the sidebar is open', async () => {
    const { state, controller } = setup(); await controller.toggle();
    state.position.scale = 180; controller.manualZoom(); controller.close();
    expect(state.position.scale).toBe(180);
  });
  it('relinquishes dock ownership for the latest native pane action', async () => {
    const { state, controller } = setup(); await controller.toggle();
    controller.nativeAction(); state.dock.mode = 'notes';
    controller.close(); expect(state.chat).toBe(false);
    expect(state.dock).toMatchObject({ collapsed: false, mode: 'notes', scrollTop: 47 });
  });
  it('cancels pending opening on a rapid second toggle', async () => {
    const { state, controller, deferMount } = setup();
    let resolve!: (value: boolean) => void;
    deferMount(() => new Promise<boolean>(done => { resolve = done; }));
    const opening = controller.toggle(); await controller.toggle(); resolve(true); await opening;
    expect(state.chat).toBe(false); expect(state.pressed).toBe(false); expect(state.dock.collapsed).toBe(true);
  });
  it('adapts at the current anchor when reading continues during mounting', async () => {
    const { state, controller, deferMount } = setup();
    let resolve!: (value: boolean) => void;
    deferMount(() => new Promise<boolean>(done => { resolve = done; }));
    const opening = controller.toggle();
    state.position.anchor = { pageIndex: 7, left: 14, top: 210 };
    resolve(true); await opening;
    expect(state.zooms[0]).toEqual({ scale: 'page-width', anchor: { pageIndex: 7, left: 14, top: 210 } });
    controller.close(); expect(state.position.scale).toBe(125);
  });
  it('restores the dock after a failed mount', async () => {
    const { state, controller, deferMount } = setup(); deferMount(() => Promise.resolve(false));
    await controller.toggle(); expect(state.dock.collapsed).toBe(true); expect(state.pressed).toBe(false);
  });
  it('cleans up and ignores future toggles after disposal', async () => {
    const { state, controller } = setup(); await controller.toggle(); controller.dispose(); await controller.toggle();
    expect(state.chat).toBe(false); expect(state.pressed).toBe(false); expect(state.dock.collapsed).toBe(true);
  });
});
describe('sidebar width', () => {
  it('clamps to the 320–560 design range and 45% of available width', () => {
    expect(clampSidebarWidth(360, 1440)).toBe(360);
    expect(clampSidebarWidth(700, 1440)).toBe(560);
    expect(clampSidebarWidth(200, 1440)).toBe(320);
    expect(clampSidebarWidth(360, 800)).toBe(360);
    expect(clampSidebarWidth(360, 600)).toBe(270);
    expect(clampSidebarWidth(200, 600)).toBe(270);
    expect(clampSidebarWidth(Number.NaN, 1440)).toBe(360);
  });
  it('applies the remembered width on open and restores the previous native width on close', async () => {
    const { state, controller } = setup();
    await controller.toggle();
    expect(state.applied).toEqual([360]);
    expect(state.dock.width).toBe(360);
    controller.close();
    expect(state.dock.width).toBe(280);
    expect(state.remembered).toEqual([]);
  });
  it('clamps a narrow window without overwriting the remembered width', async () => {
    const { state, controller } = setup();
    state.desired = 480;
    await controller.toggle();
    expect(state.dock.width).toBe(480);
    state.available = 600;
    controller.viewportChanged();
    expect(state.dock.width).toBe(270);
    expect(state.desired).toBe(480);
    expect(state.remembered).toEqual([]);
    state.available = 1440;
    controller.viewportChanged();
    expect(state.dock.width).toBe(480);
  });
  it('persists a splitter drag and re-anchors at the current reading position', async () => {
    const { state, controller } = setup();
    await controller.toggle();
    state.position.anchor = { pageIndex: 4, left: 10, top: 240 };
    await controller.setWidth(500);
    expect(state.dock.width).toBe(500);
    expect(state.remembered).toEqual([500]);
    expect(state.zooms.at(-1)).toEqual({ scale: 'page-width', anchor: { pageIndex: 4, left: 10, top: 240 } });
  });
});
