export type Scale = number | 'auto' | 'page-fit' | 'page-width';
export interface Anchor { pageIndex: number; left: number; top: number }
export interface ViewPosition { anchor: Anchor; scale: Scale }
export interface DockState { collapsed: boolean; mode: 'item' | 'notes'; scrollTop: number }
export interface LayoutHost {
  captureDock(): DockState;
  capturePosition(): ViewPosition | undefined;
  showDock(): void;
  restoreDock(state: DockState): void;
  mountChat(): Promise<boolean>;
  unmountChat(): void;
  setZoom(scale: Scale, anchor: Anchor): void;
  setActive(active: boolean): void;
}
/** Owns only the temporary changes made while chat is active. Host DOM lives in the adapter. */
export class ReaderLayoutController {
  private opened = false;
  private disposed = false;
  private generation = 0;
  private previousDock: DockState | undefined;
  private previousFixedScale: number | undefined;
  constructor(private host: LayoutHost) {}
  get active(): boolean { return this.opened; }
  async toggle(): Promise<void> {
    if (this.disposed) return;
    if (this.opened) { this.close(); return; }
    const generation = ++this.generation;
    this.previousDock = this.host.captureDock();
    const position = this.host.capturePosition();
    this.previousFixedScale = typeof position?.scale === 'number' ? position.scale : undefined;
    this.opened = true;
    this.host.showDock();
    try {
      const ready = await this.host.mountChat();
      if (generation !== this.generation) {
        // A newer opening may now own the same DOM.
        if (!this.opened) this.host.unmountChat();
        return;
      }
      if (!ready) { this.close(); return; }
      if (this.previousFixedScale !== undefined && position) this.host.setZoom('page-width', position.anchor);
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
  dispose(): void { this.close(); this.disposed = true; }
}
