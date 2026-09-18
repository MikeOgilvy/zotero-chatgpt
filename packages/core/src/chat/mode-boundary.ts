import { ReaderError, type SendInput } from '../../../contracts/src/index.ts';
import { hasAgentWork } from './agent-work.ts';

/**
 * The runtime half of the Chat/Agent boundary.
 *
 * The presenter routes a request to `executeChatSend` or `executeAgentSend`, but the session service
 * is the one place where a request is validated, hashed and committed. It re-checks the structural
 * invariant rather than trusting the caller: a request that is not in Agent mode may not carry Agent
 * work (a multi-pass reading batch or a non-`read` skill), so a direct caller that skips the
 * presenter still cannot start a reading job or a native task as Chat. Plain reads — a document
 * context, citations, image attachments — are Chat work and pass through untouched.
 *
 * An absent `mode` is Chat, per the `SendInput.mode` contract, which is also what the request hash
 * and the transcript scan (`conversationHasAgentWork`) assume. Enforcement is on the acceptance path
 * only: a request already committed under an older build is not re-checked when it is recovered and
 * re-dispatched.
 */
export function assertModeBoundary(input: Pick<SendInput, 'mode' | 'batch' | 'workflow'>): void {
  if ((input.mode ?? 'chat') === 'agent' || !hasAgentWork(input)) return;
  if (input.batch) throw new ReaderError('UNSUPPORTED_INTERACTION', 'A multi-pass reading job is Agent work. Switch to Agent mode to run it.');
  const workflow = input.workflow?.skill?.workflow ?? 'this skill';
  throw new ReaderError('UNSUPPORTED_INTERACTION', `The "${workflow}" skill changes the library or the PDF, so it needs Agent mode. Switch to Agent mode to run it.`);
}
