import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Per-user daily AI token budget, stored in the existing `rate_limits` table
 * as one bucket per user per UTC day (`ai-tokens-YYYY-MM-DD`, `count` holds
 * the running token total). Complements `checkRateLimit`, which caps request
 * COUNTS per minute — this caps cumulative token SPEND per day so one user
 * can't burn the whole API budget on a shared deployment.
 *
 * Disabled unless AI_DAILY_TOKEN_BUDGET is set to a positive integer, so
 * single-user installs keep today's unlimited behavior. Both functions fail
 * OPEN (availability over strictness), matching checkRateLimit.
 */

const BUCKET_PREFIX = "ai-tokens-";

function todayBucket(): string {
  return BUCKET_PREFIX + new Date().toISOString().slice(0, 10);
}

/** Configured budget in tokens/day; 0 = budgeting disabled. */
export function dailyTokenBudget(): number {
  const n = Number(process.env.AI_DAILY_TOKEN_BUDGET ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export type AiBudgetResult = { allowed: boolean; used: number; budget: number };

/** Call BEFORE generation. `allowed: false` once today's spend ≥ budget. */
export async function checkAiBudget(userId: string): Promise<AiBudgetResult> {
  const budget = dailyTokenBudget();
  if (!budget) return { allowed: true, used: 0, budget: 0 };
  try {
    const rows = (await db.execute(sql`
      select count from rate_limits
      where user_id = ${userId} and bucket = ${todayBucket()}
    `)) as unknown as Array<{ count: number }>;
    const used = Number(rows[0]?.count ?? 0);
    return { allowed: used < budget, used, budget };
  } catch {
    return { allowed: true, used: 0, budget };
  }
}

// Prune stale day-buckets at most once per process lifetime — the table is
// tiny, this just stops rows accumulating forever on long-lived deployments.
let pruned = false;

/** Call AFTER generation with the response's total token usage. */
export async function recordAiUsage(userId: string, totalTokens: number): Promise<void> {
  if (!dailyTokenBudget()) return;
  const tokens = Math.max(0, Math.floor(totalTokens || 0));
  if (!tokens) return;
  try {
    await db.execute(sql`
      insert into rate_limits (user_id, bucket, count, window_start)
      values (${userId}, ${todayBucket()}, ${tokens}, now())
      on conflict (user_id, bucket) do update set
        count = rate_limits.count + ${tokens}
    `);
    if (!pruned) {
      pruned = true;
      await db.execute(sql`
        delete from rate_limits
        where bucket like ${BUCKET_PREFIX + "%"}
          and window_start < now() - interval '7 days'
      `);
    }
  } catch {
    // fail open
  }
}

/** Shared 429 message so every AI route phrases the refusal the same way. */
export function budgetExceededMessage(r: AiBudgetResult): string {
  return `Daily AI budget reached (${r.used.toLocaleString()} of ${r.budget.toLocaleString()} tokens used today). It resets at midnight UTC.`;
}
