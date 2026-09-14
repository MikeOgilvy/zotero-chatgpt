/**
 * Reader-facing entry point for the bibliography helpers. The implementation is shared with the
 * model-context layer and therefore lives in `core` (`packages/core/src/context/bibliography.ts`),
 * because the layering is contracts → core → zotero and `core` cannot import `zotero`. This module
 * only keeps the reader's existing import path and export names stable; put logic in the core module.
 */
export * from '../../../core/src/context/bibliography.ts';
