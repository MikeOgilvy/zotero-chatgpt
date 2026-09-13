import { expect, it } from 'vitest';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
import { PREFERENCES_EXPORT_NAME, preferencesExportText } from '../../packages/core/src/workspace/export.ts';

it('exports one preference snapshot shape for both the sidebar and the native pane', () => {
  const settings = {
    ...defaultSettings(),
    preferences: { ...defaultSettings().preferences, background: 'I know linear algebra' },
    profiles: [{ id: 'math', name: 'Mathematics', preferences: { mathematics: 'formal' as const } }],
  };
  expect(PREFERENCES_EXPORT_NAME).toBe('reading-preferences.json');
  const exported = JSON.parse(preferencesExportText(settings)) as Record<string, unknown>;
  // Only the user-authored preferences and research profiles are exported.
  expect(Object.keys(exported)).toEqual(['preferences', 'profiles']);
  expect(exported.preferences).toEqual(settings.preferences);
  expect(exported.profiles).toEqual(settings.profiles);
  expect(preferencesExportText(settings)).toContain('\n  "preferences": {');
});
