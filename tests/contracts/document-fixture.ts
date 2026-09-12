import { paperA } from './factories.ts';
export const documentA = {
  id: 'aabbccdd-0000-4000-8000-000000000001', paper: paperA,
  revision: { fingerprint: 'synthetic-v1', size: 1024, modifiedAt: 1000 },
  parserVersion: 'zotero-pdfjs-text-v1', totalPages: 2,
  pages: [
    { pageIndex: 0, pageLabel: 'i', text: 'Definition: x denotes the hidden state.', status: 'text' as const },
    { pageIndex: 1, pageLabel: 'ii', text: 'Theorem: y = x + 7. Figure 1: a synthetic diagram.', status: 'text' as const },
  ],
};
