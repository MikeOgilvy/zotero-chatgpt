import { ReaderError } from '../../../contracts/src/index.ts';
import type { ReaderWorkspace, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { PREFERENCES_EXPORT_NAME, preferencesExportText } from '../../../core/src/workspace/export.ts';

/**
 * The only bridge the Preferences pane needs. Everything crossing the pane sandbox is JSON text,
 * so the pane never receives live store objects or DOM nodes from the plugin compartment.
 * All reads and writes go through the existing workspace store, including its validation,
 * atomic writes and skill revision conflicts; nothing here keeps a second copy of the settings.
 */
export interface PreferencesServiceHost {
  workspace(): Promise<ReaderWorkspace>;
  uuid(): string;
  /** Native save dialog; the host owns the file picker and the exact bytes written. */
  exportText(name: string, text: string): Promise<void>;
}
export interface PreferencesService {
  readSettings(): Promise<string>;
  writeSettings(json: string): Promise<void>;
  setSkillEnabled(id: string, enabled: boolean): Promise<void>;
  exportPreferences(): Promise<void>;
  /** Profile ids are minted in the plugin sandbox so the pane needs no host globals. */
  newProfileId(): string;
}

function parseSettings(json: string): WorkspaceSettings {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new ReaderError('INVALID_REQUEST', 'The preferences payload is invalid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReaderError('INVALID_REQUEST', 'The preferences payload is invalid.');
  return value as WorkspaceSettings;
}

export function createPreferencesService(host: PreferencesServiceHost): PreferencesService {
  return {
    async readSettings(): Promise<string> {
      return JSON.stringify(await (await host.workspace()).settings());
    },
    async writeSettings(json: string): Promise<void> {
      const value = parseSettings(json);
      await (await host.workspace()).saveSettings(value);
    },
    async setSkillEnabled(id: string, enabled: boolean): Promise<void> {
      if (typeof enabled !== 'boolean') throw new ReaderError('INVALID_REQUEST', 'A workflow is either enabled or disabled.');
      const workspace = await host.workspace();
      const settings = await workspace.settings();
      const skill = settings.skills.find(item => item.id === id);
      if (!skill) throw new ReaderError('NOT_FOUND', 'The workflow is no longer installed.');
      // saveSkill enforces the skill revision conflict; saveSettings would silently keep a newer file.
      await workspace.saveSkill({ ...skill, enabled });
    },
    async exportPreferences(): Promise<void> {
      // Same payload and same native file dialog as the sidebar export, from one definition.
      await host.exportText(PREFERENCES_EXPORT_NAME, preferencesExportText(await (await host.workspace()).settings()));
    },
    newProfileId(): string {
      return `profile-${host.uuid()}`;
    },
  };
}
