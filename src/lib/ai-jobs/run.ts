import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiJobs, type AiJobKind, type AiJobPayload } from "@/lib/db/schema";
import { buildCurriculumNote, buildResearchNote, type NoteResult } from "@/lib/ai/research-notes";

// A job stuck in "running" longer than this is presumed orphaned (its runner's
// process died) and may be re-kicked.
const STALE_RUNNING_MS = 2 * 60 * 1000;

export async function createAiJob(userId: string, kind: AiJobKind, payload: AiJobPayload): Promise<string> {
  const [row] = await db.insert(aiJobs).values({ userId, kind, payload }).returning({ id: aiJobs.id });
  return row.id;
}

export async function getAiJob(userId: string, jobId: string) {
  const [job] = await db
    .select()
    .from(aiJobs)
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId)))
    .limit(1);
  return job ?? null;
}

/**
 * Execute a pending job. Idempotent-safe: a finished job returns its stored
 * result, a fresh "running" job refuses a second concurrent run, and only a
 * stale "running" job (orphaned by a dead process) can be re-claimed. The
 * kick request's response is allowed to sever — the client polls getAiJob.
 */
export async function runAiJob(
  userId: string,
  jobId: string,
): Promise<{ ok: true; itemId: string | null } | { ok: false; error: string }> {
  const job = await getAiJob(userId, jobId);
  if (!job) return { ok: false, error: "Job not found" };
  if (job.status === "done") return { ok: true, itemId: job.resultItemId };
  if (job.status === "running" && Date.now() - job.updatedAt.getTime() < STALE_RUNNING_MS) {
    return { ok: false, error: "Already running" };
  }

  // Atomic claim: only one racer flips the row into "running" (guarded by the
  // status it just observed), so double kicks can't run the AI call twice.
  const claimed = await db
    .update(aiJobs)
    .set({ status: "running", error: null, updatedAt: new Date() })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId), eq(aiJobs.status, job.status)))
    .returning({ id: aiJobs.id });
  if (claimed.length === 0) return { ok: false, error: "Already running" };

  let result: NoteResult;
  try {
    const topic = job.payload.topic;
    const folderId = job.payload.folderId ?? null;
    result =
      job.kind === "curriculum"
        ? await buildCurriculumNote(userId, topic, folderId)
        : await buildResearchNote(userId, topic, folderId);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : "Job failed" };
  }

  if (result.ok) {
    await db
      .update(aiJobs)
      .set({ status: "done", resultItemId: result.itemId, updatedAt: new Date() })
      .where(eq(aiJobs.id, jobId));
    return { ok: true, itemId: result.itemId };
  }
  await db
    .update(aiJobs)
    .set({ status: "error", error: result.error, updatedAt: new Date() })
    .where(eq(aiJobs.id, jobId));
  return { ok: false, error: result.error };
}
