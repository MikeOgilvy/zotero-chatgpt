import { describe, expect, it } from 'vitest';
import { detectActionIntent } from '../../packages/core/src/chat/action-intent.ts';

/**
 * The classifier is the runtime gate that keeps Chat Mode from executing (or silently escalating)
 * an action request. These tests pin both directions: clear imperative library/PDF mutations must be
 * recognized, and every ordinary chat question — including the four from the product spec and the
 * "explain how highlighting works" near-miss — must stay chat.
 */
describe('detectActionIntent', () => {
  const actions: Array<[string, string, string]> = [
    ['Highlight all important claims in this paper.', 'highlight', 'claims'],
    ['Fix the metadata for this item.', 'fix', 'metadata'],
    ['Create notes from this paper and save them to Zotero', 'create', 'notes'],
    ['Find these papers in my library and organize them into a collection', 'organize', 'collection'],
    ['Please download the paper we discussed.', 'download', 'paper'],
    ['Can you tag these papers?', 'tag', 'papers'],
    ['Add a highlight to page 3.', 'add', 'highlight'],
    ['Move this item to my library.', 'move', 'item'],
    ['Update the metadata for this entry.', 'update', 'metadata'],
    ['Delete the annotation on page 2.', 'delete', 'annotation'],
    ['save them to Zotero', 'save', 'zotero'],
    ['I want you to highlight the key claims', 'highlight', 'claims'],
    ['Summarize and highlight the key claims', 'highlight', 'claims'],
  ];
  for (const [question, verb, target] of actions) {
    it(`recognizes the action in: ${question}`, () => {
      expect(detectActionIntent(question)).toEqual({ verb, target });
    });
  }

  const questions = [
    // The four Chat-Mode examples named by the product spec.
    'Explain Figure 3.',
    'Summarize this paper.',
    'What does this equation mean?',
    'Compare the method in this paper with predictive coding.',
    // The required near-miss: the gerund "highlighting" is not an imperative.
    'explain how highlighting works in PDFs',
    // Prose about the document is not a mutation, even with a generic creation verb.
    'Make a summary of this paper.',
    'Write a poem about this paper.',
    'Add more detail about the collection.',
    'Write a review of this document.',
    // A target introduced as a topic ("about"/"of") never counts.
    'The highlight of this paper is its method.',
    // Questions about the feature stay chat, even when they contain an action verb.
    'How do I add a highlight?',
    'I want to organize my library, where do I start?',
    'Can you explain how to organize a collection?',
    'What is the best way to tag papers?',
    // Ordinary questions with no mutation at all.
    'Why is this assumption reasonable?',
    'Show me the limitations section.',
    '',
  ];
  for (const question of questions) {
    it(`stays chat for: ${JSON.stringify(question)}`, () => {
      expect(detectActionIntent(question)).toBeNull();
    });
  }
});
