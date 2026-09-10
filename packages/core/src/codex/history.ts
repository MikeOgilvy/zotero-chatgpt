import { record } from './transport.ts';
import { string } from './models.ts';
export interface HistoryTurn {
  id: string;
  status: 'inProgress' | 'completed' | 'interrupted' | 'failed';
  requestIds: string[];
  agentMessages: Array<{ itemId: string; text: string; phase: string | null }>;
  error: unknown;
}
const TURN_STATUS = ['inProgress', 'completed', 'interrupted', 'failed'] as const;
function parseTurn(value: unknown): HistoryTurn {
  const turn = record(value);
  const status = string(turn.status);
  if (!(TURN_STATUS as readonly string[]).includes(status)) throw new Error('Protocol turn status invalid');
  const requestIds: string[] = [];
  if (typeof turn.clientUserMessageId === 'string') requestIds.push(turn.clientUserMessageId);
  const agentMessages: HistoryTurn['agentMessages'] = [];
  const items = Array.isArray(turn.items) ? turn.items : [];
  for (const item of items) {
    const row = record(item);
    const type = string(row.type);
    if (type === 'userMessage') {
      if (typeof row.clientId === 'string') requestIds.push(row.clientId);
      if (typeof row.clientUserMessageId === 'string') requestIds.push(row.clientUserMessageId);
    }
    if (type === 'agentMessage') agentMessages.push({ itemId: string(row.id), text: typeof row.text === 'string' ? row.text : '', phase: typeof row.phase === 'string' ? row.phase : null });
  }
  return { id: string(turn.id), status: status as HistoryTurn['status'], requestIds, agentMessages, error: turn.error };
}
/** `thread/read` history used only for restart reconciliation; never exposed to the sidebar. */
export function parseThreadHistory(value: unknown): HistoryTurn[] {
  const thread = record(record(value).thread);
  if (!Array.isArray(thread.turns)) throw new Error('Protocol thread history invalid');
  return thread.turns.map(parseTurn);
}
