import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiAvailable } from "@/lib/ai/provider";
import { runAiJob } from "@/lib/ai-jobs/run";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Execute a background AI job. Long-running by design; the client fires this
 * and polls GET /api/jobs/[id] instead of depending on this response, so a
 * serverless timeout severing it is harmless.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI isn't configured" }, { status: 503 });
  }

  const { id } = await params;
  const r = await runAiJob(user.id, id);
  if (!r.ok) {
    const status = r.error === "Already running" ? 409 : r.error === "Job not found" ? 404 : 502;
    return NextResponse.json({ error: r.error }, { status });
  }
  return NextResponse.json({ ok: true, itemId: r.itemId });
}
