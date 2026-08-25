// Server-side cache for a generated Daily Brief. Backed by the daily_briefs
// table (one row per user) so a reload — or a SECOND DEVICE — reuses the brief
// instead of re-paying the model, and the brief survives cold starts and
// reinstalls. Keyed by the unread-set fingerprint + the system-prompt hash:
// when either changes the stored brief no longer matches and a fresh one is
// generated. Explicit "Regenerate" bypasses reuse (the route passes force).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyBriefs, type BriefSourceRef, type BriefUsage } from "@/lib/db/schema";
import {
  coveredTitles,
  mergeStoryMemory,
  parseStoryMemory,
  type RememberedStory,
} from "@/lib/today/story-memory";

export type StoredBrief = {
  fingerprint: string;
  promptHash: string;
  content: string;
  sourceMap: BriefSourceRef[];
  usage: BriefUsage | null;
  generatedAt: Date;
};

/** The user's latest stored brief, or null when none exists yet. */
export async function loadUserBrief(userId: string): Promise<StoredBrief | null> {
  try {
    const [row] = await db
      .select()
      .from(dailyBriefs)
      .where(eq(dailyBriefs.userId, userId))
      .limit(1);
    if (!row) return null;
    return {
      fingerprint: row.fingerprint,
      promptHash: row.promptHash,
      content: row.content,
      sourceMap: row.sourceMap,
      usage: row.usage,
      generatedAt: row.generatedAt,
    };
  } catch {
    // A read hiccup must never break brief generation — treat as a miss.
    return null;
  }
}

/**
 * What the brief has told this user about, from the row that gets replaced
 * every time a brief is saved.
 *
 * Selected on its own rather than through `loadUserBrief`, which would drag
 * the whole markdown body across to read a small JSON array — and this is read
 * on the plan request, which the Today tab makes on every visit.
 */
export async function loadStoryMemory(userId: string): Promise<RememberedStory[]> {
  try {
    const [row] = await db
      .select({ storyMemory: dailyBriefs.storyMemory })
      .from(dailyBriefs)
      .where(eq(dailyBriefs.userId, userId))
      .limit(1);
    return parseStoryMemory(row?.storyMemory);
  } catch {
    // No memory is the pre-migration state and a perfectly good brief — every
    // story simply reads as new.
    return [];
  }
}

/**
 * Upsert the user's latest brief (replaces the previous one), folding the
 * stories it covered into the memory.
 *
 * The merge happens here, not at the call sites, because there are two of them
 * (the sectioned brief posts its assembled markdown to `/api/brief/store`, the
 * custom-prompt brief saves itself as it streams) and a memory updated by only
 * one of them would quietly claim continuity that depends on which mode the
 * reader happens to use.
 */
export async function saveUserBrief(
  userId: string,
  value: {
    fingerprint: string;
    promptHash: string;
    content: string;
    sourceMap: BriefSourceRef[];
    usage: BriefUsage | null;
  },
): Promise<void> {
  const now = new Date();
  try {
    const storyMemory = mergeStoryMemory(
      await loadStoryMemory(userId),
      coveredTitles(value.content, value.sourceMap),
      now,
    );
    await db
      .insert(dailyBriefs)
      .values({ userId, ...value, storyMemory, generatedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: dailyBriefs.userId,
        set: { ...value, storyMemory, generatedAt: now, updatedAt: now },
      });
  } catch {
    // Persisting is best-effort — a failed write just means the next load
    // regenerates. Never fail the brief the user already received.
  }
}
