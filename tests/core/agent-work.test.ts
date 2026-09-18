import { describe, expect, it } from 'vitest';
import type { Conversation, Message } from '../../packages/contracts/src/index.ts';
import { conversationHasAgentWork } from '../../packages/core/src/chat/agent-work.ts';

/** The helper reads only the transcript, so the fixtures carry only the fields it can look at. */
const chat = (...messages: Array<Partial<Message>>): Conversation => ({ messages } as unknown as Conversation);

describe('conversationHasAgentWork', () => {
  it('reports no Agent work for a pure Chat-Mode transcript', () => {
    expect(conversationHasAgentWork(chat({ mode: 'chat', text: 'Summarize this paper.' }))).toBe(false);
    // A legacy record without `mode` is Chat (D3), as is an explicit read skill.
    expect(conversationHasAgentWork(chat({ text: 'Explain Figure 3.' }))).toBe(false);
    expect(conversationHasAgentWork(chat({ workflow: { skill: { workflow: 'read' } } } as Partial<Message>))).toBe(false);
    expect(conversationHasAgentWork(chat())).toBe(false);
    expect(conversationHasAgentWork(null)).toBe(false);
    expect(conversationHasAgentWork(undefined)).toBe(false);
  });

  it('reports Agent work for an Agent-Mode request', () => {
    expect(conversationHasAgentWork(chat({ mode: 'agent' }))).toBe(true);
  });

  it('reports Agent work for a non-read skill, including a legacy record without mode', () => {
    for (const workflow of ['annotate', 'acquire', 'diagram']) {
      expect(conversationHasAgentWork(chat({ workflow: { skill: { workflow } } } as Partial<Message>))).toBe(true);
    }
  });

  it('reports Agent work for a multi-pass reading request even when the message says chat', () => {
    // The Stage 6-7 escalation leak froze `mode: 'chat'` onto a send that still started a reading job;
    // `batch` is only ever set by the reading coordinator, so it keeps that chat protected.
    expect(conversationHasAgentWork(chat({ mode: 'chat', batch: { id: 'job', index: 0, total: 2, phase: 'map', question: 'q' } }))).toBe(true);
  });

  it('finds Agent work anywhere in the transcript', () => {
    expect(conversationHasAgentWork(chat({ mode: 'chat' }, { mode: 'agent' }))).toBe(true);
  });
});
