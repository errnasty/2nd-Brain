/**
 * How much feed history is kept.
 *
 * Its own dependency-free module because two very different callers need it and
 * neither should drag the other in: `lib/rss/sync.ts` does the deleting and
 * imports the database, while `lib/today/feed-trust.ts` is deliberately pure so
 * its arithmetic stays unit-testable.
 *
 * ## Why anything that counts articles has to know this number
 *
 * The purge is SELECTIVE — it deletes read and archived articles, and keeps
 * unread, starred, read-later and anything saved to the Directory. That
 * selectivity is what makes a longer window dangerous rather than merely
 * smaller: past the cutoff the read articles are gone and the unread ones are
 * not, so any rate of the form read ÷ delivered is computed over a leftover
 * that is biased against exactly the thing it is measuring. A feed you read
 * religiously would score WORSE than one you ignore, because the evidence of
 * reading is what got collected.
 *
 * A sample that stops at the cutoff is simply a smaller sample, and honest. So
 * every window derived from `articles` is capped to this, and
 * `retention.test.ts` fails the build if a new one is not.
 *
 * Stats that must outlive the window do not count rows at all: XP, levels,
 * stats and achievements all read incrementing counters on `player_profile`,
 * and Study reads the `directory_*` tables, which the purge never touches.
 */
export const RETENTION_DAYS = 30;

/** Milliseconds in the retention window. */
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * A window over `articles`, clamped to what still exists.
 *
 * Pass the window the signal would ideally like; get back the longest one the
 * data can actually support.
 */
export function articleWindowDays(preferredDays: number): number {
  return Math.min(preferredDays, RETENTION_DAYS);
}
