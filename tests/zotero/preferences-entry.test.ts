import { Window } from 'happy-dom';
/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { expect, it, vi } from 'vitest';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';

/**
 * The pane script is loaded by Zotero into a sandbox whose prototype is the Preferences window, so
 * the only contract it has with the plugin is JSON-text functions on the shared `Zotero` object.
 * These tests drive that exact contract: they publish a bridge, import the real entry script and
 * mount the real pane module into a real DOM root.
 */
interface PreferencesBridge {
  readSettings(): Promise<string> | string;
  writeSettings(json: string): Promise<void> | void;
  setSkillEnabled(id: string, enabled: boolean): Promise<void> | void;
  newProfileId(): string;
}
interface PreferencesPaneGlobal {
  mount(root: Element): void;
  unmount(root: Element): void;
}

const shared = globalThis as unknown as {
  Zotero?: {
    ZoteroCodexReaderPreferencesHost?: PreferencesBridge;
    ZoteroCodexReaderPreferencesPane?: PreferencesPaneGlobal;
    logError?(error: unknown): void;
  };
};
const failures: unknown[] = [];
const stored = () => JSON.stringify({ ...defaultSettings(), uiLanguage: 'en', textScale: 1 });
const bridge: PreferencesBridge = {
  readSettings: () => stored(),
  writeSettings: () => undefined,
  setSkillEnabled: () => undefined,
  newProfileId: () => 'profile-aaaaaaaa-0000-4000-8000-00000000000a',
};
shared.Zotero = { ZoteroCodexReaderPreferencesHost: bridge, logError: error => failures.push(error) };
// Import once: Zotero evaluates this script once per Preferences window and then reuses the pane.
await import('../../packages/zotero/src/preferences-entry.ts');

function root(html = '<vbox/>') {
  const window = new Window({ url: 'https://test.invalid' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}
function pane(): PreferencesPaneGlobal {
  const published = shared.Zotero?.ZoteroCodexReaderPreferencesPane;
  if (!published) throw new Error('The pane script did not publish itself on the shared Zotero object.');
  return published;
}

it('publishes the pane on the shared preferences global and renders the real stored settings', async () => {
  const element = root();
  pane().mount(element);
  await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-zcr-pref="textScale"]')?.value).toBe('1'));
  const language = element.querySelector<HTMLSelectElement>('[data-zcr-pref="uiLanguage"]');
  const scale = element.querySelector<HTMLInputElement>('[data-zcr-pref="textScale"]');
  expect(language).not.toBeNull();
  expect(language!.value).toBe('en');
  expect(scale!.value).toBe('1');
  expect(failures).toEqual([]);
  pane().unmount(element);
  expect(element.querySelector('[data-zcr-pref="form"]')).toBeNull();
});

it('reports an honest message instead of throwing when the plugin host is not running', () => {
  const element = root();
  const host = shared.Zotero!.ZoteroCodexReaderPreferencesHost;
  delete shared.Zotero!.ZoteroCodexReaderPreferencesHost;
  try {
    expect(() => pane().mount(element)).not.toThrow();
    const alert = element.querySelector('[role="alert"]');
    expect(alert?.textContent).toMatch(/not running/u);
  } finally {
    if (host) shared.Zotero!.ZoteroCodexReaderPreferencesHost = host;
  }
  pane().unmount(element);
});

it('reports the store\'s own failure and no half-rendered form when the settings cannot be read', async () => {
  const element = root();
  const readSettings = bridge.readSettings;
  bridge.readSettings = () => Promise.reject(new Error('The workspace is stopping.'));
  try {
    pane().mount(element);
    await vi.waitFor(() => expect(element.querySelector('[data-zcr-pref="error"]')?.textContent).toBe('The workspace is stopping.'));
    expect(element.querySelector('[data-zcr-pref="error"]')!.getAttribute('role')).toBe('alert');
    expect(element.querySelector('[data-zcr-pref="form"]')).toBeNull();
    expect(failures).toEqual([]);
  } finally {
    bridge.readSettings = readSettings;
    pane().unmount(element);
  }
});

it('mounts one form when Zotero fires load twice and stops listening after unload', async () => {
  const element = root();
  const writeSettings = vi.fn(bridge.writeSettings);
  const setSkillEnabled = vi.fn(bridge.setSkillEnabled);
  bridge.writeSettings = writeSettings;
  bridge.setSkillEnabled = setSkillEnabled;
  try {
    pane().mount(element);
    pane().mount(element);
    await vi.waitFor(() => expect(element.querySelectorAll('[data-zcr-pref="form"]')).toHaveLength(1));
    pane().unmount(element);
    // After unload the detached controls must not keep writing to the store.
    const save = element.querySelector<HTMLButtonElement>('[data-zcr-pref="save-preferences"]');
    save?.dispatchEvent(new (element.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('click', { bubbles: true }));
    await Promise.resolve();
    expect(writeSettings).not.toHaveBeenCalled();
    expect(setSkillEnabled).not.toHaveBeenCalled();
  } finally {
    bridge.writeSettings = bridge.writeSettings === writeSettings ? () => undefined : bridge.writeSettings;
    bridge.setSkillEnabled = () => undefined;
  }
});
