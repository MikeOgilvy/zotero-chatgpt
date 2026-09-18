/**
 * Deterministic, model-free recognition of a Chat-Mode request that is really an instruction to act
 * on Zotero or on local files.
 *
 * Chat Mode is read context + reason + answer: it must never execute or queue a native write, and it
 * must never silently escalate into Agent Mode. When the composer is in Chat Mode and the question is
 * a clear imperative library/PDF mutation, the Chat path refuses and points the owner at Agent Mode.
 * Agent Mode is never inferred from complexity — only this syntactic rule turns an action request into
 * a refusal, and the refusal is a decision the owner makes by switching the control.
 *
 * The rule is deliberately narrow. A false negative (an action treated as an ordinary question) only
 * means the model answers instead of acting; a false positive would block an ordinary question. It is
 * therefore purely syntactic, never semantic, and has no ML, model call, I/O or randomness: the same
 * question always produces the same answer, so it is unit-testable without Zotero.
 *
 * A clause is an action request only when all three hold:
 *
 *   1. Imperative form. Split the question into clauses, strip an optional politeness prefix
 *      (`please`, `can you`, `I want you to`, `go ahead and`, ...), and require the next word to be a
 *      mutation verb. "Explain how highlighting works in PDFs" has `explain` first, so the gerund
 *      `highlighting` later in the sentence is not an imperative.
 *   2. Mutation target. The clause must name an artifact noun (annotation/highlight/note/metadata/
 *      collection/library item/file/Zotero/...) anywhere, or a document noun (paper/PDF/document/
 *      article/claim) — but only for the verbs that genuinely act on a document (`highlight`,
 *      `annotate`, `download`, `organize`, ...). `write`/`make`/`save`/`update` need an artifact, so
 *      "make a summary of this paper" and "write a poem about this paper" stay chat.
 *   3. Not a topic noun phrase. A target introduced by `about`/`regarding`/`concerning`/`of`/`on`/`in`
 *      is the subject of the sentence, not the object of the action, so it does not count: "add more
 *      detail about the collection" stays chat, while "organize them into a collection" (destination
 *      `into`) is an action.
 *
 * The classifier covers English imperatives. Chinese or other-language action requests currently fall
 * through as ordinary questions: that is the intended conservative failure direction, and it is
 * recorded here and in `docs/module-design.md` rather than guessed at with a second matcher.
 */

/** A recognized imperative mutation: the verb that would act and the noun it targets. */
export interface ActionIntent {
  verb: string;
  target: string;
}

/** Base-form verbs that can only act on a target (the target check below decides every match). */
const MUTATION_VERBS = new Set([
  'acquire', 'add', 'annotate', 'attach', 'change', 'correct', 'create', 'delete', 'discard',
  'download', 'edit', 'erase', 'export', 'fetch', 'fix', 'group', 'highlight', 'import', 'insert',
  'make', 'mark', 'merge', 'modify', 'move', 'note', 'organise', 'organize', 'rearrange', 'remove',
  'rename', 'repair', 'save', 'set', 'sort', 'tag', 'trash', 'underline', 'update', 'write',
]);

/** Nouns whose mutation is a library/PDF/file action (the artifact the action produces or changes). */
const ARTIFACT_TARGETS = new Set([
  'annotation', 'annotations', 'attachment', 'attachments', 'collection', 'collections', 'doi',
  'entry', 'entries', 'file', 'files', 'folder', 'folders', 'highlight', 'highlights', 'item',
  'items', 'library', 'libraries', 'metadata', 'note', 'notes', 'tag', 'tags', 'zotero',
]);

/** Document nouns that only document-acting verbs may treat as the mutation target. */
const DOCUMENT_TARGETS = new Set([
  'article', 'articles', 'claim', 'claims', 'document', 'documents', 'paper', 'papers', 'pdf', 'pdfs',
]);

/**
 * Verbs that genuinely act on the document itself. The generic creation verbs (`write`, `make`,
 * `save`, `add`, `create`, `update`, ...) are intentionally absent: they still need an artifact
 * target, so prose about a paper is not mistaken for a mutation.
 */
const DOCUMENT_VERBS = new Set([
  'acquire', 'annotate', 'attach', 'delete', 'discard', 'download', 'erase', 'export', 'fetch',
  'group', 'highlight', 'import', 'mark', 'merge', 'move', 'organise', 'organize', 'rearrange',
  'remove', 'sort', 'tag', 'trash', 'underline',
]);

/**
 * A question word anywhere in the utterance makes it a question about the work rather than an
 * instruction to do it. This is the strongest false-negative guard: "How do I add a highlight?" and
 * "I want to organize my library, where do I start?" stay chat even though an imperative-looking
 * clause is present. It also means an action phrased as "highlight what is important" falls through
 * to chat, which is the intended conservative direction.
 */
const QUESTION_WORD = /\b(?:how|what|when|where|whether|which|who|whom|whose|why)\b/u;

/** Tokens that may precede the verb without changing its imperative form. */
const POLITE_TOKENS = new Set([
  'a', 'an', 'also', 'and', 'can', 'could', 'd', 'go', 'ahead', 'help', 'hey', 'i', 'id', 'just',
  'kindly', 'like', 'll', 'love', 'me', 'need', 'now', 'please', 'the', 'then', 'to', 'want', 'will',
  'would', 'you',
]);

/** Prepositions that introduce the subject/topic of a clause rather than the object of the action. */
const TOPIC_PREPOSITIONS = new Set(['about', 'as', 'concerning', 'in', 'of', 'on', 'regarding', 'than']);

/**
 * Any preposition. Used only to detect that a noun is inside a topic phrase; an absent value means
 * the noun is the direct object of the verb.
 */
const PREPOSITIONS = new Set([
  'about', 'across', 'after', 'against', 'among', 'around', 'as', 'at', 'before', 'between', 'by',
  'concerning', 'down', 'during', 'for', 'from', 'in', 'into', 'near', 'of', 'off', 'on', 'onto',
  'out', 'over', 'per', 'regarding', 'since', 'than', 'through', 'throughout', 'to', 'toward',
  'towards', 'under', 'until', 'up', 'upon', 'via', 'when', 'where', 'while', 'with', 'within',
  'without',
]);

/** Split on sentence and clause boundaries, including the coordinating conjunctions that chain actions. */
function clauses(question: string): string[] {
  return question.normalize('NFKC').toLowerCase().split(/\s*(?:[.;!?\n]+|\band\b|\bthen\b|,)\s*/u).filter(Boolean);
}

function tokens(clause: string): string[] {
  return clause.match(/[a-z0-9]+/gu) ?? [];
}

/**
 * Does the clause contain the target of its mutation verb? Walks the tokens after the verb, tracking
 * the governing preposition so a topic noun phrase cannot satisfy the target requirement.
 */
function targetIn(tokensAfterVerb: string[], verb: string): string | null {
  let governing: string | null = null;
  for (const token of tokensAfterVerb) {
    if (PREPOSITIONS.has(token)) { governing = token; continue; }
    const topic = governing !== null && TOPIC_PREPOSITIONS.has(governing);
    if (ARTIFACT_TARGETS.has(token) && !topic) return token;
    if (DOCUMENT_TARGETS.has(token) && !topic && DOCUMENT_VERBS.has(verb)) return token;
  }
  return null;
}

/**
 * One action intent for the first clause that is an imperative mutation, or null when the question is
 * an ordinary chat question. Pure: no model call, no I/O.
 */
export function detectActionIntent(question: string): ActionIntent | null {
  if (typeof question !== 'string') return null;
  const normalized = question.normalize('NFKC').toLowerCase();
  if (QUESTION_WORD.test(normalized)) return null;
  for (const clause of clauses(normalized)) {
    const words = tokens(clause);
    let index = 0;
    while (index < words.length && POLITE_TOKENS.has(words[index]!)) index++;
    const verb = words[index];
    if (!verb || !MUTATION_VERBS.has(verb)) continue;
    const target = targetIn(words.slice(index + 1), verb);
    if (target) return { verb, target };
  }
  return null;
}
