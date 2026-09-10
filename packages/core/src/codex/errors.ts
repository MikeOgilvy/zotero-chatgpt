import type { ErrorCode } from '../../../contracts/src/index.ts';
export interface TurnFailure { code: ErrorCode; message: string; retryable: boolean }
// Maps the typed 0.144.1 `codexErrorInfo` of a failed turn to a stable code and constant,
// user-presentable text. The free-text upstream `message` is never copied: it may contain
// account or provider details that must not reach the UI, records or diagnostics.
const reasons: Record<string, TurnFailure> = {
  usageLimitExceeded: { code: 'RATE_LIMITED', message: 'The ChatGPT usage limit for this account has been reached; try again later or review the Codex usage settings.', retryable: true },
  sessionBudgetExceeded: { code: 'RATE_LIMITED', message: 'The session budget for this account has been exhausted.', retryable: false },
  contextWindowExceeded: { code: 'PAYLOAD_TOO_LARGE', message: 'The request exceeded the model context window; start a new conversation or select less text.', retryable: false },
  serverOverloaded: { code: 'RATE_LIMITED', message: 'The model service is overloaded; try again later.', retryable: true },
  unauthorized: { code: 'AUTH_REQUIRED', message: 'The model service rejected the account authorization; sign in again.', retryable: false },
  badRequest: { code: 'INVALID_REQUEST', message: 'The model service rejected the request.', retryable: false },
  internalServerError: { code: 'INTERNAL_ERROR', message: 'The model service reported an internal error.', retryable: true },
  cyberPolicy: { code: 'INVALID_REQUEST', message: 'The request was blocked by the provider policy.', retryable: false },
};
const connectionFailures = ['httpConnectionFailed', 'responseStreamConnectionFailed', 'responseStreamDisconnected', 'responseTooManyFailedAttempts'];
const generic: TurnFailure = { code: 'INTERNAL_ERROR', message: 'The model request failed.', retryable: false };
export function describeTurnError(error: unknown): TurnFailure {
  if (!error || typeof error !== 'object') return generic;
  const info = (error as Record<string, unknown>).codexErrorInfo;
  if (typeof info === 'string') return reasons[info] ?? generic;
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const [kind, detail] = Object.entries(info)[0] ?? [];
    if (kind && connectionFailures.includes(kind)) {
      const status = detail && typeof detail === 'object' ? (detail as Record<string, unknown>).httpStatusCode : undefined;
      return { code: 'RUNTIME_UNAVAILABLE', message: `The connection to the model service failed${typeof status === 'number' && Number.isInteger(status) ? ` (HTTP ${status})` : ''}; check network access and try again.`, retryable: true };
    }
  }
  return generic;
}
