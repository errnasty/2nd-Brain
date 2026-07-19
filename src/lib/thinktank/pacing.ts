/**
 * Daily pacing ("drip mode") for ThinkTank decks. A deck created with
 * pacing = "daily" unlocks DAILY_CARDS cards per calendar day (UTC) from its
 * creation date, instead of the whole deck at once. Pure date math — shared by
 * the reader (client) and the Today page (server) so both agree on what's
 * unlocked. Skipped days accumulate, so a lapsed user can catch up rather
 * than being locked to 5-forever-behind.
 */
export const DAILY_CARDS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight for a date — day boundaries are UTC so server and client agree. */
function utcDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/** How many cards of a daily-paced deck are unlocked right now. */
export function unlockedCardCount(createdAt: Date, cardCount: number, now: Date = new Date()): number {
  const days = Math.max(0, utcDay(now) - utcDay(createdAt));
  return Math.min(cardCount, DAILY_CARDS * (days + 1));
}
