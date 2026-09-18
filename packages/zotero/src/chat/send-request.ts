import { ReaderError, type SendInput } from '../../../contracts/src/index.ts';
import type { ReaderClient } from '../../../contracts/src/runtime.ts';

/**
 * One request handed to the conversation session, queued or sent immediately. This is the single
 * terminal step every execution path ends with, so the durable-queue availability check and the
 * send/enqueue choice have one owner instead of one copy per mode.
 */
export async function deliverRequest(client: ReaderClient, request: SendInput, queued: boolean): Promise<void> {
  if (queued) {
    if (!client.enqueue) throw new ReaderError('UNSUPPORTED_INTERACTION', 'Durable request queuing is unavailable. Your draft is kept.');
    await client.enqueue(request);
    return;
  }
  await client.send(request);
}
