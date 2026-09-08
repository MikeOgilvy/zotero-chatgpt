import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi, type Mock } from "vitest";

const bootstrapPath = path.resolve(
  import.meta.dirname,
  "../../packages/zotero/bootstrap.js",
);

interface PluginContext {
  pluginID: string;
  rootURI: string;
}

interface PluginApi {
  onMainWindowLoad: Mock<(window: object) => Promise<void>>;
  onMainWindowUnload: Mock<(window: object) => Promise<void>>;
  shutdown: Mock<() => Promise<void>>;
  startup: Mock<(context: PluginContext) => Promise<void>>;
}

interface LoadedBootstrap {
  api: PluginApi;
  loadSubScript: Mock<
    (url: string, moduleScope: Record<string, unknown>) => void
  >;
  resolveInitialization: () => void;
  scope: Record<string, unknown>;
  services: object;
  windows: object[];
}

async function loadBootstrap(): Promise<LoadedBootstrap> {
  let resolveInitialization = () => {};
  const initializationPromise = new Promise<void>((resolve) => {
    resolveInitialization = resolve;
  });
  const windows = [{ name: "first" }, { name: "second" }];
  const api: PluginApi = {
    onMainWindowLoad: vi.fn(async () => {}),
    onMainWindowUnload: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
    startup: vi.fn(async () => {}),
  };
  const zotero = {
    getMainWindows: () => windows,
    initializationPromise,
  };
  const loadSubScript = vi.fn(
    (_url: string, moduleScope: Record<string, unknown>) => {
      expect(moduleScope.Zotero).toBe(zotero);
      moduleScope.ZoteroCodexReader = api;
    },
  );
  const services = { scriptloader: { loadSubScript } };
  const scope: Record<string, unknown> = {
    Services: services,
    Zotero: zotero,
  };
  vm.createContext(scope);
  vm.runInContext(await readFile(bootstrapPath, "utf8"), scope);

  return {
    api,
    loadSubScript,
    resolveInitialization,
    scope,
    services,
    windows,
  };
}

function lifecycleFunction<T>(
  scope: Record<string, unknown>,
  name: string,
): T {
  const value = scope[name];
  expect(value, name).toBeTypeOf("function");
  return value as T;
}

describe("Zotero bootstrap lifecycle", () => {
  it("waits for Zotero initialization before loading and starting existing windows", async () => {
    const loaded = await loadBootstrap();
    const startup = lifecycleFunction<
      (context: { id: string; rootURI: string }) => Promise<void>
    >(loaded.scope, "startup");

    const started = startup({
      id: "extension-id",
      rootURI: "resource://zcr/",
    });
    await Promise.resolve();
    expect(loaded.loadSubScript).not.toHaveBeenCalled();

    loaded.resolveInitialization();
    await started;

    expect(loaded.loadSubScript).toHaveBeenCalledOnce();
    expect(loaded.loadSubScript.mock.calls[0]?.[0]).toBe(
      "resource://zcr/content/zcr.js",
    );
    expect(loaded.api.startup).toHaveBeenCalledWith({
      pluginID: "extension-id",
      rootURI: "resource://zcr/",
    });
    expect(
      loaded.api.onMainWindowLoad.mock.calls.map(([window]) => window),
    ).toEqual(loaded.windows);
  });

  it("forwards future window hooks and unloads existing windows at shutdown", async () => {
    const loaded = await loadBootstrap();
    loaded.resolveInitialization();
    const startup = lifecycleFunction<
      (context: { id: string; rootURI: string }) => Promise<void>
    >(loaded.scope, "startup");
    await startup({ id: "extension-id", rootURI: "resource://zcr/" });
    loaded.api.onMainWindowLoad.mockClear();

    const futureWindow = { name: "future" };
    const onMainWindowLoad = lifecycleFunction<
      (data: { window: object }) => Promise<void>
    >(loaded.scope, "onMainWindowLoad");
    const onMainWindowUnload = lifecycleFunction<
      (data: { window: object }) => Promise<void>
    >(loaded.scope, "onMainWindowUnload");
    const shutdown = lifecycleFunction<() => Promise<void>>(
      loaded.scope,
      "shutdown",
    );

    await onMainWindowLoad({ window: futureWindow });
    await onMainWindowUnload({ window: futureWindow });
    await shutdown();

    expect(loaded.api.onMainWindowLoad).toHaveBeenCalledWith(futureWindow);
    expect(loaded.api.onMainWindowUnload).toHaveBeenCalledWith(futureWindow);
    expect(
      loaded.api.onMainWindowUnload.mock.calls.slice(1).map(([window]) => window),
    ).toEqual(loaded.windows);
    expect(loaded.api.shutdown).toHaveBeenCalledOnce();
  });

  it("registers a window arriving during startup exactly once", async () => {
    const loaded = await loadBootstrap();
    const arrivingWindow = { name: "arriving" };
    loaded.windows.splice(0, loaded.windows.length, arrivingWindow);
    const startup = lifecycleFunction<
      (context: { id: string; rootURI: string }) => Promise<void>
    >(loaded.scope, "startup");
    const onMainWindowLoad = lifecycleFunction<
      (data: { window: object }) => Promise<void>
    >(loaded.scope, "onMainWindowLoad");

    const started = startup({ id: "extension-id", rootURI: "resource://zcr/" });
    const hookOutcome = onMainWindowLoad({ window: arrivingWindow }).then(
      () => "resolved",
      (error: unknown) =>
        error instanceof Error ? `rejected: ${error.message}` : "rejected",
    );
    loaded.resolveInitialization();

    await started;
    expect(await hookOutcome).toBe("resolved");
    expect(
      loaded.api.onMainWindowLoad.mock.calls.map(([window]) => window),
    ).toEqual([arrivingWindow]);
  });

  it("cancels a pending startup when shutdown begins", async () => {
    const loaded = await loadBootstrap();
    const startup = lifecycleFunction<
      (context: { id: string; rootURI: string }) => Promise<void>
    >(loaded.scope, "startup");
    const shutdown = lifecycleFunction<() => Promise<void>>(
      loaded.scope,
      "shutdown",
    );

    const started = startup({ id: "extension-id", rootURI: "resource://zcr/" });
    const stopped = shutdown();
    loaded.resolveInitialization();
    await Promise.all([started, stopped]);

    expect(loaded.loadSubScript).not.toHaveBeenCalled();
    expect(loaded.api.startup).not.toHaveBeenCalled();
  });

  it("uses Zotero's injected Services global without clearing it", async () => {
    const loaded = await loadBootstrap();
    loaded.resolveInitialization();
    const startup = lifecycleFunction<
      (context: { id: string; rootURI: string }) => Promise<void>
    >(loaded.scope, "startup");
    const shutdown = lifecycleFunction<() => Promise<void>>(
      loaded.scope,
      "shutdown",
    );

    await startup({ id: "extension-id", rootURI: "resource://zcr/" });
    await shutdown();

    expect(loaded.scope.Services).toBe(loaded.services);
  });
});
