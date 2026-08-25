/**
 * The trending cron's run loop.
 *
 * ## The budget
 *
 * Railway's edge closes a request that transfers no data for 5 minutes, so the
 * run still works to a wall-clock budget and returns a partial success — but
 * the budget is now minutes rather than the ~8 seconds the old serverless host
 * allowed. That difference is not just throughput: a run that had to stop after
 * a couple of users left most of the library unscored between passes, which is
 * what made the ranking look arbitrary.
 *
 * Resumption is by `trending_runs.last_run_at`, oldest first, exactly like feed
 * sync resumes on oldest-fetched feeds. That ordering is self-correcting: any
 * user the budget didn't reach is by definition the oldest next time, so nobody
 * can be starved by a large neighbour.
 */

import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trendingRuns } from "@/lib/db/schema";
import { getUserSettings } from "@/lib/settings/store";
import { normalizeCustomDesks, type CustomDesk } from "@/lib/today/topics";
import { computeTrendingForUser, decayStaleScores } from "./compute";
import { refreshSignals, signalsAreStale } from "./signals";

/**
 * Wall-clock budget. Held a minute under Railway's 5-minute no-data cutoff so
 * the final writes land inside the request — a run killed mid-write leaves
 * scores and clusters disagreeing, which is worse than doing fewer users.
 */
export const RUN_BUDGET_MS = 240_000;

/**
 * Budget reserved for the signal refresh when it's due. The four public sources
 * are fetched in parallel, so this is a generous worst case rather than a sum;
 * keeping it separate means a slow signal fetch eats its own allowance rather
 * than every user's.
 */
export const SIGNAL_BUDGET_MS = 20_000;

/** Users per run, whatever the clock says — a sanity ceiling. */
export const MAX_USERS_PER_RUN = 200;

export type TrendingRunSummary = {
  usersProcessed: number;
  clusters: number;
  scored: number;
  decayed: number;
  signals: { refreshed: boolean; sources?: { source: string; terms: number; stories: number; error?: string }[] };
  budgetExhausted: boolean;
  errors: string[];
};

/**
 * Users with feeds, oldest-run first. A LEFT JOIN with nulls sorted first means
 * a user who has never been scored is picked up before anyone gets a second
 * pass — otherwise a new user could wait for the whole base to cycle.
 */
async function usersToProcess(limit: number): Promise<string[]> {
  const res = (await db.execute(sql`
    select f.user_id as user_id
    from feeds f
    left join trending_runs r on r.user_id = f.user_id
    group by f.user_id, r.last_run_at
    order by r.last_run_at asc nulls first
    limit ${limit}
  `)) as unknown as { rows?: { user_id: string }[] } | { user_id: string }[];
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return rows.map((r) => r.user_id);
}

/** This user's desk preferences, for the followed-desk boost. Never throws. */
async function deskPrefs(
  userId: string,
): Promise<{ followedTopics: string[]; customDesks: CustomDesk[] }> {
  try {
    const s = await getUserSettings(userId);
    return {
      followedTopics: Array.isArray(s.briefTopics)
        ? s.briefTopics.filter((t): t is string => typeof t === "string")
        : [],
      customDesks: normalizeCustomDesks(s.customDesks),
    };
  } catch {
    return { followedTopics: [], customDesks: [] };
  }
}

async function markRun(userId: string, clusters: number, scored: number): Promise<void> {
  try {
    await db
      .insert(trendingRuns)
      .values({ userId, lastRunAt: new Date(), clusters, scored })
      .onConflictDoUpdate({
        target: trendingRuns.userId,
        set: {
          lastRunAt: sql`excluded.last_run_at`,
          clusters: sql`excluded.clusters`,
          scored: sql`excluded.scored`,
        },
      });
  } catch (err) {
    // If the cursor can't be written the user is simply reprocessed next run —
    // wasteful, but correct. Not worth failing the whole pass over.
    console.error("[trending] cursor write failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * One cron pass: refresh the global signals if they're stale, then score as
 * many users as the budget allows.
 */
export async function runTrending(now: Date = new Date()): Promise<TrendingRunSummary> {
  const started = Date.now();
  const errors: string[] = [];
  const summary: TrendingRunSummary = {
    usersProcessed: 0,
    clusters: 0,
    scored: 0,
    decayed: 0,
    signals: { refreshed: false },
    budgetExhausted: false,
    errors,
  };

  // Signals first: a user scored against fresh terms is worth more than an
  // extra user scored against stale ones.
  try {
    if (await signalsAreStale(now)) {
      const refresh = await Promise.race([
        refreshSignals(now),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SIGNAL_BUDGET_MS)),
      ]);
      if (refresh) {
        summary.signals = { refreshed: true, sources: refresh.sources };
      } else {
        // The fetches keep running and will land in the table; we just stop
        // waiting so the user pass still gets its share of the budget.
        summary.signals = { refreshed: false };
        errors.push("signal refresh exceeded its budget");
      }
    }
  } catch (err) {
    errors.push(`signals: ${err instanceof Error ? err.message : String(err)}`);
  }

  let users: string[] = [];
  try {
    users = await usersToProcess(MAX_USERS_PER_RUN);
  } catch (err) {
    errors.push(`user list: ${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }

  for (const userId of users) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      summary.budgetExhausted = true;
      break;
    }
    try {
      const prefs = await deskPrefs(userId);
      const result = await computeTrendingForUser(userId, { ...prefs, now });
      summary.clusters += result.clusters;
      summary.scored += result.scored;
      summary.decayed += await decayStaleScores(userId, now);
      summary.usersProcessed += 1;
      await markRun(userId, result.clusters, result.scored);
    } catch (err) {
      errors.push(`user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      // Still mark the run, so one user whose data reliably breaks the pass
      // can't block everyone behind them forever.
      await markRun(userId, 0, 0);
    }
  }

  return summary;
}

/** Score a single user on demand, ignoring the cron cursor. */
export async function runTrendingForUser(userId: string): Promise<TrendingRunSummary> {
  const errors: string[] = [];
  const summary: TrendingRunSummary = {
    usersProcessed: 0,
    clusters: 0,
    scored: 0,
    decayed: 0,
    signals: { refreshed: false },
    budgetExhausted: false,
    errors,
  };
  try {
    const prefs = await deskPrefs(userId);
    const result = await computeTrendingForUser(userId, prefs);
    summary.clusters = result.clusters;
    summary.scored = result.scored;
    summary.decayed = await decayStaleScores(userId);
    summary.usersProcessed = 1;
    await markRun(userId, result.clusters, result.scored);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return summary;
}

/** Whether a user has ever been scored — the Today tab uses this to explain
 *  why a brand-new account's ranking still looks like plain reverse-chron. */
export async function hasTrendingRun(userId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ userId: trendingRuns.userId })
      .from(trendingRuns)
      .where(eq(trendingRuns.userId, userId))
      .orderBy(asc(trendingRuns.lastRunAt))
      .limit(1);
    return Boolean(row);
  } catch {
    return false;
  }
}
