import { describe, expect, it, vi } from 'vitest';
import type { SendInput } from '../../../packages/contracts/src/index.ts';
import type { ReaderClient } from '../../../packages/contracts/src/runtime.ts';
import type { NativeCollectionTarget } from '../../../packages/contracts/src/native.ts';
import type { ActionTasks } from '../../../packages/contracts/src/tasks.ts';
import type { ContextPlan } from '../../../packages/core/src/context/planner.ts';
import type { ReadingJob } from '../../../packages/core/src/context/coordinator.ts';
import type { PresenterReading } from '../../../packages/zotero/src/chat/capability.ts';
import { executeAgentSend, requestsCurrentPaperAnnotations, type AgentSendContext } from '../../../packages/zotero/src/chat/agent-execution.ts';

const request: SendInput = { question: 'Summarize all pages', requestId: 'r1' } as SendInput;
const plan = { mode: 'multi-pass' } as unknown as ContextPlan;
const job = { id: 'saved-job', conversationId: 'c1', status: 'reserved' } as unknown as ReadingJob;
const target: NativeCollectionTarget = { clientId: 'c', libraryId: 1, collectionKey: 'COLLECT1' };

/** A fake Agent capability whose ports are spies: the test observes exactly what Agent Mode reaches. */
function context(overrides: Partial<AgentSendContext> = {}) {
  const send = vi.fn(); const enqueue = vi.fn();
  const planAcquisition = vi.fn(() => Promise.resolve({ id: 'task-1' }));
  const start = vi.fn(() => Promise.resolve(job)); const enqueueReading = vi.fn(() => Promise.resolve(job));
  const acceptTask = vi.fn(); const acceptReading = vi.fn(); const describeReading = vi.fn();
  const tasks = vi.fn(() => Promise.resolve({ planAcquisition } as unknown as ActionTasks));
  const reading = vi.fn(() => Promise.resolve({ start, enqueue: enqueueReading } as unknown as PresenterReading));
  const client = { send, enqueue } as unknown as ReaderClient;
  const value: AgentSendContext = { ports: { tasks, reading }, client, conversationId: 'c1', request, plan: null, queued: false, acquisition: null, scopeLabel: 'Paper A', acceptTask, acceptReading, describeReading, ...overrides };
  return { send, enqueue, planAcquisition, start, enqueueReading, acceptTask, acceptReading, describeReading, tasks, reading, value };
}

describe('Agent execution path', () => {
  it('recognizes direct current-paper annotation actions without treating questions as actions', () => {
    for (const question of [
      '高亮当前论文最重要的 5 处内容，并简要说明原因。',
      '请帮我标注这篇文章的核心假设。',
      'Highlight the five most important claims in this paper.',
      'Underline the key claims in the current PDF.',
    ]) expect(requestsCurrentPaperAnnotations(question), question).toBe(true);
    for (const question of [
      '如何高亮当前论文？',
      '解释这篇论文里高亮的段落。',
      'Explain how highlighting works in PDFs.',
      'Highlight this button.',
      '总结当前论文最重要的 5 处内容。',
    ]) expect(requestsCurrentPaperAnnotations(question), question).toBe(false);
  });

  it('turns a multi-pass plan into a reading job through the injected capability', async () => {
    const f = context({ plan });
    await executeAgentSend(f.value);
    expect(f.reading).toHaveBeenCalledWith(f.value.client); expect(f.start).toHaveBeenCalledWith(request, plan);
    expect(f.acceptReading).toHaveBeenCalledWith(job);
    expect(f.describeReading).toHaveBeenCalledWith({ question: request.question, scopeLabel: 'Paper A' });
    expect(f.send).not.toHaveBeenCalled();
  });

  it('enqueues a queued multi-pass plan instead of starting it', async () => {
    const f = context({ plan, queued: true });
    await executeAgentSend(f.value);
    expect(f.enqueueReading).toHaveBeenCalledWith(request, plan); expect(f.start).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it('plans an acquisition preview through the task port and sends no model request', async () => {
    const f = context({ acquisition: { target, identifiers: ['10.1234/example'] } });
    await executeAgentSend(f.value);
    expect(f.planAcquisition).toHaveBeenCalledWith({ conversationId: 'c1', target, question: request.question, identifiers: ['10.1234/example'] });
    expect(f.acceptTask).toHaveBeenCalledWith({ id: 'task-1' }); expect(f.send).not.toHaveBeenCalled();
  });

  it('delivers a single-pass Agent request without planning a task or reading job', async () => {
    const f = context();
    await executeAgentSend(f.value);
    expect(f.send).toHaveBeenCalledWith(request);
    expect(f.tasks).not.toHaveBeenCalled(); expect(f.reading).not.toHaveBeenCalled();
  });
});
