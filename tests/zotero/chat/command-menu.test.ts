import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountCommandMenu } from '../../../packages/zotero/src/chat/command-menu.ts';

function setup(choose = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined)) {
  const document = new Window().document as unknown as Document;
  const pane = document.createElement('div');
  pane.dataset.zcrSidebar = '';
  const input = document.createElement('textarea');
  pane.append(input); document.body.append(pane);
  const menu = mountCommandMenu(input, pane, choose);
  const key = (key: string, options: KeyboardEventInit = {}) => input.dispatchEvent(new document.defaultView!.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  return { document, input, menu, key, choose };
}

it('keeps keyboard selection in the composer and consumes Enter before the send handler', async () => {
  const { input, menu, key, choose } = setup();
  const send = vi.fn(); input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); });
  menu.update({ heading: 'References', items: [{ id: 'a', label: 'First paper' }, { id: 'disabled', label: 'Unavailable', disabled: true }, { id: 'b', label: 'Second paper' }] });
  input.focus(); key('ArrowDown');
  expect(menu.element.querySelector('[aria-selected="true"]')?.textContent).toContain('Second paper');
  key('Enter');
  await vi.waitFor(() => expect(choose).toHaveBeenCalledWith('b'));
  expect(send).not.toHaveBeenCalled();
  expect(menu.isOpen()).toBe(false);
  expect(input.ownerDocument.activeElement).toBe(input);
});

it('leaves IME confirmation alone and Escape closes only after composition finishes', () => {
  const { input, menu, key, choose, document } = setup();
  const send = vi.fn(); input.addEventListener('keydown', event => { if (event.key === 'Enter') send(); });
  menu.update({ heading: 'Workflows', items: [{ id: 'one', label: '/derive' }] });
  input.dispatchEvent(new document.defaultView!.Event('compositionstart'));
  expect(key('Enter')).toBe(true); key('Escape');
  expect(choose).not.toHaveBeenCalled(); expect(menu.isOpen()).toBe(true);
  expect(send).not.toHaveBeenCalled();
  input.dispatchEvent(new document.defaultView!.Event('compositionend'));
  key('Enter', { isComposing: true });
  expect(choose).not.toHaveBeenCalled();
  key('Escape'); expect(menu.isOpen()).toBe(false);
});

it('renders untrusted labels as text and does not select the same pending item twice', async () => {
  let release!: () => void;
  const choose = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const { menu, key } = setup(choose);
  menu.update({ heading: 'References', items: [{ id: 'a', label: '<img src=x onerror=alert(1)>', description: '<svg onload=alert(2)>' }] });
  expect(menu.element.querySelector('img, svg')).toBeNull();
  expect(menu.element.textContent).toContain('<svg onload=alert(2)>');
  key('Enter'); key('Enter');
  expect(choose).toHaveBeenCalledTimes(1);
  release(); await vi.waitFor(() => expect(menu.isOpen()).toBe(false));
});

it('keeps failed choices reviewable and removes its listeners on disposal', async () => {
  const { menu, key, choose, input } = setup(vi.fn().mockRejectedValue(new Error('Source changed')));
  menu.update({ heading: 'References', items: [{ id: 'a', label: 'A' }] }); key('Enter');
  await vi.waitFor(() => expect(menu.element.textContent).toContain('Source changed'));
  expect(menu.isOpen()).toBe(true);
  menu.dispose(); key('Enter');
  expect(choose).toHaveBeenCalledTimes(1);
  expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  expect(menu.element.isConnected).toBe(false);
});

it('closes when keyboard focus leaves both the input and its chooser', () => {
  const { menu, input, document } = setup();
  input.focus(); menu.update({ heading: 'References', items: [{ id: 'a', label: 'A' }] });
  const outside = document.createElement('button'); document.body.append(outside); outside.focus();
  expect(menu.isOpen()).toBe(false);
});

it('keeps a references chooser and a commands chooser from rendering each other\'s candidates', () => {
  const { menu } = setup();
  menu.update({ kind: 'commands', heading: 'Installed workflows', items: [{ id: 'skill:derive', label: '/Derive' }, { id: 'reference:paper', label: 'A paper' }] });
  expect(menu.element.dataset.zcrCommandKind).toBe('commands');
  expect(menu.element.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(menu.element.querySelector('[role="option"]')!.textContent).toContain('/Derive');
  // A workflow chooser has no reference-type axis, so its filter row is not usable.
  expect(menu.toolbar.style.display).toBe('none');
  menu.update({ kind: 'references', heading: 'References', items: [{ id: 'reference:paper', label: 'A paper' }, { id: 'skill:derive', label: '/Derive' }] });
  expect(menu.element.dataset.zcrCommandKind).toBe('references');
  expect(menu.element.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(menu.element.querySelector('[role="option"]')!.textContent).toContain('A paper');
  expect(menu.toolbar.style.display).toBe('');
});

it('uses the caller\'s honest empty state for commands and the shared No matches for references', () => {
  const { menu } = setup();
  menu.update({ kind: 'commands', heading: 'Installed workflows', empty: 'No workflows installed.', items: [] });
  expect(menu.element.textContent).toContain('No workflows installed.');
  expect(menu.element.textContent).not.toContain('No matches');
  menu.update({ kind: 'references', heading: 'References', items: [] });
  expect(menu.element.textContent).toContain('No matches');
  expect(menu.element.textContent).not.toContain('No workflows installed.');
});

it('keeps an untyped chooser backward compatible and unstyled by kind', () => {
  const { menu } = setup();
  menu.update({ heading: 'Anything', items: [{ id: 'plain-a', label: 'A' }, { id: 'plain-b', label: 'B' }] });
  expect(menu.element.dataset.zcrCommandKind).toBeUndefined();
  expect(menu.element.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(menu.toolbar.style.display).toBe('');
});

it('settles the status from the newest update so a reopened chooser never keeps a stale Searching label', () => {
  const { menu } = setup();
  menu.update({ heading: 'References', items: [], loading: true });
  expect(menu.element.textContent).toContain('Searching…');
  expect(menu.element.textContent).not.toContain('No matches');
  menu.close();
  expect(menu.isOpen()).toBe(false);
  menu.update({ heading: 'References', items: [{ id: 'a', label: 'A' }] });
  expect(menu.isOpen()).toBe(true);
  expect(menu.element.textContent).not.toContain('Searching…');
  expect(menu.element.textContent).not.toContain('No matches');
  menu.update({ heading: 'References', items: [] });
  expect(menu.element.textContent).toContain('No matches');
});
