import { type SendInput } from '../../../contracts/src/index.ts';
import type { ReaderClient } from '../../../contracts/src/runtime.ts';
import type { NativeCollectionTarget } from '../../../contracts/src/native.ts';
import type { ActionTaskRecord, ActionTasks } from '../../../contracts/src/tasks.ts';
import type { ContextPlan } from '../../../core/src/context/planner.ts';
import type { ReadingJob } from '../../../core/src/context/coordinator.ts';
import { detectActionIntent } from '../../../core/src/chat/action-intent.ts';
import type { PresenterReading } from './capability.ts';
import { traceMode } from './mode-trace.ts';
import { deliverRequest } from './send-request.ts';

const CHINESE_ANNOTATION_ACTION = /^(?:(?:请|请你|请帮我|帮我|麻烦|麻烦你|可以|能否)\s*)?(?:把\s*)?(?:当前|这|本)?(?:篇|份|个)?(?:论文|文章|文献|PDF)?(?:中|里|内|的)?\s*(?:高亮|标注|划线|画线|加下划线)/iu;
const CHINESE_DOCUMENT_TARGET = /(?:当前|这|本)(?:篇|份|个)?(?:论文|文章|文献|PDF)|(?:论文|文章|文献|PDF)(?:中|里|内|的)/iu;

/**
 * Recognize the narrow natural-language form that already names the native annotation action and
 * the current document. Agent mode may use this to select the built-in annotation workflow when the
 * owner did not explicitly select a skill. It is deliberately deterministic and conservative: an
 * explicit skill always wins, and questions about highlighting do not begin with an action verb.
 */
export function requestsCurrentPaperAnnotations(question: string): boolean {
  if (typeof question !== 'string') return false;
  const normalized = question.normalize('NFKC').trim();
  const intent = detectActionIntent(normalized);
  if (intent && ['annotate', 'highlight', 'mark', 'underline'].includes(intent.verb)) return true;
  return CHINESE_ANNOTATION_ACTION.test(normalized) && CHINESE_DOCUMENT_TARGET.test(normalized);
}

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
  // Acceptance trace: this is the only path that may acquire a task/reading port. A plain read sent
  // from Agent mode still says so honestly instead of pretending a capability was used.
  traceMode('[mode] agent');
  traceMode('[executor] agent');
  if (context.acquisition) {
    traceMode('[agent-runtime] STARTED tasks');
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
    traceMode('[agent-runtime] STARTED reading');
    const reading = await context.ports.reading(context.client);
    context.describeReading({ question: context.request.question, scopeLabel: context.scopeLabel });
    context.acceptReading(await (context.queued ? reading.enqueue(context.request, context.plan) : reading.start(context.request, context.plan)));
    return;
  }
  traceMode('[agent-runtime] NOT STARTED (plain read; no task or reading capability)');
  await deliverRequest(context.client, context.request, context.queued);
}
