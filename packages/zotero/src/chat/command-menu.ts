export interface CommandCandidate { id: string; label: string; description?: string; disabled?: boolean }
export interface CommandMenuState { heading: string; items: CommandCandidate[]; loading?: boolean; error?: string }
export interface CommandMenu {
  element: HTMLElement;
  toolbar: HTMLElement;
  update(state: CommandMenuState): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

let serial = 0;
const STYLES = `
.zcr-command-menu { position:absolute; inset-inline:0; bottom:calc(100% + 6px); z-index:12; display:flex; flex-direction:column; min-width:0; max-width:100%; max-height:280px; padding:4px; box-sizing:border-box; overflow:hidden; font:inherit; font-size:12px; color:var(--fill-primary,CanvasText); background:var(--material-menu,var(--material-background,Canvas)); border:1px solid var(--zcr-border,GrayText); border-radius:8px; box-shadow:0 4px 16px #0002; }
.zcr-command-menu[hidden] { display:none; }
.zcr-command-heading { margin:4px 8px; color:var(--fill-secondary,GrayText); font-size:11px; }
.zcr-command-toolbar { display:flex; flex-wrap:wrap; gap:4px; }
.zcr-command-list { min-height:0; overflow:auto; }
.zcr-command-option { display:flex; flex-direction:column; gap:2px; width:100%; min-height:28px; padding:6px 8px; text-align:left; font:inherit; color:inherit; background:transparent; border:0; border-radius:5px; cursor:pointer; box-sizing:border-box; }
.zcr-command-option[aria-selected=true],.zcr-command-option:hover { background:var(--fill-quinary,ButtonFace); }
.zcr-command-option:disabled { opacity:.55; cursor:default; }
.zcr-command-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
.zcr-command-description { color:var(--fill-secondary,GrayText); font-size:11px; line-height:16px; overflow-wrap:anywhere; }
.zcr-command-status { margin:4px 8px; font-size:12px; overflow-wrap:anywhere; }
.zcr-command-menu :focus-visible { outline:2px solid AccentColor; outline-offset:-2px; }
`;

/** One keyboard owner for every composer chooser. Candidate text is always inert. */
export function mountCommandMenu(input: HTMLTextAreaElement, container: HTMLElement, choose: (id: string) => Promise<void>): CommandMenu {
  const doc = input.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => { const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.className = className; return node; };
  const style = create('style', ''); style.textContent = STYLES; doc.head.append(style);
  const element = create('div', 'zcr-command-menu'); element.hidden = true;
  const toolbar = create('div', 'zcr-command-toolbar');
  const heading = create('div', 'zcr-command-heading');
  const list = create('div', 'zcr-command-list'); list.id = `zcr-command-${++serial}`; list.setAttribute('role', 'listbox');
  const status = create('p', 'zcr-command-status'); status.setAttribute('role', 'status'); status.hidden = true;
  element.append(toolbar, heading, list, status); container.append(element);
  const position = container.style.position;
  const ownsPosition = !doc.defaultView?.getComputedStyle(container).position || doc.defaultView.getComputedStyle(container).position === 'static';
  if (ownsPosition) container.style.position = 'relative';
  const attributes = new Map(['aria-controls', 'aria-expanded', 'aria-autocomplete', 'aria-activedescendant'].map(name => [name, input.getAttribute(name)]));
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  let items: CommandCandidate[] = []; let active = ''; let composing = false; let busy = false; let disposed = false; let revision = 0;
  const isOpen = () => !element.hidden && !disposed;
  const close = () => { element.hidden = true; revision++; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const markActive = () => {
    let activeNode: HTMLElement | null = null;
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) {
      const selected = row.dataset.candidateId === active;
      row.setAttribute('aria-selected', String(selected));
      if (selected) activeNode = row;
    }
    if (activeNode) {
      input.setAttribute('aria-activedescendant', activeNode.id);
      const top = activeNode.offsetTop - list.offsetTop; const bottom = top + activeNode.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    }
    else input.removeAttribute('aria-activedescendant');
  };
  const chooseActive = async () => {
    if (busy || !isOpen() || !items.some(item => item.id === active && !item.disabled)) return;
    busy = true; const current = revision; const id = active;
    status.textContent = 'Adding…'; status.hidden = false;
    try {
      await choose(id);
      if (!disposed && current === revision) { close(); input.focus(); }
    } catch (error) {
      if (isOpen() && current === revision) { status.textContent = error instanceof Error ? error.message : 'This item could not be added.'; status.hidden = false; }
    } finally { busy = false; }
  };
  const place = () => {
    const pane = input.closest<HTMLElement>('[data-zcr-sidebar]') ?? container;
    const paneRect = pane.getBoundingClientRect(); const anchor = container.getBoundingClientRect();
    if (!paneRect.height || !anchor.height) return;
    const above = anchor.top - paneRect.top - 6; const below = paneRect.bottom - anchor.bottom - 6;
    const upward = above >= below;
    element.style.bottom = upward ? 'calc(100% + 6px)' : 'auto';
    element.style.top = upward ? 'auto' : 'calc(100% + 6px)';
    element.style.maxHeight = `${Math.max(0, Math.min(280, upward ? above : below))}px`;
  };
  const update = (state: CommandMenuState) => {
    if (disposed) return;
    revision++; items = state.items; heading.textContent = state.heading; list.setAttribute('aria-label', state.heading);
    if (!items.some(item => item.id === active && !item.disabled)) active = items.find(item => !item.disabled)?.id ?? '';
    list.replaceChildren(...items.map((item, index) => {
      const row = create('button', 'zcr-command-option'); row.type = 'button'; row.tabIndex = -1; row.id = `${list.id}-${index}`; row.dataset.candidateId = item.id;
      row.setAttribute('role', 'option'); row.disabled = !!item.disabled; row.setAttribute('aria-disabled', String(!!item.disabled));
      const label = create('span', 'zcr-command-label'); label.textContent = item.label; row.append(label);
      if (item.description) { const detail = create('span', 'zcr-command-description'); detail.textContent = item.description; row.append(detail); }
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('pointermove', () => { if (!item.disabled) { active = item.id; markActive(); } });
      row.addEventListener('click', () => { active = item.id; markActive(); void chooseActive(); });
      return row;
    }));
    status.textContent = state.error || (state.loading ? 'Searching…' : !items.length ? 'No matches' : ''); status.hidden = !status.textContent;
    element.hidden = false; input.setAttribute('aria-expanded', 'true'); markActive(); place();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!isOpen()) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    // Keep the IME's browser default, but do not let confirmation reach Send.
    if (composing || event.isComposing || event.keyCode === 229) { event.stopImmediatePropagation(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { close(); input.focus(); return; }
    if (event.key === 'Enter') { void chooseActive(); return; }
    const choices = items.filter(item => !item.disabled); if (!choices.length) return;
    const index = choices.findIndex(item => item.id === active);
    active = choices[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]!.id;
    markActive();
  };
  const onStart = () => { composing = true; }; const onEnd = () => { composing = false; };
  const outside = (event: Event) => { const target = event.target as Node | null; if (isOpen() && target !== input && !element.contains(target)) close(); };
  const onFocusOut = (event: FocusEvent) => { const next = event.relatedTarget as Node | null; if (!composing && next !== input && !element.contains(next)) close(); };
  input.addEventListener('keydown', onKey, true); element.addEventListener('keydown', onKey, true);
  input.addEventListener('focusout', onFocusOut); element.addEventListener('focusout', onFocusOut);
  input.addEventListener('compositionstart', onStart); input.addEventListener('compositionend', onEnd);
  doc.addEventListener('pointerdown', outside); doc.defaultView?.addEventListener('resize', place);
  return { element, toolbar, update, close, isOpen, dispose: () => {
    if (disposed) return; close(); disposed = true;
    input.removeEventListener('keydown', onKey, true); element.removeEventListener('keydown', onKey, true);
    input.removeEventListener('focusout', onFocusOut); element.removeEventListener('focusout', onFocusOut);
    input.removeEventListener('compositionstart', onStart); input.removeEventListener('compositionend', onEnd);
    doc.removeEventListener('pointerdown', outside); doc.defaultView?.removeEventListener('resize', place);
    for (const [name, value] of attributes) { if (value === null) input.removeAttribute(name); else input.setAttribute(name, value); }
    if (ownsPosition && container.style.position === 'relative') container.style.position = position;
    element.remove(); style.remove();
  } };
}
