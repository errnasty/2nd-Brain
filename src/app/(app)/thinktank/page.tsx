import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tags, thinktankCards, thinktankDecks } from "@/lib/db/schema";
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

  const [decks, interests, recentTags] = await Promise.all([
    // Decks with card counts, newest first.
    db
      .select({
        id: thinktankDecks.id,
        topic: thinktankDecks.topic,
        title: thinktankDecks.title,
        description: thinktankDecks.description,
        status: thinktankDecks.status,
        lastPosition: thinktankDecks.lastPosition,
        createdAt: sql<string>`${thinktankDecks.createdAt}::text`,
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
  ]);

  // Interests first, then library tags; dedupe case-insensitively.
  const seen = new Set<string>();
  const suggestions = [...interests, ...recentTags.map((t) => t.name)]
    .filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);

  return <ThinkTankHub decks={decks} suggestions={suggestions} />;
}
