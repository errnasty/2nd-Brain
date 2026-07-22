// Server-side cache for a generated Daily Brief. Backed by the daily_briefs
// table (one row per user) so a reload — or a SECOND DEVICE — reuses the brief
// instead of re-paying the model, and the brief survives cold starts and
// reinstalls. Keyed by the unread-set fingerprint + the system-prompt hash:
// when either changes the stored brief no longer matches and a fresh one is
// generated. Explicit "Regenerate" bypasses reuse (the route passes force).

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyBriefs, type BriefSourceRef, type BriefUsage } from "@/lib/db/schema";

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

/** Reuse a stored brief only if it matches the current inputs exactly. */
export async function getMatchingBrief(
  userId: string,
  fingerprint: string,
  promptHash: string,
): Promise<StoredBrief | null> {
  const stored = await loadUserBrief(userId);
  if (!stored) return null;
  if (stored.fingerprint !== fingerprint || stored.promptHash !== promptHash) return null;
  return stored;
}

/** Upsert the user's latest brief (replaces the previous one). */
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
    await db
      .insert(dailyBriefs)
      .values({ userId, ...value, generatedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: dailyBriefs.userId,
        set: { ...value, generatedAt: now, updatedAt: now },
      });
  } catch {
    // Persisting is best-effort — a failed write just means the next load
    // regenerates. Never fail the brief the user already received.
  }
}
