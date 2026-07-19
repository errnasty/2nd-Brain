import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAiJob } from "@/lib/ai-jobs/run";
import type { AiJobKind } from "@/lib/db/schema";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<AiJobKind>(["curriculum", "gap_research"]);

/**
 * Create a background AI job (fast, reliable — this response must survive so
 * the client gets the jobId to poll). The slow work happens in
 * /api/jobs/[id]/run, whose response is allowed to sever.
 */
export async function POST(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same budget the old inline routes enforced, applied at job creation.
  const rl = await checkRateLimit(user.id, "analyze", 20, 60);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  let body: { kind?: string; topic?: string; folderId?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const kind = body.kind as AiJobKind;
  if (!KINDS.has(kind)) return NextResponse.json({ error: "Unknown job kind" }, { status: 400 });
  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  const folderId = body.folderId && UUID_RE.test(body.folderId) ? body.folderId : null;

  const jobId = await createAiJob(user.id, kind, { topic, folderId });
  return NextResponse.json({ ok: true, jobId });
}
