import type { WorkspaceSettings } from '../../../contracts/src/workspace.ts';

/** Name of the user-visible preference export, shared by every surface that offers it. */
export const PREFERENCES_EXPORT_NAME = 'reading-preferences.json';

/**
 * The exact exported text: the user-authored answer preferences and research profiles only.
 * Skills, per-chat overrides and file paths are never part of the export.
 */
export function preferencesExportText(settings: WorkspaceSettings): string {
  return JSON.stringify({ preferences: settings.preferences, profiles: settings.profiles }, null, 2);
}
