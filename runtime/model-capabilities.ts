/**
 * Whitelisted fields from the JSON catalog embedded in the pinned binary.
 * Audited 2026-09-13 without inference; the binary digest matched manifest.ts at rust-v0.154.0.
 * This is a fallback catalog, not an account entitlement or effective window.
 * Keep both identity literals: a manifest upgrade must invalidate stale data.
 * Order mirrors the embedded catalog (newest listed first); the first id is the composer default.
 */
export const PINNED_MODEL_CATALOG = {
  runtimeVersion: '0.154.0',
  runtimeSha256: '4f85982624b3898c8991cb80c0981b2aa71070e3537046c9a95950318a95afcc',
  models: {
    'gpt-6-astra': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-sol': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-terra': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-luna': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-daybreak-blue-latest': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-daybreak-red-latest': { contextWindow: 372000, maxContextWindow: 372000, inputModalities: ['text', 'image'] },
    'gpt-5.5': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.4': { contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'] },
    'gpt-5.4-mini': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.2': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'codex-auto-review': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
  },
} as const;
