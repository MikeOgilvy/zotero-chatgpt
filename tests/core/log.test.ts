import { describe, expect, it } from 'vitest';
import { encodeRequestLog, parseRequestLog } from '../../packages/core/src/sessions/log.ts';
const accepted = { schemaVersion: 1 as const, n: 1, requestId: '11111111-0000-4000-8000-000000000001', state: 'accepted' as const, turnId: null, at: '2026-09-09T08:00:00.000Z' };
const running = { schemaVersion: 1 as const, n: 2, requestId: accepted.requestId, state: 'running' as const, turnId: 'turn-1', at: '2026-09-09T08:00:01.000Z' };
describe('request log', () => {
  it('keeps complete JSONL records and drops a truncated tail without rewriting evidence', () => {
    const complete = new Uint8Array([...encodeRequestLog(accepted), ...encodeRequestLog(running)]);
    const truncated = new Uint8Array([...complete, ...new TextEncoder().encode('{"schemaVersion":1,"n":3,"state":"comp')]);
    const parsed = parseRequestLog(truncated);
    expect(parsed.truncated).toBe(true);
    expect(parsed.records).toEqual([accepted, running]);
    expect(new TextDecoder().decode(truncated)).toContain('"state":"comp');
  });
  it('skips a newer schema line and a corrupt complete line without throwing', () => {
    const lines = [
      JSON.stringify(accepted),
      JSON.stringify({ schemaVersion: 2, n: 2, requestId: accepted.requestId, state: 'completed' }),
      '{not-json}',
      JSON.stringify(running),
      '',
    ].join('\n') + '\n';
    const parsed = parseRequestLog(new TextEncoder().encode(lines));
    expect(parsed.truncated).toBe(false);
    expect(parsed.records).toEqual([accepted, running]);
  });
});
