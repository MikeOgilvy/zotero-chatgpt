import type { ErrorCode, RequestState, ShareableDiagnostics } from '../../../contracts/src/index.ts';
import { SHAREABLE_STORAGE_LOCATION } from '../../../contracts/src/index.ts';
export type { ShareableDiagnostics };
/** Whitelist-only report. Callers must not pass paper text, paths, tokens or account identifiers. */
export function shareableDiagnostics(input: {
  pluginVersion: string;
  runtimeVersion: string;
  errorCode?: ErrorCode | null;
  requests: Array<{ state: RequestState }>;
}): ShareableDiagnostics {
  const states: Partial<Record<RequestState, number>> = {};
  for (const request of input.requests) states[request.state] = (states[request.state] ?? 0) + 1;
  return {
    pluginVersion: input.pluginVersion,
    runtimeVersion: input.runtimeVersion,
    errorCode: input.errorCode ?? null,
    requestCount: input.requests.length,
    states,
    storageLocation: SHAREABLE_STORAGE_LOCATION,
  };
}
