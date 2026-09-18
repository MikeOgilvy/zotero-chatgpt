import { ReaderError, type SendInput } from '../../../contracts/src/index.ts';
import type { ReaderClient } from '../../../contracts/src/runtime.ts';
import type { ReaderSkill } from '../../../contracts/src/workspace.ts';
import { detectActionIntent } from '../../../core/src/chat/action-intent.ts';
import type { ContextPlan } from '../../../core/src/context/planner.ts';
import { traceMode } from './mode-trace.ts';
import { deliverRequest } from './send-request.ts';

/**
 * The Chat-Mode execution path: read context + reason + answer.
 *
 * Everything this module may touch is a read-side port plus the model request itself. It has no
 * `AgentCapability` member, no import of `core/context/coordinator` (the reading coordinator, and so
 * no reading job), and no import of `core/tasks` or `zotero/actions` (native writes):
 *
 *   - a skill that is not a plain read is refused before the request is built,
 *   - a plainly imperative library/PDF mutation is refused by the deterministic classifier,
 *   - a context that needs a multi-pass read is refused instead of escalated to a reading job.
 *
 * The presenter's `submit()` is the only caller, and only when the mode frozen on the request is
 * `'chat'`. The structural test in `tests/build/dependency-boundaries.test.ts` asserts this file's
 * imports and the absence of an `agent` member on `ChatSendContext`.
 */
export interface ChatSendContext {
  client: ReaderClient;
  request: SendInput;
  queued: boolean;
  /**
   * The shared context plan. A non-null plan is always the multi-pass plan: a single-pass request
   * carries the pages inline and plans nothing.
   */
  plan: ContextPlan | null;
}

/**
 * Chat never starts a reading job. `planInput()` already recorded the honest `multi-pass` context
 * report, so the refusal names the measured condition and the action the owner can take instead.
 */
export function refuseChatMultiPass(plan: ContextPlan | null): void {
  if (!plan) return;
  throw new ReaderError('PAYLOAD_TOO_LARGE', 'This source needs a long multi-pass read, which is an Agent action. Switch to Agent mode, or narrow the page range and try again.');
}

/**
 * Chat runs plain-read skills only. A skill that generates images or changes the PDF/library is an
 * Agent action; refusing here keeps the request from ever reaching the model or the write path.
 */
export function refuseChatWorkflow(workflow: ReaderSkill['workflow'] | null | undefined): void {
  if (!workflow || workflow === 'read') return;
  if (workflow === 'acquire') throw new ReaderError('UNSUPPORTED_INTERACTION', 'Acquiring articles is an Agent action. Switch to Agent mode to run it.');
  if (workflow === 'diagram') throw new ReaderError('UNSUPPORTED_INTERACTION', 'Image generation is an Agent action. Switch to Agent mode to run it.');
  throw new ReaderError('UNSUPPORTED_INTERACTION', `The "${workflow}" skill changes the library or the PDF, so it needs Agent mode. Switch to Agent mode to run it.`);
}

/**
 * Refuse an imperative library/PDF mutation typed into Chat Mode. The classifier is conservative and
 * syntactic; an ordinary question — including "explain how highlighting works in PDFs" — returns
 * null and is answered normally. The message is explicit that Agent Mode is required, and nothing is
 * sent or planned.
 */
export function refuseChatAction(question: string): void {
  const intent = detectActionIntent(question);
  if (!intent) return;
  throw new ReaderError('UNSUPPORTED_INTERACTION', `That reads as an action on your Zotero library or files ("${intent.verb} ${intent.target}"). Agent mode is required: switch to Agent mode to run it, or ask a question about the current paper.`);
}

/** The one Chat-Mode send entry point: refuse anything that would act, then deliver one request. */
export async function executeChatSend(context: ChatSendContext): Promise<void> {
  // Acceptance trace: a Chat send reads context and delivers one model request. It never acquires a
  // task/reading port, so no Agent capability (and no reading job) is started for this request.
  traceMode('[mode] chat');
  traceMode('[executor] chat');
  traceMode('[agent-runtime] NOT STARTED');
  refuseChatMultiPass(context.plan);
  await deliverRequest(context.client, context.request, context.queued);
}
