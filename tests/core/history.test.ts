import { describe, expect, it } from 'vitest';
import { parseThreadHistory } from '../../packages/core/src/codex/history.ts';
describe('thread history', () => {
  it('matches a turn by clientUserMessageId or userMessage clientId and keeps agent text', () => {
    const requestId = '11111111-0000-4000-8000-000000000001';
    const history = parseThreadHistory({
      thread: {
        turns: [{
          id: 'turn-1',
          status: 'completed',
          clientUserMessageId: requestId,
          items: [
            { type: 'userMessage', id: 'u1', clientId: requestId },
            { type: 'agentMessage', id: 'item-1', text: '对账得到的回答', phase: 'final_answer' },
          ],
        }],
      },
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.requestIds).toEqual([requestId, requestId]);
    expect(history[0]?.agentMessages).toEqual([{ itemId: 'item-1', text: '对账得到的回答', phase: 'final_answer' }]);
  });
  it('rejects a malformed thread/read payload', () => {
    expect(() => parseThreadHistory({ thread: { turns: 'nope' } })).toThrow(/history/i);
  });
});
