/**
 * What "today" means, for trending and for the Daily Brief.
 *
 * Trending answers "what is big RIGHT NOW", and the brief is a *daily* brief —
 * so both need one agreed answer to "which articles belong to today". It lives
 * here, on its own, because the two would otherwise define it separately and
 * drift: the moment the scoring window and the briefing window disagree, the
 * brief either leads on stories the trending pass has already retired, or drops
 * stories it has just promoted.
 *
 * ## Why a rolling 24 hours rather than a calendar day
 *
 * There is no per-user timezone anywhere in the app, so a calendar day could
 * only be a calendar day in UTC — and a UTC midnight boundary empties the brief
 * for every reader whose morning happens to fall just after it. A rolling
 * window is always "the last day of news" wherever the reader is, which is what
 * both features actually mean by the word.
 *
 * ## Why the boundary is snapped to the hour
 *
 * An unsnapped `now - 24h` moves every millisecond, so the set of articles
 * inside the window changes continuously. The brief hashes that set to detect
 * drift (`briefFingerprint`), and a boundary that never stops moving means a
 * half-generated brief can be invalidated by nothing but the clock ticking past
 * one stale article. Snapping to the hour makes the window stable between hour
 * boundaries, so the fingerprint only moves when the queue really does.
 */

/** Length of the window both features treat as "today". */
export const TRENDING_DAY_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Start of the current trending day: `now - 24h`, floored to the hour. The
 * window is therefore between 24 and 25 hours long — the extra minutes are the
 * price of a boundary that holds still, and they cost nothing but a slightly
 * longer tail of yesterday evening.
 */
export function trendingDayStart(now: Date = new Date()): Date {
  const raw = now.getTime() - TRENDING_DAY_HOURS * HOUR_MS;
  return new Date(Math.floor(raw / HOUR_MS) * HOUR_MS);
}

/**
 * Whether an article belongs to today's news.
 *
 * A missing publish date counts as outside the day: RSS items without one are
 * overwhelmingly old imports, and treating "unknown" as "today" would let them
 * take trending slots away from stories that really are breaking.
 */
export function isWithinTrendingDay(date: Date | null | undefined, now: Date = new Date()): boolean {
  if (!date) return false;
  const t = date.getTime();
  if (Number.isNaN(t)) return false;
  return t >= trendingDayStart(now).getTime();
}
