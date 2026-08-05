"use server";

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefFeedback } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { type Verdict } from "@/lib/today/brief-feedback";

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
