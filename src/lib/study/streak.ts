// Pure streak computation. Db-free + runtime-free for testability and reuse in
// a future local build.

/** UTC YYYY-MM-DD key for a date. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive-day streak ending at (or just before) today. A day counts if it
 * appears in `activeDays`. If today has no activity yet, the streak is measured
 * through yesterday (so it doesn't reset until a full day is missed).
 */
export function computeStreak(activeDays: Iterable<string>, today: Date = new Date()): number {
  const set = activeDays instanceof Set ? activeDays : new Set(activeDays);
  if (set.size === 0) return 0;

  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // If nothing today, start counting from yesterday.
  if (!set.has(dayKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);

  let streak = 0;
  while (set.has(dayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
