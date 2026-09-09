// Maps the typed 0.144.1 `codexErrorInfo` of a failed turn to constant, user-presentable
// text. The free-text upstream `message` is never copied: it may contain account or
// provider details that must not reach the UI, records or diagnostics.
const reasons: Record<string, string> = {
  usageLimitExceeded: 'The ChatGPT usage limit for this account has been reached; try again later or review the Codex usage settings.',
  sessionBudgetExceeded: 'The session budget for this account has been exhausted.',
  contextWindowExceeded: 'The request exceeded the model context window.',
  serverOverloaded: 'The model service is overloaded; try again later.',
  unauthorized: 'The model service rejected the account authorization; sign in again.',
  badRequest: 'The model service rejected the request.',
  internalServerError: 'The model service reported an internal error.',
  cyberPolicy: 'The request was blocked by the provider policy.',
};
const connectionFailures = ['httpConnectionFailed', 'responseStreamConnectionFailed', 'responseStreamDisconnected', 'responseTooManyFailedAttempts'];
export function describeTurnError(error: unknown): string {
  const generic = 'The model request failed.';
  if (!error || typeof error !== 'object') return generic;
  const info = (error as Record<string, unknown>).codexErrorInfo;
  if (typeof info === 'string') return reasons[info] ?? generic;
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const [kind, detail] = Object.entries(info)[0] ?? [];
    if (kind && connectionFailures.includes(kind)) {
      const status = detail && typeof detail === 'object' ? (detail as Record<string, unknown>).httpStatusCode : undefined;
      return `The connection to the model service failed${typeof status === 'number' && Number.isInteger(status) ? ` (HTTP ${status})` : ''}; check network access and try again.`;
    }
  }
  return generic;
}
