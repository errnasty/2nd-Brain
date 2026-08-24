import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { saveUserBrief } from "@/lib/brief-cache";
import { getUserSettings } from "@/lib/settings/store";
import {
  DEFAULT_BRIEF_LEVEL,
  briefSettingsKey,
  isBriefLevel,
  type BriefLevel,
} from "@/lib/today/brief-plan";
import { briefSettingsHash } from "@/lib/today/brief-queue";
import { normalizeCustomDesks, type CustomDesk } from "@/lib/today/topics";
import { normalizeBriefInstructions } from "@/lib/today/brief-prompts";
import { normalizeFollowedStories, touchFollows } from "@/lib/today/story-follow";
import type { BriefSourceRef, BriefUsage } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * POST /api/brief/store — persist a finished sectioned brief.
 *
 * A sectioned brief is assembled by the client from several streamed section
 * requests, so no single request has the whole thing to save. Once the last
 * section lands, the client posts the assembled markdown here and it goes into
 * the same `daily_briefs` row the single-pass brief uses — which is what makes
 * the next visit (or a second device) paint instantly instead of regenerating.
 *
 * The stored `promptHash` is the hash of the brief SETTINGS (depth level +
 * followed desks) rather than a prompt: that's what has to change for a stored
 * sectioned brief to stop matching what the user is asking for.
 */

/** Generous ceiling — a deep brief is a few thousand words, not a book. */
const MAX_CONTENT_CHARS = 200_000;
const MAX_SOURCES = 200;

type Body = {
  fingerprint?: string;
  level?: string;
  content?: string;
  sources?: BriefSourceRef[];
  usage?: BriefUsage | null;
};

function validSources(v: unknown): BriefSourceRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (s): s is BriefSourceRef =>
        !!s &&
        typeof s === "object" &&
        typeof (s as BriefSourceRef).n === "number" &&
        typeof (s as BriefSourceRef).id === "string" &&
        typeof (s as BriefSourceRef).title === "string",
    )
    .slice(0, MAX_SOURCES);
}

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  if (!content.trim() || !fingerprint) {
    return new Response("Nothing to store", { status: 422 });
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return new Response("Brief too large to store", { status: 413 });
  }

  // Trust the level the client says it generated at only as far as validating
  // it; the followed desks come from the stored settings either way, so the two
  // halves of the key can't drift apart.
  const sources = validSources(body.sources);
  let priority: string[] = [];
  let customDesks: CustomDesk[] = [];
  let instructions = "";
  let followedRaw: unknown;
  let level: BriefLevel = isBriefLevel(body.level) ? body.level : DEFAULT_BRIEF_LEVEL;
  try {
    const s = await getUserSettings(auth.user.id);
    priority = Array.isArray(s.briefTopics) ? s.briefTopics.filter((t) => typeof t === "string") : [];
    customDesks = normalizeCustomDesks(s.customDesks);
    instructions = normalizeBriefInstructions(s.briefInstructions);
    followedRaw = s.followedStories;
    if (!isBriefLevel(body.level) && isBriefLevel(s.briefLevel)) level = s.briefLevel;
  } catch {
    // Settings unavailable — store under the defaults rather than not at all.
  }

  // A finished brief is the moment a follow's clock is reset: the story either
  // turned up in today's queue or it did not, and no other request knows both
  // the follow list and what the brief actually contained. Fail-soft — a follow
  // that misses one refresh simply lapses a day later than it might have.
  try {
    const followed = normalizeFollowedStories(followedRaw);
    if (followed.length > 0) {
      const { followed: next } = touchFollows(
        followed,
        sources.map((s) => s.title),
      );
      if (JSON.stringify(next) !== JSON.stringify(followed)) {
        await updateFollowedStories(auth.user.id, next);
      }
    }
  } catch {
    // ignore
  }

  await saveUserBrief(auth.user.id, {
    fingerprint,
    promptHash: briefSettingsHash(briefSettingsKey(level, priority, customDesks, instructions)),
    content,
    sourceMap: sources,
    usage: body.usage ?? null,
  });

  return Response.json({ ok: true });
}

/** Write back the refreshed follow list, merged into the settings blob. */
async function updateFollowedStories(userId: string, followedStories: unknown): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, settings: { followedStories } as never, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        settings: sql`${userSettings.settings} || ${JSON.stringify({ followedStories })}::jsonb`,
        updatedAt: new Date(),
      },
    });
}
