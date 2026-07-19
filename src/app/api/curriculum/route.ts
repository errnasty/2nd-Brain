import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildCurriculumNote } from "@/lib/ai/research-notes";

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Topic deep-dive / curriculum generator — thin wrapper over
 * buildCurriculumNote (see src/lib/ai/research-notes.ts). The app itself now
 * goes through the /api/jobs background pattern so long responses can't
 * surface as false errors; this inline route stays for direct/API use.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(user.id, "analyze", 20, 60);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
  }

  let body: { topic?: string; folderId?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  const folderId = body.folderId && UUID_RE.test(body.folderId) ? body.folderId : null;

  try {
    const r = await buildCurriculumNote(user.id, topic, folderId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true, itemId: r.itemId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
