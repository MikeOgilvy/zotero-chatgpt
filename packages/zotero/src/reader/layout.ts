export type Scale = number | 'auto' | 'page-fit' | 'page-width';
export interface Anchor { pageIndex: number; left: number; top: number }
export interface ViewPosition { anchor: Anchor; scale: Scale }
export interface DockState { collapsed: boolean; mode: 'item' | 'notes'; scrollTop: number; width: number }
export const DEFAULT_SIDEBAR_WIDTH = 360;
/** Max 560px or 45% of the reader+sidebar strip; min 320px unless the max is smaller. */
export function clampSidebarWidth(desired: number, availableWidth: number): number {
  const available = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : DEFAULT_SIDEBAR_WIDTH / 0.45;
  const max = Math.min(560, Math.floor(available * 0.45));
  const min = Math.min(320, max);
  const target = Number.isFinite(desired) && desired > 0 ? desired : DEFAULT_SIDEBAR_WIDTH;
  return Math.min(Math.max(Math.round(target), min), Math.max(min, max));
}
export interface LayoutHost {
  captureDock(): DockState;
  capturePosition(): ViewPosition | undefined;
  showDock(): void;
  restoreDock(state: DockState): void;
  mountChat(): Promise<boolean>;
  unmountChat(): void;
  setZoom(scale: Scale, anchor: Anchor): void;
  keepAnchor(anchor: Anchor): void;
  setActive(active: boolean): void;
  readDesiredWidth(): number;
  rememberWidth(cssPixels: number): void;
  measureAvailableWidth(): number;
  applyWidth(cssPixels: number): void;
  currentWidth(): number;
}
/** Owns only the temporary changes made while chat is active. Host DOM lives in the adapter. */
export class ReaderLayoutController {
  private opened = false;
  private disposed = false;
  private generation = 0;
  private previousDock: DockState | undefined;
  private previousFixedScale: number | undefined;
  private desiredWidth = DEFAULT_SIDEBAR_WIDTH;
  constructor(private host: LayoutHost) {}
  get active(): boolean { return this.opened; }
  /** Selection actions only show: an already open sidebar must never be closed by them. */
  async open(): Promise<void> { if (this.opened || this.disposed) return; await this.toggle(); }
  async toggle(): Promise<void> {
    if (this.disposed) return;
    if (this.opened) { this.close(); return; }
    const generation = ++this.generation;
    this.previousDock = this.host.captureDock();
    const position = this.host.capturePosition();
    this.previousFixedScale = typeof position?.scale === 'number' ? position.scale : undefined;
    this.desiredWidth = this.host.readDesiredWidth();
    this.opened = true;
    this.host.showDock();
    this.applyWidth(false);
    try {
      const ready = await this.host.mountChat();
      if (generation !== this.generation) {
        // A newer opening may now own the same DOM.
        if (!this.opened) this.host.unmountChat();
        return;
      }
      if (!ready) { this.close(); return; }
      const currentPosition = this.host.capturePosition();
      if (this.previousFixedScale !== undefined && currentPosition) this.host.setZoom('page-width', currentPosition.anchor);
      this.host.setActive(true);
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    }
  }
  close(restore = true): void {
    if (!this.opened) return;
    ++this.generation;
    this.opened = false;
    const position = this.host.capturePosition();
    this.host.unmountChat();
    if (restore && this.previousDock) this.host.restoreDock(this.previousDock);
    if (this.previousFixedScale !== undefined && position) this.host.setZoom(this.previousFixedScale, position.anchor);
    this.previousDock = undefined;
    this.previousFixedScale = undefined;
    this.host.setActive(false);
  }
  nativeAction(): void { this.close(false); }
  manualZoom(): void { this.previousFixedScale = undefined; }
  /** Window or host layout changed: clamp the applied width, keep the remembered choice. */
  viewportChanged(): void { if (this.opened && !this.disposed) this.relayout(false); }
  /** Native splitter drag: persist the chosen width and restore the current PDF anchor. */
  setWidth(cssPixels: number): Promise<void> {
    if (this.opened && !this.disposed) {
      this.desiredWidth = cssPixels;
      this.relayout(true);
    }
    return Promise.resolve();
  }
  dispose(): void { this.close(); this.disposed = true; }
  private applyWidth(persist: boolean): number {
    const applied = clampSidebarWidth(this.desiredWidth, this.host.measureAvailableWidth());
    this.host.applyWidth(applied);
    if (persist) {
      this.desiredWidth = applied;
      this.host.rememberWidth(applied);
    }
    return applied;
  }
  private relayout(persist: boolean): void {
    const position = this.host.capturePosition();
    this.applyWidth(persist);
    if (!position) return;
    if (this.previousFixedScale !== undefined) this.host.setZoom('page-width', position.anchor);
    else this.host.keepAnchor(position.anchor);
  }
}
