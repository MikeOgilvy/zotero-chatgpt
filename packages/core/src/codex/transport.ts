import type { ManagedProcess } from '../../../contracts/src/runtime.ts';
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Protocol shape invalid');
  return value as Record<string, unknown>;
}
export class RpcTransport {
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private writes = Promise.resolve();
  private failure: Error | null = null;
  private failureSignal: Promise<Error>;
  private signalFailure!: (error: Error) => void;
  private closeFlight: Promise<void> | null = null;
  private maxLine: number;
  private maxPending: number;
  private listeners = new Set<(message: Record<string, unknown>) => void>();
  private failures = new Set<() => void>();
  constructor(private process: ManagedProcess, options: { maxLineChars?: number; maxPending?: number } = {}) {
    this.failureSignal = new Promise(resolve => { this.signalFailure = resolve; });
    // A supported 16 MiB image expands to roughly 22 MiB of base64 plus JSON.
    this.maxLine = options.maxLineChars ?? 32 * 1024 * 1024;
    this.maxPending = options.maxPending ?? 64;
    void this.read();
  }
  subscribe(listener: (message: Record<string, unknown>) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onFailure(listener: () => void) { this.failures.add(listener); return () => { this.failures.delete(listener); }; }
  /** Read-only capability/status queries only; a missed deadline does not poison the main channel. */
  requestOptional(method: string, params: unknown, timeoutMs = 10000): Promise<unknown> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return Promise.reject(new Error('Invalid optional request deadline'));
    return this.requestWithDeadline(method, params, timeoutMs, false);
  }
  request(method: string, params: unknown): Promise<unknown> { return this.requestWithDeadline(method, params, 60000, true); }
  private requestWithDeadline(method: string, params: unknown, timeoutMs: number, fatal: boolean): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= this.maxPending) return Promise.reject(new Error('Protocol capacity exceeded'));
    const id = ++this.nextId;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        if (fatal) this.fail(new Error('Protocol response timed out'));
        else { this.pending.delete(id); reject(new Error('Optional protocol response timed out')); }
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    void this.send({ id, method, params }).catch(() => { /* send fails all pending requests */ });
    return result;
  }
  notify(method: string, params?: unknown) { return this.send(params === undefined ? { method } : { method, params }); }
  respond(id: unknown, result: unknown) { return this.send({ id, result }); }
  rejectRequest(id: unknown) { return this.send({ id, error: { code: -32601, message: 'Unsupported interaction' } }); }
  private send(value: unknown): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    const serialized = JSON.stringify(value) + '\n';
    const write = this.writes.then(async () => {
      if (this.failure) throw this.failure;
      await Promise.race([this.process.writeStdin(serialized), this.failureSignal.then(error => { throw error; })]);
    });
    this.writes = write.catch(() => { this.fail(new Error('Protocol transport closed')); });
    return write;
  }
  private async read() {
    let buffer = '';
    try {
      for await (const chunk of this.process.stdout) {
        if (this.failure) return;
        // Walk lines before appending to keep the retained buffer strictly bounded.
        for (const part of chunk.split(/(?<=\n)/u)) {
          if (this.failure) return;
          if (buffer.length + part.length > this.maxLine) throw new Error('Protocol frame too large');
          buffer += part;
          if (!buffer.endsWith('\n')) continue;
          const line = buffer.trim(); buffer = '';
          if (!line) continue;
          let value: unknown;
          try { value = JSON.parse(line); } catch { throw new Error('Protocol JSON invalid'); }
          const message = record(value);
          if ('method' in message) {
            if (typeof message.method !== 'string') throw new Error('Protocol method invalid');
            for (const listener of this.listeners) listener(message);
          } else if (typeof message.id === 'number') {
            const pending = this.pending.get(message.id);
            if (!pending) continue;
            this.pending.delete(message.id); clearTimeout(pending.timer);
            if ('error' in message) pending.reject(new Error('Upstream request failed'));
            else if ('result' in message) pending.resolve(message.result);
            else pending.reject(new Error('Protocol response invalid'));
          } else throw new Error('Protocol message invalid');
        }
      }
      this.fail(new Error(buffer ? 'Protocol truncated frame' : 'Protocol transport closed'));
    } catch { this.fail(new Error('Protocol transport closed or invalid framing')); }
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error; this.signalFailure(error);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    for (const listener of this.failures) listener();
  }
  close(): Promise<void> {
    this.fail(new Error('Protocol transport closed'));
    this.closeFlight ??= this.process.terminate(); return this.closeFlight;
  }
}
