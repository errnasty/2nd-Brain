/**
 * How much each of your feeds has earned.
 *
 * ## Why corroboration needed this
 *
 * The brief's backbone signal is corroboration: how many DISTINCT feeds carried
 * a story. That is a good measure with one unexamined assumption in it — that
 * every feed's vote is worth the same. It isn't. A subscription list built over
 * a year contains three outlets whose every piece gets opened and two
 * aggregators whose items are marked read in bulk and never touched. Counting
 * those five equally means an aggregator pile-up outranks a story the reader's
 * actual sources agreed on.
 *
 * The evidence to fix it is already in the database and has been all along:
 * which feeds' articles get opened, starred and saved for later. Nothing new is
 * collected, nothing is asked of the reader, and there is no setting — a feed
 * earns its weight by being read.
 *
 * ## Deliberately gentle, and deliberately silent
 *
 * Trust multiplies a feed's contribution to corroboration within a bounded
 * range and adds a small term to a story's score. It cannot silence a feed:
 * a source you rarely open still carries stories, and "I don't usually read
 * this outlet" is a much weaker claim than "this story doesn't matter". If you
 * want a feed gone, deleting it is right there and is a decision worth making
 * on purpose rather than accumulating by accident — the same reasoning as desk
 * verdicts in `brief-feedback.ts`.
 *
 * A reader with no history at all gets a uniform 1.0 for every feed, which is
 * exactly the behaviour that existed before this file. Trust only ever
 * *differentiates* feeds once there is something to differentiate them by.
 *
 * Pure: the query lives in `feed-trust-store.ts`, the arithmetic lives here.
 */

/** One feed's engagement over the trust window. */
export type FeedEngagement = {
  feedId: string;
  /** Articles delivered by this feed in the window. */
  delivered: number;
  /** …of which were marked read. */
  read: number;
  /** …of which were starred or saved for later. A much stronger signal. */
  saved: number;
};

/** Days of history trust is computed over. */
export const TRUST_WINDOW_DAYS = 60;

/**
 * Articles a feed must have delivered before its rate means anything. Below
 * this it stays neutral: a feed that delivered two articles and had both read
 * is not five times more trustworthy than one with a hundred, it is a feed
 * about which almost nothing is known.
 */
export const MIN_DELIVERED_FOR_TRUST = 8;

/** Bounds. Narrow on purpose — see the header. */
export const MIN_TRUST = 0.75;
export const MAX_TRUST = 1.35;

/**
 * Saving something is worth several reads.
 *
 * Marking read is ambiguous — it happens by bulk-clearing a backlog as often as
 * by finishing a piece — while starring or saving for later is a deliberate act
 * about one article. So the rate that drives trust weighs them accordingly
 * rather than treating "read" as the measure of a good feed.
 */
const SAVE_WEIGHT = 4;

/**
 * Engagement rate for one feed, in `[0, 1]`-ish: reads plus weighted saves over
 * what it delivered. Can exceed 1 for a feed whose every article is saved,
 * which the trust curve then clamps.
 */
export function engagementRate(e: FeedEngagement): number {
  if (e.delivered <= 0) return 0;
  return (e.read + e.saved * SAVE_WEIGHT) / e.delivered;
}

/**
 * Trust multipliers per feed, centred on the reader's own average.
 *
 * Centring matters more than it looks. An absolute threshold ("30% read rate is
 * good") is a claim about reading habits in general, and it is wrong for both
 * the completionist who opens everything and the skimmer who opens two things a
 * week — the first would have every feed trusted and the second none, which in
 * both cases is the same as having no signal while pretending otherwise.
 * Against their OWN average, both get a usable ranking of their own feeds.
 *
 * Returns only the feeds it has an opinion about; everything absent is 1.0.
 */
export function feedTrust(rows: FeedEngagement[]): Record<string, number> {
  const eligible = rows.filter((r) => r.delivered >= MIN_DELIVERED_FOR_TRUST);
  if (eligible.length < 2) return {};

  const rates = eligible.map(engagementRate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return {};

  const out: Record<string, number> = {};
  eligible.forEach((r, i) => {
    // Ratio to the reader's mean, compressed by a square root so a feed read
    // four times as often as average lands at twice the weight rather than
    // four times it, then clamped. Compression before clamping keeps the
    // middle of the range meaningful instead of pinning every keen feed to the
    // ceiling.
    const ratio = Math.sqrt(rates[i] / mean);
    out[r.feedId] = Math.min(MAX_TRUST, Math.max(MIN_TRUST, ratio));
  });
  return out;
}

/**
 * Corroboration for a story, counting feeds by what they have earned.
 *
 * Replaces a plain `distinctFeeds` count. Three outlets the reader actually
 * reads agreeing on something outweighs four they never open — which is what
 * "distinct feeds" was always trying to measure and could not.
 */
export function trustedFeedCount(feedIds: string[], trust: Record<string, number>): number {
  const distinct = new Set(feedIds);
  let total = 0;
  for (const id of distinct) total += trust[id] ?? 1;
  return total;
}
