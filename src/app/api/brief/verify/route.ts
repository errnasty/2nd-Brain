import { generateText } from "ai";
import { aiAvailable } from "@/lib/ai/provider";
import { withLiteModel } from "@/lib/ai/lite";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiBudget, recordAiUsage } from "@/lib/ai/budget";
import { getUserSettings } from "@/lib/settings/store";
import {
  BRIEF_LEVEL_CONFIG,
  DEFAULT_BRIEF_LEVEL,
  findSection,
  isBriefLevel,
  planBrief,
} from "@/lib/today/brief-plan";
import { normalizeCustomDesks, resolveDesks } from "@/lib/today/topics";
import { loadDeskWeights } from "@/lib/today/feedback-store";
import { loadFeedTrust } from "@/lib/today/reading-signals";
import { followMatcher, normalizeFollowedStories } from "@/lib/today/story-follow";
import { isRuledOut, normalizeMisfiles } from "@/lib/today/desk-suggest";
import { sectionArticleBlock } from "@/lib/today/brief-prompts";
import {
  VERIFY_SYSTEM_PROMPT,
  outOfScopeRefs,
  parseVerification,
  verifyUserPrompt,
  type UnsupportedClaim,
} from "@/lib/today/brief-verify";
import {
  bodyCharLimit,
  fetchBodies,
  fetchBriefQueue,
  queueLimit,
  scanLimit,
  toArticleInputs,
  toPlanArticles,
} from "@/lib/today/brief-queue";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/brief/verify — check one finished section against its sources.
 *
 * ## Why this is its own request
 *
 * Two constraints in every section prompt are load-bearing and unenforceable:
 * cite only the numbers you were given, and state nothing the text does not
 * support. Everything else about the brief is decided deterministically; those
 * two were left to the model's goodwill, and a brief whose `[3]` does not say
 * what the sentence claims is worse than no brief because it reads exactly like
 * a correct one.
 *
 * Checking runs AFTER the section is on screen, from here, rather than inside
 * the generation. That ordering is the whole design:
 *
 *   - the reader waits for nothing — the brief streams at exactly the speed it
 *     did before this existed;
 *   - a failure costs nothing at all. No verifier, no result, no change to what
 *     is already rendered;
 *   - it runs on the lite tier (free models first, see `lite.ts`), so a check
 *     on every prose section is affordable in a way a second full-quality pass
 *     would not be.
 *
 * The scope half of the check needs no model and no network, and the client
 * runs it itself the moment a section lands; this endpoint re-runs it anyway,
 * because the client's copy of "which refs was this section given" comes from a
 * plan it was handed, and the server's comes from the plan it just rebuilt.
 */

// Raw full_text cap in SQL — mirrors the generation route.
const RAW_FULLTEXT_MULTIPLIER = 6;

/** Sections long enough to be worth checking, and short enough to check cheaply. */
const MAX_SECTION_CHARS = 12_000;

type Body = {
  section?: string;
  level?: string;
  /** The section as it was rendered. */
  text?: string;
};

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = auth.user.id;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const sectionKey = typeof body.section === "string" ? body.section : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!sectionKey || !text) return Response.json({ unsupported: [], outOfScope: [] });
  if (text.length > MAX_SECTION_CHARS) return Response.json({ unsupported: [], outOfScope: [] });

  // Verification is a nicety on top of a brief the reader already has. Every
  // way this can fail — rate limit, budget, no provider, a model that returns
  // nonsense — resolves to "nothing to report" rather than to an error the
  // reader has to think about.
  const rl = await checkRateLimit(userId, "brief-verify", 60, 60);
  if (!rl.allowed) return Response.json({ unsupported: [], outOfScope: [] });

  let level = DEFAULT_BRIEF_LEVEL;
  let priority: string[] = [];
  let desks = resolveDesks();
  let isFollowed = followMatcher([]);
  let ruledOut = (_t: string, _d: string) => false;
  try {
    const s = await getUserSettings(userId);
    if (isBriefLevel(s.briefLevel)) level = s.briefLevel;
    if (Array.isArray(s.briefTopics)) {
      priority = s.briefTopics.filter((t): t is string => typeof t === "string");
    }
    desks = resolveDesks(normalizeCustomDesks(s.customDesks));
    isFollowed = followMatcher(normalizeFollowedStories(s.followedStories));
    const misfiles = normalizeMisfiles(s.briefMisfiles);
    ruledOut = (title: string, deskId: string) => isRuledOut(title, deskId, misfiles);
  } catch {
    // Defaults are fine.
  }
  if (isBriefLevel(body.level)) level = body.level;
  const cfg = BRIEF_LEVEL_CONFIG[level];

  // The same queue, selected the same way, so "the refs this section was given"
  // means the same thing here as it did when the section was written.
  const [deskWeights, feedTrust] = await Promise.all([
    loadDeskWeights(userId),
    loadFeedTrust(userId),
  ]);
  const { rows, threads } = await fetchBriefQueue(userId, {
    limit: queueLimit(cfg.articleLimit),
    scanLimit: scanLimit(cfg.scanLimit, cfg.articleLimit),
    priority,
    deskWeights,
    feedTrust,
    isFollowed,
    ruledOut,
    desks,
  });
  if (rows.length === 0) return Response.json({ unsupported: [], outOfScope: [] });

  const plan = planBrief(toPlanArticles(rows), { level, priority, deskWeights, desks, threads });
  const section = findSection(plan, sectionKey);
  // Only sections that make claims about article text can be checked against
  // it. The quick-clear list judges headlines, and the external section was
  // deliberately never given any text to be checked against.
  if (!section || (section.kind !== "lead" && section.kind !== "topic")) {
    return Response.json({ unsupported: [], outOfScope: [] });
  }

  const outOfScope = outOfScopeRefs(text, section.refs);

  const budget = await checkAiBudget(userId);
  if (!budget.allowed || !aiAvailable()) {
    // The free half of the check still stands on its own.
    return Response.json({ unsupported: [], outOfScope });
  }

  const bodyChars = bodyCharLimit(cfg.bodyChars);
  const bodies = await fetchBodies(
    userId,
    section.refs.map((n) => rows[n - 1]?.id).filter((id): id is string => Boolean(id)),
    bodyChars * RAW_FULLTEXT_MULTIPLIER,
  );
  const articleBlock = sectionArticleBlock(
    section,
    toArticleInputs(rows, section.refs, bodies),
    level,
  );

  let unsupported: UnsupportedClaim[] = [];
  try {
    const result = await withLiteModel((model) =>
      generateText({
        model,
        system: VERIFY_SYSTEM_PROMPT,
        prompt: verifyUserPrompt(text, articleBlock),
        temperature: 0,
        maxTokens: 400,
        abortSignal: req.signal,
      }),
    );
    unsupported = parseVerification(result.text ?? "", text);
    const used = result.usage?.totalTokens ?? 0;
    if (used > 0) void recordAiUsage(userId, used);
  } catch {
    // A verifier that failed says nothing, which is the same as a clean result
    // from the reader's point of view. It must never contradict a section that
    // is already on screen.
  }

  return Response.json({ unsupported, outOfScope });
}
