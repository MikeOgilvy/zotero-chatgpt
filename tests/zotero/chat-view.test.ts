import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter } from '../../packages/zotero/src/chat/presenter.ts';
import { mountChatView, renderReaderShell } from '../../packages/zotero/src/chat/view.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Conversation } from '../../packages/contracts/src/index.ts';
import { citationA, paperA, settings } from '../contracts/factories.ts';

const model = {
  id: 'catalog-default', displayName: 'Catalog Default', isDefault: true,
  supportedReasoningEfforts: [{ id: 'medium', description: '' }, { id: 'high', description: '' }],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }],
  defaultServiceTier: 'priority',
};

function documentOf(): Document {
  return new Window({ url: 'https://zcr.test/' }).document as unknown as Document;
}

async function mountReadyChat(options: { messages?: Conversation['messages']; draftCitations?: typeof citationA[] } = {}) {
  const conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null,
    messages: options.messages ?? [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?',
      citations: [citationA], status: 'completed',
    }],
    lastSeq: 0, createdAt: 'now', updatedAt: 'now',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null,
    models: [model], error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(conversation)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(conversation)), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  if (options.draftCitations) {
    for (const citation of options.draftCitations) presenter.addCitation(citation);
  }
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  mountChatView(root, presenter, { openCitation: () => Promise.resolve() });
  return { root, presenter };
}

it('uses a flush pane chrome without a detached Codex header or close control', () => {
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: 'PDFONE01', libraryID: 1 }, () => undefined);
  expect(root.className).toBe('zcr-sidebar');
  expect(root.dataset.attachmentKey).toBe('PDFONE01');
  expect(root.dataset.libraryId).toBe('1');
  expect(root.querySelector('header')).toBeNull();
  expect(root.textContent).not.toMatch(/^\s*Codex\s/u);
  expect(root.querySelector('[aria-label="Close Codex sidebar"]')).toBeNull();
  expect(root.querySelector('h2')).toBeNull();
});

it('keeps attachment identity on the root but puts paper context outside the message list', async () => {
  const { root } = await mountReadyChat();
  expect(root.dataset.attachmentKey).toBe(paperA.attachmentKey);
  expect(root.dataset.libraryId).toBe(String(paperA.libraryId));
  const thread = root.querySelector('[data-zcr-messages]')!;
  expect(thread.textContent).not.toContain('Library 1');
  expect(thread.textContent).not.toContain('Attachment PDFONE01');
  expect(thread.querySelector('[data-zcr-citation]')).toBeNull();
  expect(thread.textContent).not.toContain(citationA.title);
  const context = root.querySelector('[data-zcr-context]');
  expect(context).toBeTruthy();
  expect(thread.contains(context)).toBe(false);
  expect(context?.textContent).toContain('Synthetic Paper A');
  expect(context?.textContent).not.toContain(`Library ${paperA.libraryId}`);
  expect(context?.querySelector('[data-zcr-action="open-citation"]')?.textContent).toBe('Return to source');
});

it('keeps pending citations in the composer, not in the transcript', async () => {
  const { root } = await mountReadyChat({ messages: [], draftCitations: [citationA] });
  expect(root.querySelectorAll('[data-zcr-messages] [data-zcr-citation]')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]')).toHaveLength(1);
  expect(root.querySelector('[data-zcr-draft-citations] [data-zcr-action="remove-citation"]')?.textContent).toBe('Remove');
});

it('does not show copy-diagnostics in the default sidebar', async () => {
  const { root } = await mountReadyChat();
  expect(root.querySelector('[data-zcr-action="copy-diagnostics"]')).toBeNull();
  expect(root.textContent).not.toContain('复制诊断');
  expect(root.textContent).not.toContain('Copy diagnostics');
});

it('renders model, speed and reasoning as compact choice controls, not text fields', async () => {
  const { root } = await mountReadyChat();
  for (const field of ['model', 'speed', 'effort'] as const) {
    const control = root.querySelector<HTMLSelectElement>(`[data-zcr-setting="${field}"]`);
    expect(control?.tagName).toBe('SELECT');
    expect(control?.classList.contains('zcr-menu')).toBe(true);
    expect(control?.type).not.toBe('text');
  }
  expect(root.querySelector('[data-zcr-setting="model"]')?.getAttribute('aria-label')).toBe('Model');
  expect(root.querySelector('[data-zcr-setting="speed"]')?.getAttribute('aria-label')).toBe('Speed');
  expect(root.querySelector('[data-zcr-setting="effort"]')?.getAttribute('aria-label')).toBe('Reasoning');
});

it('defaults visible sidebar copy to English', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  expect(root.querySelector('[data-zcr-action="new-conversation"]')?.getAttribute('aria-label') ?? root.querySelector('[data-zcr-action="new-conversation"]')?.textContent).toMatch(/New chat/u);
  expect(root.querySelector('[data-zcr-history]')?.getAttribute('aria-label')).toBe('Chat history');
  expect(root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')?.placeholder).toBe('Ask a question…');
  expect(root.querySelector('[data-zcr-action="send"]')?.textContent).toBe('Send');
  expect(root.textContent).toMatch(/Preview|preview/u);
  expect(root.textContent).not.toMatch(/对话历史|新对话|输入问题|发送|复制诊断|返回原文|开发预览/u);
});

it('does not show a generic PDF filename as a hero title', async () => {
  const conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'PDF', settings,
    activeRequestId: null, messages: [], lastSeq: 0, createdAt: 'now', updatedAt: 'now',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(conversation)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(conversation)), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(paperA, 'PDF', {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'PDF', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  mountChatView(root, presenter);
  const title = root.querySelector('[data-zcr-context-title]');
  expect(title?.textContent?.trim() ?? '').toBe('');
  expect(title?.hasAttribute('hidden') ?? true).toBe(true);
});

it('hides the history menu when there is only one conversation so New chat is not duplicated', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const history = root.querySelector<HTMLSelectElement>('[data-zcr-history]');
  const fresh = root.querySelector<HTMLButtonElement>('[data-zcr-action="new-conversation"]');
  expect(history?.hidden).toBe(true);
  expect(fresh?.hidden).toBe(false);
  expect(fresh?.getAttribute('aria-label') ?? fresh?.textContent).toMatch(/New chat/u);
  expect(root.querySelectorAll('.zcr-chrome [data-zcr-action="new-conversation"], .zcr-chrome [data-zcr-history]:not([hidden])')).toHaveLength(1);
});

it('shows a short empty-state hint instead of an untitled void', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const empty = root.querySelector('[data-zcr-empty]');
  expect(empty?.hasAttribute('hidden')).toBe(false);
  expect(empty?.textContent).toMatch(/Select text|ask a question/iu);
  const { root: filled } = await mountReadyChat();
  expect(filled.querySelector('[data-zcr-empty]')?.hasAttribute('hidden')).toBe(true);
});

it('keeps the composer as one block: input, three settings, and send', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const composer = root.querySelector('[data-zcr-composer]');
  const draft = root.querySelector('.zcr-draft');
  const input = root.querySelector('[data-zcr-input]');
  const model = root.querySelector('[data-zcr-setting="model"]');
  const speed = root.querySelector('[data-zcr-setting="speed"]');
  const effort = root.querySelector('[data-zcr-setting="effort"]');
  const send = root.querySelector('[data-zcr-action="send"]');
  expect(draft && input && draft.contains(input)).toBe(true);
  expect(composer && model && composer.contains(model)).toBe(true);
  expect(composer && speed && composer.contains(speed)).toBe(true);
  expect(composer && effort && composer.contains(effort)).toBe(true);
  expect(composer && send && composer.contains(send)).toBe(true);
  expect(draft && composer && draft.contains(composer)).toBe(true);
});

it('keeps the preview footnote to one short muted line', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const note = root.querySelector('.zcr-footnote');
  expect(note?.textContent).toMatch(/Preview/u);
  expect(note?.textContent?.length ?? 99).toBeLessThan(48);
  expect(note?.textContent).not.toMatch(/full PDF is not uploaded/iu);
});
