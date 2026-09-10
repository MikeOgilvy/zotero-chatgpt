import { describe, it, expect } from 'vitest';
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
