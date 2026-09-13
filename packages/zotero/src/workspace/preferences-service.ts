import { ReaderError } from '../../../contracts/src/index.ts';
import type { ReaderWorkspace, WorkspaceSettings } from '../../../contracts/src/workspace.ts';
import { validateHistoryStorageReport } from '../../../contracts/src/workspace-validation.ts';
import { HistoryManager } from '../../../core/src/workspace/history.ts';
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
  /** The plugin preference `extensions.zcr.automaticPdfText`; not part of the workspace store. */
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
  /**
   * The model ids the running Codex runtime last reported, or null when it is not running. Optional
   * and strictly read-only: opening the Preferences window must never start a runtime, and a host
   * without the port still renders the pane from the bundled catalog with honest copy.
   */
  liveModels?(): Promise<string[] | null>;
  /**
   * Bounded measurement of the plugin's own records store, for the History section's size report.
   * Optional: a host that omits it renders an honest unavailable state instead of a made-up number.
   */
  storageReport?(): Promise<unknown>;
}
export interface PreferencesService {
  readSettings(): Promise<string>;
  writeSettings(json: string): Promise<void>;
  setSkillEnabled(id: string, enabled: boolean): Promise<void>;
  exportPreferences(): Promise<void>;
  /** Profile ids are minted in the plugin sandbox so the pane needs no host globals. */
  newProfileId(): string;
  readAutomaticPdfText(): boolean;
  writeAutomaticPdfText(enabled: boolean): void;
  /** History management is exposed as JSON text like everything else crossing the pane boundary. */
  readHistory(query: string): Promise<string>;
  setHistoryArchived(idsJson: string, archived: boolean): Promise<string>;
  deleteHistory(idsJson: string): Promise<string>;
  /**
   * The storage measurement as JSON text. Absent when the host cannot measure; the pane then shows
   * that size is unavailable rather than a blank or an estimate.
   */
  readStorageReport?(): Promise<string>;
  /**
   * The runtime's live model ids as JSON text, or the JSON literal `null` when no runtime has
   * reported any. Absent when the host has no runtime bridge; the pane then says the Spark models
   * come from the runtime instead of inventing rows.
   */
  readLiveModels?(): Promise<string>;
}

/** Ids only: the pane never sends back titles, previews or paper scopes it could have forged. */
function parseIds(json: string): string[] {
  let value: unknown;
  try { value = JSON.parse(json) as unknown; } catch { throw new ReaderError('INVALID_REQUEST', 'The selected chats payload is invalid JSON.'); }
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new ReaderError('INVALID_REQUEST', 'Select between 1 and 500 stored chats.');
  if (!value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 36)) throw new ReaderError('INVALID_REQUEST', 'The selected chats payload is invalid.');
  if (new Set(value).size !== value.length) throw new ReaderError('INVALID_REQUEST', 'The selected chats payload contains duplicates.');
  return value as string[];
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
  // Presence, not a flag: a host without a reader simply has no `readStorageReport` to call.
  const measure = host.storageReport?.bind(host);
  const live = host.liveModels?.bind(host);
  return {
    ...(measure ? {
      async readStorageReport(): Promise<string> { return JSON.stringify(validateHistoryStorageReport(await measure())); },
    } : {}),
    ...(live ? {
      async readLiveModels(): Promise<string> { return JSON.stringify(await live()); },
    } : {}),
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
    readAutomaticPdfText(): boolean {
      return host.readAutomaticPdfText() !== false;
    },
    writeAutomaticPdfText(enabled: boolean): void {
      if (typeof enabled !== 'boolean') throw new ReaderError('INVALID_REQUEST', 'Automatic PDF text is either on or off.');
      host.writeAutomaticPdfText(enabled);
    },
    async readHistory(query: string): Promise<string> {
      if (typeof query !== 'string' || query.length > 1024) throw new ReaderError('INVALID_REQUEST', 'The history search is invalid.');
      return JSON.stringify(await new HistoryManager(await host.workspace()).listing(query));
    },
    async setHistoryArchived(idsJson: string, archived: boolean): Promise<string> {
      if (typeof archived !== 'boolean') throw new ReaderError('INVALID_REQUEST', 'A stored chat is either archived or not.');
      return JSON.stringify(await new HistoryManager(await host.workspace()).setArchivedByIds(parseIds(idsJson), archived));
    },
    async deleteHistory(idsJson: string): Promise<string> {
      return JSON.stringify(await new HistoryManager(await host.workspace()).removeByIds(parseIds(idsJson)));
    },
  };
}
