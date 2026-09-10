import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import { copyableAnswerText, followAnswerScroll, renderAnswer } from '../../packages/zotero/src/chat/render-answer.ts';

function documentOf(): Document {
  return new Window({ url: 'https://zcr.test/' }).document as unknown as Document;
}

it('strips raw HTML, images and non-https links so untrusted answers cannot run script', () => {
  const fragment = renderAnswer(documentOf(), '<img src=x onerror="alert(1)"><script>alert(1)</script>\n[x](javascript:alert(1))\n[ok](https://example.com/a)\n[file](file:///etc/passwd)\n![pic](https://evil.example/a.png)');
  expect(fragment.querySelector('script,iframe,img,img[onerror]')).toBeNull();
  expect(fragment.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(fragment.querySelector('a[href^="file:"]')).toBeNull();
  const link = fragment.querySelector('a[href="https://example.com/a"]');
  expect(link?.textContent).toBe('ok');
  expect(fragment.querySelector('a[href="https://evil.example/a.png"]')).toBeNull();
});

it('renders closed KaTeX and keeps incomplete math as characters until the answer is finished', () => {
  const doc = documentOf();
  const math = renderAnswer(doc, '面积是 \\(x^2 + y^2\\)');
  expect(math.querySelector('.katex')).not.toBeNull();
  expect(math.textContent).toContain('x');
  const streaming = renderAnswer(doc, '面积是 \\(x^2 + y^2', { deferMath: true });
  expect(streaming.querySelector('.katex')).toBeNull();
  expect(streaming.textContent).toContain('\\(x^2 + y^2');
  const plain = renderAnswer(documentOf(), '先验是初始信念。', { deferMath: true });
  expect(plain.textContent).toContain('先验是初始信念');
  expect(plain.querySelector('.katex')).toBeNull();
});

it('shows a KaTeX failure as text, not as HTML written from the error source', () => {
  const fragment = renderAnswer(documentOf(), '$\\badcommand{<img src=x onerror=alert(1)>}$');
  expect(fragment.querySelector('img,script')).toBeNull();
  expect(fragment.querySelector('.katex-error')).toBeNull();
  expect(fragment.textContent).toContain('\\badcommand');
});

it('copies readable source with formula notation, not rendered DOM', () => {
  const source = '先验 $p(\\theta)$ 与后验。';
  expect(copyableAnswerText(source)).toBe(source);
  expect(copyableAnswerText(source)).not.toContain('katex');
});

it('sticks to the bottom while reading the tail, otherwise offers 有新内容', () => {
  expect(followAnswerScroll(true, true)).toEqual({ stick: true, showNewContent: false });
  expect(followAnswerScroll(false, true)).toEqual({ stick: false, showNewContent: true });
  expect(followAnswerScroll(false, false)).toEqual({ stick: false, showNewContent: false });
});
