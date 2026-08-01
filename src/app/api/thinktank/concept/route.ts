import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/provider";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, budgetExceededMessage } from "@/lib/ai/budget";
import { fillConcept, reserveConcept } from "@/lib/thinktank/concepts";
import { conceptSlug } from "@/lib/thinktank/concept-slug";

export const runtime = "nodejs";
// One concept card is a few hundred output tokens — a small enough call to
// finish inside any host's window, which is why Explore generates inline
// instead of needing the stepped builder decks require.
export const maxDuration = 60;

/**
 * Generate one Explore concept card.
 *
 * Two callers, and the difference between them matters:
 *
 *   - a TAP. The user is waiting; this is the request that must succeed.
 *   - a PREFETCH, fired for the concepts a card links to so the next tap feels
 *     instant. Nobody is waiting on it.
 *
 * A prefetch is held to a stricter budget threshold than a tap. Background work
 * must never be able to spend the allowance a deliberate action needs — the
 * failure mode otherwise is that speculative generation exhausts the day's
 * budget and the user's actual next tap is the one that gets refused.
 */

/** Fraction of the daily AI budget that must remain before prefetching. */
const PREFETCH_BUDGET_HEADROOM = 0.25;

type Body = {
  /** Concept name (new) or slug (existing). One of the two is required. */
  name?: string;
  slug?: string;
  topic?: string | null;
  /** The concept the user came from, so the card avoids repeating it. */
  cameFrom?: string | null;
  /** Speculative: no user is waiting, so give way under budget pressure. */
  prefetch?: boolean;
};

export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI isn't configured" }, { status: 503 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const slug = body.slug ? conceptSlug(body.slug) : rawName ? conceptSlug(rawName) : "";
  if (!slug) return NextResponse.json({ error: "name or slug required" }, { status: 400 });

  const isPrefetch = body.prefetch === true;

  // Prefetch gets a much tighter rate limit than a tap: it fires several at a
  // time by design, and it is the one that should be throttled first.
  const rl = await checkRateLimit(
    user.id,
    isPrefetch ? "thinktank-prefetch" : "thinktank-concept",
    isPrefetch ? 40 : 30,
    60,
  );
  if (!rl.allowed) {
    return isPrefetch
      ? NextResponse.json({ skipped: "rate-limited" })
      : NextResponse.json({ error: "Slow down a moment — too many cards at once" }, { status: 429 });
  }

  const budget = await checkAiBudget(user.id);
  if (!budget.allowed) {
    return isPrefetch
      ? NextResponse.json({ skipped: "budget" })
      : NextResponse.json({ error: budgetExceededMessage(budget) }, { status: 429 });
  }
  if (isPrefetch && budgetHeadroom(budget) < PREFETCH_BUDGET_HEADROOM) {
    // Still inside budget, but close enough that speculative work would start
    // competing with the user's real taps. Silent — nobody asked for this.
    return NextResponse.json({ skipped: "budget-headroom" });
  }

  const reserved = await reserveConcept(user.id, rawName || slug, body.topic ?? null);
  if (!reserved) return NextResponse.json({ error: "Not a usable concept" }, { status: 400 });

  // Already written (by an earlier tap, or by the prefetch this tap raced).
  // This is the cache hit that makes a mature graph free to re-read.
  if (reserved.row.status === "ready" && reserved.row.whatIsIt) {
    return NextResponse.json({ ok: true, slug: reserved.row.slug, cached: true });
  }

  const result = await fillConcept(user.id, reserved.row.slug, { cameFrom: body.cameFrom ?? null });
  if (!result.ok) {
    return isPrefetch
      ? NextResponse.json({ skipped: "failed" })
      : NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true, slug: result.concept.slug, cached: false });
}

/** Remaining share of the day's token budget, 0–1. `budget: 0` = unlimited. */
function budgetHeadroom(result: { used: number; budget: number }): number {
  if (result.budget <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - result.used / result.budget));
}
