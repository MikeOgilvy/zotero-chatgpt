import { type SendInput } from '../../../contracts/src/index.ts';
import type { ReaderClient } from '../../../contracts/src/runtime.ts';
import type { NativeCollectionTarget } from '../../../contracts/src/native.ts';
import type { ActionTaskRecord, ActionTasks } from '../../../contracts/src/tasks.ts';
import type { ContextPlan } from '../../../core/src/context/planner.ts';
import type { ReadingJob } from '../../../core/src/context/coordinator.ts';
import type { PresenterReading } from './capability.ts';
import { deliverRequest } from './send-request.ts';

/**
 * The Agent-Mode execution path: act, using the injected capability.
 *
 * This is the only module that plans native tasks (acquisition previews) or starts/enqueues a
 * multi-pass reading job. It receives the capability as `ports`, which the presenter builds from
 * `PresenterServices.agent` only when the frozen mode is `'agent'`; the Chat path never reaches this
 * module or these ports. The presenter keeps ownership of the capability itself (port acquisition,
 * subscription and caching), so this module only sequences the Agent decision and its side effects.
 */
export interface AgentPorts {
  /** The task orchestration port. Acquiring it is what subscribes the presenter to task review. */
  tasks(): Promise<ActionTasks>;
  /** The multi-pass reading port for this client. Acquiring it subscribes reading-job progress. */
  reading(client: ReaderClient): Promise<PresenterReading>;
}

export interface AgentSendContext {
  ports: AgentPorts;
  client: ReaderClient;
  conversationId: string;
  request: SendInput;
  /** A non-null plan is the multi-pass plan; the Agent path turns it into a durable reading job. */
  plan: ContextPlan | null;
  queued: boolean;
  /** Present only for a validated acquisition request: the chosen target and parsed identifiers. */
  acquisition: { target: NativeCollectionTarget; identifiers: string[] } | null;
  /** Human label for the multi-pass reading row the reading coordinator will report. */
  scopeLabel: string;
  acceptTask(task: ActionTaskRecord): void;
  acceptReading(job: ReadingJob): void;
  describeReading(description: { question: string; scopeLabel: string }): void;
}

export async function executeAgentSend(context: AgentSendContext): Promise<void> {
  if (context.acquisition) {
    const task = await (await context.ports.tasks()).planAcquisition({
      conversationId: context.conversationId,
      target: context.acquisition.target,
      question: context.request.question,
      identifiers: context.acquisition.identifiers,
    });
    context.acceptTask(task);
    return;
  }
  if (context.plan) {
    const reading = await context.ports.reading(context.client);
    context.describeReading({ question: context.request.question, scopeLabel: context.scopeLabel });
    context.acceptReading(await (context.queued ? reading.enqueue(context.request, context.plan) : reading.start(context.request, context.plan)));
    return;
  }
  await deliverRequest(context.client, context.request, context.queued);
}
