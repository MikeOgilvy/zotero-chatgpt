import { describe, expect, it } from 'vitest';
import { advanceRequestTiming, requestProgress, type ReaderEvent, type RequestTiming } from '../../packages/contracts/src/index.ts';

const REQUEST = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const T0 = '2026-09-13T00:00:00.000Z';
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const running = (overrides: Partial<RequestTiming> = {}): RequestTiming => ({ requestId: REQUEST, acceptedAt: T0, firstTextAt: null, settledAt: null, ...overrides });
const delta = (seconds: number): ReaderEvent => ({ seq: 2, conversationId: 'c', requestId: REQUEST, at: at(seconds), type: 'delta', messageId: 'm', text: 'hi' });

describe('request progress', () => {
  it('counts whole seconds from acceptance while the request is still open', () => {
    const timing = running();
    expect(requestProgress(timing, at(0))).toEqual({ requestId: REQUEST, settled: false, elapsedSeconds: 0, firstTextSeconds: null, sinceActivitySeconds: null });
    expect(requestProgress(timing, at(9.4)).elapsedSeconds).toBe(9);
    expect(requestProgress(timing, Date.parse(at(61))).elapsedSeconds).toBe(61);
  });

  it('freezes the elapsed value at the settle time instead of counting past it', () => {
    const timing = running({ firstTextAt: at(3), settledAt: at(42) });
    const settled = requestProgress(timing, at(600));
    expect(settled.settled).toBe(true);
    expect(settled.elapsedSeconds).toBe(42);
    expect(settled.firstTextSeconds).toBe(3);
  });

  it('reports no counter for unreadable timestamps and never a negative one for a clock that ran backwards', () => {
    expect(requestProgress(running({ acceptedAt: 'not-a-date' }), at(5)).elapsedSeconds).toBeNull();
    expect(requestProgress(running(), at(-30)).elapsedSeconds).toBe(0);
  });
});

describe('advancing timing from core events', () => {
  it('stamps the first delivered text once and keeps it stable across later events', () => {
    const accepted = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(2), type: 'accepted' });
    expect(accepted[0]!.firstTextAt).toBeNull();
    const first = advanceRequestTiming(accepted, delta(5));
    expect(first[0]!.firstTextAt).toBe(at(5));
    const later = advanceRequestTiming(first, delta(9));
    expect(later[0]!.firstTextAt).toBe(at(5));
    expect(requestProgress(later[0]!, at(30)).firstTextSeconds).toBe(5);
  });

  it('stops the clock on a terminal event even when the view never saw text', () => {
    const stopped = advanceRequestTiming([running()], { seq: 4, conversationId: 'c', requestId: REQUEST, at: at(20), type: 'failed', code: 'INTERNAL_ERROR', message: 'no answer' });
    expect(stopped[0]!.settledAt).toBe(at(20));
    expect(stopped[0]!.firstTextAt).toBeNull();
    expect(requestProgress(stopped[0]!, at(900))).toEqual({ requestId: REQUEST, settled: true, elapsedSeconds: 20, firstTextSeconds: null, sinceActivitySeconds: 0 });
  });

  it('keeps the earliest terminal stamp and ignores empty text so a blank completion cannot fake first text', () => {
    const stopped = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(7), type: 'cancelled', messageId: null });
    const repeat = advanceRequestTiming(stopped, { seq: 2, conversationId: 'c', requestId: REQUEST, at: at(11), type: 'cancelled', messageId: null });
    expect(repeat[0]!.settledAt).toBe(at(7));
    const blank = advanceRequestTiming([running()], { seq: 3, conversationId: 'c', requestId: REQUEST, at: at(4), type: 'completed', messageId: 'm', finalText: '' });
    expect(blank[0]!.firstTextAt).toBeNull();
    expect(blank[0]!.settledAt).toBe(at(4));
  });

  it('leaves other requests and unknown requests untouched instead of inventing an acceptance time', () => {
    const entries = [running(), running({ requestId: OTHER, acceptedAt: at(1) })];
    const advanced = advanceRequestTiming(entries, delta(6));
    expect(advanced[1]).toEqual(entries[1]);
    const unknown = advanceRequestTiming(entries, { seq: 9, conversationId: 'c', requestId: '00000000-0000-4000-8000-000000000003', at: at(6), type: 'delta', messageId: 'm', text: 'hi' });
    expect(unknown).toEqual(entries);
    const unknownPing = advanceRequestTiming(entries, { seq: 9, conversationId: 'c', requestId: '00000000-0000-4000-8000-000000000003', at: at(6), type: 'progress' });
    expect(unknownPing).toEqual(entries);
    expect(advanceRequestTiming(undefined, delta(6))).toEqual([]);
  });
});

describe('request liveness', () => {
  it('reports no elapsed activity at all until something is heard, then counts from the last activity', () => {
    expect(requestProgress(running(), at(30)).sinceActivitySeconds).toBeNull();
    const heard = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(12), type: 'progress' });
    expect(heard[0]!.lastActivityAt).toBe(at(12));
    expect(requestProgress(heard[0]!, at(30))).toEqual({ requestId: REQUEST, settled: false, elapsedSeconds: 30, firstTextSeconds: null, sinceActivitySeconds: 18 });
  });

  it('stamps activity from a progress ping that carries no answer text and never fakes first text', () => {
    const ping = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(3), type: 'progress' });
    expect(ping[0]).toMatchObject({ firstTextAt: null, settledAt: null, lastActivityAt: at(3) });
    const later = advanceRequestTiming(ping, delta(9));
    expect(later[0]!.lastActivityAt).toBe(at(9));
    expect(later[0]!.firstTextAt).toBe(at(9));
  });

  it('moves the activity mark forward only, so a re-delivered or out-of-order event cannot fake freshness', () => {
    const heard = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(20), type: 'progress' });
    const older = advanceRequestTiming(heard, { seq: 2, conversationId: 'c', requestId: REQUEST, at: at(5), type: 'progress' });
    expect(older[0]!.lastActivityAt).toBe(at(20));
    expect(requestProgress(older[0]!, at(30)).sinceActivitySeconds).toBe(10);
  });

  it('keeps the activity mark honest when a request settles without ever producing text', () => {
    const stopped = advanceRequestTiming([running()], { seq: 1, conversationId: 'c', requestId: REQUEST, at: at(7), type: 'failed', code: 'INTERNAL_ERROR', message: 'no answer' });
    expect(stopped[0]).toMatchObject({ lastActivityAt: at(7), settledAt: at(7), firstTextAt: null });
    expect(requestProgress(stopped[0]!, at(900)).sinceActivitySeconds).toBe(0);
  });
});
