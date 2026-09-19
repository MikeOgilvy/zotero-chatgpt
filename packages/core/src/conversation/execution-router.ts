import type { AgentExecutorPort, ChatExecutorPort, ConversationExecutor, ExecutionMode } from '../../../contracts/src/execution.ts';

/**
 * The single point where the frozen mode selects an execution runtime.
 *
 * Chat and Agent are sibling executors: selecting one must never construct, wrap or fall back to the
 * other. Keep every `mode === 'chat'` / `mode === 'agent'` runtime choice here — a mode check that
 * selects a runtime anywhere else is how the two paths re-couple. Permission-style checks (does this
 * mode allow an Agent-only skill?) belong to the paths themselves, not to this switch.
 *
 * An absent mode is `'chat'` (D3): legacy and direct callers that froze no mode get the plain
 * conversation, never Agent execution.
 */
export class ExecutionRouter {
  constructor(private readonly executors: { chat: ChatExecutorPort; agent: AgentExecutorPort }) {}

  select(mode: ExecutionMode | undefined): ConversationExecutor {
    switch (mode) {
      case 'agent': return this.executors.agent;
      case 'chat': return this.executors.chat;
      default: return this.executors.chat;
    }
  }

  /** The Chat executor itself, for callers that must not route through the union (e.g. preflight). */
  chat(): ChatExecutorPort { return this.executors.chat; }

  /** The Agent executor itself, for the shared controller's Agent-only bookkeeping. */
  agent(): AgentExecutorPort { return this.executors.agent; }
}
