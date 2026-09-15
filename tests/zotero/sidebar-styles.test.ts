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

it('bounds the history list so the popover scrolls inside the dock', () => {  const { doc, cs } = stylesheetDom();
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

it('shapes the current chat title as a rounded neutral chip with a small close cross', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const chrome = el('div', 'zcr-chrome');
  const chip = el('div', 'zcr-chrome-main');
  chip.setAttribute('data-zcr-chat-pill', '');
  const title = el('button', 'zcr-current-title', 'A very long conversation name that must truncate');
  const close = el('button', 'zcr-current-close');
  close.setAttribute('aria-label', 'Close chat');
  chip.append(title, close); chrome.append(chip); doc.body.append(chrome);
  // The chip is fully rounded and its fill comes from the shared palette, not a hardcoded color.
  expect(Number.parseFloat(cs(chip).borderTopLeftRadius)).toBeGreaterThanOrEqual(999);
  expect(shippedCss()).toMatch(/\.zcr-chrome-main\[data-zcr-chat-pill\]\s*\{[^}]*var\(--fill-quinary/u);
  // The title truncates inside the chip instead of pushing the cross out of the row.
  expect(cs(title).whiteSpace).toBe('nowrap');
  expect(cs(title).textOverflow).toBe('ellipsis');
  // It is a control now, so it carries no default button chrome and reads as clickable.
  expect(cs(title).borderTopWidth).toBe('0px');
  expect(cs(title).cursor).toBe('pointer');
  // The cross is a compact control, not a full toolbar button.
  expect(cs(close).width).toBe('18px');
  expect(cs(close).borderTopLeftRadius).toBe('999px');
  // A neutral keyboard ring, never the accent outline the owner rejected.
  const focused = shippedRule(doc, '.zcr-current-close:focus-visible');
  expect(focused.outlineWidth).toBe('2px');
  expect(focused.outlineStyle).toBe('solid');
  expect(focused.outlineColor).not.toContain('AccentColor');
  expect(shippedCss()).not.toMatch(/\.zcr-current-close:focus-visible\s*\{[^}]*AccentColor/u);
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

it('keeps a visible keyboard ring on the composer context controls that remain', () => {
  // The per-chat research-profile select is gone from the composer row; the reference and workflow
  // chips that stay there must keep a real focus ring. happy-dom drops AccentColor declarations, so
  // the shipped declaration is asserted directly, as the other ring guards in this file do.
  expect(shippedCss()).toMatch(/\.zcr-workspace-control:focus-visible\s*\{[^}]*outline:\s*2px solid\b/u);
});

it('paints the send control from the primary theme token, never the accent color', () => {
  const { doc } = stylesheetDom();
  const send = shippedRule(doc, '.zcr-send');
  expect(send.cssText).toContain('var(--fill-primary');
  expect(send.cssText).not.toContain('AccentColor');
  // The disabled control keeps the same fill and dims through opacity, not transparency.
  const css = shippedCss();
  expect(css).toMatch(/\.zcr-send:disabled\s*\{[^}]*var\(--fill-primary[^}]*opacity:\s*\.?35\b/u);
  expect(css).not.toMatch(/\.zcr-send:disabled\s*\{[^}]*transparent/u);
  // Hover only shifts opacity; it never swaps the fill back to the accent color.
  expect(shippedRule(doc, '.zcr-send:hover').cssText).not.toContain('AccentColor');
  expect(css).not.toMatch(/\.zcr-send[^{},]*\{[^}]*AccentColor/u);
});

it('styles the user bubble with theme tokens and rounded corners instead of a raw black', () => {
  const { doc } = stylesheetDom();
  const css = shippedCss();
  const bubble = shippedRule(doc, '.zcr-message[data-role="user"] .zcr-message-text');
  expect(bubble.cssText).toContain('var(--fill-primary');
  expect(bubble.cssText).toContain('var(--material-background');
  expect(Number.parseFloat(bubble.borderRadius)).toBeGreaterThanOrEqual(16);
  // The bubble hugs the message side at a bounded width instead of stretching the column.
  expect(css).toMatch(/\.zcr-message\[data-role="user"\]\s+\.zcr-message-body\s*\{[^}]*align-self:\s*flex-end/u);
  expect(css).toMatch(/\.zcr-message\[data-role="user"\]\s+\.zcr-message-body\s*\{[^}]*max-width:\s*min\(92%/u);
  // No raw hex in the bubble rules: a hardcoded black would break the dark theme.
  expect(css).not.toMatch(/\.zcr-message\[data-role="user"\][^{]*\{[^}]*#[0-9a-fA-F]{3,8}/u);
});

it('makes every composer popover an opaque, shadowed surface stacked above the transcript', () => {
  const { doc } = stylesheetDom();
  const css = shippedCss();
  // happy-dom drops the `var()`/`Canvas` background declarations, so read the shipped block text.
  const block = (selector: string) => new RegExp(`${selector.replace(/\./gu, '\\.')}\\s*\\{([^}]*)\\}`, 'u').exec(css)?.[1] ?? '';
  for (const selector of ['.zcr-plus-menu', '.zcr-picker-menu', '.zcr-command-menu', '.zcr-context-details']) {
    const rule = shippedRule(doc, selector);
    // A see-through popover is the reported defect: the surface must carry the material token and
    // it must not be transparent anywhere.
    const surface = block(selector);
    expect(surface, `${selector} keeps the material token`).toContain('var(--material-menu');
    expect(surface.toLowerCase()).not.toContain('background: transparent');
    expect(rule.cssText).toContain('box-shadow');
    const z = /z-index:\s*(\d+)/u.exec(rule.cssText);
    expect(z, `${selector} declares a z-index`).not.toBeNull();
    expect(Number.parseInt(z![1]!, 10)).toBeGreaterThanOrEqual(20);
    // The material token is translucent in the host theme, so the material alone is not enough:
    // an opaque Canvas base underneath is what actually stops the transcript reading through.
    expect(surface, `${selector} paints over an opaque base`).toMatch(/background-color:\s*Canvas/u);
    expect(surface, `${selector} layers the material over that base`).toMatch(/background-image:\s*linear-gradient\(var\(--material-menu/u);
  }
  // The composer itself owns a layer above the transcript so nothing bleeds through it. It also must
  // not clip: the ring's disclosure is anchored above the card and would be cut off by an overflow.
  const draft = shippedRule(doc, '.zcr-draft');
  expect(Number.parseInt(draft.zIndex, 10)).toBeGreaterThanOrEqual(1);
  expect(css).not.toMatch(/\.zcr-composer\s*\{[^}]*overflow/u);
});

it('no longer carries bridge rules for the labelled header or the flat plus rows', () => {
  const css = shippedCss();
  // The paired DOM patches landed, so these selectors can never match again: `messageNode` emits no
  // author header and the plus popover emits only `.zcr-plus-row` groups.
  expect(css).not.toMatch(/\.zcr-message-header\b/u);
  expect(css).not.toMatch(/\.zcr-message-author\b/u);
  expect(css).not.toMatch(/\.zcr-plus-menu\s*>\s*\.zcr-button/u);
});

it('shapes the plus popover as a grouped, hairline-separated list with title and description rows', () => {
  const { doc } = stylesheetDom();
  const css = shippedCss();
  expect(css).toMatch(/\.zcr-plus-menu\s*\{[^}]*min-width:\s*240px/u);
  expect(css).toMatch(/\.zcr-plus-menu\s*\{[^}]*max-width:\s*min\(320px/u);
  expect(css).toMatch(/\.zcr-plus-menu\s*\{[^}]*padding:\s*4px/u);
  expect(css).toMatch(/\.zcr-plus-menu\s*\{[^}]*border-radius:\s*10px/u);
  // Groups are separated by a hairline; the first group must not draw a rule above itself.
  expect(css).toMatch(/\.zcr-plus-group\s*\+\s*\.zcr-plus-group\s*\{[^}]*border-top:\s*1px solid/u);
  const row = shippedRule(doc, '.zcr-plus-row');
  expect(row.cssText).toContain('padding: 7px 12px');
  expect(row.cssText).toContain('border-radius: 6px');
  expect(row.cssText).toContain('text-align: left');
  expect(css).toMatch(/\.zcr-plus-row:hover,\s*\.zcr-plus-row:focus-visible\s*\{[^}]*var\(--fill-quinary/u);
  expect(shippedRule(doc, '.zcr-plus-heading').cssText).toContain('var(--fill-secondary');
  expect(shippedRule(doc, '.zcr-plus-row-description').cssText).toContain('var(--fill-secondary');
});

it('pushes the chrome actions to the row end even when the open chat makes the title hug its chip', () => {
  const { doc } = stylesheetDom();
  // A `+` that sits next to the title instead of the row's right edge is the reported defect: with a
  // chat open the title chip stops growing, so it no longer absorbs the free space and the actions
  // would otherwise be laid out immediately after the chip.
  expect(shippedRule(doc, '.zcr-chrome-main[data-zcr-chat-pill]').flexGrow).toBe('0');
  const actions = shippedRule(doc, '.zcr-chrome-actions');
  expect(actions.marginInlineStart).toBe('auto');
  // The action group keeps its intrinsic size; the auto margin is what moves it, not a stretch.
  expect(actions.flexGrow).toBe('0');
  expect(actions.flexShrink).toBe('0');
});

it('floats the rename popover under the chrome with the opaque menu treatment', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const chat = el('section', 'zcr-chat');
  const form = el('div', 'zcr-rename-form');
  const field = el('input');
  form.append(field); chat.append(form); doc.body.append(chat);
  // It is a popover, not an inline row: renaming hangs off the title without pushing the transcript.
  expect(cs(form).position).toBe('absolute');
  const rule = shippedRule(doc, '.zcr-rename-form');
  // It hangs below the toolbar row rather than over it, so the title stays visible while renaming.
  expect(rule.cssText).toContain('--zcr-toolbar-button-size');
  expect(rule.cssText).toContain('var(--zcr-border');
  // happy-dom drops the gradient, so the opaque menu base is pinned in the shipped text.
  expect(shippedCss()).toMatch(/\.zcr-rename-form\s*\{[^}]*var\(--material-menu/u);
  // The field takes the remaining width so a long title stays editable in a narrow dock.
  expect(Number.parseFloat(cs(field).flexGrow)).toBeGreaterThan(0);
  // The menu it replaced is gone, not merely hidden.
  expect(shippedCss()).not.toMatch(/\.zcr-settings-menu/u);
  expect(shippedCss()).not.toMatch(/\.zcr-conversation-actions/u);
});

it('lays out the composer leading row so the plus and the capture-region shortcut share it', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const leading = el('div', 'zcr-composer-leading');
  const plus = el('button', 'zcr-icon-button zcr-plus');
  const region = el('button', 'zcr-icon-button zcr-capture-region');
  leading.append(plus, region); doc.body.append(leading);
  // One non-wrapping flex row: the second control must not wrap under the plus in a narrow dock.
  expect(cs(leading).display).toBe('flex');
  // `flex-wrap` is unset, whose initial value is `nowrap`; wrapping must never be opted into.
  expect(cs(leading).flexWrap === '' || cs(leading).flexWrap === 'nowrap').toBe(true);
  expect(shippedCss()).not.toMatch(/\.zcr-composer-leading\s*\{[^}]*flex-wrap:\s*wrap/u);
  expect(Number.parseFloat(cs(leading).gap)).toBeGreaterThan(0);
  // Both keep the same 28px toolbar box, so the shortcut cannot squeeze the primary control.
  expect(cs(plus).width).toBe(cs(region).width);
  expect(Number.parseFloat(cs(region).width)).toBeGreaterThanOrEqual(28);
});

it('reveals message actions with opacity alone so they stay keyboard reachable', () => {
  const { doc } = stylesheetDom();
  const css = shippedCss();
  const actions = shippedRule(doc, '.zcr-message-actions');
  expect(actions.cssText).toContain('opacity: 0');
  expect(actions.cssText).toContain('display: flex');
  expect(css).toMatch(/\.zcr-message:hover\s+\.zcr-message-actions,\s*\.zcr-message:focus-within\s+\.zcr-message-actions\s*\{[^}]*opacity:\s*1/u);
  // display/visibility would drop the buttons from the tab order, so they must never be used here.
  expect(css).not.toMatch(/\.zcr-message-actions[^{},]*\{[^}]*(display:\s*none|visibility:\s*hidden)/u);
});

it('uses neutral secondary-token rings on the transcript and popover controls', () => {
  const { doc } = stylesheetDom();
  const css = shippedCss();
  for (const selector of ['.zcr-icon-button:focus-visible', '.zcr-plus-row:focus-visible', '.zcr-send:focus-visible', '.zcr-picker-option:focus-visible']) {
    expect(shippedRule(doc, selector).cssText).toContain('var(--fill-secondary');
  }
  expect(css).not.toMatch(/\.zcr-send:focus-visible\s*\{[^}]*AccentColor/u);
  expect(css).not.toMatch(/\.zcr-plus-menu\s+:focus-visible\s*\{[^}]*AccentColor/u);
});

it('scrolls the open-chat strip inside the dock and rings its chips neutrally', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const strip = el('div', 'zcr-panes');
  const tab = el('button', 'zcr-pane-tab', 'A chat');
  const current = el('button', 'zcr-pane-tab', 'Current chat');
  current.setAttribute('aria-selected', 'true');
  strip.append(tab, current); doc.body.append(strip);
  // A narrow dock scrolls the chips inside the strip instead of pushing them past the edge.
  expect(cs(strip).overflowX).toBe('auto');
  expect(cs(strip).flexWrap === '' || cs(strip).flexWrap === 'nowrap').toBe(true);
  // A long chat name truncates in place rather than widening the row past the dock.
  expect(cs(tab).whiteSpace).toBe('nowrap');
  expect(cs(tab).textOverflow).toBe('ellipsis');
  // The chat on screen is marked with the shared neutral fill, and the keyboard ring is neutral too.
  expect(shippedRule(doc, '.zcr-pane-tab[aria-selected="true"]').cssText).toContain('var(--fill-quaternary');
  expect(shippedRule(doc, '.zcr-pane-tab:focus-visible').outlineColor).not.toContain('AccentColor');
  expect(shippedCss()).not.toMatch(/\.zcr-pane-tab[^{},]*\{[^}]*AccentColor/u);
  // The chips ride the chat text scale like the rest of the chrome, independently of the PDF.
  const sidebar = el('div', 'zcr-sidebar');
  sidebar.style.setProperty('--zcr-chat-text-scale', '1.5');
  const scaled = el('button', 'zcr-pane-tab', 'A chat');
  sidebar.append(scaled); doc.body.append(sidebar);
  expect(cs(scaled).fontSize).toBe('calc(11px * 1.5)');
});

it('lays the two chat columns side by side and separates them with a hairline', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const columns = el('div', 'zcr-columns');
  columns.setAttribute('data-zcr-columns', 'two');
  const main = el('div', 'zcr-chat-main');
  const preview = el('section', 'zcr-pane-preview');
  const header = el('div', 'zcr-pane-preview-header');
  const title = el('span', 'zcr-pane-preview-title', 'A long chat name that has to truncate in a half-width column');
  const messages = el('div', 'zcr-messages');
  header.append(title); preview.append(header, messages); columns.append(main, preview); doc.body.append(columns);
  const css = shippedCss();
  // The split is a row with a real gap, and both columns take an equal share of the measured width,
  // so neither side is ever a squeezed leftover of the other.
  expect(cs(columns).flexDirection).toBe('row');
  expect(Number.parseFloat(cs(columns).gap)).toBeGreaterThan(0);
  expect(css).toMatch(/\.zcr-columns\[data-zcr-columns="two"\]\s*>\s*\*\s*\{[^}]*flex:\s*1 1 0/u);
  // Both columns can shrink instead of overflowing the dock, whatever the columns resolve to.
  expect(Number.parseFloat(cs(main).minWidth)).toBe(0);
  expect(Number.parseFloat(cs(preview).minWidth)).toBe(0);
  // The read-only column is its own flex column that scrolls inside itself.
  expect(cs(preview).display).toBe('flex');
  expect(cs(preview).flexDirection).toBe('column');
  // The transcript keeps the dock's own scrolling rule rather than the whole column growing.
  expect(cs(messages).overflow).toContain('auto');
  expect(Number.parseFloat(cs(messages).minHeight)).toBe(0);
  // A hairline separates it from the editable column, and its title truncates rather than widening.
  expect(css).toMatch(/\.zcr-columns\[data-zcr-columns="two"\]\s+\.zcr-pane-preview\s*\{[^}]*border-inline-start:\s*1px solid/u);
  expect(cs(title).whiteSpace).toBe('nowrap');
  expect(cs(title).textOverflow).toBe('ellipsis');
  // The column's own note rides the chat text scale, like the rest of the chrome.
  const sidebar = el('div', 'zcr-sidebar');
  sidebar.style.setProperty('--zcr-chat-text-scale', '1.5');
  const note = el('span', 'zcr-pane-preview-note', 'Read-only');
  sidebar.append(note); doc.body.append(sidebar);
  expect(cs(note).fontSize).toBe('calc(11px * 1.5)');
  // Activating the column is a keyboard-reachable control with the neutral ring the owner kept.
  const activate = el('button', 'zcr-icon-button zcr-pane-preview-open');
  activate.setAttribute('data-zcr-action', 'activate-pane');
  preview.append(activate);
  expect(cs(activate).cursor).toBe('pointer');
  expect(shippedRule(doc, '.zcr-pane-preview-open:focus-visible').outlineColor).not.toContain('AccentColor');
  expect(css).not.toMatch(/\.zcr-pane-preview[^{},]*\{[^}]*AccentColor/u);
});

it('centers a scaled muted timestamp divider and keeps transcript type on the chat scale', () => {
  const { doc, cs } = stylesheetDom();
  const el = make(doc);
  const sidebar = el('div', 'zcr-sidebar');
  sidebar.style.setProperty('--zcr-chat-text-scale', '1.5');
  const time = el('div', 'zcr-message-time', '2:05 PM');
  const reference = el('span', 'zcr-message-reference', '@article');
  const card = el('figure', 'zcr-image-card');
  const caption = el('figcaption', '', 'Screenshot');
  card.append(caption);
  sidebar.append(time, reference, card); doc.body.append(sidebar);
  expect(cs(time).alignSelf).toBe('center');
  expect(cs(time).fontSize).toBe('calc(11px * 1.5)');
  expect(cs(reference).fontSize).toBe('calc(11px * 1.5)');
  expect(cs(caption).fontSize).toBe('calc(11px * 1.5)');
  expect(shippedRule(doc, '.zcr-message-time').cssText).toContain('var(--fill-secondary');
});

