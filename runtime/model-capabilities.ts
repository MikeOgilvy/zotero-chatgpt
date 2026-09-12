/**
 * Whitelisted fields from the JSON catalog embedded in the pinned binary.
 * Audited 2026-09-12 without inference; the binary digest matched manifest.ts.
 * This is a fallback catalog, not an account entitlement or effective window.
 * Keep both identity literals: a manifest upgrade must invalidate stale data.
 */
export const PINNED_MODEL_CATALOG = {
  runtimeVersion: '0.144.1',
  runtimeSha256: '29915529b97697def1a957b0505e770aa6a45744435d62fc263e98d7619e167a',
  models: {
    'gpt-5.6-sol': { contextWindow: 372000, maxContextWindow: 372000, inputModalities: ['text', 'image'] },
    'gpt-5.6-terra': { contextWindow: 372000, maxContextWindow: 372000, inputModalities: ['text', 'image'] },
    'gpt-5.6-luna': { contextWindow: 372000, maxContextWindow: 372000, inputModalities: ['text', 'image'] },
    'gpt-5.5': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.4': { contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'] },
    'gpt-5.4-mini': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.2': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'codex-auto-review': { contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'] },
  },
} as const;
