import type { ManagedProcess, StoragePort } from '../../packages/contracts/src/runtime.ts';
export class FakeProcess implements ManagedProcess {
  writes: string[] = [];
  onWrite: ((message: Record<string, unknown>) => void) | null = null;
  queue: string[] = [];
  reader: (() => void) | null = null;
  ended = false;
  terminated = false;
  push(text: string) { this.queue.push(text); this.reader?.(); }
  emit(value: unknown) { this.push(`${JSON.stringify(value)}\n`); }
  end() { this.ended = true; this.reader?.(); }
  stdout: AsyncIterable<string> = { [Symbol.asyncIterator]: async function* (this: FakeProcess) {
    while (!this.ended || this.queue.length) {
      const chunk = this.queue.shift();
      if (chunk !== undefined) yield chunk;
      else await new Promise<void>(resolve => { this.reader = resolve; });
    }
  }.bind(this) };
  writeStdin(chunk: string) { this.writes.push(chunk); this.onWrite?.(JSON.parse(chunk) as Record<string, unknown>); return Promise.resolve(); }
  async wait() { while (!this.ended) await new Promise<void>(resolve => { this.reader = resolve; }); return { exitCode: 0 }; }
  terminate() { this.terminated = true; this.end(); return Promise.resolve(); }
}
export class MemoryStorage implements StoragePort {
  files = new Map<string, Uint8Array>();
  writes: string[] = [];
  fail = false;
  read(path: string) { return Promise.resolve(this.files.get(path) ?? null); }
  writeAtomic(path: string, bytes: Uint8Array) { if (this.fail) return Promise.reject(new Error('private-storage-path')); this.files.set(path, bytes); this.writes.push(new TextDecoder().decode(bytes)); return Promise.resolve(); }
  append(path: string, bytes: Uint8Array) {
    if (this.fail) return Promise.reject(new Error('private-storage-path'));
    const previous = this.files.get(path) ?? new Uint8Array();
    const next = new Uint8Array(previous.length + bytes.length);
    next.set(previous, 0); next.set(bytes, previous.length);
    this.files.set(path, next); this.writes.push(new TextDecoder().decode(bytes)); return Promise.resolve();
  }
}
export async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
