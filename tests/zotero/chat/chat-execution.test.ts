import { describe, expect, it, vi } from 'vitest';
import { ReaderError, type SendInput } from '../../../packages/contracts/src/index.ts';
import type { ReaderClient } from '../../../packages/contracts/src/runtime.ts';
import type { ContextPlan } from '../../../packages/core/src/context/planner.ts';
import { executeChatSend, refuseChatAction, refuseChatMultiPass, refuseChatWorkflow } from '../../../packages/zotero/src/chat/chat-execution.ts';

const request = { question: 'Explain Figure 3.' } as SendInput;
/** A read-side client whose `send`/`enqueue` are standalone spies, so the assertions name no method. */
function client() {
  const send = vi.fn(); const enqueue = vi.fn();
  return { send, enqueue, port: { send, enqueue } as unknown as ReaderClient };
}

describe('Chat execution path', () => {
  it('refuses a plainly imperative library/PDF mutation with an Agent-mode message', () => {
    for (const question of ['Highlight all important claims in this paper.', 'Fix the metadata for this item.', 'Create notes from this paper and save them to Zotero', 'Find these papers in my library and organize them into a collection']) {
      expect(() => refuseChatAction(question)).toThrow(/Agent mode is required/u);
    }
  });

  it('does not refuse the ordinary Chat-Mode questions from the spec', () => {
    for (const question of ['Explain Figure 3.', 'Summarize this paper.', 'What does this equation mean?', 'Compare the method in this paper with predictive coding.', 'explain how highlighting works in PDFs']) {
      expect(() => refuseChatAction(question)).not.toThrow();
    }
  });

  it('refuses Agent-only skill workflows and allows a plain read', () => {
    for (const workflow of ['acquire', 'diagram', 'annotate'] as const) expect(() => refuseChatWorkflow(workflow)).toThrow(ReaderError);
    expect(() => refuseChatWorkflow('read')).not.toThrow();
    expect(() => refuseChatWorkflow(null)).not.toThrow();
  });

  it('delivers a single-pass request and never sends when the context needs a reading job', async () => {
    const plain = client(); await executeChatSend({ client: plain.port, request, queued: false, plan: null });
    expect(plain.send).toHaveBeenCalledWith(request);
    const multiPass = client();
    const plan = { mode: 'multi-pass', documents: [], budget: {}, coverage: {} } as unknown as ContextPlan;
    await expect(executeChatSend({ client: multiPass.port, request, queued: false, plan })).rejects.toThrow(/Agent mode/u);
    expect(multiPass.send).not.toHaveBeenCalled(); expect(multiPass.enqueue).not.toHaveBeenCalled();
    expect(() => refuseChatMultiPass(plan)).toThrow(/multi-pass/u);
    expect(() => refuseChatMultiPass(null)).not.toThrow();
  });

  it('queues without sending when the request is explicit', async () => {
    const queued = client(); await executeChatSend({ client: queued.port, request, queued: true, plan: null });
    expect(queued.enqueue).toHaveBeenCalledWith(request); expect(queued.send).not.toHaveBeenCalled();
  });
});
