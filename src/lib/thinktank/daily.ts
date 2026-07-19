import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { unlockedCardCount } from "./pacing";

export type DailyDeckDue = {
  id: string;
  title: string;
  /** Unlocked-but-unread cards waiting today. */
  remaining: number;
};

/**
 * Daily-paced decks with cards unlocked today that the user hasn't read yet —
 * the Today page's "your daily cards are ready" nudge. lastPosition is the
 * last card *viewed*, so remaining is approximate for a never-opened deck
 * (off by the first card); good enough for a nudge.
 */
export async function fetchDailyDecksDue(userId: string): Promise<DailyDeckDue[]> {
  const rows = await db
    .select({
      id: thinktankDecks.id,
      title: thinktankDecks.title,
      lastPosition: thinktankDecks.lastPosition,
      createdAt: thinktankDecks.createdAt,
      cardCount: sql<number>`(select count(*)::int from ${thinktankCards} c where c.deck_id = ${thinktankDecks.id})`,
    })
    .from(thinktankDecks)
    .where(
      and(
        eq(thinktankDecks.userId, userId),
        eq(thinktankDecks.pacing, "daily"),
        eq(thinktankDecks.status, "ready"),
      ),
    )
    .orderBy(desc(thinktankDecks.createdAt));

  return rows
    .map((r) => {
      const unlocked = unlockedCardCount(r.createdAt, r.cardCount);
      const read = Math.min(r.lastPosition + 1, r.cardCount);
      return { id: r.id, title: r.title, remaining: Math.max(0, unlocked - read) };
    })
    .filter((r) => r.remaining > 0);
}
