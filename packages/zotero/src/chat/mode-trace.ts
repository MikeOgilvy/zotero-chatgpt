/**
 * Temporary acceptance trace for the Chat/Agent split. One line per transition so the owner can read
 * the real execution path from the Zotero browser console:
 *
 *   [mode] chat
 *   [executor] chat
 *   [agent-runtime] NOT STARTED
 *
 * versus
 *
 *   [mode] agent
 *   [executor] agent
 *   [agent-runtime] STARTED reading
 *
 * `console.debug` is used instead of `Zotero.debug` so the chat modules stay host-free (the reader
 * build can drop the Zotero adapter) and so the lines are filtered out unless the browser console is
 * open. Logging itself must never break a send, so failures are swallowed.
 */
export function traceMode(line: string): void {
  try {
    console.debug(line);
  } catch {
    /* a missing console must never abort a request */
  }
}
