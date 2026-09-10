import type { RequestState } from '../../../contracts/src/index.ts';
export interface RequestLogRecord {
  schemaVersion: 1;
  n: number;
  requestId: string;
  state: RequestState;
  turnId: string | null;
  at: string;
}
const STATES: RequestState[] = ['accepted', 'dispatching', 'running', 'completed', 'cancelled', 'failed', 'uncertain'];
export function encodeRequestLog(record: RequestLogRecord): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(record)}\n`);
}
export function parseRequestLog(bytes: Uint8Array): { records: RequestLogRecord[]; truncated: boolean } {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const truncated = text.length > 0 && !text.endsWith('\n');
  const lines = text.split('\n');
  if (truncated) lines.pop();
  else if (lines.at(-1) === '') lines.pop();
  const records: RequestLogRecord[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      if (row.schemaVersion !== 1 || typeof row.n !== 'number' || !Number.isSafeInteger(row.n) || row.n < 1) continue;
      if (typeof row.requestId !== 'string' || typeof row.state !== 'string' || !STATES.includes(row.state as RequestState)) continue;
      if (row.turnId !== null && typeof row.turnId !== 'string') continue;
      if (typeof row.at !== 'string') continue;
      records.push({ schemaVersion: 1, n: row.n, requestId: row.requestId, state: row.state as RequestState, turnId: row.turnId, at: row.at });
    } catch { /* a corrupt complete line is skipped; the file is left untouched */ }
  }
  return { records, truncated };
}
