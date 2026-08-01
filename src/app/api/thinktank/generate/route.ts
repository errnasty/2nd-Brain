import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/provider";
import { runDeckGeneration } from "@/lib/thinktank/generate";

export const runtime = "nodejs";
// Each call now does ONE bounded pass of the build (see runDeckGeneration), so
// it finishes well inside any host's limit. This export is kept honest at 60:
// it is advisory on Vercel and ignored entirely on Netlify, which is exactly
// why the work is stepped rather than relying on it.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Background deck builder — ONE bounded pass per call.
 *
 * The create action inserts a "generating" deck and returns instantly; the
 * reader kicks this route repeatedly until it answers `done: true`, polling the
 * deck's status in between. Because every pass commits what it wrote, a severed
 * response costs at most one batch of cards rather than the whole build.
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
  // `done: false` means the pass ran out of budget with cards still to write.
  // The caller re-kicks; progress is already committed either way.
  return NextResponse.json({ ok: true, done: r.done, cards: r.cards, total: r.total });
}
