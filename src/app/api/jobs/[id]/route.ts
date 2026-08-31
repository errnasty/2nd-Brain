import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAiJob } from "@/lib/ai-jobs/run";
import type { OrganizeJobPayload } from "@/lib/db/schema";
import { publicSummary } from "@/lib/directory/organize-plan";

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

  // A Directory sort has no result item — it reports live progress and, at the
  // end, what it actually did. Both live in the payload (see OrganizeJobPayload).
  const organize = job.kind === "organize" ? (job.payload as OrganizeJobPayload) : null;

  return NextResponse.json({
    ok: true,
    status: job.status,
    itemId: job.resultItemId,
    error: job.error,
    progress: organize?.progress ?? null,
    // Counts only — the undo record behind it stays on the server (see
    // publicSummary); the browser undoes a sort by job id, not by replaying it.
    summary: organize?.summary ? publicSummary(organize.summary) : null,
  });
}
