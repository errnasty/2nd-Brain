import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getUserSettings } from "@/lib/settings/store";
import {
  BRIEF_LEVEL_CONFIG,
  DEFAULT_BRIEF_LEVEL,
  findSection,
  isBriefLevel,
  planBrief,
} from "@/lib/today/brief-plan";
import { fetchBriefQueue, queueLimit, scanLimit, toPlanArticles } from "@/lib/today/brief-queue";
import { normalizeCustomDesks, resolveDesks } from "@/lib/today/topics";
import { loadDeskWeights } from "@/lib/today/feedback-store";
import {
  awardBriefComplete,
  awardBriefSection,
  awardBriefSourceOpened,
  briefStreak,
} from "@/lib/today/brief-xp";

export const runtime = "nodejs";

/**
 * XP for reading the Daily Brief.
 *
 * The client reports WHAT was read ("section topic:ai", "the whole brief",
 * "opened source X") and nothing else. Which articles that covers, which
 * folders they belong to, and what any of it is worth are all re-derived here
 * from the server's own queue — otherwise reading one section and posting the
 * rest would be the cheapest XP in the app.
 *
 *   POST { kind: "section", section }  → split across that section's folders
 *   POST { kind: "complete" }          → the once-a-day completion bonus
 *   POST { kind: "source", articleId } → opening a cited source
 */

/**
 * Drop the cached Study hub so brief XP actually shows up there.
 *
 * The XP total, level and skill bars are server-rendered by /study
 * (`fetchGameState`). Every OTHER way of earning XP is a server action that
 * calls `revalidatePath("/study")` — making a quiz, making flashcards,
 * finishing an attempt. Brief XP is earned through this route handler, which
 * called nothing, so the router served its cached copy of /study and the XP
 * you had just earned was invisible until a hard reload. The brief's own
 * running total looked right, which made it read as XP being lost on the way
 * out of the brief rather than simply not being re-fetched.
 *
 * Only on a real award: the client posts on every section read, and most of
 * those are idempotent no-ops.
 */
function revalidateXpSurfaces(awarded: number): void {
  if (awarded > 0) revalidatePath("/study");
}

type Body = {
  kind?: "section" | "complete" | "source";
  section?: string;
  articleId?: string;
  level?: string;
};

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  // A deep brief is ~9 sections, and a reader may scroll back through them.
  // Generous, but bounded: the awards are idempotent, so the only thing a
  // flood could achieve is load.
  const rl = await checkRateLimit(userId, "brief-xp", 60, 60);
  if (!rl.allowed) return Response.json({ awarded: 0, skills: [] });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (body.kind === "source") {
    if (!body.articleId) return new Response("Missing articleId", { status: 400 });
    const award = await awardBriefSourceOpened(userId, body.articleId);
    revalidateXpSurfaces(award.awarded);
    return Response.json(award);
  }

  // Rebuild the same plan the brief was generated from, so a section key maps
  // to the same articles the reader actually saw.
  let level = DEFAULT_BRIEF_LEVEL;
  let priority: string[] = [];
  let desks = resolveDesks();
  try {
    const settings = await getUserSettings(userId);
    if (isBriefLevel(settings.briefLevel)) level = settings.briefLevel;
    if (Array.isArray(settings.briefTopics)) {
      priority = settings.briefTopics.filter((t): t is string => typeof t === "string");
    }
    desks = resolveDesks(normalizeCustomDesks(settings.customDesks));
  } catch {
    // Defaults are fine — this only affects which desks lead.
  }
  if (isBriefLevel(body.level)) level = body.level;

  // Every input the queue's selection depends on has to be the same one the
  // brief was generated under, or a section key would map onto a different set
  // of articles than the reader actually saw and pay XP into the wrong skills.
  const cfg = BRIEF_LEVEL_CONFIG[level];
  const deskWeights = await loadDeskWeights(userId);
  const { rows } = await fetchBriefQueue(userId, {
    limit: queueLimit(cfg.articleLimit),
    scanLimit: scanLimit(cfg.scanLimit, cfg.articleLimit),
    priority,
    deskWeights,
    desks,
  });
  if (rows.length === 0) return Response.json({ awarded: 0, skills: [] });

  const plan = planBrief(toPlanArticles(rows), { level, priority, deskWeights, desks });
  const idFor = (ref: number) => rows[ref - 1]?.id;

  /**
   * Articles a section counts as, for XP.
   *
   * Capped, because the "Quick clear" section's refs are the ENTIRE queue — it
   * is handed every title so it can spot the low-signal ones. Splitting XP
   * across all of those would spread the cheapest section over every folder in
   * the app and make it pay more than the lead. Refs are in trending order, so
   * the cap keeps the section's most prominent material.
   */
  const XP_MAX_ARTICLES_PER_SECTION = 12;
  const idsOf = (refs: number[]) =>
    refs
      .slice(0, XP_MAX_ARTICLES_PER_SECTION)
      .map(idFor)
      .filter((id): id is string => Boolean(id));

  if (body.kind === "complete") {
    // What the brief actually WROTE UP, deduplicated. Skip is excluded: its
    // refs are the whole queue, and including them would make the completion
    // bonus reflect the shape of the inbox rather than of the brief.
    const ids = [
      ...new Set(
        plan.sections.filter((s) => s.kind !== "skip").flatMap((s) => idsOf(s.refs)),
      ),
    ];
    const [award, streak] = await Promise.all([
      awardBriefComplete(userId, { articleIds: ids }),
      briefStreak(userId),
    ]);
    revalidateXpSurfaces(award.awarded);
    return Response.json({ ...award, streak });
  }

  if (!body.section) return new Response("Missing section", { status: 400 });
  const section = findSection(plan, body.section);
  // A stale client (its plan predates a re-rank) or the external section, which
  // cites no articles of the user's at all. Neither is an error worth showing.
  if (!section || section.refs.length === 0) return Response.json({ awarded: 0, skills: [] });

  const award = await awardBriefSection(userId, {
    sectionKey: section.key,
    articleIds: idsOf(section.refs),
  });
  revalidateXpSurfaces(award.awarded);
  return Response.json(award);
}
