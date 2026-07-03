import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { directoryFolders } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { generateStudyPlan } from "@/lib/ai/study-plan";
import { aiAvailable } from "@/lib/ai/provider";
import { createNoteAction, createDirectoryFolderAction } from "@/app/(app)/directory/actions";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STUDY_FOLDER = "Study Plans";
const DEFAULT_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local YYYY-MM-DD. */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
/** Parse a YYYY-MM-DD into a local-midnight Date, else today. */
function localDate(iso: string | undefined): Date {
  if (iso && DATE_RE.test(iso)) return new Date(`${iso}T00:00:00`);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Find or create the user's "Study Plans" folder; returns its id or null. */
async function ensureStudyFolder(userId: string): Promise<string | null> {
  const [existing] = await db
    .select({ id: directoryFolders.id })
    .from(directoryFolders)
    .where(and(eq(directoryFolders.userId, userId), eq(directoryFolders.name, STUDY_FOLDER)))
    .limit(1);
  if (existing) return existing.id;
  const r = await createDirectoryFolderAction(STUDY_FOLDER);
  return r.ok ? r.folderId : null;
}

/**
 * Generate a dated, followable study plan from a prompt and save it as a
 * Directory note. The note's `(due: …)` checkbox tasks flow into directoryTasks
 * (Study calendar + Tasks view) automatically; embedNote makes it searchable in
 * Ask; flashcards seed the SM-2 review queue. Mirrors /api/curriculum.
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
  if (!aiAvailable()) {
    return NextResponse.json(
      { error: "No AI provider configured (ANTHROPIC_API_KEY or OPENROUTER_API_KEY)" },
      { status: 503 },
    );
  }

  let body: { goal?: string; deadline?: string; hoursPerWeek?: number; startDate?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const goal = (body.goal ?? "").trim();
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });

  const start = localDate(body.startDate);
  const deadlineISO = body.deadline && DATE_RE.test(body.deadline) ? body.deadline : null;
  const deadline = deadlineISO ? new Date(`${deadlineISO}T00:00:00`) : null;
  const totalDays = deadline
    ? Math.max(7, Math.round((deadline.getTime() - start.getTime()) / DAY_MS))
    : DEFAULT_DAYS;
  const hoursPerWeek =
    typeof body.hoursPerWeek === "number" && body.hoursPerWeek > 0
      ? Math.min(40, Math.round(body.hoursPerWeek))
      : 5;

  try {
    // Existing items to weave in as [[wikilinks]]. Best-effort: if retrieval is
    // slow/unavailable we still generate the plan (don't burn the ~10s budget).
    const related = await retrieveFromDirectory(user.id, goal, 10).catch(() => []);
    const seen = new Set<string>();
    const contextTitles = related
      .map((r) => r.title)
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));

    // Throws with a specific message on failure; surfaced by the outer catch.
    const plan = await generateStudyPlan({
      goal,
      totalDays,
      hoursPerWeek,
      deadlineISO,
      contextTitles,
    });

    // Sort by dayOffset, compute real due dates, group into weeks.
    const sessions = [...plan.sessions].sort((a, b) => a.dayOffset - b.dayOffset);
    const byWeek = new Map<number, string[]>();
    let lastDue = start;
    for (const s of sessions) {
      const offset = Math.min(Math.max(0, s.dayOffset), totalDays);
      const due = addDays(start, offset);
      if (due > lastDue) lastDue = due;
      const tail = s.link ? ` [[${s.link}]]` : s.gap ? " (gap)" : "";
      const label = s.review ? `Review: ${s.topic}` : s.topic;
      const line = `- [ ] ${label} — ${s.focus} (due: ${ymd(due)})${tail}`;
      const week = Math.floor(offset / 7);
      byWeek.set(week, [...(byWeek.get(week) ?? []), line]);
    }

    let content = `${plan.summary}\n\n## Schedule\n`;
    for (const week of [...byWeek.keys()].sort((a, b) => a - b)) {
      content += `\n### Week ${week + 1}\n${byWeek.get(week)!.join("\n")}\n`;
    }
    if (plan.milestones && plan.milestones.length > 0) {
      content += `\n## Milestones\n`;
      for (const m of plan.milestones) {
        const due = addDays(start, Math.min(Math.max(0, m.dayOffset), totalDays));
        content += `- ${m.label} — ${ymd(due)}\n`;
      }
    }

    const folderId = await ensureStudyFolder(user.id);
    const r = await createNoteAction({ title: plan.title, content, folderId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });

    // Flashcards are seeded by the CLIENT in a SEPARATE request after this one
    // returns (see ask-shell). Doing it inline here would add another AI call to
    // a request that's already near the serverless function's wall-clock cap
    // (~10s on Netlify) — pushing it to a 504 *after* the note was saved.
    return NextResponse.json({
      ok: true,
      itemId: r.itemId,
      title: plan.title,
      taskCount: sessions.length,
      fromISO: ymd(start),
      toISO: ymd(lastDue),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
