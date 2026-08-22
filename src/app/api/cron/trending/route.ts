import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { runTrending } from "@/lib/trending/run";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron entry point for trending, hit by .github/workflows/trending.yml with
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * Separate from /api/cron/sync-feeds on purpose. The two jobs have different
 * cadences (feeds every 2h, trending hourly — trending has to decay), and more
 * importantly different failure modes: a wedged trending pass must never stop
 * new articles from arriving, which is what sharing a route would risk.
 *
 * Always returns a JSON body the workflow log can be read from:
 *   401 → CRON_SECRET mismatch between the GitHub secret and the host env var
 *   500 → a top-level failure (per-user errors are collected, not thrown)
 *   200 → the run summary, including `budgetExhausted` when the wall-clock
 *         budget ran out before every user was scored (expected and harmless —
 *         the next run resumes from the oldest cursor).
 */
export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;

  try {
    const summary = await runTrending();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown trending error";
    console.error("cron trending failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
