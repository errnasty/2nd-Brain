import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, tags, thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { ThinkTankHub, type DeckSummary } from "@/components/thinktank/thinktank-hub";

export const dynamic = "force-dynamic";
// Raise the server-action time limit for this route so deck generation (web
// grounding + AI call, ~30-60s) doesn't trip Next.js's "unexpected response"
// error. Server actions inherit the route's maxDuration.
export const maxDuration = 120;

export default async function ThinkTankPage() {
  const { user } = await requireUser();

  const [decks, interests, recentTags, recentReads] = await Promise.all([
    // Decks with card counts, newest first.
    db
      .select({
        id: thinktankDecks.id,
        topic: thinktankDecks.topic,
        title: thinktankDecks.title,
        description: thinktankDecks.description,
        status: thinktankDecks.status,
        pacing: thinktankDecks.pacing,
        detail: thinktankDecks.detail,
        lastPosition: thinktankDecks.lastPosition,
        createdAt: sql<string>`${thinktankDecks.createdAt}::text`,
        updatedAt: sql<string>`${thinktankDecks.updatedAt}::text`,
        cardCount: sql<number>`(select count(*)::int from ${thinktankCards} c where c.deck_id = ${thinktankDecks.id})`,
      })
      .from(thinktankDecks)
      .where(eq(thinktankDecks.userId, user.id))
      .orderBy(desc(thinktankDecks.createdAt)) as Promise<DeckSummary[]>,
    // Interests from onboarding/Settings — fail-soft.
    getUserSettings(user.id)
      .then((s) => s.interests ?? [])
      .catch(() => [] as string[]),
    // Recently used tags round out the suggestions.
    db
      .select({ name: tags.name })
      .from(tags)
      .where(eq(tags.userId, user.id))
      .orderBy(desc(tags.createdAt))
      .limit(8)
      .catch(() => [] as { name: string }[]),
    // What the user just read in Feeds — turning a fresh read into a deck is
    // the most natural jumping-off point. Long headlines make bad chips, so
    // they're filtered out below.
    db
      .select({ title: articles.title })
      .from(articles)
      .where(and(eq(articles.userId, user.id), eq(articles.readStatus, "read")))
      .orderBy(desc(articles.updatedAt))
      .limit(6)
      .catch(() => [] as { title: string }[]),
  ]);

  // Interests first, then library tags, then recent reads; dedupe
  // case-insensitively. Capped at 6 — a wall of chips buries the topic input
  // on a phone. Read titles are held to headline-chip length (≤48 chars) and
  // at most 2, so news headlines can't crowd out the user's own interests.
  const readTitles = recentReads
    .map((a) => a.title.trim())
    .filter((t) => t.length > 0 && t.length <= 48)
    .slice(0, 2);
  const seen = new Set<string>();
  const suggestions = [...interests, ...recentTags.map((t) => t.name), ...readTitles]
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6);

  return <ThinkTankHub decks={decks} suggestions={suggestions} />;
}
