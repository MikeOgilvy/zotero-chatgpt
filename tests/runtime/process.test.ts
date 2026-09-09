/* eslint-disable @typescript-eslint/unbound-method -- assertions inspect injected spies without invoking them. */
import { describe, expect, it, vi } from 'vitest';
import { decodeStdout, GeckoProcessPort, type RawPipe, type NativeProcess } from '../../packages/zotero/src/runtime/process.ts';
function raw(...chunks: number[][]): RawPipe { return { read: vi.fn(() => Promise.resolve(Uint8Array.from(chunks.shift() ?? []).buffer)) }; }
async function text(stream: AsyncIterable<string>) { let value = ''; for await (const chunk of stream) value += chunk; return value; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
describe('Gecko byte stream and owned process', () => {
  it('preserves a multibyte-only prefix until actual raw EOF', async () => {
    expect(await text(decodeStdout(raw([0xe4], [0xb8], [0xad, 10], [0xf0], [0x9f, 0x98], [0x80])))).toBe('中\n😀');
  });
  it('rejects invalid and truncated UTF8 instead of silently replacing it', async () => {
    await expect(text(decodeStdout(raw([0xe4])))).rejects.toThrow();
    await expect(text(decodeStdout(raw([0xff])))).rejects.toThrow();
  });
  it('drains stderr, prevents environment inheritance and honors stdin backpressure', async () => {
    const exit = deferred<{ exitCode: number | null }>(); const write = deferred<number>();
    const stderr = raw([0xff, 0xfe], [12]);
    const native: NativeProcess = { stdin: { write: vi.fn(() => write.promise), close: vi.fn(() => { exit.resolve({ exitCode: 0 }); return Promise.resolve(); }) }, stdout: raw([97]), stderr, wait: () => exit.promise, kill: vi.fn(() => Promise.resolve()) };
    const call = vi.fn(() => Promise.resolve(native));
    const process = await new GeckoProcessPort({ call }).spawn({ executable: '/private/codex', args: ['app-server'], cwd: '/private/scratch', env: { HOME: '/private/home' } });
    let written = false; const pending = process.writeStdin('中').then(() => { written = true; });
    await Promise.resolve(); expect(written).toBe(false); write.resolve(3); await pending;
    expect(call.mock.calls[0]).toEqual([{ command: '/private/codex', arguments: ['app-server'], workdir: '/private/scratch', environment: { HOME: '/private/home' }, environmentAppend: false, stderr: 'pipe' }]);
    expect(await text(process.stdout)).toBe('a');
    await process.terminate(); await process.terminate();
    expect(await process.wait()).toEqual({ exitCode: 0 }); expect(native.stdin.close).toHaveBeenCalledTimes(1);
    expect(stderr.read).toHaveBeenCalledTimes(3); expect(native.kill).not.toHaveBeenCalled();
  });
  it('does not memoize a failed termination so the owner can retry stopping the same handle', async () => {
    const exit = deferred<{ exitCode: number | null }>(); let kills = 0;
    const native: NativeProcess = { stdin: { write: () => Promise.resolve(0), close: () => Promise.resolve() }, stdout: raw(), stderr: raw(), wait: () => exit.promise, kill: vi.fn(() => { if (++kills === 1) return Promise.reject(new Error('raw signal failure')); exit.resolve({ exitCode: -9 }); return Promise.resolve(); }) };
    const process = await new GeckoProcessPort({ call: () => Promise.resolve(native) }, 1).spawn({ executable: '/private/codex', args: [], cwd: '/private', env: {} });
    await expect(process.terminate()).rejects.toThrow('Unable to stop owned Codex process');
    await process.terminate(); expect(native.kill).toHaveBeenCalledTimes(2); expect(await process.wait()).toEqual({ exitCode: -9 });
  });
  it('kills only its owned handle when graceful close does not exit', async () => {
    const exit = deferred<{ exitCode: number | null }>();
    const native: NativeProcess = { stdin: { write: () => Promise.resolve(0), close: () => Promise.resolve() }, stdout: raw(), stderr: raw(), wait: () => exit.promise, kill: vi.fn(() => { exit.resolve({ exitCode: -9 }); return Promise.resolve(); }) };
    const process = await new GeckoProcessPort({ call: () => Promise.resolve(native) }, 1).spawn({ executable: '/private/codex', args: [], cwd: '/private', env: {} });
    await Promise.all([process.terminate(), process.terminate()]); expect(native.kill).toHaveBeenCalledTimes(1); expect(await process.wait()).toEqual({ exitCode: -9 });
  });
});
