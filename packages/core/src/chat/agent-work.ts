import type { Conversation } from '../../../contracts/src/index.ts';

/**
 * Does this conversation's own transcript evidence that it was used in Agent Mode?
 *
 * The presenter gates its Agent-infrastructure access on this so that a pure Chat-Mode chat can be
 * deleted (and only deleted) without acquiring the task controller or the reading coordinator, while
 * a chat that ever ran Agent work still gets the busy check that protects unfinished tasks and
 * reading jobs. Pure and host-agnostic: it reads the persisted conversation record only.
 *
 * Evidence, any one of which is enough:
 *
 *   - `message.mode === 'agent'`: the request was frozen as Agent Mode (Stage 1+). This is the
 *     authoritative signal and survives a reopen, when the composer itself defaults back to Chat.
 *   - `message.batch`: the request belongs to a multi-pass reading job. This is the one signal that
 *     also covers an unfinished reading job created from a Chat-Mode send during the Stage 6-7
 *     escalation leak, whose message was still frozen as `mode: 'chat'`. `batch` is set only by the
 *     reading coordinator, so its presence is unambiguous.
 *   - a non-`read` `workflow.skill.workflow`: the acquisition/annotation/diagram skills are what
 *     create native tasks, and this covers records written before `mode` was persisted (D3 legacy).
 *
 * A legacy record with no `mode` and no Agent workflow is treated as Chat (D3), exactly as the
 * original request hash and every other mode read treat it. Only user requests ever carry these
 * fields, but scanning both roles is simpler and cannot produce a false positive, since the fields
 * are absent on assistant messages regardless.
 */
export function conversationHasAgentWork(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;
  return conversation.messages.some(message => {
    if (message.mode === 'agent' || message.batch) return true;
    const workflow = message.workflow?.skill?.workflow;
    return !!workflow && workflow !== 'read';
  });
}
