/**
 * Turning verdicts on brief sections into weights the planner can use.
 *
 * ## Why the brief needed a loop at all
 *
 * Everything else about the brief is inference: which desks the reader follows,
 * how widely a story is covered, how close it sits to their notes. None of it
 * ever gets told whether the result was any good. A desk they follow that
 * keeps producing sections they skim stayed exactly as prominent the next day,
 * and there was no way to say so short of unfollowing the desk outright —
 * which is a blunt instrument for "less of this, but not none".
 *
 * ## Decay, and why it's linear
 *
 * A verdict is about the brief on the day it was given. Left undecayed, one
 * irritated click in March would still be shaping the brief in June. Linear
 * decay to zero over the window is deliberately gentler than the exponential
 * curves used for story freshness: a reader's taste in desks changes over
 * weeks, not hours, and a preference that halved every few days would need
 * re-stating constantly to hold.
 *
 * ## Bounded on purpose
 *
 * Weights are clamped to [-1, 1] and enter the planner alongside signals worth
 * two to three points, so feedback can nudge the ordering and never seize it.
 * A reader who dislikes one section of a desk for a week should not lose that
 * desk's coverage entirely — they have "unfollow" for that, and it is a
 * decision they should make on purpose rather than accumulate by accident.
 *
 * Pure: the query lives in the actions module, the arithmetic lives here.
 */

export type Verdict = "more" | "less";

export type FeedbackRow = {
  topicId: string | null;
  verdict: Verdict;
  createdAt: Date;
};

/** How long a verdict keeps any influence at all. */
export const FEEDBACK_WINDOW_DAYS = 30;

/** Ceiling on a desk's accumulated weight, in either direction. */
export const MAX_DESK_WEIGHT = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Weight of a single verdict, given how long ago it was cast. */
export function verdictWeight(row: FeedbackRow, now: Date): number {
  const age = now.getTime() - row.createdAt.getTime();
  if (!Number.isFinite(age) || age < 0) return row.verdict === "more" ? 1 : -1;
  const remaining = 1 - age / (FEEDBACK_WINDOW_DAYS * DAY_MS);
  if (remaining <= 0) return 0;
  return (row.verdict === "more" ? 1 : -1) * remaining;
}

/**
 * Desk weights from a user's recent verdicts, in [-1, 1].
 *
 * Rows without a topic (the lead) are skipped: the lead spans every desk, so
 * folding its verdict into one would attribute an opinion about the brief's
 * judgement to whichever desk happened to lead that morning.
 */
export function deskWeights(rows: FeedbackRow[], now: Date = new Date()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (!row.topicId) continue;
    const w = verdictWeight(row, now);
    if (w === 0) continue;
    out[row.topicId] = (out[row.topicId] ?? 0) + w;
  }
  for (const topicId of Object.keys(out)) {
    const clamped = Math.max(-MAX_DESK_WEIGHT, Math.min(MAX_DESK_WEIGHT, out[topicId]));
    if (clamped === 0) delete out[topicId];
    else out[topicId] = clamped;
  }
  return out;
}
