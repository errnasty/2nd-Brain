import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { conceptSlug } from "@/lib/thinktank/concept-slug";
import { completeRefresher } from "@/lib/thinktank/concepts";
import { awardXp } from "@/lib/gamify/award";

export const runtime = "nodejs";

/**
 * Finish a refresher. No AI: the question was generated with the card, and
 * the user marks themselves — see the note in concept-card.tsx on why grading
 * this with a model would cost more than learning the thing did.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { slug?: string; outcome?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const slug = body.slug ? conceptSlug(body.slug) : "";
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const outcome = body.outcome === "forgot" ? "forgot" : "remembered";

  const result = await completeRefresher(user.id, slug, outcome);
  if (!result.ok) return NextResponse.json({ error: "Not saved" }, { status: 404 });

  // Idempotent per concept per day: a refresher is worth paying for once,
  // however many times the card is reopened.
  const day = new Date().toISOString().slice(0, 10);
  const award = await awardXp(user.id, {
    source: "refresher_done",
    refKind: "thinktank_refresher",
    refId: `${day}:${slug}`,
  });

  return NextResponse.json({
    ok: true,
    nextAt: result.nextAt?.toISOString() ?? null,
    awarded: award.awarded,
  });
}
