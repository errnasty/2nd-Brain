import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/provider";
import { runDeckGeneration } from "@/lib/thinktank/generate";

export const runtime = "nodejs";
// Deep decks with web grounding can run past 60s; a severed run leaves the
// deck stuck "generating" until the stall detection re-kicks it, so give the
// builder the same ceiling as the ThinkTank pages.
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Background deck builder. The create action inserts a "generating" deck and
 * returns instantly; the reader kicks this route and polls the deck's status,
 * so a severed long response (serverless timeout) can't surface as an error —
 * the poll just picks the finished deck up.
 */
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

  let body: { deckId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body.deckId || !UUID_RE.test(body.deckId)) {
    return NextResponse.json({ error: "deckId required" }, { status: 400 });
  }

  const r = await runDeckGeneration(user.id, body.deckId);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
