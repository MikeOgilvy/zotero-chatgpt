import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountChatView, renderReaderShell, type EmbedClipboardOutcome } from '../../../packages/zotero/src/chat/view.ts';
import type { ConversationPresenter, PresenterState } from '../../../packages/zotero/src/chat/presenter.ts';
import { workspaceDraft } from '../../../packages/zotero/src/chat/draft.ts';
import type { RequestMode } from '../../../packages/contracts/src/index.ts';
import { paperA } from '../../contracts/factories.ts';
import { presenterContext } from '../presenter-context.ts';

/**
 * A presenter only as far as `mountChatView` observes it: state, a render subscription, and the mode
 * control. The real presenter's routing is covered by its own tests; this file is about which
 * surface Chat mode renders when the host hosts the real ChatGPT application.
 */
function stubPresenter(mode: RequestMode = 'chat') {
  const listeners = new Set<(state: PresenterState) => void>();
  const state: PresenterState = {
    connection: 'ready', runtime: null, conversation: null, openConversations: [], newChatOpen: true,
    conversations: [],
    draft: workspaceDraft({ settings: null, paper: paperA, question: '', citations: [], images: [] }),
    pendingExplain: null, message: null, generating: false, mode, chatUnavailable: 'Chat is unavailable in this build. Use Agent mode.',
    focusToken: 0, workspace: null, history: [], historyQuery: '', scrollTop: 0, persistence: 'session',
    tasks: [], readingJobs: [], contextReport: null, queueing: false, messageFocus: null,
    acquisitionTarget: null, collectionOptions: [], document: presenterContext(paperA, 'Synthetic Paper A'),
  };
  const presenter = {
    snapshot: () => state,
    bind: (render: (value: PresenterState) => void) => { listeners.add(render); render(state); return () => { listeners.delete(render); }; },
    setScrollTop: () => undefined,
    setMode(next: RequestMode) { state.mode = next; for (const listener of [...listeners]) listener(state); },
    closeConversation: () => false,
    acknowledgeContext: () => undefined,
    newConversation: () => Promise.resolve(),
    focusInput: () => undefined,
  };
  return presenter as unknown as ConversationPresenter;
}

function mount(mode: RequestMode = 'chat') {
  const doc = new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
  const body = doc.createElement('div');
  doc.body.append(body);
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId });
  const embed = {
    show: vi.fn(), hide: vi.fn(), reload: vi.fn(),
    copyContext: vi.fn<() => Promise<EmbedClipboardOutcome>>(() => Promise.resolve<EmbedClipboardOutcome>({ copied: true, kind: 'document', pages: 2, totalPages: 2, truncated: false })),
    copySelection: vi.fn<() => Promise<EmbedClipboardOutcome>>(() => Promise.resolve<EmbedClipboardOutcome>({ copied: true, kind: 'selection', pageLabel: 'i' })),
    copyPdfFile: vi.fn<() => Promise<EmbedClipboardOutcome>>(() => Promise.resolve<EmbedClipboardOutcome>({ copied: true, kind: 'file' })),
  };
  const presenter = stubPresenter(mode);
  const teardown = mountChatView(root, presenter, { chatEmbed: embed });
  return { root, embed, presenter, teardown };
}

/** The bar's answer line, which is created hidden and shows the outcome of the last clipboard action. */
function statusOf(root: ParentNode): HTMLElement {
  return root.querySelector<HTMLElement>('[data-zchatgpt-embed-status]')!;
}
/** Let the copy action's promise chain settle; the view announces the outcome after it resolves. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

it('renders the hosted application instead of the native chat while Chat mode is selected', () => {
  const { root, embed } = mount('chat');
  const native = root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!;
  const section = root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!;
  const slot = root.querySelector<HTMLElement>('[data-zchatgpt-embed-slot]')!;
  expect(native.hidden).toBe(true);
  expect(section.hidden).toBe(false);
  expect(root.getAttribute('data-zchatgpt-embed-active')).toBe('true');
  // The host is handed the slot, not the whole dock: the mode control stays usable beside it.
  expect(embed.show).toHaveBeenCalledWith(slot);
  expect(embed.hide).not.toHaveBeenCalled();
});

it('never shows the Agent composer, approvals or task surface in hosted Chat mode', () => {
  const { root } = mount('chat');
  const native = root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!;
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  expect(native.hidden).toBe(true);
  // The native chat keeps its DOM (a switch back must not rebuild it) but nothing in it is reachable
  // while Chat is the web application, including the composer that would freeze a Chat request.
  expect(native.contains(composer)).toBe(true);
  // `hidden` on the ancestor is what makes it unreachable: the composer cannot be typed into, so no
  // Chat request can be frozen from this build's (unconfigured) native Chat transport.
  expect(composer.closest('[hidden]')).toBe(native);
  expect(root.dataset.zchatgptEmbedActive).toBe('true');
});

it('keeps exactly one mode control, and moves it to the surface that can use it', () => {
  const { root, presenter, embed } = mount('chat');
  const switches = () => root.querySelectorAll('[data-zchatgpt-mode-switch]');
  expect(switches()).toHaveLength(1);
  expect(root.querySelector('[data-zchatgpt-embed-bar]')!.contains(switches()[0]!)).toBe(true);
  expect(root.querySelector('[data-zchatgpt-composer-leading]')!.contains(switches()[0]!)).toBe(false);
  (root.querySelector('[data-zchatgpt-action="mode-agent"]') as HTMLButtonElement).click();
  expect(presenter.snapshot().mode).toBe('agent');
  // Agent mode is the native surface again: the same control, back with the composer it belongs to.
  expect(switches()).toHaveLength(1);
  expect(root.querySelector('[data-zchatgpt-composer-leading]')!.contains(switches()[0]!)).toBe(true);
  expect(root.querySelector('[data-zchatgpt-embed]')!.hasAttribute('hidden')).toBe(true);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(false);
  expect(embed.hide).toHaveBeenCalled();
  (root.querySelector('[data-zchatgpt-action="mode-chat"]') as HTMLButtonElement).click();
  expect(root.querySelector('[data-zchatgpt-embed]')!.hasAttribute('hidden')).toBe(false);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(true);
  expect(embed.show).toHaveBeenCalledTimes(2);
});

it('reloads the hosted application from the dock chrome without leaving Chat mode', () => {
  const { root, embed, presenter } = mount('chat');
  (root.querySelector('[data-zchatgpt-action="reload-chat"]') as HTMLButtonElement).click();
  expect(embed.reload).toHaveBeenCalledTimes(1);
  expect(presenter.snapshot().mode).toBe('chat');
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!.hidden).toBe(false);
});

it('offers both context copy controls and says the text is on the clipboard, not that it was sent', async () => {
  const { root, embed } = mount('chat');
  const bar = root.querySelector<HTMLElement>('[data-zchatgpt-embed-bar]')!;
  const copyContext = bar.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-context"]')!;
  const copySelection = bar.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-selection"]')!;
  // The controls the web application cannot provide are the only ones this bar adds, and the status
  // line starts empty rather than claiming anything happened.
  expect(statusOf(root).hidden).toBe(true);
  copyContext.click();
  await settle();
  expect(embed.copyContext).toHaveBeenCalledTimes(1);
  expect(statusOf(root).hidden).toBe(false);
  expect(statusOf(root).textContent).toBe('Copied 2 of 2 pages — paste into ChatGPT.');
  copySelection.click();
  await settle();
  expect(embed.copySelection).toHaveBeenCalledTimes(1);
  expect(statusOf(root).textContent).toBe('Copied the selection from page i — paste into ChatGPT.');
});

it('hands the real PDF file to the clipboard for the application\'s own paste-to-attach path', async () => {
  const { root, embed } = mount('chat');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-pdf-file"]')!.click();
  await settle();
  expect(embed.copyPdfFile).toHaveBeenCalledTimes(1);
  // The bar says the file is on the clipboard, not that the application received it: pasting is the
  // owner's step and the upload runs inside ChatGPT's own composer.
  expect(statusOf(root).textContent).toBe('The PDF file is on your clipboard — paste it into ChatGPT to attach it.');
  embed.copyPdfFile.mockResolvedValueOnce({ copied: false, reason: 'no-file' });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-pdf-file"]')!.click();
  await settle();
  expect(statusOf(root).textContent).toBe('This attachment has no local PDF file to copy.');
});

it('clears the previous answer while a new action is still running', async () => {
  const { root, embed } = mount('chat');
  let resolveFile!: (outcome: EmbedClipboardOutcome) => void;
  embed.copyPdfFile.mockImplementationOnce(() => new Promise<EmbedClipboardOutcome>(resolve => { resolveFile = resolve; }));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-pdf-file"]')!.click();
  await settle();
  // A stale "Copied 2 of 2 pages" next to a control the owner just pressed would be a false claim
  // about this action, so the line is empty until this action has its own answer.
  expect(statusOf(root).hidden).toBe(true);
  expect(statusOf(root).textContent).toBe('');
  resolveFile({ copied: true, kind: 'file' });
  await settle();
  expect(statusOf(root).hidden).toBe(false);
  expect(statusOf(root).textContent).toBe('The PDF file is on your clipboard — paste it into ChatGPT to attach it.');
});

it('reports the honest reason when there is nothing to copy', async () => {
  const { root, embed } = mount('chat');
  embed.copyContext.mockResolvedValueOnce({ copied: false, reason: 'no-text' });
  embed.copySelection.mockResolvedValueOnce({ copied: false, reason: 'no-selection' });
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-context"]')!.click();
  await settle();
  expect(statusOf(root).textContent).toBe('No text was read from this PDF, so there is nothing to copy.');
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-selection"]')!.click();
  await settle();
  expect(statusOf(root).textContent).toBe('Select text in the PDF first, then copy it here.');
  embed.copyContext.mockRejectedValueOnce(new Error('unavailable'));
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-context"]')!.click();
  await settle();
  expect(statusOf(root).textContent).toBe('The paper context could not be prepared.');
});

it('carries the same copy controls into Agent mode without acting on them there', () => {
  const { root, embed } = mount('agent');
  // The embed bar belongs to the hosted Chat surface, so it is out of the way while Agent runs.
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!.hidden).toBe(true);
  expect(embed.copyContext).not.toHaveBeenCalled();
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(false);
});

it('stops painting the hosted surface when the view is torn down', () => {
  const { embed, teardown } = mount('chat');
  embed.show.mockClear();
  teardown();
  expect(embed.hide).toHaveBeenCalledTimes(1);
  expect(embed.show).not.toHaveBeenCalled();
});
