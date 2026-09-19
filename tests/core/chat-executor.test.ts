import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatStreamEvent, ChatTransport } from '../../packages/contracts/src/execution.ts';
import { unavailableChatTransport } from '../../packages/core/src/chat/chat-transport.ts';
import { ChatExecutor } from '../../packages/core/src/chat/executor.ts';

const request: ChatRequest = {
  requestId: 'req-1', conversationId: 'conv-1',
  messages: [{ role: 'user', text: 'hello', citations: [] }],
  context: { paper: null, document: null, citations: [], references: [], images: [], contextReport: null },
  modelConfig: { model: 'gpt-test', serviceTier: null, effort: null },
};

async function collect(stream: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function transport(events: ChatStreamEvent[]): { transport: ChatTransport; spy: { streams: number; cancels: number } } {
  const spy = { streams: 0, cancels: 0 };
  return {
    spy,
    transport: {
      available: true,
      async *stream(): AsyncIterable<ChatStreamEvent> { spy.streams++; for (const event of events) { await Promise.resolve(); yield event; } },
      cancel: (): Promise<void> => { spy.cancels++; return Promise.resolve(); },
    },
  };
}

describe('ChatExecutor', () => {
  it('streams a plain completion through exactly one transport call', async () => {
    const { transport: fake, spy } = transport([
      { type: 'chat.started' }, { type: 'chat.delta', text: 'he' }, { type: 'chat.delta', text: 'llo' }, { type: 'chat.completed', text: 'hello' },
    ]);
    const events = await collect(new ChatExecutor(fake).stream(request, new AbortController().signal));
    expect(spy.streams).toBe(1);
    expect(events.map(event => event.type)).toEqual(['chat.started', 'chat.delta', 'chat.delta', 'chat.completed']);
  });

  it('keeps only the first terminal event when a transport keeps emitting', async () => {
    const { transport: fake } = transport([
      { type: 'chat.completed', text: 'done' }, { type: 'chat.delta', text: 'late' }, { type: 'chat.failed', code: 'INTERNAL_ERROR', message: 'late' },
    ]);
    const events = await collect(new ChatExecutor(fake).stream(request, new AbortController().signal));
    expect(events).toEqual([{ type: 'chat.completed', text: 'done' }]);
  });

  it('reports a failure when the transport ends without a terminal event', async () => {
    const { transport: fake } = transport([{ type: 'chat.started' }]);
    const events = await collect(new ChatExecutor(fake).stream(request, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: 'chat.failed', code: 'INTERNAL_ERROR' });
  });

  it('delegates cancellation to the transport', async () => {
    const { transport: fake, spy } = transport([]);
    await new ChatExecutor(fake).cancel('req-1');
    expect(spy.cancels).toBe(1);
  });

  // The unresolved platform boundary: no supported chat transport exists yet, so Chat must fail
  // honestly instead of silently becoming an Agent/Codex turn.
  it('is unavailable and fails honestly with the placeholder transport', async () => {
    const placeholder = unavailableChatTransport();
    expect(placeholder.available).toBe(false);
    const events = await collect(new ChatExecutor(placeholder).stream(request, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'chat.failed', code: 'UNSUPPORTED_INTERACTION' });
  });
});
