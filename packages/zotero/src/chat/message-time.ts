/**
 * Transcript timestamp dividers. The transcript has no per-message `createdAt`: the only honest
 * clock is the recorded request timing, so a caller passes the matched `acceptedAt` and a reference
 * `now`. Anything unparseable yields `null` and the caller renders no divider rather than a
 * fabricated time.
 */
export function messageTimeLabel(acceptedAt: string, now: number, locale: string): string | null {
  const accepted = Date.parse(acceptedAt);
  if (!Number.isFinite(accepted)) return null;
  const reference = Number.isFinite(now) ? now : Date.now();
  const startOfDay = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const day = startOfDay(accepted);
  const today = startOfDay(reference);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(accepted);
  if (day >= today) return time;
  if (day >= today - 86_400_000) {
    // `numeric: 'auto'` gives the reader's own "yesterday"-style word instead of a fabricated date.
    const yesterday = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');
    return `${yesterday.charAt(0).toLocaleUpperCase(locale)}${yesterday.slice(1)} ${time}`;
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(accepted);
}
