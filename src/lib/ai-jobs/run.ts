import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  aiJobs,
  type AiJobKind,
  type AiJobPayload,
  type OrganizeJobPayload,
  type ResearchJobPayload,
} from "@/lib/db/schema";
import { buildCurriculumNote, buildResearchNote } from "@/lib/ai/research-notes";
import { runOrganize, type OrganizeProgress } from "@/lib/directory/organize";
import { bustMapCache } from "@/lib/map-cache";

// A job stuck in "running" longer than this is presumed orphaned (its runner's
// process died) and may be re-kicked.
const STALE_RUNNING_MS = 2 * 60 * 1000;

/**
 * What a job hands back. Wider than a note-building result because not every
 * job makes a note: a Directory sort finishes with no single item to open, so
 * `itemId` is allowed to be null and the client reads the outcome from the
 * job's payload instead.
 */
type JobOutcome = { ok: true; itemId: string | null } | { ok: false; error: string };

export async function createAiJob(userId: string, kind: AiJobKind, payload: AiJobPayload): Promise<string> {
  const [row] = await db.insert(aiJobs).values({ userId, kind, payload }).returning({ id: aiJobs.id });
  return row.id;
}

/**
 * A job of this kind that is already under way for this user, if there is one.
 *
 * "Under way" is pending, or running and recently alive — the same staleness
 * window `runAiJob` uses to decide a job has been orphaned, so a job this
 * reports as active is exactly one that `runAiJob` would refuse to re-claim.
 *
 * Exists because a Directory sort must not run twice at once: two sorts would
 * plan against each other's half-finished state and interleave their moves,
 * and only the second would leave an undo record, making the first one's moves
 * permanent. A guard in the browser cannot see a second tab, so the check has
 * to live where the job is created.
 */
export async function activeJobId(userId: string, kind: AiJobKind): Promise<string | null> {
  const rows = await db
    .select({ id: aiJobs.id, status: aiJobs.status, updatedAt: aiJobs.updatedAt })
    .from(aiJobs)
    .where(and(eq(aiJobs.userId, userId), eq(aiJobs.kind, kind)))
    .orderBy(desc(aiJobs.updatedAt))
    .limit(5);

  // A pending row is only briefly legitimate — the gap between the create call
  // and the kick that follows it, a few hundred milliseconds. One that is still
  // pending after the staleness window never got a runner (the kick was
  // refused, the tab was closed in between, the network dropped) and must not
  // be allowed to block every future sort for the life of the account.
  const alive = rows.find(
    (r) =>
      Date.now() - r.updatedAt.getTime() < STALE_RUNNING_MS &&
      (r.status === "pending" || r.status === "running"),
  );
  return alive?.id ?? null;
}

/**
 * Mark a job failed without running it — for a refusal the job can never get
 * past, like a missing API key. Best-effort: the caller is already returning
 * the real error, and a failed tidy-up must not replace it.
 */
export async function failAiJob(userId: string, jobId: string, error: string): Promise<void> {
  try {
    await db
      .update(aiJobs)
      .set({ status: "error", error, updatedAt: new Date() })
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.userId, userId), eq(aiJobs.status, "pending")));
  } catch {
    // The staleness window in activeJobId is the backstop.
  }
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

  let result: JobOutcome;
  try {
    result =
      job.kind === "organize"
        ? await runOrganizeJob(userId, jobId, job.payload as OrganizeJobPayload)
        : await runNoteJob(userId, job.kind, job.payload as ResearchJobPayload);
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

async function runNoteJob(
  userId: string,
  kind: Exclude<AiJobKind, "organize">,
  payload: ResearchJobPayload,
): Promise<JobOutcome> {
  const topic = payload.topic;
  const folderId = payload.folderId ?? null;
  return kind === "curriculum"
    ? buildCurriculumNote(userId, topic, folderId)
    : buildResearchNote(userId, topic, folderId);
}

/**
 * The Directory sort, wrapped in the job contract.
 *
 * Progress is written straight back into this row's payload on every step,
 * because the row is the only thing the browser can see once the request that
 * started the work has severed. Those writes are fail-soft on purpose: losing a
 * progress tick should slow the bar down, never abandon the sort.
 *
 * The sort produces no note, so the outcome's `itemId` is null and the answer
 * — what moved, what was created, what was tidied away — is read back from the
 * payload by GET /api/jobs/[id].
 */
async function runOrganizeJob(
  userId: string,
  jobId: string,
  payload: OrganizeJobPayload,
): Promise<JobOutcome> {
  // Accumulated, not rebuilt from the original payload each time: the final
  // write adds the summary and must not erase the progress the last tick wrote,
  // and vice versa. Each write also refreshes `updated_at`, which is what stops
  // a genuinely long sort from looking orphaned to the stale-job check above.
  let current: OrganizeJobPayload = payload;
  const write = async (patch: Partial<OrganizeJobPayload>) => {
    current = { ...current, ...patch };
    try {
      await db
        .update(aiJobs)
        .set({ payload: current, updatedAt: new Date() })
        .where(eq(aiJobs.id, jobId));
    } catch {
      // A dropped progress tick is cosmetic — never fail the sort over it.
    }
  };

  const summary = await runOrganize(
    userId,
    { scope: payload.scope, pruneEmpty: payload.pruneEmpty },
    (progress: OrganizeProgress) => write({ progress }),
  );

  await write({ summary });

  // The sidebar's folder tree and the knowledge map both cache what just moved.
  bustMapCache(userId);
  revalidatePath("/directory");

  return { ok: true, itemId: null };
}
