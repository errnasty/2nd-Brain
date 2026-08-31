import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { activeJobId, createAiJob } from "@/lib/ai-jobs/run";
import type { AiJobKind } from "@/lib/db/schema";
import type { OrganizeScope } from "@/lib/directory/organize";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<AiJobKind>(["curriculum", "gap_research", "organize"]);
const SCOPES = new Set<OrganizeScope>(["unsorted", "everything"]);

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

  let body: {
    kind?: string;
    topic?: string;
    folderId?: string | null;
    scope?: string;
    pruneEmpty?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const kind = body.kind as AiJobKind;
  if (!KINDS.has(kind)) return NextResponse.json({ error: "Unknown job kind" }, { status: 400 });

  // A Directory sort takes a scope instead of a topic, and its payload is also
  // where its progress and result will be written as it runs.
  if (kind === "organize") {
    const scope = body.scope as OrganizeScope;
    if (!SCOPES.has(scope)) return NextResponse.json({ error: "Unknown scope" }, { status: 400 });

    // One sort per account at a time. The browser guards this too, but it can
    // only see its own tab — and two sorts running together would interleave
    // their moves and leave only the later one undoable. The id of the sort
    // already running comes back so the caller can watch that one instead of
    // reporting a failure.
    const running = await activeJobId(user.id, "organize");
    if (running) {
      return NextResponse.json(
        { error: "A sort is already running", jobId: running, alreadyRunning: true },
        { status: 409 },
      );
    }

    const jobId = await createAiJob(user.id, kind, {
      scope,
      // Only the whole-library run is allowed to delete anything, whatever the
      // client asks for.
      pruneEmpty: scope === "everything" && body.pruneEmpty === true,
    });
    return NextResponse.json({ ok: true, jobId });
  }

  const topic = (body.topic ?? "").trim();
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 });
  const folderId = body.folderId && UUID_RE.test(body.folderId) ? body.folderId : null;

  const jobId = await createAiJob(user.id, kind, { topic, folderId });
  return NextResponse.json({ ok: true, jobId });
}
