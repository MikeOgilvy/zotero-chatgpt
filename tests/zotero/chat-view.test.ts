import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { ConversationPresenter, type DocumentServices } from '../../packages/zotero/src/chat/presenter.ts';
import { documentA } from '../contracts/document-fixture.ts';
import { mountChatView, renderReaderShell } from '../../packages/zotero/src/chat/view.ts';
import { UNLOCATED_SOURCE_TEXT } from '../../packages/zotero/src/chat/source-links.ts';
import type { SourceOpenOutcome } from '../../packages/zotero/src/reader/source-highlight.ts';
import type { ModelOption, ReaderClient, RuntimeSnapshot } from '../../packages/contracts/src/runtime.ts';
import { SHAREABLE_STORAGE_LOCATION, type Citation, type Conversation, type DocumentRevision, type PaperScope, type ReaderEvent, type SendInput } from '../../packages/contracts/src/index.ts';
import { documentSummary } from '../../packages/contracts/src/document.ts';
import { citationA, imageA, paperA, paperB, settings, TINY_PNG_DATA_URL } from '../contracts/factories.ts';

const model: ModelOption = {
  id: 'catalog-default', displayName: 'Catalog Default', isDefault: true,
  supportedReasoningEfforts: [
    { id: 'low', description: '' }, { id: 'medium', description: '' },
    { id: 'high', description: '' }, { id: 'xhigh', description: '' },
  ],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Priority', description: '' }, { id: 'flex', name: 'Flex', description: '' }],
  defaultServiceTier: 'priority',
  inputModalities: ['text', 'image'],
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
  openDocumentPage?: (document: { paper: PaperScope; revision: DocumentRevision }, pageIndex: number, quote?: string | null) => Promise<SourceOpenOutcome | void>;
  openCitation?: (citation: Citation) => Promise<void>;
  copyText?: (text: string) => void;
  openLink?: (url: string) => void;
  usage?: Conversation['usage'];
  requestTiming?: Conversation['requestTiming'];
  activeRequestId?: string | null;
  captureTimers?: boolean;
  rename?: (id: string, title: string) => Promise<Conversation>;
} = {}) {
  let conversation: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: options.activeRequestId ?? null,
    messages: options.messages ?? [{
      id: 'm1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What does this mean?',
      citations: [citationA], status: 'completed',
    }],
    lastSeq: 0, createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
    ...(options.usage ? { usage: options.usage } : {}),
    ...(options.requestTiming ? { requestTiming: options.requestTiming } : {}),
  };
  const runtime: RuntimeSnapshot = {
    revision: 0, runtime: 'ready', account: { state: 'signedIn' }, login: null,
    models: [model], error: null,
  };
  const listed = options.conversations ?? [conversation];
  if (!listed.some(entry => entry.id === conversation.id)) listed.unshift(conversation);
  let onRuntime: (snapshot: RuntimeSnapshot) => void = () => undefined;
  let onEvent: (event: ReaderEvent) => void = () => undefined;
  const client: ReaderClient = {
    snapshot: () => structuredClone(runtime), observe: l => { onRuntime = l; l(structuredClone(runtime)); return () => undefined; },
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
    renameConversation: options.rename ?? ((id, title) => {
      const index = listed.findIndex(entry => entry.id === id);
      if (index < 0) return Promise.reject(new Error('missing conversation'));
      const renamed = { ...listed[index]!, title, titleCustomized: true };
      listed[index] = renamed;
      if (conversation.id === id) conversation = renamed;
      return Promise.resolve(structuredClone(renamed));
    }),
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
    subscribe: listener => { onEvent = listener; return () => undefined; }, close: async () => {},
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
  doc.body.append(body);
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId }, () => undefined);
  const scale = options.textScale ?? { value: 1 };
  const timers = options.captureTimers ? captureIntervalTimers(doc.defaultView as unknown as ViewWindow) : null;
  const teardown = mountChatView(root, presenter, {
    openCitation: options.openCitation ?? (() => Promise.resolve()),
    readTextScale: () => scale.value,
    writeTextScale: value => { scale.value = value; },
    confirm: options.confirm ?? (() => true),
    uuid: options.uuid ?? (() => imageA.id),
    ...(options.copyText ? { copyText: options.copyText } : {}),
    ...(options.openDocumentPage ? { openDocumentPage: options.openDocumentPage } : {}),
    ...(options.openLink ? { openLink: options.openLink } : {}),
    ...(options.readerZoom ? {
      readerZoom: {
        zoomIn: () => { options.readerZoom!.ins += 1; options.readerZoom!.factor = Math.round((options.readerZoom!.factor + 0.25) * 100) / 100; },
        zoomOut: () => { options.readerZoom!.outs += 1; options.readerZoom!.factor = Math.max(0.5, Math.round((options.readerZoom!.factor - 0.25) * 100) / 100); },
        zoomReset: () => { options.readerZoom!.resets += 1; options.readerZoom!.factor = 1; },
        readZoom: () => options.readerZoom!.factor,
      },
    } : {}),
  });
  await Promise.resolve();
  return { root, presenter, scale, client, teardown, timers, emit: (event: ReaderEvent) => onEvent(event), updateRuntime: (patch: Partial<RuntimeSnapshot>) => { Object.assign(runtime, patch); onRuntime(structuredClone(runtime)); } };
}

const assistantMessage = (text: string): Conversation['messages'][number] => ({
  id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed', text,
});

function applySidebarStyles(root: HTMLElement): CSSStyleDeclaration {
  const doc = root.ownerDocument;
  const style = doc.createElement('style');
  style.textContent = readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/sidebar.css'), 'utf8');
  doc.head.append(style);
  return doc.defaultView!.getComputedStyle(root);
}

/**
 * The view schedules its elapsed-time ticker on the happy-dom window, whose timers are bound to
 * `globalThis` when happy-dom loads, so vitest fake timers cannot drive them. Spy on the concrete
 * window instance instead: capture the callbacks and invoke them after moving `Date.now`.
 */
type ViewWindow = {
  setInterval: (handler: () => void, delay?: number) => number;
  clearInterval: (id: number) => void;
};
function captureIntervalTimers(view: ViewWindow) {
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const set = vi.spyOn(view, 'setInterval').mockImplementation(handler => {
    const id = ++next;
    callbacks.set(id, handler);
    return id;
  });
  const clear = vi.spyOn(view, 'clearInterval').mockImplementation(id => { callbacks.delete(id); });
  return { callbacks, restore: () => { clear.mockRestore(); set.mockRestore(); } };
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
  expect(thread.querySelectorAll('[data-zcr-citation]')).toHaveLength(1);
  expect(thread.textContent).not.toContain(citationA.title);
  const chrome = root.querySelector('.zcr-chrome');
  const title = root.querySelector('[data-zcr-current-title]');
  expect(chrome?.contains(title)).toBe(true);
  expect(thread.contains(title)).toBe(false);
  expect(title?.textContent).toBe('Synthetic Paper A');
  expect(title?.getAttribute('title')).toBe('Synthetic Paper A');
  expect(title?.textContent).not.toContain(`Library ${paperA.libraryId}`);
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
it('shows persisted source selections and generated image outputs with a usable preview', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root } = await mountReadyChat({ messages: [
    { id: 'source', requestId: 'r1', role: 'user', phase: null, settings, text: 'Explain', citations: [citationA], status: 'completed', images: [imageA] },
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  expect(root.querySelector('[data-zcr-message="source"] [data-zcr-citation]')).not.toBeNull();
  expect(root.querySelectorAll('[data-zcr-message] [data-zcr-image]')).toHaveLength(2);
  const preview = root.querySelector<HTMLButtonElement>('[data-zcr-message="image-output"] [data-zcr-action="preview-image"]')!;
  preview.click();
  expect(root.querySelector('[data-zcr-image-preview]')?.hasAttribute('hidden')).toBe(false);
});
it('opens a cited answer page through the frozen document navigation and leaves external links to openLink', async () => {
  const openDocumentPage = vi.fn(() => Promise.resolve());
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What is defined?', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `Definition [page](https://zcr.invalid/source/${documentA.id}/1) and [external](https://example.com/paper).` },
    ],
    openDocumentPage, openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zcr-message="a1"] [data-zcr-text]')!;
  const [cited, external] = [...text.querySelectorAll<HTMLAnchorElement>('a')];
  expect(cited?.hasAttribute('href')).toBe(false);
  expect(cited?.textContent).toBe('p. ii');
  expect(cited?.dataset.zcrSource).toBe(documentA.id);
  expect(cited?.dataset.zcrPage).toBe('1');
  cited?.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: documentA.paper, revision: documentA.revision }, 1, null));
  expect(openLink).not.toHaveBeenCalled();
  external?.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(openLink).toHaveBeenCalledWith('https://example.com/paper');
});

it('resolves a citation into a persisted referenced document with that reference paper scope', async () => {
  const referenced = { ...documentSummary(documentA), id: 'bbbbbbbb-0000-4000-8000-000000000002' };
  const openDocumentPage = vi.fn(() => Promise.resolve());
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Compare the supplement.', citations: [], status: 'completed',
        references: [{ id: 'ref-1', kind: 'article', label: 'Supplement', paper: paperB, capturedAt: 'now' }],
        referenceDocuments: [{ referenceId: 'ref-1', document: referenced }] },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `See [page](https://zcr.invalid/source/${referenced.id}/0).` },
    ],
    openDocumentPage,
  });
  const anchor = root.querySelector<HTMLAnchorElement>('[data-zcr-message="a1"] [data-zcr-text] a')!;
  expect(anchor.textContent).toBe('p. i');
  anchor.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: paperB, revision: documentA.revision }, 0, null));
});

it('carries the verbatim link title quote into the frozen page open and reports an honest miss', async () => {
  const openDocumentPage = vi.fn((): Promise<SourceOpenOutcome> => Promise.resolve('unlocated'));
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'What is defined?', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `Definition [page](https://zcr.invalid/source/${documentA.id}/1 "the   exact   words")` },
    ],
    openDocumentPage,
  });
  const anchor = root.querySelector<HTMLAnchorElement>('[data-zcr-message="a1"] [data-zcr-text] a')!;
  anchor.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(openDocumentPage).toHaveBeenCalledWith({ paper: documentA.paper, revision: documentA.revision }, 1, 'the exact words'));
  // The host reported the passage could not be located: the claim is traced but nothing is fabricated.
  await vi.waitFor(() => expect(root.querySelector('[data-zcr-message="a1"] [data-zcr-text] [role="status"]')?.textContent).toBe(UNLOCATED_SOURCE_TEXT));
});

it('degrades an unresolvable answer citation without launching it externally', async () => {
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Q', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: '[page](https://zcr.invalid/source/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/0)' },
    ],
    openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zcr-message="a1"] [data-zcr-text]')!;
  const anchor = text.querySelector<HTMLAnchorElement>('a')!;
  expect(anchor.hasAttribute('href')).toBe(false);
  expect(anchor.getAttribute('aria-disabled')).toBe('true');
  expect(text.textContent).toContain('This source is not available in this answer.');
  const event = new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(openLink).not.toHaveBeenCalled();
});

it('surfaces a constant failure when the frozen source cannot be opened, without launching it', async () => {
  const openDocumentPage = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const openLink = vi.fn();
  const { root } = await mountReadyChat({
    messages: [
      { id: 'u1', requestId: 'r1', role: 'user', phase: null, settings, text: 'Q', citations: [citationA], status: 'completed', document: documentSummary(documentA) },
      { id: 'a1', requestId: 'r1', role: 'assistant', phase: 'final', settings, citations: [], status: 'completed',
        text: `[page](https://zcr.invalid/source/${documentA.id}/0)` },
    ],
    openDocumentPage, openLink,
  });
  const text = root.querySelector<HTMLElement>('[data-zcr-message="a1"] [data-zcr-text]')!;
  text.querySelector<HTMLAnchorElement>('a')!.dispatchEvent(new root.ownerDocument.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(text.querySelector('[role="status"]')?.textContent).toBe('The source could not be opened. Reopen the PDF and try again.'));
  expect(text.textContent).not.toContain('/private');
  expect(openLink).not.toHaveBeenCalled();
});

it('reports a failed view action in a dedicated slot without leaking the raw error', async () => {
  const { root, presenter } = await mountReadyChat();
  vi.spyOn(presenter, 'cancelQueuedRequest').mockRejectedValue(new Error('/private/library/file.pdf'));
  root.querySelector<HTMLButtonElement>('[data-zcr-action="cancel-queued"]')!.click();
  const viewError = root.querySelector<HTMLElement>('[data-zcr-view-error]')!;
  await vi.waitFor(() => expect(viewError.hidden).toBe(false));
  expect(viewError.textContent).toBe('This action could not be completed.');
  expect(root.textContent).not.toContain('/private');
  expect(root.querySelector<HTMLElement>('[role="alert"]:not([data-zcr-view-error])')?.hidden).toBe(true);
});

it('reports a rejected citation open without clobbering the presenter message slot', async () => {
  const openCitation = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const { root } = await mountReadyChat({ draftCitations: [citationA], openCitation });
  root.querySelector<HTMLButtonElement>('[data-zcr-context-source] [data-zcr-action="open-citation"]')!.click();
  await vi.waitFor(() => expect(openCitation).toHaveBeenCalled());
  const viewError = root.querySelector<HTMLElement>('[data-zcr-view-error]')!;
  await vi.waitFor(() => expect(viewError.textContent).toBe('The source could not be opened.'));
  expect(root.textContent).not.toContain('/private');
});

it('routes a rejected draft-citation open through the same dedicated slot', async () => {  const openCitation = vi.fn(() => Promise.reject(new Error('/private/library/file.pdf')));
  const { root } = await mountReadyChat({ draftCitations: [citationA], openCitation });
  root.querySelector<HTMLButtonElement>('[data-zcr-citation] [data-zcr-action="open-citation"]')!.click();
  const viewError = root.querySelector<HTMLElement>('[data-zcr-view-error]')!;
  await vi.waitFor(() => expect(viewError.textContent).toBe('The source could not be opened.'));
  expect(root.textContent).not.toContain('/private');
});

it('announces status through the dedicated live region instead of the whole transcript', async () => {
  const { root } = await mountReadyChat();
  expect(root.querySelector('[data-zcr-messages]')?.hasAttribute('aria-live')).toBe(false);
  expect(root.querySelector('.zcr-status-line')?.getAttribute('role')).toBe('status');
});

it('offers a discoverable copy control for an answer and confirms the copy', async () => {
  const copyText = vi.fn();
  const { root } = await mountReadyChat({ messages: [assistantMessage('先验是初始信念。')], copyText });
  const copy = root.querySelector<HTMLButtonElement>('[data-zcr-action="copy-answer"]')!;
  expect(copy.hidden).toBe(false);
  expect(copy.dataset.zcrCopied).toBeUndefined();
  copy.click();
  expect(copyText).toHaveBeenCalledWith('先验是初始信念。');
  expect(copy.dataset.zcrCopied).toBe('true');
  expect(copy.getAttribute('aria-label')).toBe('Copied');
});

it('offers a copy control for every fenced code block', async () => {
  const copyText = vi.fn();
  const { root } = await mountReadyChat({ messages: [assistantMessage('See:\n\n```ts\nconst x = 1;\n```\n')], copyText });
  const text = root.querySelector<HTMLElement>('[data-zcr-message="a1"] [data-zcr-text]')!;
  const wrapper = text.querySelector<HTMLElement>('.zcr-code-block');
  expect(wrapper?.parentElement).toBe(text);
  const copy = wrapper!.querySelector<HTMLButtonElement>('[data-zcr-action="copy-code"]')!;
  copy.click();
  expect(copyText).toHaveBeenCalledWith('const x = 1;\n');
  expect(copy.dataset.zcrCopied).toBe('true');
});

it('gives every markdown table its own local scroll container', async () => {
  const { root } = await mountReadyChat({ messages: [assistantMessage('| a | b |\n| - | - |\n| 1 | 2 |\n')] });
  const text = root.querySelector<HTMLElement>('[data-zcr-message="a1"] [data-zcr-text]')!;
  const wrapper = text.querySelector<HTMLElement>('.zcr-table-block');
  expect(wrapper?.parentElement).toBe(text);
  expect(wrapper?.firstElementChild?.tagName).toBe('TABLE');
});

it('shows an honest context ring: unfilled and neutral until the runtime reports usage', async () => {
  const { root } = await mountReadyChat();
  const ring = root.querySelector<HTMLElement>('[data-zcr-context-usage]')!;
  // The composer holds no token text at all: the ring is the whole indicator.
  expect(ring.className).toBe('zcr-context-ring');
  expect(ring.textContent).toBe('');
  expect(ring.dataset.zcrContextState).toBe('unknown');
  expect(ring.getAttribute('role')).toBe('status');
  expect(ring.title).toContain('unknown');
  expect(ring.getAttribute('aria-label')).toBe(ring.title);
  expect(ring.querySelector('.zcr-context-ring-fill')!.getAttribute('stroke-dasharray')).toBe('0.00 50.27');
});

it('fills the ring from the last runtime report and keeps the numbers in the tooltip only', async () => {
  const { root } = await mountReadyChat({
    usage: {
      model: 'catalog-default', contextWindow: 128000,
      last: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
      total: { inputTokens: 12345, cachedInputTokens: 0, outputTokens: 300, reasoningOutputTokens: 0, totalTokens: 12645 },
    },
  });
  const ring = root.querySelector<HTMLElement>('[data-zcr-context-usage]')!;
  expect(ring.dataset.zcrContextState).toBe('runtime-reported');
  expect(ring.textContent).toBe('');
  expect(ring.getAttribute('aria-label')).toContain('12,345');
  expect(ring.getAttribute('aria-label')).toContain('128,000');
  expect(ring.getAttribute('aria-label')).toContain('not remaining context.');
  const filled = ring.querySelector('.zcr-context-ring-fill')!.getAttribute('stroke-dasharray')!.split(' ').map(Number);
  expect(filled[1]).toBeCloseTo(50.27, 2);
  expect(filled[0]! / filled[1]!).toBeCloseTo(12345 / 128000, 4);
});

it('counts the wait in whole seconds and refreshes it on each tick', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '11111111-1111-4111-8111-111111111111';
  try {
    const { root, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 3000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const timer = root.querySelector<HTMLElement>('[data-zcr-request-timing]')!;
    const text = root.querySelector<HTMLElement>('[data-zcr-request-timing-text]')!;
    expect(timer.hidden).toBe(false);
    expect(timer.querySelector('svg')).toBeTruthy();
    expect(text.textContent).toBe('Waiting 3s');
    expect(timers!.callbacks.size).toBe(1);
    now.mockReturnValue(base + 2000);
    for (const tick of timers!.callbacks.values()) tick();
    expect(text.textContent).toBe('Waiting 5s');
  } finally { vi.restoreAllMocks(); }
});

it('freezes the wait at the first delivered text instead of counting the stream', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '22222222-2222-4222-8222-222222222222';
  try {
    const { root, emit, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 4000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const text = root.querySelector<HTMLElement>('[data-zcr-request-timing-text]')!;
    expect(text.textContent).toBe('Waiting 4s');
    emit({ seq: 1, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 1000).toISOString(), type: 'delta', messageId: 'a1', text: '答' });
    expect(text.textContent).toBe('Waiting 3s');
    now.mockReturnValue(base + 30000);
    for (const tick of timers!.callbacks.values()) tick();
    expect(text.textContent).toBe('Waiting 3s');
  } finally { vi.restoreAllMocks(); }
});

it('reports the settled answer duration once and stops ticking', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const now = vi.spyOn(Date, 'now').mockReturnValue(base);
  const requestId = '33333333-3333-4333-8333-333333333333';
  try {
    const { root, emit, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 40000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    const text = root.querySelector<HTMLElement>('[data-zcr-request-timing-text]')!;
    expect(text.textContent).toBe('Waiting 40s');
    emit({ seq: 1, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 37000).toISOString(), type: 'delta', messageId: 'a1', text: '答' });
    emit({ seq: 2, conversationId: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', requestId, at: new Date(base - 10000).toISOString(), type: 'completed', messageId: 'a1', finalText: '答' });
    expect(text.textContent).toBe('Answered in 30s');
    expect(timers!.callbacks.size).toBe(0);
    now.mockReturnValue(base + 90000);
    for (const tick of [...timers!.callbacks.values()]) tick();
    expect(text.textContent).toBe('Answered in 30s');
  } finally { vi.restoreAllMocks(); }
});

it('clears the elapsed-time interval on teardown so the view leaks no timer', async () => {
  const base = Date.parse('2026-09-13T00:00:00.000Z');
  const requestId = '44444444-4444-4444-8444-444444444444';
  try {
    const { teardown, timers } = await mountReadyChat({
      captureTimers: true, messages: [], activeRequestId: requestId,
      requestTiming: [{ requestId, acceptedAt: new Date(base - 1000).toISOString(), firstTextAt: null, settledAt: null }],
    });
    expect(timers!.callbacks.size).toBe(1);
    teardown();
    expect(timers!.callbacks.size).toBe(0);
  } finally { vi.restoreAllMocks(); }
});

it('shows an explicit unknown instead of a fabricated duration when timing is missing', async () => {
  const { root } = await mountReadyChat({ messages: [], activeRequestId: '55555555-5555-4555-8555-555555555555' });
  const timer = root.querySelector<HTMLElement>('[data-zcr-request-timing]')!;
  const text = root.querySelector<HTMLElement>('[data-zcr-request-timing-text]')!;
  expect(timer.hidden).toBe(false);
  expect(text.textContent).toBe('Elapsed time unavailable');
  expect(text.textContent).not.toMatch(/\d/u);
});

it('hides the elapsed-time indicator when no request timing exists at all', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  expect(root.querySelector<HTMLElement>('[data-zcr-request-timing]')!.hidden).toBe(true);
});

it('keeps the offline composer editable while preventing model submission', async () => {
  const f = await mountReadyChat(); f.updateRuntime({ runtime: 'error', error: 'Connection ended' });
  expect(f.root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')?.disabled).toBe(false);
  expect(f.root.querySelector<HTMLButtonElement>('[data-zcr-action="send"]')?.disabled).toBe(true);
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
  expect(root.querySelectorAll('[data-zcr-picker-menu] select')).toHaveLength(0);
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
  expect(root.querySelectorAll('[data-zcr-picker-menu] select')).toHaveLength(0);
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

it('keeps an attachment fallback title available in compact chrome without a hero title', async () => {
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
  const title = root.querySelector('[data-zcr-current-title]');
  expect(title?.textContent).toBe('PDF');
  expect(title?.getAttribute('title')).toBe('PDF');
  expect(root.querySelector('h1, h2')).toBeNull();
});

it('keeps title, New chat, and history inside the sidebar pane below the native toolbar', async () => {
  const { root } = await mountReadyChat({ messages: [] });
  const chrome = root.querySelector('.zcr-chrome');
  const historyButton = root.querySelector<HTMLButtonElement>('[data-zcr-action="history"]');
  const panel = root.querySelector<HTMLElement>('[data-zcr-history]');
  const fresh = root.querySelector<HTMLButtonElement>('[data-zcr-action="new-conversation"]');
  const title = root.querySelector('[data-zcr-current-title]');
  expect(root.contains(chrome)).toBe(true);
  expect(chrome?.contains(historyButton)).toBe(true);
  expect(chrome?.contains(fresh)).toBe(true);
  expect(chrome?.contains(title)).toBe(true);
  expect(root.style.getPropertyValue('--zcr-reader-toolbar-height')).toBe('');
  expect(historyButton?.hidden).toBe(false);
  expect(fresh?.hidden).toBe(false);
  expect(fresh?.getAttribute('aria-label')).toMatch(/New chat/u);
  expect(fresh?.textContent?.trim()).toBe('');
  expect(chrome?.textContent).not.toMatch(/New chat/u);
  expect(panel?.tagName).not.toBe('SELECT');
  expect(root.querySelectorAll('[data-zcr-picker-menu] select')).toHaveLength(0);
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

it('leaves the automatic-PDF preference to Zotero Preferences instead of the sidebar', async () => {
  const sent: SendInput[] = [];
  const { root } = await mountReadyChat({ messages: [], sent, document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  const settings = root.querySelector<HTMLButtonElement>('[data-zcr-action="settings"]');
  const menu = root.querySelector<HTMLElement>('[data-zcr-settings-menu]');
  expect(settings?.getAttribute('aria-label')).toBe('More');
  expect(settings?.textContent?.trim()).toBe('');
  settings?.click();
  expect(menu?.hasAttribute('hidden')).toBe(false);
  // The sidebar owns no preference or appearance control: the pane writes the same pref.
  expect(root.querySelector('[data-zcr-automatic-pdf]')).toBeNull();
  expect(menu?.querySelectorAll('[data-zcr-pref^="automatic-pdf"]')).toHaveLength(0);
  expect(menu?.querySelectorAll('input[type="checkbox"], select')).toHaveLength(0);
  expect(menu?.querySelector('[data-zcr-account-usage]')).not.toBeNull();
  expect(sent).toHaveLength(0);
  // The reader still applies the stored opt-out to background preparation without a sidebar control.
  expect(root.querySelector('[data-zcr-document-context]')?.textContent).toMatch(/Current PDF/u);
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

it('keeps the Current PDF panel collapsed while local preparation runs in the background', async () => {
  const prepare = vi.fn(() => Promise.resolve(documentA)); const sent: SendInput[] = [];
  const { root, presenter } = await mountReadyChat({ messages: [], sent, document: { prepare, validate: async () => {}, readEnabled: () => true, writeEnabled: () => {} } });
  const details = root.querySelector<HTMLDetailsElement>('[data-zcr-document-context]')!;
  const disclosure = root.querySelector<HTMLElement>('[data-zcr-context-disclosure]')!;
  // Opening the sidebar prepares the PDF locally with no click and no model request.
  await vi.waitFor(() => expect(prepare).toHaveBeenCalled());
  await vi.waitFor(() => expect(presenter.snapshot().document.phase).toBe('ready'));
  expect(sent).toHaveLength(0);
  // The reader sees one compact summary line, never an expanded block or a pinned consent banner.
  expect(details.open).toBe(false);
  expect(disclosure.hasAttribute('hidden')).toBe(true);
  expect(details.querySelector('summary')?.textContent).toMatch(/Current PDF/u);
});

it('shows the send disclosure only when a request actually needs consent', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [], document: { prepare: () => Promise.resolve(documentA), validate: async () => {}, readEnabled: () => true, writeEnabled: () => {}, needsDisclosure: () => true } });
  const disclosure = root.querySelector<HTMLElement>('[data-zcr-context-disclosure]')!;
  expect(disclosure.hasAttribute('hidden')).toBe(true);
  expect(disclosure.textContent).toMatch(/go to Codex/u);
  // An explain with automatic PDF text on needs consent: the prompt appears with its button.
  await presenter.explain(citationA);
  expect(disclosure.hasAttribute('hidden')).toBe(false);
  expect(disclosure.querySelector<HTMLButtonElement>('button')?.hidden).toBe(false);
});

it('keeps the composer in document flow as its references grow, without reserving a fixed transcript height', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  applySidebarStyles(root);
  const draft = root.querySelector<HTMLElement>('.zcr-draft')!;
  const transcript = root.querySelector<HTMLElement>('.zcr-transcript')!;
  const messages = root.querySelector<HTMLElement>('[data-zcr-messages]')!;
  const styles = (node: HTMLElement) => root.ownerDocument.defaultView!.getComputedStyle(node);
  expect(['absolute', 'fixed']).not.toContain(styles(draft).position);
  expect(draft.previousElementSibling).toBe(transcript);
  expect(styles(messages).paddingBottom).toBe('12px');
  presenter.addCitation(citationA);
  presenter.addImage(imageA);
  expect(draft.querySelectorAll('[data-zcr-citation], [data-zcr-draft-image]')).toHaveLength(2);
  expect(['absolute', 'fixed']).not.toContain(styles(draft).position);
  expect(root.querySelector('[data-zcr-action="attach"]')).toBeNull();
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
  expect(root.querySelectorAll('[data-zcr-picker-menu] select')).toHaveLength(0);
});

it('uses icon-only New chat and history-row delete actions with accessible names', async () => {
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
  // Copy is a labelled chip now: the visible "Copy" text is the discoverability affordance.
  expect(copy?.querySelector('[data-zcr-copy-label]')?.textContent).toBe('Copy');
  const removeChat = root.querySelector('[data-zcr-history] [data-zcr-action="delete-conversation"]');
  expect(removeChat?.getAttribute('aria-label')).toMatch(/Delete chat/u);
  expect(removeChat?.textContent?.trim()).toBe('');
  // History deletion is a cross, not a trash can.
  expect(removeChat?.querySelector('svg path')?.getAttribute('d')).toBe('M4 4l8 8M12 4l-8 8');
});

it('deletes only the current chat from the chrome cross after confirmation, never from More', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002',
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  const { root, presenter } = await mountReadyChat({ messages: [], conversations: [first, second], confirm });
  const chrome = root.querySelector('.zcr-chrome')!;
  const close = chrome.querySelector<HTMLButtonElement>('[data-zcr-action="delete-current-conversation"]')!;
  expect(close.getAttribute('aria-label')).toBe('Delete chat');
  expect(close.textContent?.trim()).toBe('');
  expect(close.querySelector('svg path')?.getAttribute('d')).toBe('M4 4l8 8M12 4l-8 8');
  root.querySelector<HTMLButtonElement>('[data-zcr-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zcr-history] button[data-zcr-conversation-id="${second.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  // More keeps rename only: no destructive action for the current chat.
  root.querySelector<HTMLButtonElement>('[data-zcr-action="settings"]')!.click();
  const menu = root.querySelector<HTMLElement>('[data-zcr-settings-menu]')!;
  expect(menu.querySelector('[data-zcr-action="delete-conversation"], [data-zcr-action="delete-current-conversation"]')).toBeNull();
  expect(menu.querySelector('[data-zcr-action="rename-conversation"]')).not.toBeNull();
  // Cancelling keeps the chat; accepting deletes exactly the current one.
  close.click();
  expect(presenter.snapshot().conversations.map(entry => entry.id)).toContain(second.id);
  close.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversations.map(entry => entry.id)).not.toContain(second.id));
  expect(presenter.snapshot().conversations.map(entry => entry.id)).toContain(first.id);
  expect(chrome.querySelector('[data-zcr-current-title]')?.textContent).toBe('Synthetic Paper A');
  expect(confirm).toHaveBeenCalledWith('Delete this chat? This only removes the local history for this PDF.');
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

it('renames the open chat from the history actions and closes the form on success', async () => {
  const { root, presenter } = await mountReadyChat();
  const rename = root.querySelector<HTMLButtonElement>('[data-zcr-action="rename-conversation"]')!;
  const form = root.querySelector<HTMLElement>('.zcr-rename-form')!;
  expect(form.hidden).toBe(true);
  rename.click();
  expect(form.hidden).toBe(false);
  const input = form.querySelector<HTMLInputElement>('input')!;
  expect(input.value).toBe('Synthetic Paper A');
  input.value = '  先验讨论  ';
  form.querySelector<HTMLButtonElement>('[data-zcr-action="save-conversation-name"]')!.click();
  await vi.waitFor(() => expect(form.hidden).toBe(true));
  expect(presenter.snapshot().conversation?.title).toBe('先验讨论');
});

it('reports a failed rename in the view error slot and keeps the form open', async () => {
  const { root } = await mountReadyChat({ rename: () => Promise.reject(new Error('/Users/somebody/private/state.json missing')) });
  root.querySelector<HTMLButtonElement>('[data-zcr-action="rename-conversation"]')!.click();
  const form = root.querySelector<HTMLElement>('.zcr-rename-form')!;
  form.querySelector<HTMLButtonElement>('[data-zcr-action="save-conversation-name"]')!.click();
  const slot = root.querySelector<HTMLElement>('[data-zcr-view-error]')!;
  await vi.waitFor(() => expect(slot.hidden).toBe(false));
  expect(slot.textContent).not.toContain('/Users/somebody');
  expect(form.hidden).toBe(false);
});


it('keeps the composer free of voice input and third-party chat branding', async () => {
  const { root } = await mountReadyChat();
  const composer = root.querySelector<HTMLElement>('[data-zcr-composer]')!;
  const controls = [...composer.querySelectorAll('button')]
    .map(node => `${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''} ${node.textContent ?? ''}`).join('\n');
  expect(controls).not.toMatch(/voice|microphone|dictate|\bmic\b|ChatGPT/iu);
  expect(composer.querySelector('[data-zcr-input]')?.getAttribute('placeholder')).toBe('Ask a question…');
});


it('keeps the transcript pinned when an answer image finishes loading', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root } = await mountReadyChat({ messages: [
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  const transcript = root.querySelector<HTMLElement>('[data-zcr-messages]')!;
  Object.defineProperty(transcript, 'scrollHeight', { get: () => 1000, configurable: true });
  Object.defineProperty(transcript, 'clientHeight', { get: () => 200, configurable: true });
  transcript.scrollTop = 900;
  transcript.scrollTop = 500;
  transcript.querySelector('img')!.dispatchEvent(new (root.ownerDocument.defaultView!.Event)('load'));
  expect(transcript.scrollTop).toBe(1000);
});

it('leaves the transcript alone when an image loads while the reader is scrolled away', async () => {
  const generated = { ...imageA, origin: { kind: 'generated' as const, model: settings.model } };
  const { root, presenter } = await mountReadyChat({ messages: [
    { id: 'image-output', requestId: 'r1', role: 'assistant', phase: 'final', settings, text: 'A generated explanation', citations: [], status: 'completed', generatedImages: [generated] },
  ] });
  const transcript = root.querySelector<HTMLElement>('[data-zcr-messages]')!;
  Object.defineProperty(transcript, 'scrollHeight', { get: () => 1000, configurable: true });
  Object.defineProperty(transcript, 'clientHeight', { get: () => 200, configurable: true });
  transcript.scrollTop = 100;
  presenter.setQuestion('keep reading');
  transcript.querySelector('img')!.dispatchEvent(new (root.ownerDocument.defaultView!.Event)('load'));
  expect(transcript.scrollTop).toBe(100);
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

it('pastes a screenshot from the reader chrome document only while the composer owns focus', async () => {
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
  root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!.focus();
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

it('shows one current title and keeps the chat switch reachable from history', async () => {
  const first: Conversation = {
    id: '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', paper: paperA, title: 'Synthetic Paper A', settings,
    activeRequestId: null, messages: [], lastSeq: 0,
    createdAt: '2026-09-10T08:00:00.000Z', updatedAt: '2026-09-10T08:00:00.000Z',
  };
  const second: Conversation = {
    ...first, id: 'aaaaaaaa-0000-4000-8000-000000000002',
    createdAt: '2026-09-10T09:00:00.000Z', updatedAt: '2026-09-10T09:00:00.000Z',
  };
  const { root, presenter } = await mountReadyChat({ messages: [], conversations: [first, second] });
  const chrome = root.querySelector('.zcr-chrome')!;
  expect(chrome.querySelectorAll('[data-zcr-current-title]')).toHaveLength(1);
  expect(chrome.querySelector('[data-zcr-current-title]')?.textContent).toBe('Synthetic Paper A');
  expect(chrome.querySelectorAll('[data-zcr-chat-pill], [data-zcr-action="delete-conversation"]')).toHaveLength(0);
  root.querySelector<HTMLButtonElement>('[data-zcr-action="history"]')!.click();
  root.querySelector<HTMLButtonElement>(`[data-zcr-history] button[data-zcr-conversation-id="${second.id}"]`)!.click();
  await vi.waitFor(() => expect(presenter.snapshot().conversation?.id).toBe(second.id));
  expect(chrome.querySelector('[data-zcr-current-title]')?.textContent).toBe('Synthetic Paper A · 2');
});

it('keeps local history reachable when the account signs out and the runtime becomes unavailable', async () => {
  const { root, updateRuntime } = await mountReadyChat();
  updateRuntime({ account: { state: 'signedOut' }, models: [], runtime: 'error' });
  const history = root.querySelector<HTMLButtonElement>('[data-zcr-action="history"]')!;
  expect(history.hidden).toBe(false);
  expect(history.disabled).toBe(false);
  history.click();
  expect(root.querySelector<HTMLElement>('[data-zcr-history]')!.hidden).toBe(false);
  expect(root.querySelector('[data-zcr-history]')!.textContent).toContain('Synthetic Paper A');
});

it('preserves existing message nodes and a persistent unread indicator across unrelated updates', async () => {
  const { root, presenter, emit } = await mountReadyChat();
  const messages = root.querySelector<HTMLElement>('[data-zcr-messages]')!;
  const originalMessage = messages.querySelector('[data-zcr-message="m1"]')!;
  const originalText = originalMessage.querySelector('[data-zcr-text]')!;
  Object.defineProperties(messages, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
  messages.scrollTop = 100;
  const event = { conversationId: presenter.snapshot().conversation!.id, requestId: 'r2', messageId: 'm2', at: '2026-09-12T00:00:00Z' };
  emit({ ...event, seq: 1, type: 'delta', text: 'A new answer' });
  expect(messages.querySelector('[data-zcr-message="m1"]')).toBe(originalMessage);
  expect(originalMessage.querySelector('[data-zcr-text]')).toBe(originalText);
  expect(messages.scrollTop).toBe(100);
  const unread = root.querySelector<HTMLButtonElement>('[data-zcr-action="new-content"]')!;
  expect(unread.hidden).toBe(false);
  presenter.addImage(imageA);
  presenter.setSettings({ ...settings, effort: 'low' });
  expect(unread.hidden).toBe(false);
  expect(messages.scrollTop).toBe(100);
  unread.click();
  expect(unread.hidden).toBe(true);
  expect(messages.scrollTop).toBe(messages.scrollHeight);
  messages.scrollTop = 100;
  emit({ ...event, seq: 2, type: 'delta', text: ' with more detail' });
  expect(unread.hidden).toBe(false);
  messages.scrollTop = 800;
  messages.dispatchEvent(new root.ownerDocument.defaultView!.Event('scroll'));
  expect(unread.hidden).toBe(true);
});

it('does not intercept a screenshot pasted into another editor in the reader document', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const outside = root.ownerDocument.createElement('textarea');
  root.ownerDocument.body.append(outside); outside.focus();
  const png = Uint8Array.from(atob(TINY_PNG_DATA_URL.split(',')[1]!), c => c.charCodeAt(0));
  const file = new view.File([png], 'screenshot.png', { type: 'image/png' });
  const event = new view.Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }], files: [file] } });
  outside.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  await Promise.resolve();
  expect(presenter.snapshot().draft.images).toHaveLength(0);
});

it('navigates model options with the keyboard, returns focus, and ignores Escape during IME composition', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const picker = root.querySelector<HTMLButtonElement>('[data-zcr-picker]')!;
  const menu = root.querySelector<HTMLElement>('[data-zcr-picker-menu]')!;
  const input = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;
  const send = vi.spyOn(presenter, 'send');
  picker.focus();
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(false);
  expect(menu.contains(root.ownerDocument.activeElement)).toBe(true);
  const first = root.ownerDocument.activeElement;
  first!.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  expect(root.ownerDocument.activeElement).not.toBe(first);
  root.ownerDocument.activeElement!.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(picker);
  picker.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  root.querySelector<HTMLButtonElement>('[data-zcr-setting="effort"][data-zcr-value="low"]')!.click();
  expect(presenter.snapshot().draft.settings?.effort).toBe('low');
  expect(menu.hidden).toBe(true);
  expect(root.ownerDocument.activeElement).toBe(picker);
  expect(send).not.toHaveBeenCalled();
  picker.click(); input.focus();
  input.dispatchEvent(new view.Event('compositionstart', { bubbles: true }));
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(false);
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  expect(send).not.toHaveBeenCalled();
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

it('keeps exactly one plus control at the composer start and removes the attach and @ buttons', async () => {
  const { root } = await mountReadyChat();
  const leading = root.querySelector<HTMLElement>('[data-zcr-composer-leading]')!;
  const controls = [...leading.querySelectorAll<HTMLElement>('button, details, summary')];
  expect(controls).toHaveLength(1);
  const plus = controls[0] as HTMLButtonElement;
  expect(plus.dataset.zcrPlus).toBe('');
  expect(plus.dataset.zcrAction).toBe('composer-plus');
  expect(plus.getAttribute('aria-label')).toBe('Add images or context');
  // The old Attach details and the literal '@' trigger are gone, not merely hidden.
  expect(root.querySelector('.zcr-attachment-menu, .zcr-input-actions')).toBeNull();
  expect([...root.querySelectorAll('button')].filter(node => node.textContent?.trim() === '@')).toHaveLength(0);
});

it('opens every attachment route from the plus menu and closes it after a choice', async () => {
  const { root, presenter } = await mountReadyChat({ messages: [] });
  const view = root.ownerDocument.defaultView!;
  const plus = root.querySelector<HTMLButtonElement>('[data-zcr-action="composer-plus"]')!;
  const menuSelector = '[data-zcr-plus-menu]';
  const menu = root.querySelector<HTMLElement>(menuSelector)!;
  expect(menu.hidden).toBe(true);
  expect(plus.getAttribute('aria-expanded')).toBe('false');
  plus.click();
  expect(menu.hidden).toBe(false);
  expect(plus.getAttribute('aria-expanded')).toBe('true');
  const route = (action: string) => [...menu.querySelectorAll<HTMLButtonElement>('button')].find(node => node.dataset.zcrAction === action)!;

  const pick = vi.spyOn(presenter, 'pickImages').mockResolvedValue(undefined);
  route('pick-images').click();
  await vi.waitFor(() => expect(pick).toHaveBeenCalledTimes(1));
  expect(menu.hidden).toBe(true);

  plus.click();
  const region = vi.spyOn(presenter, 'captureRegion').mockResolvedValue(undefined);
  route('capture-region').click();
  await vi.waitFor(() => expect(region).toHaveBeenCalledTimes(1));

  plus.click();
  const page = vi.spyOn(presenter, 'capturePage').mockResolvedValue(undefined);
  menu.querySelector<HTMLInputElement>('input[type="number"]')!.value = '4';
  route('capture-page').click();
  // The page-number input stays one-based for the reader; the presenter takes a zero-based index.
  await vi.waitFor(() => expect(page).toHaveBeenCalledWith(3));

  plus.click();
  plus.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(menu.hidden).toBe(true);
  const input = root.querySelector<HTMLTextAreaElement>('[data-zcr-input]')!;
  input.focus(); plus.click();
  expect(menu.hidden).toBe(false);
  root.ownerDocument.body.dispatchEvent(new view.MouseEvent('click', { bubbles: true }));
  expect(menu.hidden).toBe(true);
});
