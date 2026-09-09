import { RuntimeFailure, type StoragePort, type SyntheticRequest } from '../../../contracts/src/runtime.ts';
import { record } from '../codex/transport.ts';
const states = ['accepted', 'dispatching', 'running', 'completed', 'cancelled', 'failed', 'uncertain'];
export function active(request: SyntheticRequest | null) { return request !== null && ['accepted', 'dispatching', 'running'].includes(request.state); }
function parseRequest(value: unknown): SyntheticRequest {
  const r = record(value);
  if (typeof r.requestId !== 'string' || !r.requestId || r.requestId.length > 128 || typeof r.state !== 'string' || !states.includes(r.state) || typeof r.question !== 'string' || typeof r.model !== 'string' || typeof r.output !== 'string' || (r.error !== null && typeof r.error !== 'string')) throw new Error('Storage journal invalid');
  return { requestId: r.requestId, state: r.state as SyntheticRequest['state'], question: r.question, model: r.model, output: r.output, error: r.error };
}
export class RequestJournal {
  private requests: SyntheticRequest[] = [];
  private queue = Promise.resolve();
  private constructor(private storage: StoragePort) {}
  static async open(storage: StoragePort): Promise<RequestJournal> {
    const journal = new RequestJournal(storage);
    try {
      const bytes = await storage.read('s2-requests.json');
      if (bytes) {
        if (bytes.length > 16 * 1024 * 1024) throw new Error('size');
        const data = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown);
        if (data.version !== 1 || !Array.isArray(data.requests) || data.requests.length > 500) throw new Error('shape');
        journal.requests = data.requests.map(parseRequest);
        if (new Set(journal.requests.map(r => r.requestId)).size !== journal.requests.length) throw new Error('duplicate');
        if (journal.requests.some(active)) await journal.persist(journal.requests.map(r => active(r) ? { ...r, state: 'uncertain', error: 'Connection ended before confirmation; this request will not be resent.' } : r));
      }
      return journal;
    } catch { throw new RuntimeFailure('Storage journal unavailable; dispatch is disabled'); }
  }
  hasUncertain() { return this.requests.some(request => request.state === 'uncertain'); }
  latest(): SyntheticRequest | null { const value = this.requests.at(-1); return value ? { ...value } : null; }
  get(id: string) { const value = this.requests.find(r => r.requestId === id); return value ? { ...value } : null; }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  accept(request: SyntheticRequest): Promise<boolean> {
    return this.serial(async () => {
      parseRequest(request);
      const existing = this.get(request.requestId);
      if (existing) {
        if (existing.question !== request.question || existing.model !== request.model) throw new Error('Request ID conflict');
        return false;
      }
      if (this.hasUncertain()) throw new Error('An uncertain request must be reconciled before another submission');
      if (this.requests.some(active)) throw new Error('Request busy');
      if (this.requests.length >= 500) throw new Error('Request journal capacity exceeded');
      await this.persist([...this.requests, { ...request }]); return true;
    });
  }
  save(request: SyntheticRequest): Promise<void> {
    return this.serial(async () => {
      if (!this.get(request.requestId)) throw new Error('Request missing');
      await this.persist(this.requests.map(r => r.requestId === request.requestId ? { ...request } : r));
    });
  }
  private async persist(requests: SyntheticRequest[]) {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, requests }));
    if (bytes.length > 16 * 1024 * 1024) throw new Error('Storage journal capacity exceeded');
    try { await this.storage.writeAtomic('s2-requests.json', bytes); } catch { throw new Error('Storage journal write failed'); }
    this.requests = requests;
  }
}
