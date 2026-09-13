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

/** Read one shipped rule so a structural style contract can be asserted without a real host. */
function shippedRule(doc: Document, selector: string): CSSStyleDeclaration {
  for (const sheet of [...doc.styleSheets]) {
    for (const node of [...sheet.cssRules] as Array<{ selectorText?: string; style?: CSSStyleDeclaration }>) {
      if (node.selectorText === selector && node.style) return node.style;
    }
  }
  throw new Error(`Missing rule ${selector}`);
}
/** The shipped stylesheet text: happy-dom drops declarations it cannot parse (for example AccentColor). */
function shippedCss(): string {
  return readFileSync(resolve(import.meta.dirname, '../../packages/zotero/assets/sidebar.css'), 'utf8');
}

it('keeps composer focus neutral instead of painting an accent-colored selection bar', () => {
  const { doc, cs } = stylesheetDom();
  const composer = make(doc)('div', 'zcr-composer');
  doc.body.append(composer);
  // The resting card owns the border; focus must not add a colored outline anywhere.
  expect(cs(composer).outlineStyle === '' || cs(composer).outlineStyle === 'none').toBe(true);
  const focused = shippedRule(doc, '.zcr-composer:focus-within');
  expect(focused.cssText).not.toContain('outline');
  // The focus cue is a neutral border/ring, never the platform accent color.
  expect(focused.boxShadow).not.toBe('');
  const css = shippedCss();
  expect(css).toMatch(/\.zcr-composer:focus-within\s*\{[^}]*border-color:[^}]*\}/u);
  expect(css).not.toMatch(/\.zcr-composer:focus-within\s*\{[^}]*outline/u);
});

it('gives the dock resizer a visible keyboard focus ring with a negative offset', () => {
  const { doc } = stylesheetDom();
  // happy-dom drops `outline: 2px solid AccentColor`, so the shipped declaration is asserted directly.
  expect(shippedCss()).toMatch(/\.zcr-dock-resizer:focus-visible\s*\{\s*outline:\s*2px solid AccentColor;\s*outline-offset:\s*-2px;\s*\}/u);
  expect(shippedRule(doc, '.zcr-dock-resizer:focus-visible').outlineOffset).toBe('-2px');
});

it('keeps the unknown context ring a solid neutral band instead of hiding the fill', () => {
  const { doc } = stylesheetDom();
  const unknown = shippedRule(doc, '.zcr-context-ring[data-zcr-context-state="unknown"]');
  // A neutral/secondary tone, so the complete ring reads as a state rather than an empty slot.
  expect(unknown.color).not.toBe('');
  // Regression guard: the unknown state must never blank the fill stroke back to an empty ring.
  expect(shippedCss()).not.toMatch(/\[data-zcr-context-state="unknown"\][^{}]*\.zcr-context-ring-fill\s*\{[^}]*stroke:\s*transparent/u);
});

it('bounds the history list so the popover scrolls inside the dock', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const panel = el('div', 'zcr-history-panel');
  const list = el('div', 'zcr-history-list');
  panel.append(list); doc.body.append(panel);
  // The list owns the only scrollbar and is bounded by the dock-sized panel.
  expect(cs(list).overflowY).toBe('auto');
  expect(cs(list).maxHeight).not.toBe('');
  expect(cs(panel).maxHeight).not.toBe('');
});

it('separates history groups with hairlines and keeps roomy single-line rows', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const list = el('div', 'zcr-history-list');
  const first = el('div', 'zcr-history-group');
  const second = el('div', 'zcr-history-group');
  const heading = el('div', 'zcr-history-heading', 'Yesterday');
  const row = el('div', 'zcr-history-row');
  const item = el('button', 'zcr-history-item');
  const title = el('span', 'zcr-history-title', 'A chat');
  item.append(title); row.append(item); second.append(heading, row);
  list.append(first, second); doc.body.append(list);
  // The first section sits under the search field without a rule; later sections get a hairline.
  expect(cs(first).borderTopWidth).toBe('0px');
  expect(cs(second).borderTopWidth).toBe('1px');
  // Small and muted: the heading uses the secondary fill token, not a hardcoded color.
  expect(shippedRule(doc, '.zcr-history-heading').color).toContain('var(--fill-secondary');
  expect(Number.parseFloat(cs(item).minHeight)).toBeGreaterThanOrEqual(28);
  expect(cs(row).borderTopLeftRadius).not.toBe('');
  // Single-line rows truncate the title rather than wrapping into a second line.
  expect(cs(title).whiteSpace).toBe('nowrap');
  expect(cs(title).textOverflow).toBe('ellipsis');
});

it('gives history rows a neutral keyboard focus ring instead of the accent outline', () => {
  const { doc } = stylesheetDom();
  const focused = shippedRule(doc, '.zcr-history-item:focus-visible');
  expect(focused.outlineWidth).toBe('2px');
  expect(focused.outlineStyle).toBe('solid');
  expect(focused.outlineColor).not.toContain('AccentColor');
  expect(shippedCss()).not.toMatch(/\.zcr-history-item:focus-visible\s*\{[^}]*AccentColor/u);
});

it('keeps history copy and rows on the chat text scale', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const sidebar = el('div', 'zcr-sidebar');
  sidebar.style.setProperty('--zcr-chat-text-scale', '1.5');
  const item = el('button', 'zcr-history-item');
  const heading = el('div', 'zcr-history-heading', 'Today');
  sidebar.append(item, heading); doc.body.append(sidebar);
  expect(cs(item).fontSize).toBe('calc(13px * 1.5)');
  expect(cs(heading).fontSize).toBe('calc(11px * 1.5)');
});
