"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefFeedback, userSettings } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { type Verdict } from "@/lib/today/brief-feedback";
import {
  addFollow,
  normalizeFollowedStories,
  removeFollow,
  type FollowedStory,
} from "@/lib/today/story-follow";
import {
  MAX_MISFILES,
  normalizeMisfiles,
  type MisfiledStory,
} from "@/lib/today/desk-suggest";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Section keys are "lead" | "skip" | "external" | "topic:<id>". */
function topicOf(sectionKey: string): string | null {
  return sectionKey.startsWith("topic:") ? sectionKey.slice("topic:".length) || null : null;
}

function isVerdict(v: unknown): v is Verdict {
  return v === "more" || v === "less";
}

/**
 * Record a verdict on one section of today's brief.
 *
 * Today's earlier verdict on the same section is deleted first, so the record
 * is "what the reader thinks of this section today" rather than a tally of how
 * many times they clicked. Changing your mind an hour later replaces the vote;
 * feeling the same way tomorrow adds a new one, which is the accumulation that
 * should count.
 */
export async function recordBriefFeedbackAction(input: {
  sectionKey: string;
  verdict: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sectionKey = typeof input.sectionKey === "string" ? input.sectionKey.trim() : "";
  if (!sectionKey || sectionKey.length > 80) return { ok: false, error: "Invalid section" };
  if (!isVerdict(input.verdict)) return { ok: false, error: "Invalid verdict" };

  const { user } = await requireUser();
  const dayStart = new Date(Date.now() - DAY_MS);
  try {
    await db
      .delete(briefFeedback)
      .where(
        and(
          eq(briefFeedback.userId, user.id),
          eq(briefFeedback.sectionKey, sectionKey),
          gte(briefFeedback.createdAt, dayStart),
        ),
      );
    await db.insert(briefFeedback).values({
      userId: user.id,
      sectionKey,
      topicId: topicOf(sectionKey),
      verdict: input.verdict,
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save that" };
  }
}

// The planner's read of these rows deliberately does NOT live here. Every
// export of a "use server" module is a callable endpoint, and a loader taking
// a userId would be one any client could call with somebody else's id. It sits
// in `src/lib/today/feedback-store.ts`, which the server imports directly.

/**
 * Write one key of the settings blob.
 *
 * The generic settings action shallow-merges whatever the client sends, which
 * is right for a preference the reader typed and wrong for these: a follow and
 * a misfile are derived from the CURRENT stored list, so the read and the write
 * have to happen on the server or two taps in quick succession would each
 * overwrite the other's list wholesale.
 */
async function patchSettings(userId: string, patch: Record<string, unknown>): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, settings: patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        settings: sql`${userSettings.settings} || ${JSON.stringify(patch)}::jsonb`,
        updatedAt: new Date(),
      },
    });
}

/**
 * Start or stop following a story.
 *
 * Identified by headline rather than by article id, because a follow outlives
 * the article it was started from: tomorrow the story arrives as a different
 * piece from a different outlet, and that is precisely the case following
 * exists for. See `story-follow.ts` for the matching.
 */
export async function followStoryAction(input: {
  title: string;
  following: boolean;
}): Promise<{ ok: boolean; followed?: FollowedStory[]; error?: string }> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 300) return { ok: false, error: "Invalid story" };

  const { user } = await requireUser();
  try {
    const settings = await getUserSettings(user.id);
    const current = normalizeFollowedStories(settings.followedStories);
    const next = input.following ? addFollow(current, title) : removeFollow(current, title);
    await patchSettings(user.id, { followedStories: next });
    return { ok: true, followed: next };
  } catch {
    return { ok: false, error: "Couldn't save that" };
  }
}

/**
 * Record that a story was written up under the wrong desk.
 *
 * Two consequences, both in `desk-suggest.ts`: that desk stops claiming the
 * story, and enough corrections about one subject become the offer to give it
 * a desk of its own.
 */
export async function reportMisfileAction(input: {
  title: string;
  deskId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const deskId = typeof input.deskId === "string" ? input.deskId.trim() : "";
  if (!title || title.length > 300) return { ok: false, error: "Invalid story" };
  if (!deskId || deskId.length > 64) return { ok: false, error: "Invalid desk" };

  const { user } = await requireUser();
  try {
    const settings = await getUserSettings(user.id);
    const current = normalizeMisfiles(settings.briefMisfiles);
    // Same story, same desk, twice is one correction — the reader may well tap
    // it again on tomorrow's telling, and a doubled count would inflate the
    // evidence for a desk suggestion out of one opinion held once.
    const deduped = current.filter(
      (m) => !(m.deskId === deskId && m.title.toLowerCase() === title.toLowerCase()),
    );
    const next: MisfiledStory[] = [
      { title, deskId, at: new Date().toISOString() },
      ...deduped,
    ].slice(0, MAX_MISFILES);
    await patchSettings(user.id, { briefMisfiles: next });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save that" };
  }
}
