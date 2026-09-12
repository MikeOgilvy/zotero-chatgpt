import MarkdownIt from 'markdown-it';
import createDOMPurify from 'dompurify';
import katex from 'katex';

export interface RenderAnswerOptions { deferMath?: boolean }

const MARKS: Array<[string, string]> = [['$$', '\uE010'], ['\\[', '\uE011'], ['\\]', '\uE012'], ['\\(', '\uE013'], ['\\)', '\uE014'], ['$', '\uE015']];
const PURIFY = {
  ALLOWED_TAGS: ['a', 'p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'hr', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub'],
  ALLOWED_ATTR: ['href', 'class', 'title', 'style', 'aria-hidden'],
  ALLOWED_URI_REGEXP: /^https:/iu,
  FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'iframe', 'script', 'object', 'embed', 'form', 'style', 'svg'],
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}
function freezeDelimiters(source: string): string {
  let next = source;
  for (const [from, to] of MARKS) next = next.split(from).join(to);
  return next;
}
function thawDelimiters(source: string): string {
  let next = source;
  for (const [from, to] of [...MARKS].reverse()) next = next.split(to).join(from);
  return next;
}
function renderMath(source: string, display: boolean): string {
  try {
    // `strict: 'ignore'` keeps Unicode that KaTeX only warns about (for example CJK subscripts in
    // $T_{误差}$) renderable; `throwOnError` still turns genuinely broken TeX into escaped text.
    return katex.renderToString(source, { output: 'html', displayMode: display, throwOnError: true, trust: false, maxSize: 10, maxExpand: 1000, strict: 'ignore' });
  } catch {
    return `<span class="zcr-math-fallback">${escapeHtml(source)}</span>`;
  }
}
function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before('escape', 'zcr_math', (state, silent) => {
    const src = state.src;
    const pos = state.pos;
    const take = (open: string, close: string, display: boolean, accept?: (content: string, after: string) => boolean): boolean => {
      if (!src.startsWith(open, pos)) return false;
      const end = src.indexOf(close, pos + open.length);
      if (end === -1) return false;
      const content = src.slice(pos + open.length, end);
      if (!display && content.includes('\n')) return false;
      if (accept && !accept(content, src.slice(end + close.length, end + close.length + 1))) return false;
      if (!silent) {
        const token = state.push('zcr_math', display ? 'div' : 'span', 0);
        token.content = content;
        token.markup = open;
        token.meta = { display };
      }
      state.pos = end + close.length;
      return true;
    };
    // `$$`, `\[` and `\(` are unambiguous TeX delimiters. A single `$` follows the common
    // Pandoc-style guards so currency such as `$5 and $10` is left as text instead of being
    // silently rewritten into one formula spanning the digits in between.
    const inlineDollar = (content: string, after: string): boolean =>
      content.length > 0 && !/^\s/u.test(content) && !/\s$/u.test(content) && !/^[0-9]/u.test(after);
    return take('$$', '$$', true, content => content.length > 0)
      || take('\\[', '\\]', true, content => content.trim().length > 0)
      || take('\\(', '\\)', false, content => content.trim().length > 0)
      || take('$', '$', false, inlineDollar);
  });
  md.renderer.rules.zcr_math = (tokens, idx) => {
    const token = tokens[idx]!;
    return renderMath(token.content, Boolean((token.meta as { display?: boolean } | undefined)?.display));
  };
}
function markdown(deferMath: boolean): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
  if (!deferMath) mathPlugin(md);
  return md;
}
const markdownLive = markdown(false);
const markdownStreaming = markdown(true);
const purifyByWindow = new WeakMap<object, ReturnType<typeof createDOMPurify>>();
function freezeIfNeeded(source: string): string {
  if (!source.includes('$') && !source.includes('\\')) return source;
  return freezeDelimiters(source);
}
function sanitize(doc: Document, html: string): string {
  const view = doc.defaultView;
  if (!view) return escapeHtml(html);
  let purify = purifyByWindow.get(view);
  if (!purify) { purify = createDOMPurify(view as never); purifyByWindow.set(view, purify); }
  return purify.sanitize(html, PURIFY);
}
function fragmentFromHtml(doc: Document, html: string): DocumentFragment {
  const view = doc.defaultView;
  const fragment = doc.createDocumentFragment();
  if (!view) { fragment.append(doc.createTextNode(html)); return fragment; }
  const parsed = new view.DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
  for (const child of [...parsed.body.childNodes]) fragment.append(doc.importNode(child, true));
  return fragment;
}

/** Sanitized Markdown/KaTeX fragment. Raw HTML, images and non-https URLs never become live nodes. */
export function renderAnswer(doc: Document, source: string, options: RenderAnswerOptions = {}): DocumentFragment {
  const deferMath = options.deferMath === true;
  const prepared = deferMath ? freezeIfNeeded(source) : source;
  const rendered = (deferMath ? markdownStreaming : markdownLive).render(prepared);
  return fragmentFromHtml(doc, sanitize(doc, prepared === source ? rendered : thawDelimiters(rendered)));
}
/** Clipboard payload: the original Markdown, including TeX delimiters, never rendered tags. */
export function copyableAnswerText(source: string): string { return source; }
export function followAnswerScroll(nearBottom: boolean, contentChanged: boolean): { stick: boolean; showNewContent: boolean } {
  if (nearBottom) return { stick: true, showNewContent: false };
  return { stick: false, showNewContent: contentChanged };
}
