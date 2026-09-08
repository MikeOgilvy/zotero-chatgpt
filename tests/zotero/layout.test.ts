import { describe, expect, it } from 'vitest';
import { ReaderLayoutController, type LayoutHost, type Scale, type ViewPosition } from '../../packages/zotero/src/reader/layout.ts';
function setup(scale: Scale = 125) {
  const state = { dock: { collapsed: true, mode: 'notes' as 'notes' | 'item', scrollTop: 47 }, chat: false, pressed: false,
    position: { scale, anchor: { pageIndex: 2, left: 8, top: 90 } },
    zooms: [] as ViewPosition[] };
  let mount = () => Promise.resolve(true);
  const host: LayoutHost = {
    captureDock: () => ({ ...state.dock }), capturePosition: () => structuredClone(state.position),
    showDock: () => { state.dock.collapsed = false; state.dock.mode = 'item'; },
    restoreDock: dock => { state.dock = { ...dock }; },
    mountChat: async () => { const ready = await mount(); if (ready) state.chat = true; return ready; },
    unmountChat: () => { state.chat = false; },
    setZoom: (scale, anchor) => { state.position = { scale, anchor }; state.zooms.push(structuredClone(state.position)); },
    setActive: active => { state.pressed = active; },
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
    expect(state.dock).toEqual({ collapsed: true, mode: 'notes', scrollTop: 47 });
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
    expect(state.dock).toEqual({ collapsed: false, mode: 'notes', scrollTop: 47 });
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
