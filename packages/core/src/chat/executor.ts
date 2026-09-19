import type { ChatExecutorPort, ChatRequest, ChatStreamEvent, ChatTransport } from '../../../contracts/src/execution.ts';

/**
 * The Chat execution path: a normal conversational completion, nothing else.
 *
 * It owns exactly one request's response lifecycle — stream, terminal event, cancellation — and it
 * knows only `ChatRequest`, the shared document context and the model configuration. It has no
 * `ChatTransport`-external dependency: no Codex, no session/thread/turn, no task, no approval, no
 * reading coordinator, no native write port. `tests/build/dependency-boundaries.test.ts` enforces
 * that, and `tests/core/chat-executor.test.ts` proves a Chat request never reaches an Agent sink.
 *
 * The transport is injected and abstract: this build ships only the honest unavailable
 * implementation, so a real ChatGPT backend can later be added behind the same port without touching
 * the router, the shared conversation controller or the Agent runtime.
 */
export class ChatExecutor implements ChatExecutorPort {
  readonly mode = 'chat' as const;

  constructor(private readonly transport: ChatTransport) {}

  /** True when a real chat transport is integrated; the shared controller can refuse early when not. */
  get available(): boolean {
    return this.transport.available;
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent> {
    let terminal = false;
    // One completion, one terminal event. A transport that ends without a terminal event is reported
    // as a failure rather than silently completing, so the shared request record never hangs.
    for await (const event of this.transport.stream(request, signal)) {
      if (terminal) continue;
      if (event.type === 'chat.completed' || event.type === 'chat.failed' || event.type === 'chat.cancelled') terminal = true;
      yield event;
    }
    if (!terminal) yield { type: 'chat.failed', code: 'INTERNAL_ERROR', message: 'The chat transport ended without a final response.' };
  }

  async cancel(requestId: string): Promise<void> {
    await this.transport.cancel(requestId);
  }
}
