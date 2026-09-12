import type { Citation, GenerationSettings, ImageAttachment, PaperScope, SendInput } from '../../packages/contracts/src/index.ts';
export const clientId = '3c043b02-e442-4e16-b1ce-340f5f5f1a72';
export const paperA: PaperScope = { clientId, libraryId: 1, attachmentKey: 'PDFONE01' };
export const paperB: PaperScope = { clientId, libraryId: 1, attachmentKey: 'PDFTWO02' };
export const settings: GenerationSettings = { model: 'catalog-default', serviceTier: 'priority', effort: 'medium' };
export const citationA: Citation = {
  id: '7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d01',
  paper: paperA,
  text: '设先验分布为 p(θ)，观测数据 D 后的后验为 p(θ|D) ∝ p(D|θ)p(θ)。',
  title: 'Synthetic Paper A',
  authors: ['Synthetic Author'],
  year: '2026',
  pageLabel: 'iv',
  positions: [{ pageIndex: 3, rects: [[72, 500.5, 300.25, 512]] }],
  capturedAt: '2026-09-09T08:00:00.000Z',
  contextScope: 'selection',
};
export const citationB: Citation = { ...citationA, id: '7d6f2a10-5c1e-4b7a-9e3f-2f9c1a8b4d02', paper: paperB, title: 'Synthetic supplement B', pageLabel: '2', positions: [{ pageIndex: 1, rects: [[50, 100, 200, 120]] }] };
export function makeSend(overrides: Partial<SendInput> = {}): SendInput {
  return { requestId: '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e', conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', action: 'explain', question: '', citations: [citationA], settings, ...overrides };
}
/** 1×1 PNG data URL. rust-v0.144.1 `turn/start` UserInput::Image accepts `url` as a data URL. */
export const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const imageA: ImageAttachment = {
  id: '6c8e0a2b-4d1f-4e3a-9c5b-1a7d3e5f9b20',
  name: 'figure.png',
  mime: 'image/png',
  dataUrl: TINY_PNG_DATA_URL,
};
