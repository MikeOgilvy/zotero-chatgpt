export interface PluginContext {
  rootURI: string;
  pluginID: string;
}

export function startup(context: PluginContext): void {
  void context;
}

export function shutdown(): void {}

export function onMainWindowLoad(window: Window): void {
  void window;
}

export function onMainWindowUnload(window: Window): void {
  void window;
}
