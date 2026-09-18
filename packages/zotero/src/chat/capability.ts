import type { ReaderClient } from '../../../contracts/src/runtime.ts';
import type { ActionTasks } from '../../../contracts/src/tasks.ts';
import type { ReadingCoordinator } from '../../../core/src/context/coordinator.ts';

/**
 * The complete Agent-Mode capability: durable native task orchestration plus multi-pass reading (and,
 * through those ports, approvals, the write-intent ledger, reconciliation and undo). The composition
 * root assembles it once and injects it as `PresenterServices.agent`.
 *
 * This interface is the only surface through which Agent infrastructure is reachable. It lives in its
 * own module so the boundary is a file, not a comment: `chat-execution.ts` (the Chat path) does not
 * import this module, has no field of this type, and therefore cannot call `tasks()` or `reading()`
 * even by accident. A reader-only host leaves the capability absent and the Chat path is unaffected.
 */
export interface AgentCapability {
  tasks(): Promise<ActionTasks>;
  reading(client?: ReaderClient): Promise<PresenterReading>;
}

/** Retained name for the composition root and existing callers; identical to `AgentCapability`. */
export type PresenterAgent = AgentCapability;

/** The subset of the reading coordinator the presenter drives directly. */
export type PresenterReading = Pick<ReadingCoordinator, 'start' | 'enqueue' | 'list' | 'get' | 'subscribe' | 'cancel' | 'reconcile'>;
