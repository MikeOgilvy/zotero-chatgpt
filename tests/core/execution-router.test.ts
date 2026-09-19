import { describe, expect, it } from 'vitest';
import type { AgentExecutionRequest, AgentExecutorPort, ChatExecutorPort, ChatStreamEvent } from '../../packages/contracts/src/execution.ts';
import { ChatExecutor } from '../../packages/core/src/chat/executor.ts';
import { ExecutionRouter } from '../../packages/core/src/conversation/execution-router.ts';

function transport(events: ChatStreamEvent[], spy = { streams: 0, cancels: 0 }) {
  return {
    spy,
    available: true,
    async *stream(): AsyncIterable<ChatStreamEvent> { spy.streams++; for (const event of events) { await Promise.resolve(); yield event; } },
    cancel: (): Promise<void> => { spy.cancels++; return Promise.resolve(); },
  };
}

class RecordingAgent implements AgentExecutorPort {
  readonly mode = 'agent' as const;
  calls: AgentExecutionRequest[] = [];
  execute(value: AgentExecutionRequest): Promise<void> { this.calls.push(value); return Promise.resolve(); }
}

describe('ExecutionRouter', () => {
  it('routes a chat request to the ChatExecutor and never touches the Agent executor', () => {
    const chatSpy = { streams: 0, cancels: 0 }; const agent = new RecordingAgent();
    const chat: ChatExecutorPort = new ChatExecutor(transport([{ type: 'chat.completed', text: 'hi' }], chatSpy));
    const selected = new ExecutionRouter({ chat, agent }).select('chat');
    expect(selected).toBe(chat);
    expect(agent.calls).toEqual([]);
  });

  it('routes an agent request to the AgentExecutor and never touches the ChatExecutor', () => {
    const chatSpy = { streams: 0, cancels: 0 }; const agent = new RecordingAgent();
    const chat: ChatExecutorPort = new ChatExecutor(transport([], chatSpy));
    const selected = new ExecutionRouter({ chat, agent }).select('agent');
    expect(selected).toBe(agent);
    expect(chatSpy.streams).toBe(0);
  });

  it('treats an absent mode as chat (D3), never as Agent', () => {
    const agent = new RecordingAgent();
    const chat: ChatExecutorPort = new ChatExecutor(transport([]));
    const router = new ExecutionRouter({ chat, agent });
    expect(router.select(undefined)).toBe(chat);
  });

  it('never returns the same runtime for the two modes', () => {
    const chat: ChatExecutorPort = new ChatExecutor(transport([]));
    const agent = new RecordingAgent();
    const router = new ExecutionRouter({ chat, agent });
    expect(router.select('chat')).not.toBe(router.select('agent'));
  });
});
