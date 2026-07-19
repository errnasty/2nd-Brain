import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAiJob } from "@/lib/ai-jobs/run";

export const runtime = "nodejs";

/** Light status poll for a background AI job. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getAiJob(user.id, id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    ok: true,
    status: job.status,
    itemId: job.resultItemId,
    error: job.error,
  });
}
