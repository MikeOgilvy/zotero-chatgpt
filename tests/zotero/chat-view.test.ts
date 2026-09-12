import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter, type DocumentServices } from '../../packages/zotero/src/chat/presenter.ts';
import { documentA } from '../contracts/document-fixture.ts';
import { mountChatView, renderReaderShell } from '../../packages/zotero/src/chat/view.ts';
import type { ReaderClient, RuntimeSnapshot } from '../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Conversation, type SendInput } from '../../packages/contracts/src/index.ts';
import { citationA, imageA, paperA, settings, TINY_PNG_DATA_URL } from '../contracts/factories.ts';

const model = {
  id: 'catalog-default', displayName: 'Catalog Default', isDefault: true,
  supportedReasoningEfforts: [
    { id: 'low', description: '' }, { id: 'medium', description: '' },
    { id: 'high', description: '' }, { id: 'xhigh', description: '' },
  ],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }, { id: 'flex', name: 'Flex', description: '' }],
  defaultServiceTier: 'priority',
};

function documentOf(): Document {
  return new Window({ url: 'https://zcr.test/' }).document as unknown as Document;
}

async function mountReadyChat(options: {
  messages?: Conversation['messages'];
  draftCitations?: typeof citationA[];
  draftImages?: typeof imageA[];
  conversations?: Conversation[];
  textScale?: { value: number };
  readerZoom?: { factor: number; ins: number; outs: number; resets: number };
  sent?: SendInput[];
  confirm?: (message: string) => boolean;
  uuid?: () => string;
  document?: DocumentServices;
} = {}) {
  let conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null,
    messages: options.messages ?? [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?',
      citations: [citationA], status: 'completed',
    }],
    lastSeq: 0, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null,
    models: [model], error: null,
  };
  const listed = options.conversations ?? [conversation];
  if (!listed.some(entry => entry.id === conversation.id)) listed.unshift(conversation);
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(conversation)),
    newConversation: () => {
      conversation = {
        ...conversation, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], lastSeq: 0,
        createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z', activeRequestId: null,
      };
      listed.push(conversation);
      return Promise.resolve(structuredClone(conversation));
    },
    list: () => Promise.resolve(listed.map(entry => structuredClone(entry))),
    select: (_paper, id) => {
      const found = listed.find(entry => entry.id === id);
      if (!found) return Promise.reject(new Error('missing conversation'));
      conversation = found;
      return Promise.resolve(structuredClone(found));
    },
    get: () => Promise.resolve(structuredClone(conversation)),
    send: input => {
      options.sent?.push(input);
      conversation = {
        ...conversation, settings: input.settings, activeRequestId: input.requestId,
        messages: [...conversation.messages, {
          id: `u-${conversation.messages.length + 1}`, requestId: input.requestId, role: 'user',
          phase: null, settings: input.settings, text: input.question, citations: input.citations,
          status: 'completed', ...(input.images ? { images: input.images } : {}),
        }],
        lastSeq: conversation.lastSeq + 1,
      };
      return Promise.resolve({ requestId: input.requestId, state: 'accepted' as const, replay: false });
    },
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    deleteConversation: (_paper, id) => {
      const index = listed.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new Error('missing conversation'));
      listed.splice(index, 1);
      if (conversation.id === id) {
        conversation = listed[0] ?? {
          ...conversation, id: 'bbbbbbbb-0000-4000-8000-000000000003', messages: [], lastSeq: 0, activeRequestId: null,
        };
        if (!listed.some(entry => entry.id === conversation.id)) listed.push(conversation);
      }
      return Promise.resolve(structuredClone(conversation));
    },
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined,
    uuid: options.uuid ?? (() => '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e'), now: () => 'now',
    ...(options.document ? { document: options.document } : {}),
  });
  if (options.draftCitations) {
    for (const citation of options.draftCitations) presenter.addCitation(citation);
  }
  if (options.draftImages) {
    for (const image of options.draftImages) presenter.addImage(image);
  }
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  const scale = options.textScale ?? { value: 1 };
  mountChatView(root, presenter, {
    openCitation: () => Promise.resolve(),
    readTextScale: () => scale.value,
    writeTextScale: value => { scale.value = value; },
    confirm: options.confirm ?? (() => true),
    uuid: options.uuid ?? (() => imageA.id),
    ...(options.readerZoom ? {
      readerZoom: {
        zoomIn: () => { options.readerZoom!.ins += 1; options.readerZoom!.factor = Math.round((options.readerZoom!.factor + 0.25) * 100) / 100; },
        zoomOut: () => { options.readerZoom!.outs += 1; options.readerZoom!.factor = Math.max(0.5, Math.round((options.readerZoom!.factor - 0.25) * 100) / 100); },
        zoomReset: () => { options.readerZoom!.resets += 1; options.readerZoom!.factor = 1; },
        readZoom: () => options.readerZoom!.factor,
      },
    } : {}),
  });
  return { root, presenter, scale, client };
}

it('uses an in-pane sidebar without impersonating the reader toolbar or adding a close control', () => {
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: 'PDFONE01', libraryID: 1 }, () => undefined);
  expect(root.className).toMatch(/zcr-sidebar/u);
  expect(root.classList.contains('zcr-paper')).toBe(true);
  expect(root.dataset.attachmentKey).toBe('PDFONE01');
  expect(root.dataset.libraryId).toBe('1');
  expect(root.style.getPropertyValue('--zcr-reader-toolbar-height')).toBe('');
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
  const chrome = root.querySelector('.zcr-chrome');
  const pill = root.querySelector('[data-zcr-chat-pill]');
  expect(chrome?.contains(pill)).toBe(true);
  expect(thread.contains(pill)).toBe(false);
  expect(pill?.textContent).toContain('Synthetic Paper A');
  expect(pill?.textContent).not.toContain(`Library ${paperA.libraryId}`);
  const back = root.querySelector('[data-zcr-action="open-citation"]');
  expect(back?.getAttribute('aria-label')).toBe('Return to source');
  expect(back?.textContent?.trim()).toBe('');
});

it('keeps pending citations in the composer, not in the transcript', async () => {
  const { root } = await mountReadyChat({ messages: [], draftCitations: [citationA] });
  expect(root.querySelectorAll('[data-zcr-messages] [data-zcr-citation]')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zcr-draft-citations] [data-zcr-citation]')).toHaveLength(1);
  const remove = root.querySelector('[data-zcr-draft-citations] [data-zcr-action="remove-citation"]');
  expect(remove?.getAttribute('aria-label')).toBe('Remove');
  expect(remove?.textContent?.trim()).toBe('');
});

it('does not show copy-diagnostics in the default sidebar', async () => {
  const { root } = await mountReadyChat();
  expect(root.querySelector('[data-zcr-action="copy-diagnostics"]')).toBeNull();
  expect(root.textContent).not.toContain('复制诊断');
  expect(root.textContent).not.toContain('Copy diagnostics');
});

it('opens a custom model popover instead of three always-visible selects', async () => {
  const { root } = await mountReadyChat();
  const picker = root.querySelector('[data-zcr-picker]');
  const menu = root.querySelector('[data-zcr-picker-menu]');
  expect(picker).toBeTruthy();
  expect(picker?.getAttribute('aria-expanded')).toBe('false');
  expect(menu?.hasAttribute('hidden')).toBe(true);
  expect(root.querySelectorAll('select')).toHaveLength(0);
  expect(root.querySelectorAll('[data-zcr-composer] > select, .zcr-settings > select')).toHaveLength(0);
  (picker as HTMLButtonElement).click();
  expect(picker?.getAttribute('aria-expanded')).toBe('true');
  expect(menu?.hasAttribute('hidden')).toBe(false);
  expect(menu?.querySelector('[data-zcr-picker-section="effort"]')?.textContent).toMatch(/Effort/u);
  expect(menu?.querySelector('[data-zcr-setting="effort"][data-zcr-value="low"]')?.textContent).toMatch(/Low/u);
  expect(menu?.querySelector('[data-zcr-setting="effort"][data-zcr-value="xhigh"]')?.textContent).toMatch(/Extra High/u);
  expect(menu?.querySelector('[data-zcr-setting="effort"][data-zcr-value="medium"]')?.getAttribute('aria-checked')).toBe('true');
  const fast = menu?.querySelector('[data-zcr-setting="speed"]');
  expect(fast?.getAttribute('role')).toBe('switch');
  expect(fast?.getAttribute('aria-label')).toMatch(/Fast/u);
  expect(menu?.querySelector('[data-zcr-picker-section="model"]')?.textContent).toMatch(/Model/u);
  expect(menu?.querySelectorAll('[data-zcr-setting="model"]').length).toBeGreaterThan(0);
  expect(root.querySelectorAll('select')).toHaveLength(0);
});

it('defaults visible sidebar copy to English', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  expect(root.querySelector('[data-zcr-action="new-conversation"]')?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(root.querySelector('[data-zcr-action="history"]')?.getAttribute('aria-label')).toMatch(/Chat history/u);
  expect(root.querySelector('[data-zcr-history]')?.getAttribute('aria-label')).toBe('Chat history');
  expect(root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')?.placeholder).toBe('Ask a question…');
  const send = root.querySelector('[data-zcr-action="send"]');
  expect(send?.getAttribute('aria-label')).toBe('Send');
  expect(send?.textContent?.trim()).toBe('');
  expect(root.textContent).not.toMatch(/Preview|preview|development preview/u);
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
    deleteConversation: () => Promise.reject(new Error()),
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
  const pill = root.querySelector('[data-zcr-chat-pill]');
  expect(pill?.textContent).not.toMatch(/\bPDF\b/u);
  expect(pill?.textContent).toMatch(/Untitled/u);
});

it('keeps title, New chat, and history inside the sidebar pane below the native toolbar', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const chrome = root.querySelector('.zcr-chrome');
  const historyButton = root.querySelector<HTMLButtonElement>('[data-zcr-action="history"]');
  const panel = root.querySelector<HTMLElement>('[data-zcr-history]');
  const fresh = root.querySelector<HTMLButtonElement>('[data-zcr-action="new-conversation"]');
  const pill = root.querySelector('[data-zcr-chat-pill]');
  expect(root.contains(chrome)).toBe(true);
  expect(chrome?.contains(historyButton)).toBe(true);
  expect(chrome?.contains(fresh)).toBe(true);
  expect(chrome?.contains(pill)).toBe(true);
  expect(root.style.getPropertyValue('--zcr-reader-toolbar-height')).toBe('');
  expect(historyButton?.hidden).toBe(false);
  expect(fresh?.hidden).toBe(false);
  expect(fresh?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(fresh?.textContent?.trim()).toBe('');
  expect(chrome?.textContent).not.toMatch(/New chat/u);
  expect(panel?.tagName).not.toBe('SELECT');
  expect(root.querySelectorAll('select')).toHaveLength(0);
  expect(panel?.hasAttribute('hidden')).toBe(true);
  historyButton?.click();
  expect(panel?.hasAttribute('hidden')).toBe(false);
  expect(panel?.querySelector('[data-zcr-history-search]')).toBeTruthy();
});

it('centers a Codex mark in an empty transcript without instructional copy', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const mark = root.querySelector('[data-zcr-empty]');
  expect(mark?.closest('.zcr-transcript')).toBeTruthy();
  expect(mark?.querySelector('svg')).toBeTruthy();
  expect(root.textContent).not.toMatch(/Select text in the PDF|ask a question\./iu);
  expect(root.textContent).not.toMatch(/@ chats|\/ skills|highlight/iu);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')?.placeholder).toBe('Ask a question…');
  const { root: filled } = await mountReadyChat();
  expect(filled.querySelector('[data-zcr-empty]')).toBeNull();
});

it('changes the actual full-PDF default from Settings without submitting a question', async () => {
  const writeEnabled = vi.fn(); const sent: SendInput[] = [];
  const { root } = await mountReadyChat({ messages: [], sent, document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled } });
  const chrome = root.querySelector('.zcr-chrome-actions');
  const settings = root.querySelector<HTMLButtonElement>('[data-zcr-action="settings"]');
  const menu = root.querySelector<HTMLElement>('[data-zcr-settings-menu]');
  expect(chrome?.contains(settings)).toBe(true);
  expect(settings?.getAttribute('aria-label')).toBe('Settings');
  expect(settings?.textContent?.trim()).toBe('');
  expect(menu?.hasAttribute('hidden')).toBe(true);
  settings?.click();
  expect(menu?.hasAttribute('hidden')).toBe(false);
  const checkbox = menu?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  root.ownerDocument.body.append(root);
  expect(checkbox?.checked).toBe(true); checkbox?.click();
  expect(writeEnabled).toHaveBeenCalledWith(false); expect(sent).toHaveLength(0);
  expect(root.querySelector('[data-zcr-document-context]')?.textContent).toMatch(/off/iu);
});

it('shows local PDF coverage and extraction gaps without claiming transmission or image understanding', async () => {
  const partial = { ...documentA, pages: [documentA.pages[0]!, { ...documentA.pages[1]!, text: '', status: 'empty' as const }] };
  const { root } = await mountReadyChat({ messages: [], document: { prepare: () => Promise.resolve(partial), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {}, needsDisclosure: () => true } });
  await new Promise(resolve => setTimeout(resolve, 5));
  const context = root.querySelector('[data-zcr-document-context]');
  expect(context?.textContent).toContain('1/2'); expect(context?.textContent).toMatch(/no text|empty/iu);
  expect(context?.textContent).toMatch(/not sent/iu); expect(context?.textContent).toMatch(/unknown/iu);
  expect(root.querySelector('[data-zcr-context-disclosure]')?.textContent).toMatch(/PDF text/iu);
});

it('floats the composer as an inset card over the transcript without a hairline split', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const draft = root.querySelector('.zcr-draft');
  const composer = root.querySelector('[data-zcr-composer]');
  expect(draft?.classList.contains('zcr-draft-float')).toBe(true);
  expect(composer).toBeTruthy();
  expect(root.querySelector('[data-zcr-action="attach"]')).toBeNull();
  const css = readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/sidebar.css'), 'utf8');
  expect(css).toMatch(/\.zcr-draft-float[\s\S]{0,200}position:\s*absolute/u);
  expect(css).toMatch(/\.zcr-composer[\s\S]{0,240}box-shadow/u);
  expect(css).not.toMatch(/\.zcr-draft[^{]*\{[^}]*border-top/u);
  expect(css).not.toMatch(/\.zcr-composer[^{]*\{[^}]*border:\s*1px/u);
  expect(css).not.toMatch(/\.zcr-chrome[^{]*\{[^}]*border-bottom/u);
  expect(css).not.toMatch(/#split-view[^{]*\.zcr-dock[^{]*\{[^}]*border-inline-start/u);
  expect(css).toMatch(/--zcr-dock-inset:\s*16px/u);
  expect(css).toMatch(/--zcr-toolbar-button-size:\s*28px/u);
  expect(css).toMatch(/--zcr-toolbar-icon-size:\s*20px/u);
  expect(css).toMatch(/\.zcr-send[^{]*\{[^}]*background:\s*#111/u);
  expect(css).toMatch(/\.zcr-send[^{]*\{[^}]*color:\s*#fff/u);
  expect(css).not.toMatch(/\.zcr-composer:focus-within[^{]*\{[^}]*AccentColor/u);
  expect(css).toMatch(/\.zcr-composer:focus-within[^{]*\{[^}]*outline:\s*none/u);
  expect(css).toMatch(/\.zcr-input:focus(?:-visible)?[^{]*\{[^}]*outline:\s*none/u);
});

it('keeps the composer as one card: textarea, footer chip, and circular arrow send', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const composer = root.querySelector('[data-zcr-composer]');
  const draft = root.querySelector('.zcr-draft');
  const input = root.querySelector('[data-zcr-input]');
  const send = root.querySelector('[data-zcr-action="send"]');
  const picker = root.querySelector('[data-zcr-picker]');
  const bar = root.querySelector('.zcr-composer-bar');
  expect(draft && input && draft.contains(input)).toBe(true);
  expect(composer && send && composer.contains(send)).toBe(true);
  expect(composer && picker && composer.contains(picker)).toBe(true);
  expect(bar && picker && bar.contains(picker)).toBe(true);
  expect(bar && send && bar.contains(send)).toBe(true);
  expect(draft && composer && draft.contains(composer)).toBe(true);
  expect(picker?.textContent).toMatch(/Catalog Default/u);
  expect(send?.classList.contains('zcr-send')).toBe(true);
  expect(root.querySelector('.zcr-footnote')).toBeNull();
  expect(root.getAttribute('aria-label')).toBe('Codex');
  expect(root.querySelectorAll('select')).toHaveLength(0);
});

it('uses icon-only New chat, Copy, and history-row delete actions with accessible names', async () => {
  const { root } = await mountReadyChat({
    messages: [
      { id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?', citations: [citationA], status: 'completed' },
      { id: 'm2', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'It is a definition.', citations: [], status: 'completed' },
    ],
  });
  const fresh = root.querySelector('[data-zcr-action="new-conversation"]');
  expect(fresh?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(fresh?.textContent?.trim()).toBe('');
  const copy = root.querySelector('[data-zcr-action="copy-answer"]');
  expect(copy?.getAttribute('aria-label')).toBe('Copy');
  expect(copy?.textContent?.trim()).toBe('');
  const removeChat = root.querySelector('[data-zcr-history] [data-zcr-action="delete-conversation"]');
  expect(removeChat?.getAttribute('aria-label')).toMatch(/Delete chat/u);
  expect(removeChat?.textContent?.trim()).toBe('');
});

it('hides the More details prompt in the transcript while keeping the citation', async () => {
  const { root } = await mountReadyChat({
    messages: [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings,
      text: 'tell me more about this', citations: [citationA], status: 'completed', action: 'explain',
    }],
  });
  const user = root.querySelector('[data-zcr-message][data-role="user"]');
  expect(user?.textContent).not.toContain('tell me more about this');
  expect(user?.textContent).not.toMatch(/请用中文解释/u);
  expect(root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')?.value).not.toContain('tell me more about this');
  expect(root.querySelector('[data-zcr-action="open-citation"]')).toBeTruthy();
});

it('lists history in a grouped panel by paper title and disambiguates a second chat', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'));
  try {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [{ id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?', citations: [citationA], status: 'completed' }],
    lastSeq: 0, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002', messages: [], createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null, models: [model], error: null,
  };
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { l(structuredClone(runtime)); return () => undefined; },
    refreshAccount: async () => {}, startLogin: () => Promise.reject(new Error()), cancelLogin: async () => {},
    current: () => Promise.resolve(structuredClone(second)), newConversation: () => Promise.reject(new Error()),
    list: () => Promise.resolve([structuredClone(first), structuredClone(second)]), select: () => Promise.reject(new Error()),
    get: () => Promise.resolve(structuredClone(second)), send: () => Promise.reject(new Error()),
    request: () => Promise.resolve({ requestId: 'r1', state: 'completed', replay: false }),
    cancel: () => Promise.reject(new Error()),
    deleteConversation: () => Promise.reject(new Error()),
    diagnostics: vi.fn(() => Promise.resolve({
      pluginVersion: '0.3.0-alpha.1', runtimeVersion: '0.144.1', errorCode: null, requestCount: 0, states: {},
      storageLocation: SHAREABLE_STORAGE_LOCATION,
    })),
    subscribe: () => () => undefined, close: async () => {},
  };
  const presenter = new ConversationPresenter(paperA, 'Synthetic Paper A', {
    ensureStarted: () => Promise.resolve(client), openAuthorization: () => undefined, uuid: () => 'id', now: () => 'now',
  });
  await presenter.activate();
  const doc = documentOf();
  const body = doc.createElement('div');
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  mountChatView(root, presenter);
  const panel = root.querySelector('[data-zcr-history]');
  expect(panel?.querySelector('select')).toBeNull();
  expect(panel?.querySelector('[data-zcr-history-search]')).toBeTruthy();
  expect(panel?.textContent).toMatch(/Today/u);
  const labels = [...root.querySelectorAll('[data-zcr-history] [data-zcr-conversation-id]')].map(node => node.textContent?.trim());
  expect(labels.join('\n')).not.toMatch(/Untitled|What does this mean/u);
  expect(labels.some(label => label?.includes('Synthetic Paper A'))).toBe(true);
  expect(labels.filter(label => label?.includes('Synthetic Paper A')).length).toBe(2);
  expect(labels.some(label => /Synthetic Paper A · 2|Synthetic Paper A · 09:00/u.test(label ?? ''))).toBe(true);
  expect(root.querySelector('[data-zcr-history] [data-zcr-action="delete-conversation"]')).toBeTruthy();
  expect(root.querySelector('[data-zcr-action="pin-conversation"]')).toBeNull();
  } finally { now.mockRestore(); }
});

it('shows pending image thumbnails in the composer and can remove them', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [], draftImages: [imageA] });
  const thumb = root.querySelector('[data-zcr-draft-image]');
  expect(thumb?.querySelector('img')?.getAttribute('src')).toBe(imageA.dataUrl);
  expect(root.querySelector('[data-zcr-action="remove-image"]')?.getAttribute('aria-label')).toMatch(/Remove/u);
  root.querySelector<HTMLButtonElement>('[data-zcr-action="remove-image"]')?.click();
  expect(presenter.snapshot().draft.images).toHaveLength(0);
  expect(root.querySelector('[data-zcr-draft-image]')).toBeNull();
});

it('pastes a clipboard screenshot into the composer and includes it on send', async () => {
  const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent });
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const composer = root.querySelector('[data-zcr-composer]')!;
  const view = root.ownerDocument.defaultView!;
  const file = new view.File([png], 'screenshot.png', { type: 'image/png' });
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      files: [file],
    },
  });
  composer.dispatchEvent(event);
  await vi.waitFor(() => {
    expect(presenter.snapshot().draft.images).toHaveLength(1);
  });
  expect(presenter.snapshot().draft.images).toEqual([{
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  }]);
  expect(root.querySelector('[data-zcr-draft-image] img')?.getAttribute('src')).toBe(TINY_PNG_DATA_URL);
  presenter.setQuestion('图里的符号是什么？');
  await presenter.send();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.images).toEqual([{
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  }]);
});

it('pastes a screenshot from the reader chrome document when Gecko items are empty', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const view = root.ownerDocument.defaultView as unknown as Window & {
    Cc?: unknown;
    Ci?: unknown;
    Services?: unknown;
  };
  const transferable = {
    init() { /* unused */ },
    addDataFlavor() { /* unused */ },
    getTransferData(_flavor: string, data: { value?: unknown }) {
      data.value = { data: String.fromCharCode(...png) };
    },
  };
  view.Ci = { nsIClipboard: { kGlobalClipboard: 1 }, nsITransferable: {}, nsISupportsCString: {} };
  view.Cc = {
    '@mozilla.org/widget/transferable;1': { createInstance: () => transferable },
    '@mozilla.org/widget/clipboard;1': {
      getService: () => ({
        kGlobalClipboard: 1,
        hasDataMatchingFlavors: (list: string[]) => list.includes('image/png') || list.includes('public.png'),
        getData: () => undefined,
      }),
    },
  };
  view.Services = {
    clipboard: {
      kGlobalClipboard: 1,
      hasDataMatchingFlavors: (list: string[]) => list.includes('image/png') || list.includes('public.png'),
      getData: (trans: typeof transferable) => {
        trans.getTransferData = transferable.getTransferData.bind(transferable);
      },
    },
  };
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { items: [], files: [], types: [] },
  });
  root.ownerDocument.dispatchEvent(event);
  await vi.waitFor(() => {
    expect(presenter.snapshot().draft.images).toHaveLength(1);
  });
  expect(presenter.snapshot().draft.images[0]).toEqual({
    id: imageA.id,
    name: 'screenshot.png',
    mime: 'image/png',
    dataUrl: TINY_PNG_DATA_URL,
  });
  expect(root.querySelector('[data-zcr-draft-image] img')?.getAttribute('src')).toBe(TINY_PNG_DATA_URL);
});

it('does not send on Enter while IME composition is active', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const send = vi.spyOn(presenter, 'send');
  const input = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;
  const view = root.ownerDocument.defaultView!;
  input.dispatchEvent(new view.Event('compositionstart', { bubbles: true }));
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(send).not.toHaveBeenCalled();
});

it('keeps dock type at 1 when the open PDF zooms', async () => {
  const readerZoom = { factor: 1, ins: 0, outs: 0, resets: 0 };
  const { root } = await mountReadyChat({ messages: [], readerZoom });
  const input = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;
  const view = root.ownerDocument.defaultView!;
  const zoom = (init: KeyboardEventInit) => input.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  zoom({ key: '=', code: 'Equal', metaKey: true });
  expect(readerZoom.ins).toBe(1);
  expect(root.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
  zoom({ key: '-', code: 'Minus', metaKey: true });
  expect(readerZoom.outs).toBe(1);
  expect(root.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
  zoom({ key: '0', code: 'Digit0', metaKey: true });
  expect(readerZoom.resets).toBe(1);
  expect(root.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
});

it('shows chats as side-by-side pills with an X that deletes after confirm', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002',
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const { root, presenter } = await mountReadyChat({
    messages: [],
    conversations: [first, second],
    confirm: () => true,
  });
  const chrome = root.querySelector('.zcr-chrome')!;
  const pills = [...root.querySelectorAll<HTMLElement>('[data-zcr-chat-pill]')];
  expect(pills).toHaveLength(2);
  expect(chrome.contains(pills[0]!)).toBe(true);
  expect(pills[0]?.dataset.zcrConversationId).toBe(first.id);
  expect(pills[1]?.dataset.zcrConversationId).toBe(second.id);
  expect(pills.some(pill => pill.hasAttribute('data-current'))).toBe(true);
  expect(root.querySelectorAll('.zcr-chrome [data-zcr-action="delete-conversation"]')).toHaveLength(2);
  const css = readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/sidebar.css'), 'utf8');
  expect(css).toMatch(/\.zcr-chat-pills[\s\S]{0,160}flex-direction:\s*row|\.zcr-chat-pills[\s\S]{0,160}display:\s*flex/u);
  const drop = root.querySelector<HTMLButtonElement>(`[data-zcr-chat-pill][data-zcr-conversation-id="${second.id}"] [data-zcr-action="delete-conversation"]`);
  drop?.click();
  await vi.waitFor(() => {
    expect(presenter.snapshot().conversations.map(entry => entry.id)).not.toContain(second.id);
  });
  expect(root.querySelectorAll('[data-zcr-chat-pill]')).toHaveLength(1);
});

it('closes the model popover on Escape and click outside', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const picker = root.querySelector<HTMLButtonElement>('[data-zcr-picker]')!;
  const menu = root.querySelector<HTMLElement>('[data-zcr-picker-menu]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;
  const view = root.ownerDocument.defaultView!;
  picker.click();
  expect(menu.hidden).toBe(false);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  picker.click();
  expect(menu.hidden).toBe(false);
  root.ownerDocument.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
});
