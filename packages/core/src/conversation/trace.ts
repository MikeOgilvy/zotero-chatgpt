/**
 * Runtime instrumentation for the Chat/Agent split, so the owner can read the real path rather than
 * trust a label in the UI:
 *
 *   [conversation] mode=chat
 *   [execution-router] executor=chat
 *   [chat] request_started
 *   [agent] runtime_started=false
 *
 * Every line is derived from the object the service actually holds (the frozen mode, the selected
 * executor, the run's thread id). Nothing here prints an expected value. The sink is injected and
 * off by default — `ReaderOptions.trace` turns it on — so this stays a development diagnostic and
 * never becomes product noise or a privacy surface.
 */
export type Trace = (line: string) => void;
