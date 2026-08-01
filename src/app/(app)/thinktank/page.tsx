import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, tags, thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/settings/store";
import { ThinkTankHub, type DeckSummary } from "@/components/thinktank/thinktank-hub";
import { dueRefreshers, exploredTopics } from "@/lib/thinktank/concepts";

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
        // NOT `::text`. Postgres renders timestamptz as
        // "2026-07-31 14:16:15.123456+00" — a space instead of the "T", and a
        // two-digit offset. V8 tolerates it; Safari returns Invalid Date, and
        // an Invalid Date silently made every stall check answer "not
        // stalled", which is what pinned dead decks on "Building…" forever.
        // The deck page already did this correctly with .toISOString(); this
        // makes the hub agree.
        createdAt: thinktankDecks.createdAt,
        updatedAt: thinktankDecks.updatedAt,
        cardCount: sql<number>`(select count(*)::int from ${thinktankCards} c where c.deck_id = ${thinktankDecks.id})`,
      })
      .from(thinktankDecks)
      .where(eq(thinktankDecks.userId, user.id))
      .orderBy(desc(thinktankDecks.createdAt))
      .then((rows): DeckSummary[] =>
        rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      ),
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

  // Explore state, both fail-soft: a pending migration or an empty graph just
  // means these sections don't render.
  const [refreshers, topics] = await Promise.all([
    dueRefreshers(user.id, 6),
    exploredTopics(user.id, 8),
  ]);

  return (
    <ThinkTankHub
      decks={decks}
      suggestions={suggestions}
      refreshers={refreshers.map((r) => ({ slug: r.slug, name: r.name, topic: r.topic }))}
      exploredTopics={topics}
    />
  );
}
