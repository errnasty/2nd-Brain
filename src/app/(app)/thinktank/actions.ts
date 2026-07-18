"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  thinktankCards,
  thinktankDecks,
  type ThinkTankRef,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiAvailable } from "@/lib/ai/provider";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { generateThinkTankDeck, type ThinkTankDetail } from "@/lib/ai/thinktank";
import { awardXp } from "@/lib/gamify/award";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { createCardsFromTextAction } from "@/app/(app)/review/actions";

/**
 * Build a new deck for a topic: RAG-ground against the user's library, one
 * schema-validated AI call, insert deck + cards. Awaited inline by the client
 * (~10–30s) behind a busy overlay; the deck `status` column is the seam for
 * async generation later.
 */
export async function createThinkTankDeckAction(rawTopic: string, detail: ThinkTankDetail = "standard") {
  const topic = (rawTopic ?? "").trim().slice(0, 200);
  if (!topic) return { ok: false as const, error: "Enter a topic to learn" };
  const { user } = await requireUser();

  if (!aiAvailable()) {
    return { ok: false as const, error: "AI isn't configured — add an API key in Settings" };
  }
  const rl = await checkRateLimit(user.id, "analyze", 20, 60);
  if (!rl.allowed) {
    return { ok: false as const, error: "Too many generations — try again in a bit" };
  }

  try {
    // Library grounding + web grounding run in parallel — both are fail-soft,
    // so a hiccup in either just means an ungrounded deck. Running them
    // concurrently cuts the pre-AI latency to ~max(ground, web) instead of
    // the sum.
    const grounding = (async () => {
      try {
        const hits = await retrieveFromDirectory(user.id, topic, 12);
        const seen = new Set<string>();
        return hits.filter((h) => (seen.has(h.title) ? false : (seen.add(h.title), true)));
      } catch {
        return [] as { directoryItemId: string; title: string }[];
      }
    })();
    const related = await grounding;

    const deck = await generateThinkTankDeck(topic, related, detail);
    if (!deck || deck.cards.length === 0) {
      return { ok: false as const, error: "Couldn't build a deck for this topic — try again" };
    }

    const [inserted] = await db
      .insert(thinktankDecks)
      .values({
        userId: user.id,
        topic,
        title: deck.title,
        description: deck.description,
        status: "ready",
        model: deck.model,
        tokenCount: deck.tokenCount,
        detail,
      })
      .returning({ id: thinktankDecks.id });

    // Keep the AI's prerequisites → core → advanced ordering.
    const order = { prerequisites: 0, core: 1, advanced: 2 };
    const sorted = [...deck.cards].sort((a, b) => order[a.section] - order[b.section]);
    await db.insert(thinktankCards).values(
      sorted.map((c, i) => ({
        userId: user.id,
        deckId: inserted.id,
        position: i,
        section: c.section,
        title: c.title,
        body: c.body,
        sourceRefs: c.refIndexes
          .filter((n) => n >= 0 && n < related.length)
          .map((n): ThinkTankRef => ({ itemId: related[n].directoryItemId, title: related[n].title })),
      })),
    );

    // Same bonus as building a curriculum — it's the same kind of effort.
    await awardXp(user.id, {
      source: "curriculum",
      refKind: "thinktank_deck",
      refId: inserted.id,
    });

    revalidatePath("/thinktank");
    return { ok: true as const, deckId: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't build the deck";
    console.error("createThinkTankDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Save one idea card into the Directory as a note (idempotent per card). */
export async function saveCardToLibraryAction(cardId: string) {
  const { user } = await requireUser();
  try {
    const [card] = await db
      .select()
      .from(thinktankCards)
      .where(and(eq(thinktankCards.id, cardId), eq(thinktankCards.userId, user.id)))
      .limit(1);
    if (!card) return { ok: false as const, error: "Card not found" };
    if (card.savedItemId) return { ok: true as const, itemId: card.savedItemId, alreadySaved: true };

    const [deck] = await db
      .select({ topic: thinktankDecks.topic })
      .from(thinktankDecks)
      .where(eq(thinktankDecks.id, card.deckId))
      .limit(1);

    const refs =
      card.sourceRefs.length > 0
        ? `\n\n**Related in your library:**\n${card.sourceRefs.map((r) => `- [[${r.title}]]`).join("\n")}`
        : "";
    const r = await createNoteAction({
      title: card.title,
      content: `${card.body}${refs}\n\n— From ThinkTank: ${deck?.topic ?? "a deck"}`,
      folderId: null,
    });
    if (!r.ok) return { ok: false as const, error: r.error };

    await db
      .update(thinktankCards)
      .set({ savedItemId: r.itemId, updatedAt: new Date() })
      .where(eq(thinktankCards.id, card.id));
    revalidatePath("/thinktank");
    return { ok: true as const, itemId: r.itemId, alreadySaved: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't save the card";
    console.error("saveCardToLibraryAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Turn one idea card into spaced-repetition flashcards (Study deck). */
export async function makeFlashcardsFromCardAction(cardId: string) {
  const { user } = await requireUser();
  try {
    const [card] = await db
      .select({ title: thinktankCards.title, body: thinktankCards.body })
      .from(thinktankCards)
      .where(and(eq(thinktankCards.id, cardId), eq(thinktankCards.userId, user.id)))
      .limit(1);
    if (!card) return { ok: false as const, error: "Card not found" };
    return await createCardsFromTextAction({ title: card.title, text: `${card.title}\n\n${card.body}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't make flashcards";
    console.error("makeFlashcardsFromCardAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Persist the reader's resume position (fire-and-forget from the client). */
export async function setDeckPositionAction(deckId: string, position: number) {
  const { user } = await requireUser();
  const pos = Math.max(0, Math.floor(position));
  try {
    await db
      .update(thinktankDecks)
      .set({ lastPosition: pos, updatedAt: new Date() })
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)));
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function deleteDeckAction(deckId: string) {
  const { user } = await requireUser();
  try {
    await db
      .delete(thinktankDecks)
      .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)));
    revalidatePath("/thinktank");
    return { ok: true as const };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't delete the deck";
    console.error("deleteDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}
