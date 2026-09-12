import type { Citation, Draft, GenerationSettings, ImageAttachment, PaperIdentity, SendInput } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
/** Pure draft helpers: no network, no host access. */
export function addCitation(draft: Draft, citation: Citation): Draft {
  if (draft.citations.some(c => c.id === citation.id)) return draft;
  return { ...draft, citations: [...draft.citations, clone(citation)] };
}
export function removeCitation(draft: Draft, citationId: string): Draft {
  return { ...draft, citations: draft.citations.filter(c => c.id !== citationId) };
}
export function addImage(draft: Draft, image: ImageAttachment): Draft {
  if (draft.images.some(entry => entry.id === image.id)) return draft;
  return { ...draft, images: [...draft.images, clone(image)] };
}
export function removeImage(draft: Draft, imageId: string): Draft {
  return { ...draft, images: draft.images.filter(entry => entry.id !== imageId) };
}
function withPaper(input: SendInput, paper?: PaperIdentity): SendInput {
  return paper?.title.trim() ? { ...input, paper: { title: paper.title, authors: [...paper.authors], ...(paper.year ? { year: paper.year } : {}), ...(paper.doi ? { doi: paper.doi } : {}) } } : input;
}
export function makeExplain(citation: Citation, conversationId: string, requestId: string, settings: GenerationSettings, paper?: PaperIdentity): SendInput {
  return withPaper({ requestId, conversationId, action: 'explain', question: EXPLAIN_QUESTION, citations: [clone(citation)], settings: { ...settings } }, paper ?? { title: citation.title, authors: [...citation.authors], ...(citation.year ? { year: citation.year } : {}), ...(citation.doi ? { doi: citation.doi } : {}) });
}
export function makeAsk(draft: Draft, conversationId: string, requestId: string, settings: GenerationSettings, paper?: PaperIdentity): SendInput {
  const first = draft.citations[0];
  return withPaper({
    requestId, conversationId, action: 'ask', question: draft.question.trim(),
    citations: draft.citations.map(c => clone(c)), settings: { ...settings },
    ...(draft.images.length ? { images: draft.images.map(image => clone(image)) } : {}),
  }, paper ?? (first ? { title: first.title, authors: [...first.authors], ...(first.year ? { year: first.year } : {}), ...(first.doi ? { doi: first.doi } : {}) } : undefined));
}
