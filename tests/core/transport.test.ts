import { describe, it, expect, vi } from 'vitest';
import { RpcTransport } from '../../packages/core/src/codex/transport.ts';
import { FakeProcess, flush } from './doubles.ts';
describe('JSONL transport', () => {
  it('correlates fragmented unicode and multiple lines independent of response order', async () => {
    const p = new FakeProcess(); const t = new RpcTransport(p);
    const a = t.request('a', {}); const b = t.request('b', {}); await flush();
    p.push('{"id":2,"result":"中文'); p.push('"}\n{"id":1,"result":42}\n');
    expect(await a).toBe(42); expect(await b).toBe('中文'); await t.close();
  });
  it.each(['{bad}\n', 'x'.repeat(65)])('fails pending requests on invalid/bounded framing', async chunk => {
    const p = new FakeProcess(); const t = new RpcTransport(p, { maxLineChars: 64 });
    const result = t.request('a', {}); const rejected = expect(result).rejects.toThrow('Protocol'); p.push(chunk); await rejected; await t.close();
  });
  it('rejects pending on EOF and redacts upstream errors', async () => {
    const p = new FakeProcess(); const t = new RpcTransport(p); const a = t.request('a', {});
    const rejection = expect(a).rejects.toThrow('Upstream request failed'); p.emit({ id: 1, error: { code: 123, message: 'secret-token' } }); await rejection;
    const b = t.request('b', {}); const eof = expect(b).rejects.toThrow('closed'); p.end(); await eof;
  });
  it('serializes writes and bounds pending pressure', async () => {
    const p = new FakeProcess(); let release!: () => void; p.writeStdin = () => new Promise<void>(resolve => { release = resolve; });
    const t = new RpcTransport(p, { maxPending: 1 }); const a = t.request('a', {}); const stopped = expect(a).rejects.toThrow(); await flush();
    await expect(t.request('b', {})).rejects.toThrow('capacity'); release(); await t.close(); await stopped;
  });
});
it('does not start the next stdin write before prior backpressure resolves', async () => {
  const p = new FakeProcess(); let release!: () => void; let writes = 0;
  p.writeStdin = () => { writes++; return new Promise<void>(resolve => { release = resolve; }); };
  const t = new RpcTransport(p); const a = t.request('a', {}); const b = t.request('b', {});
  const rejection = Promise.allSettled([a, b]); await flush(); expect(writes).toBe(1); release(); await flush(); expect(writes).toBe(2); release(); await t.close(); await rejection;
});
it('rejects truncated EOF without exposing the partial protocol frame', async () => {
  const p = new FakeProcess(); const t = new RpcTransport(p); const request = t.request('a', {}); const assertion = expect(request).rejects.toThrow('truncated');
  p.push('{"secret":"private-token'); p.end(); await assertion;
});
it('times out an optional request without breaking a main request and ignores its late response', async () => {
  vi.useFakeTimers(); const p = new FakeProcess(); const t = new RpcTransport(p, { maxPending: 2 });
  let optionalFailure: unknown = null;
  const optional = t.requestOptional('optional', {}, 20).catch(error => { optionalFailure = error; });
  try {
    await vi.advanceTimersByTimeAsync(21); expect(optionalFailure).toBeInstanceOf(Error);
    const main = t.request('main', {}); await flush();
    p.emit({ id: 1, result: 'Late optional data' }); p.emit({ id: 2, result: 'Main response' });
    expect(await main).toBe('Main response'); expect(p.terminated).toBe(false);
  } finally { await t.close(); await optional; vi.useRealTimers(); }
});
it('keeps the main request hard timeout after introducing optional requests', async () => {
  vi.useFakeTimers(); const p = new FakeProcess(); const t = new RpcTransport(p);
  try {
    const waiting = t.request('required', {}); const rejected = expect(waiting).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60000); await rejected;
    await expect(t.request('next', {})).rejects.toThrow('timed out');
  } finally { await t.close(); vi.useRealTimers(); }
});
it('accepts an exact bounded frame and rejects a valid JSON frame one character too large', async () => {
  const line = JSON.stringify({ method: 'synthetic/image', params: { result: 'a'.repeat(20) } }) + '\n';
  const p = new FakeProcess(); const t = new RpcTransport(p, { maxLineChars: line.length }); const notices: unknown[] = [];
  t.subscribe(notice => notices.push(notice)); p.push(line.slice(0, 10)); p.push(line.slice(10)); await flush();
  expect(notices).toHaveLength(1);
  const waiting = t.request('pending', {}); const failed = expect(waiting).rejects.toThrow('Protocol');
  p.push(line.slice(0, -1) + ' \n'); await failed; await t.close();
});
