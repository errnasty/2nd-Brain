/**
 * The refresher ladder for saved concepts.
 *
 * ## Why this and not FSRS
 *
 * `src/lib/srs/fsrs.ts` is a good scheduler and it is right there. It is also
 * the wrong tool here, for one structural reason: FSRS schedules from a RECALL
 * GRADE, and a refresher has no grade. To use it we would have to ask "how well
 * did you remember that?" after every nudge — which is the exact ceremony this
 * mode exists to avoid. Saving something should cost one tap and no decisions.
 *
 * So the schedule is a fixed ladder, and the only signal that moves you along
 * it is showing up. It is less clever than FSRS and that is the point: nothing
 * to configure, nothing to grade, nothing to explain.
 *
 * If graded refreshers are ever wanted, promoting a concept into
 * `directory_flashcards` is the upgrade path — the machinery is already built.
 *
 * Pure: no db, no clock except an injected `now`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Intervals in days, by stage.
 *
 * Roughly the classic expanding schedule: catch it before the first night's
 * forgetting, then at a week, a month, a quarter. The last entry repeats for
 * every stage beyond it — a concept you keep meeting stops needing new
 * intervals invented for it.
 */
export const REFRESH_LADDER_DAYS = [1, 7, 30, 90] as const;

/** The interval for a stage, clamped to the end of the ladder. */
export function intervalDaysForStage(stage: number): number {
  const i = Math.max(0, Math.min(REFRESH_LADDER_DAYS.length - 1, Math.floor(stage)));
  return REFRESH_LADDER_DAYS[i];
}

/** When a concept at `stage` should next be surfaced. */
export function nextRefresherAt(stage: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + intervalDaysForStage(stage) * DAY_MS);
}

export type RefreshOutcome = "remembered" | "forgot";

/**
 * The stage after a refresher.
 *
 * "Remembered" advances one rung; "forgot" drops back to the start rather than
 * one rung. A concept you have just failed to recall is, for scheduling
 * purposes, a new concept — stepping down gently would keep showing it at
 * month-long intervals it has already proven too long.
 */
export function advanceStage(stage: number, outcome: RefreshOutcome): number {
  if (outcome === "forgot") return 0;
  return Math.min(REFRESH_LADDER_DAYS.length - 1, Math.max(0, Math.floor(stage)) + 1);
}

/** Whether a saved concept is due. */
export function isDue(nextRefresherAt: Date | string, now: Date = new Date()): boolean {
  const due = new Date(nextRefresherAt).getTime();
  // An unreadable timestamp counts as due: a nudge you didn't need is a far
  // smaller failure than a saved concept that silently never comes back.
  if (!Number.isFinite(due)) return true;
  return due <= now.getTime();
}

/** Human label for how long until the next refresher, for the save affordance. */
export function ladderSummary(): string {
  const [first, ...rest] = REFRESH_LADDER_DAYS;
  const label = (d: number) => (d === 1 ? "a day" : d === 7 ? "a week" : d === 30 ? "a month" : `${d} days`);
  return [label(first), ...rest.slice(0, 2).map(label)].join(", then ");
}
