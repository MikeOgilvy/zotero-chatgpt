import { Window as HappyWindow } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { renderAnswer } from '../../../packages/zotero/src/chat/render-answer.ts';
import { linkAnswerSources, UNLOCATED_SOURCE_TEXT, type AnswerSource } from '../../../packages/zotero/src/chat/source-links.ts';
import type { SourceOpenOutcome } from '../../../packages/zotero/src/reader/source-highlight.ts';
import { paperA } from '../../contracts/factories.ts';

const sourceId = '11111111-2222-3333-4444-555555555555';
const otherId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const source = (): AnswerSource => ({ id: sourceId, paper: { ...paperA }, revision: { fingerprint: 'synthetic', size: 200, modifiedAt: 1000, sha256: 'a'.repeat(64) }, pages: [{ pageIndex: 0, pageLabel: 'iv' }, { pageIndex: 7, pageLabel: '8' }] });
const href = (id = sourceId, page: string | number = 0) => `https://zchatgpt.invalid/source/${id}/${page}`;
function setup(markdown: string) {
  const document = new HappyWindow({ url: 'https://test.invalid' }).document as unknown as Document;
  const fragment = renderAnswer(document, markdown); const container = document.createElement('div'); document.body.append(container);
  const external = vi.fn((event: Event) => { event.preventDefault(); }); container.addEventListener('click', external); container.addEventListener('auxclick', external);
  const click = (anchor: HTMLAnchorElement) => { const event = new document.defaultView!.MouseEvent('click', { bubbles: true, cancelable: true }); anchor.dispatchEvent(event); return event; };
  return { document, fragment, container, external, click };
}

it('binds only a supplied source and page, using the frozen page label and preserving the anchor and focus', async () => {
  const { document, fragment, container, external, click } = setup(`[model says page 100](${href()})`); const anchor = fragment.querySelector('a')!;
  const descriptor = source(); const open = vi.fn<(_source: AnswerSource, _page: number, _quote: string | null) => Promise<void>>().mockResolvedValue(undefined);
  linkAnswerSources(fragment, [descriptor], open); container.append(fragment); anchor.focus();
  expect(container.querySelector('a')).toBe(anchor); expect(document.activeElement).toBe(anchor);
  expect(anchor.textContent).toBe('p. iv'); expect(anchor.dataset.zchatgptSource).toBe(sourceId); expect(anchor.dataset.zchatgptPage).toBe('0');
  const event = click(anchor); expect(event.defaultPrevented).toBe(true); expect(external).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith(descriptor, 0, null)); expect(document.activeElement).toBe(anchor);
});

it.each([href(otherId), href(sourceId, 3), href(sourceId, '07'), href(sourceId, '-1'), href(sourceId, '9007199254740992'), `${href()}?next=https://example.com`, `${href()}#p=8`, 'https://zchatgpt.invalid/not-a-source', `https://user@zchatgpt.invalid/source/${sourceId}/0`, `https://zchatgpt.invalid./source/${sourceId}/0`])('blocks unsupported internal references without allowing an external opener: %s', url => {
  const { fragment, container, external, click } = setup(`[fake label](${url})`); const open = vi.fn().mockResolvedValue(undefined);
  linkAnswerSources(fragment, [source()], open); const anchor = fragment.querySelector('a')!; container.append(fragment);
  expect(anchor.hasAttribute('href')).toBe(false); expect(anchor.hasAttribute('data-zchatgpt-source')).toBe(false); expect(anchor.getAttribute('aria-disabled')).toBe('true');
  expect(container.textContent).toContain('This source is not available in this answer.'); const event = click(anchor);
  expect(event.defaultPrevented).toBe(true); expect(open).not.toHaveBeenCalled(); expect(external).not.toHaveBeenCalled();
});

it('leaves ordinary HTTPS links intact and does not infer source authority from supplied data attributes', () => {
  const { fragment, container, external, click } = setup('[ordinary](https://example.com/paper)'); const open = vi.fn().mockResolvedValue(undefined); const anchor = fragment.querySelector('a')!;
  anchor.dataset.zchatgptSource = sourceId; anchor.dataset.zchatgptPage = '0'; linkAnswerSources(fragment, [source()], open); container.append(fragment);
  expect(anchor.getAttribute('href')).toBe('https://example.com/paper'); expect(anchor.textContent).toBe('ordinary'); expect(anchor.hasAttribute('data-zchatgpt-source')).toBe(false);
  click(anchor); expect(open).not.toHaveBeenCalled(); expect(external).toHaveBeenCalledOnce();
});

it('keeps click authority in its closure when DOM attributes or caller-owned sources change later', async () => {
  const { fragment, container, click } = setup(`[page](${href(sourceId, 7)})`); const descriptor = source(); const expected = structuredClone(descriptor); const open = vi.fn().mockResolvedValue(undefined);
  linkAnswerSources(fragment, [descriptor], open); const anchor = fragment.querySelector('a')!; container.append(fragment);
  descriptor.paper.attachmentKey = 'CHANGED1'; descriptor.revision.fingerprint = 'changed'; descriptor.pages[1]!.pageLabel = '999';
  anchor.dataset.zchatgptSource = otherId; anchor.dataset.zchatgptPage = '0'; click(anchor);
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith(expected, 7, null)); expect(anchor.textContent).toBe('p. 8');
  const passed = open.mock.calls[0]![0] as AnswerSource; expect(Object.isFrozen(passed)).toBe(true); expect(Object.isFrozen(passed.paper)).toBe(true); expect(Object.isFrozen(passed.pages)).toBe(true);
});

it('shows a constant nearby failure, keeps focus and catches both async rejection and synchronous throws', async () => {
  for (const sync of [false, true]) {
    const { document, fragment, container, click } = setup(`[page](${href()})`);
    const open = sync ? vi.fn((): Promise<void> => { throw new Error('/private/library/file.pdf'); }) : vi.fn().mockRejectedValue(new Error('/private/library/file.pdf'));
    linkAnswerSources(fragment, [source()], open); const anchor = fragment.querySelector('a')!; container.append(fragment); anchor.focus(); click(anchor);
    await vi.waitFor(() => expect(container.querySelector('[role="status"]')!.textContent).toBe('The source could not be opened. Reopen the PDF and try again.'));
    expect(container.textContent).not.toContain('/private'); expect(document.activeElement).toBe(anchor); expect(anchor.nextElementSibling?.getAttribute('role')).toBe('status');
  }
});

it('opens once with Enter, suppresses alternate navigation and treats labels as text', async () => {
  const { document, fragment, container, external } = setup(`[<b>fake</b>](${href()})`); const descriptor = source(); descriptor.pages[0]!.pageLabel = '<svg onload=alert(1)>iv';
  const open = vi.fn().mockResolvedValue(undefined); linkAnswerSources(fragment, [descriptor], open); const anchor = fragment.querySelector('a')!; container.append(fragment); anchor.focus();
  expect(anchor.textContent).toBe('p. <svg onload=alert(1)>iv'); expect(anchor.querySelector('svg,b,img,script')).toBeNull();
  anchor.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true })); expect(open).not.toHaveBeenCalled();
  const enter = new document.defaultView!.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); anchor.dispatchEvent(enter); expect(enter.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
  for (const type of ['auxclick', 'contextmenu', 'dragstart']) { const event = new document.defaultView!.MouseEvent(type, { bubbles: true, cancelable: true, button: 1 }); anchor.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); }
  expect(external).not.toHaveBeenCalled(); expect(open).toHaveBeenCalledOnce(); expect(anchor.hasAttribute('href')).toBe(false);
});

it('links a resolvable citation when the host sandbox does not expose structuredClone', () => {
  vi.stubGlobal('structuredClone', undefined);
  try {
    const { fragment, container } = setup(`[page](${href()})`);
    const open = vi.fn<(_source: AnswerSource, _page: number) => Promise<void>>().mockResolvedValue(undefined);
    linkAnswerSources(fragment, [source()], open); container.append(fragment);
    const anchor = container.querySelector('a')!;
    expect(container.textContent).toContain('p. iv');
    expect(anchor.dataset.zchatgptSource).toBe(sourceId);
    expect(anchor.dataset.zchatgptPage).toBe('0');
  } finally { vi.unstubAllGlobals(); }
});

it('degrades one malformed source without blanking the rest of the answer', () => {
  const { fragment, container } = setup(`[bad](${href(sourceId, 0)}) [good](${href(otherId, 7)})`);
  const good = { ...source(), id: otherId };
  const hostile = { ...source(), get pages(): AnswerSource['pages'] { throw new Error('/private/library/file.pdf'); } };
  const open = vi.fn().mockResolvedValue(undefined);
  expect(() => linkAnswerSources(fragment, [hostile, good], open)).not.toThrow();
  container.append(fragment);
  const anchors = [...container.querySelectorAll<HTMLAnchorElement>('a')];
  expect(anchors[1]?.dataset.zchatgptSource).toBe(otherId);
  expect(anchors[0]?.hasAttribute('href')).toBe(false);
  expect(container.textContent).not.toContain('/private');
});

it('passes a whitespace-normalized verbatim quote from the link title and stays silent when highlighted', async () => {
  const { fragment, container, click } = setup(`[page](${href()} "the   measured effect was small")`);
  const descriptor = source();
  const open = vi.fn<(_source: AnswerSource, _page: number, _quote: string | null) => Promise<'highlighted'>>().mockResolvedValue('highlighted');
  linkAnswerSources(fragment, [descriptor], open); const anchor = fragment.querySelector('a')!; container.append(fragment); click(anchor);
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith(descriptor, 0, 'the measured effect was small'));
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('reports an unlocatable cited passage honestly instead of fabricating a highlight', async () => {
  const { document, fragment, container, click } = setup(`[page](${href()} "not actually on this page")`);
  const descriptor = source();
  const open = vi.fn<(_source: AnswerSource, _page: number, _quote: string | null) => Promise<SourceOpenOutcome>>().mockResolvedValue('unlocated');
  linkAnswerSources(fragment, [descriptor], open); const anchor = fragment.querySelector('a')!; container.append(fragment); anchor.focus(); click(anchor);
  await vi.waitFor(() => expect(container.querySelector('[role="status"]')!.textContent).toBe(UNLOCATED_SOURCE_TEXT));
  expect(open).toHaveBeenCalledWith(descriptor, 0, 'not actually on this page');
  expect(container.textContent).not.toContain('/private');
  expect(document.activeElement).toBe(anchor);
  // A later successful open clears the honest miss again.
  open.mockResolvedValue('highlighted'); click(anchor);
  await vi.waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
});

it('deduplicates a pending open and safely rebinds a reused fragment against the current source list', async () => {
  const { fragment, click } = setup(`[page](${href()})`); let finish!: () => void; const open = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  linkAnswerSources(fragment, [source()], open); const anchor = fragment.querySelector('a')!; click(anchor); click(anchor); expect(open).toHaveBeenCalledOnce();
  finish(); await Promise.resolve(); await Promise.resolve(); linkAnswerSources(fragment, [], open); click(anchor);
  expect(open).toHaveBeenCalledOnce(); expect(anchor.hasAttribute('data-zchatgpt-source')).toBe(false); expect(fragment.querySelectorAll('[role="status"]')).toHaveLength(1);
});
