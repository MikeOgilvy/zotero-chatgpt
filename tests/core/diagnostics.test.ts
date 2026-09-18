import { describe, expect, it } from 'vitest';
import { shareableDiagnostics } from '../../packages/core/src/sessions/diagnostics.ts';
describe('shareable diagnostics', () => {
  it('exports only version, error code, counts and states', () => {
    const report = shareableDiagnostics({
      pluginVersion: '0.3.0-alpha.1',
      runtimeVersion: '0.144.1',
      errorCode: 'RATE_LIMITED',
      requests: [{ state: 'completed' }, { state: 'uncertain' }, { state: 'uncertain' }],
    });
    expect(report).toEqual({
      pluginVersion: '0.3.0-alpha.1',
      runtimeVersion: '0.144.1',
      errorCode: 'RATE_LIMITED',
      requestCount: 3,
      states: { completed: 1, uncertain: 2 },
      storageLocation: 'Zotero profile/zotero-chatgpt/v1/records',
    });
    expect(JSON.stringify(report)).not.toMatch(/paper|token|@|\/Users|question|citation/i);
  });
});
