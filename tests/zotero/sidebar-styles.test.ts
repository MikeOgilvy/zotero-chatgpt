import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Window } from 'happy-dom';
import { expect, it } from 'vitest';

/**
 * Structural style regressions for the reader sidebar. happy-dom resolves plain
 * longhand values, so assertions stay on geometry/decoration; anything that
 * depends on `var()`/`color-mix()` contrast needs a real host.
 */
function stylesheetDom(): { doc: Document; cs: (node: Element) => CSSStyleDeclaration } {
  const win = new Window({ url: 'https://zcr.test/' });
  const doc = win.document as unknown as Document;
  const style = doc.createElement('style');
  style.textContent = readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/sidebar.css'), 'utf8');
  doc.head.append(style);
  return { doc, cs: node => win.getComputedStyle(node as unknown as Parameters<typeof win.getComputedStyle>[0]) as unknown as CSSStyleDeclaration };
}

const make = (doc: Document) => <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K];
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

it('scales message actions to the 28px control scale instead of a fixed 10px label', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const chat = el('section', 'zcr-chat');
  const message = el('article', 'zcr-message');
  const action = el('button', 'zcr-button zcr-message-action', 'Regenerate in new chat');
  message.append(action); chat.append(message); doc.body.append(chat);
  expect(cs(action).minHeight).toBe('28px');
  expect(cs(action).fontSize).not.toBe('10px');
});

it('gives answer links real link affordances', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const text = el('div', 'zcr-message-text zcr-rendered');
  const link = el('a', '', 'page');
  text.append(link); doc.body.append(text);
  expect(cs(link).textDecorationLine).toBe('underline');
  expect(cs(link).cursor).toBe('pointer');
});

it('renders fenced code with local scrolling and a monospace face', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const text = el('div', 'zcr-message-text zcr-rendered');
  const pre = el('pre'); const code = el('code', '', 'const x = 1;');
  pre.append(code); text.append(pre); doc.body.append(text);
  expect(cs(pre).overflowX).toBe('auto');
  expect(cs(pre).fontFamily).toContain('monospace');
  expect(cs(code).fontFamily).toContain('monospace');
});

it('styles tables and lists as readable prose instead of browser defaults', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const text = el('div', 'zcr-message-text zcr-rendered');
  const table = el('table'); const th = el('th', '', 'a'); const td = el('td', '', '1');
  const row = el('tr'); row.append(th, td); table.append(row);
  const list = el('ul'); list.append(el('li', '', 'one'));
  text.append(table, list); doc.body.append(text);
  expect(cs(table).borderCollapse).toBe('collapse');
  expect(cs(th).borderBottomWidth).toBe('1px');
  expect(cs(td).borderBottomWidth).toBe('1px');
  expect(Number.parseFloat(cs(list).paddingInlineStart)).toBeGreaterThan(0);
});

it('anchors the code copy control to its own block wrapper', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const text = el('div', 'zcr-message-text zcr-rendered');
  const wrapper = el('div', 'zcr-code-block');
  const pre = el('pre'); const copy = el('button', 'zcr-button zcr-code-copy', 'Copy');
  wrapper.append(copy, pre); text.append(wrapper); doc.body.append(text);
  expect(cs(wrapper).position).toBe('relative');
  expect(cs(copy).position).toBe('absolute');
  expect(cs(copy).top).toBe('4px');
});

it('keeps the answer copy chip on the control scale', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const chat = el('section', 'zcr-chat');
  const message = el('article', 'zcr-message');
  const copy = el('button', 'zcr-button zcr-copy-answer', 'Copy');
  message.append(copy); chat.append(message); doc.body.append(chat);
  expect(cs(copy).minHeight).toBe('28px');
  expect(cs(copy).display).toBe('inline-flex');
});

it('keeps the composer a rounded, evenly padded card on the documented scale', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const composer = el('div', 'zcr-composer');
  doc.body.append(composer);
  const box = cs(composer);
  expect(Number.parseFloat(box.paddingTop)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(box.borderTopLeftRadius)).toBeGreaterThanOrEqual(12);
});

it('keeps the draft-image remove control inside its thumbnail bounds', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const chip = el('div', 'zcr-draft-image');
  const remove = el('button', 'zcr-icon-button', 'Remove');
  chip.append(remove); doc.body.append(chip);
  const box = cs(remove);
  expect(box.position).toBe('absolute');
  expect(box.top).toBe('2px');
  expect(box.right).toBe('2px');
  expect(Number.parseFloat(box.width)).toBeGreaterThanOrEqual(18);
});
