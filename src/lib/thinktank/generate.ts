import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  thinktankCards,
  thinktankDecks,
  type ThinkTankOutlineEntry,
  type ThinkTankRef,
} from "@/lib/db/schema";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { CARD_BATCH_SIZE, generateCardBodies, generateDeckOutline } from "@/lib/ai/thinktank";
import { awardXp } from "@/lib/gamify/award";

/**
 * Build a "generating" deck, a bounded step at a time.
 *
 * ## Why it is stepped
 *
 * The previous version generated an entire deck in ONE call — web search plus
 * a large structured response, 30-60 seconds. That is precisely the shape this
 * app cannot run: it deploys to Netlify, where a function is killed at ~10s no
 * matter what the route's `maxDuration` says (that export is Vercel-only), the
 * same constraint that already reshaped feed sync, article simplify/translate
 * and the Daily Brief. The call never completed, so the deck sat on
 * "generating" forever, the stall detector re-kicked it, and every retry died
 * at the same ten seconds. That is the "stuck on Building…" bug, and no amount
 * of retrying could ever have fixed it.
 *
 * Generation is now plan-then-fill:
 *   1. one short call writes the outline (titles only) onto the deck;
 *   2. each subsequent pass writes bodies for a few cards and inserts them.
 *
 * Every pass is wall-clock budgeted and every pass commits. A severed request
 * costs one batch, and the next kick resumes from whatever is already in the
 * database — so progress is monotonic even if no single request survives.
 *
 * Idempotent throughout: cards are keyed by their outline position, so a
 * duplicate kick (page re-mount, retry after a severed response) re-does at
 * most one batch and can never double a deck's content.
 */

/**
 * Wall-clock budget for one pass. Under the ~10s cap with room for the final
 * insert to land — a pass killed mid-write would leave the deck's card count
 * disagreeing with what was actually generated.
 */
export const STEP_BUDGET_MS = 7_500;

export type DeckStepResult =
  | { ok: true; done: boolean; cards: number; total: number }
  | { ok: false; error: string };

/** Mark the run alive. `updatedAt` is the liveness stamp stall detection uses. */
async function touch(deckId: string): Promise<void> {
  await db
    .update(thinktankDecks)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(thinktankDecks.id, deckId));
}

async function fail(deckId: string, error: string): Promise<DeckStepResult> {
  await db
    .update(thinktankDecks)
    .set({ status: "error", updatedAt: new Date() })
    .where(eq(thinktankDecks.id, deckId))
    .catch(() => {});
  return { ok: false, error };
}

/**
 * Run one pass of a deck build. Call repeatedly (the client polls and re-kicks)
 * until `done` is true. Never throws.
 */
export async function runDeckGeneration(userId: string, deckId: string): Promise<DeckStepResult> {
  const started = Date.now();

  const [deck] = await db
    .select()
    .from(thinktankDecks)
    .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, userId)))
    .limit(1);
  if (!deck) return { ok: false, error: "Deck not found" };

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

    // ── Step 1: the outline ────────────────────────────────────────────
    let outline: ThinkTankOutlineEntry[] = Array.isArray(deck.outline) ? deck.outline : [];
    let webBrief = deck.webBrief ?? "";

    if (outline.length === 0) {
      await touch(deck.id);
      const planned = await generateDeckOutline(deck.topic, related, deck.detail);
      if (!planned || planned.cards.length === 0) {
        return fail(deck.id, "Couldn't plan a deck for this topic — try again");
      }
      // Keep the prerequisites → core → advanced ordering.
      const order = { prerequisites: 0, core: 1, advanced: 2 } as const;
      outline = [...planned.cards].sort((a, b) => order[a.section] - order[b.section]);
      webBrief = planned.webBrief;

      await db
        .update(thinktankDecks)
        .set({
          title: planned.title,
          description: planned.description,
          outline,
          webBrief,
          model: planned.model,
          tokenCount: planned.tokenCount,
          status: "generating",
          updatedAt: new Date(),
        })
        .where(eq(thinktankDecks.id, deck.id));
      revalidatePath("/thinktank");
    }

    // ── Step 2..n: fill bodies in batches ──────────────────────────────
    // Existing positions drive resumption: the database, not a counter, is the
    // record of what has been written.
    let done = false;
    let filled = 0;

    for (;;) {
      const existing = await db
        .select({ position: thinktankCards.position })
        .from(thinktankCards)
        .where(eq(thinktankCards.deckId, deck.id))
        .orderBy(asc(thinktankCards.position));
      const have = new Set(existing.map((r) => r.position));
      filled = have.size;

      const missing = outline.map((entry, i) => ({ entry, i })).filter(({ i }) => !have.has(i));

      if (missing.length === 0) {
        done = true;
        break;
      }
      // Out of budget: commit what we have and let the next kick continue.
      if (Date.now() - started > STEP_BUDGET_MS) break;

      const batch = missing.slice(0, CARD_BATCH_SIZE);
      const bodies = await generateCardBodies(
        deck.topic,
        outline,
        batch.map((b) => b.entry),
        related,
        webBrief,
        deck.detail,
      );

      if (!bodies) {
        // One failed batch shouldn't destroy a half-built deck. With nothing at
        // all written the deck is unusable and worth failing; otherwise stop
        // and let a retry pick up from here.
        if (filled === 0) return fail(deck.id, "Couldn't write cards for this topic — try again");
        break;
      }

      // Match generated bodies back to planned cards by title, falling back to
      // batch order. The model is told to copy titles exactly and usually does,
      // but a plan-and-fill design must not lose a card to a reworded heading.
      const byTitle = new Map(bodies.map((b) => [b.title.trim().toLowerCase(), b]));
      const rows = batch
        .map(({ entry, i }, k) => {
          const match = byTitle.get(entry.title.trim().toLowerCase()) ?? bodies[k];
          return {
            userId,
            deckId: deck.id,
            position: i,
            section: entry.section,
            title: entry.title,
            body: match?.body ?? "",
            sourceRefs: (match?.refIndexes ?? [])
              .filter((n) => n >= 0 && n < related.length)
              .map(
                (n): ThinkTankRef => ({
                  itemId: related[n].directoryItemId,
                  title: related[n].title,
                }),
              ),
          };
        })
        // A card whose body didn't come back is skipped rather than inserted
        // empty: leaving the position unfilled means the next pass retries just
        // that one, instead of the reader hitting a blank card forever.
        .filter((r) => r.body.trim().length > 0);

      if (rows.length === 0) {
        if (filled === 0) return fail(deck.id, "Couldn't write cards for this topic — try again");
        break;
      }

      // onConflictDoNothing: two concurrent kicks racing on the same batch must
      // not double-insert.
      await db.insert(thinktankCards).values(rows).onConflictDoNothing();
      await touch(deck.id);
      filled += rows.length;
    }

    if (done) {
      await db
        .update(thinktankDecks)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(thinktankDecks.id, deck.id));

      // Same bonus as building a curriculum — fail-soft: a gamify hiccup must
      // never fail a deck that generated fine. Idempotent by deck id, so the
      // stepped build can't pay it more than once.
      try {
        await awardXp(userId, { source: "curriculum", refKind: "thinktank_deck", refId: deck.id });
      } catch {
        // ignore
      }
    }

    revalidatePath("/thinktank");
    return { ok: true, done, cards: filled, total: outline.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't build the deck";
    console.error("runDeckGeneration failed:", msg);
    // Only hard-fail a deck with nothing in it. A partially built deck is
    // readable and resumable; marking it "error" would throw that away.
    let count = 0;
    try {
      const [row] = (await db
        .select({ count: sql<number>`count(*)::int` })
        .from(thinktankCards)
        .where(eq(thinktankCards.deckId, deckId))) as { count: number }[];
      count = row?.count ?? 0;
    } catch {
      // fall through to failing the deck
    }
    if (count === 0) return fail(deckId, msg);
    return { ok: false, error: msg };
  }
}
