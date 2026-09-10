import type { Citation, Draft, GenerationSettings, SendInput } from '../../../contracts/src/index.ts';
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
export function makeExplain(citation: Citation, conversationId: string, requestId: string, settings: GenerationSettings): SendInput {
  return { requestId, conversationId, action: 'explain', question: EXPLAIN_QUESTION, citations: [clone(citation)], settings: { ...settings } };
}
export function makeAsk(draft: Draft, conversationId: string, requestId: string, settings: GenerationSettings): SendInput {
  return { requestId, conversationId, action: 'ask', question: draft.question.trim(), citations: draft.citations.map(c => clone(c)), settings: { ...settings } };
}
