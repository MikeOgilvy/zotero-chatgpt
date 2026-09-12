import type { Citation, Draft, GenerationSettings, ImageAttachment, PaperIdentity, SendInput } from '../../../contracts/src/index.ts';
import { clone } from '../../../contracts/src/clone.ts';
import { EXPLAIN_QUESTION } from '../../../core/src/codex/reader-policy.ts';
import type { ReferenceInput, WorkflowSnapshot, WorkspaceDraft } from '../../../contracts/src/workspace.ts';
/** Pure draft helpers: no network, no host access. */
export function addCitation<T extends Draft>(draft: T, citation: Citation): T {
  if (draft.citations.some(c => c.id === citation.id)) return draft;
  return { ...draft, citations: [...draft.citations, clone(citation)] };
}
export function removeCitation<T extends Draft>(draft: T, citationId: string): T {
  return { ...draft, citations: draft.citations.filter(c => c.id !== citationId) };
}
export function addImage<T extends Draft>(draft: T, image: ImageAttachment): T {
  if (draft.images.some(entry => entry.id === image.id)) return draft;
  return { ...draft, images: [...draft.images, clone(image)] };
}
export function removeImage<T extends Draft>(draft: T, imageId: string): T {
  return { ...draft, images: draft.images.filter(entry => entry.id !== imageId) };
}
export function moveImage<T extends Draft>(draft: T, imageId: string, delta: number): T {
  const index = draft.images.findIndex(image => image.id === imageId); const next = index + delta;
  if (index < 0 || !Number.isSafeInteger(delta) || next < 0 || next >= draft.images.length || next === index) return draft;
  const images = [...draft.images]; const image = images.splice(index, 1)[0]!; images.splice(next, 0, image);
  return { ...draft, images };
}
export function workspaceDraft(draft: Draft): WorkspaceDraft {
  const richer = draft as Partial<WorkspaceDraft>;
  return { ...clone(draft), references: clone(richer.references ?? []), skillId: richer.skillId ?? null, profileId: richer.profileId ?? null, overrides: clone(richer.overrides ?? {}) };
}
export interface DraftContext { workflow?: WorkflowSnapshot; references?: ReferenceInput[] }
function withContext(input: SendInput, context?: DraftContext): SendInput {
  return { ...input, ...(context?.workflow ? { workflow: clone(context.workflow) } : {}), ...(context?.references?.length ? { references: clone(context.references) } : {}) };
}
function withPaper(input: SendInput, paper?: PaperIdentity): SendInput {
  return paper?.title.trim() ? { ...input, paper: { title: paper.title, authors: [...paper.authors], ...(paper.year ? { year: paper.year } : {}), ...(paper.doi ? { doi: paper.doi } : {}) } } : input;
}
export function makeExplain(citation: Citation, conversationId: string, requestId: string, settings: GenerationSettings, paper?: PaperIdentity, context?: DraftContext): SendInput {
  return withContext(withPaper({ requestId, conversationId, action: 'explain', question: EXPLAIN_QUESTION, citations: [clone(citation)], settings: { ...settings } }, paper ?? { title: citation.title, authors: [...citation.authors], ...(citation.year ? { year: citation.year } : {}), ...(citation.doi ? { doi: citation.doi } : {}) }), context);
}
export function makeAsk(draft: Draft, conversationId: string, requestId: string, settings: GenerationSettings, paper?: PaperIdentity, context?: DraftContext): SendInput {
  const first = draft.citations[0];
  return withContext(withPaper({
    requestId, conversationId, action: 'ask', question: draft.question.trim(),
    citations: draft.citations.map(c => clone(c)), settings: { ...settings },
    ...(draft.images.length ? { images: draft.images.map(image => clone(image)) } : {}),
  }, paper ?? (first ? { title: first.title, authors: [...first.authors], ...(first.year ? { year: first.year } : {}), ...(first.doi ? { doi: first.doi } : {}) } : undefined)), context);
}
