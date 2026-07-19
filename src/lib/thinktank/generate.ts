import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks, type ThinkTankRef } from "@/lib/db/schema";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { generateThinkTankDeck } from "@/lib/ai/thinktank";
import { awardXp } from "@/lib/gamify/award";

/**
 * Fill a "generating" deck with AI-built cards. Runs in the background API
 * route (not the create action), so the UI never holds a connection open for
 * the 10–30s AI call — the reader polls the deck's status instead.
 *
 * Idempotent: a deck that already has cards is just marked ready, so a
 * repeated kick (page re-mount, retry after a severed response) can't
 * duplicate content.
 */
export async function runDeckGeneration(
  userId: string,
  deckId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [deck] = await db
    .select()
    .from(thinktankDecks)
    .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, userId)))
    .limit(1);
  if (!deck) return { ok: false, error: "Deck not found" };

  const [{ count: existing }] = (await db
    .select({ count: sql<number>`count(*)::int` })
    .from(thinktankCards)
    .where(eq(thinktankCards.deckId, deck.id))) as { count: number }[];
  if (existing > 0) {
    if (deck.status !== "ready") {
      await db
        .update(thinktankDecks)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(thinktankDecks.id, deck.id));
    }
    return { ok: true };
  }

  // A retried deck goes back to "generating" first, so every surface (hub
  // list, deck page poller) reflects the in-flight rebuild instead of the
  // stale failure.
  if (deck.status === "error") {
    await db
      .update(thinktankDecks)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(thinktankDecks.id, deck.id));
  }

  try {
    // Library grounding — fail-soft: a retrieval hiccup (no embeddings key,
    // empty library) just means an ungrounded deck.
    let related: { directoryItemId: string; title: string }[] = [];
    try {
      const hits = await retrieveFromDirectory(userId, deck.topic, 12);
      const seen = new Set<string>();
      related = hits.filter((h) => (seen.has(h.title) ? false : (seen.add(h.title), true)));
    } catch {
      // ungrounded deck
    }

    const generated = await generateThinkTankDeck(deck.topic, related, deck.detail);
    if (!generated || generated.cards.length === 0) {
      await db
        .update(thinktankDecks)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(thinktankDecks.id, deck.id));
      return { ok: false, error: "Couldn't build a deck for this topic — try again" };
    }

    // Keep the AI's prerequisites → core → advanced ordering.
    const order = { prerequisites: 0, core: 1, advanced: 2 };
    const sorted = [...generated.cards].sort((a, b) => order[a.section] - order[b.section]);

    await db.transaction(async (tx) => {
      // Re-check inside the transaction: a concurrent kick that won the race
      // (two tabs on the same generating deck) must not double the cards.
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(thinktankCards)
        .where(eq(thinktankCards.deckId, deck.id))) as { count: number }[];
      if (count > 0) return;

      await tx.insert(thinktankCards).values(
        sorted.map((c, i) => ({
          userId,
          deckId: deck.id,
          position: i,
          section: c.section,
          title: c.title,
          body: c.body,
          sourceRefs: [
            ...c.refIndexes
              .filter((n) => n >= 0 && n < related.length)
              .map((n): ThinkTankRef => ({ itemId: related[n].directoryItemId, title: related[n].title })),
            ...c.sources.map((s): ThinkTankRef => ({ title: s.title, url: s.url })),
          ],
        })),
      );
      await tx
        .update(thinktankDecks)
        .set({
          title: generated.title,
          description: generated.description,
          status: "ready",
          model: generated.model,
          tokenCount: generated.tokenCount,
          updatedAt: new Date(),
        })
        .where(eq(thinktankDecks.id, deck.id));
    });

    // Same bonus as building a curriculum — fail-soft: a gamify hiccup must
    // never fail a deck that generated fine.
    try {
      await awardXp(userId, { source: "curriculum", refKind: "thinktank_deck", refId: deck.id });
    } catch {
      // ignore
    }

    revalidatePath("/thinktank");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't build the deck";
    console.error("runDeckGeneration failed:", msg);
    await db
      .update(thinktankDecks)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(thinktankDecks.id, deck.id))
      .catch(() => {});
    return { ok: false, error: msg };
  }
}
