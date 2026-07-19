"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { thinktankCards, thinktankDecks } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiAvailable } from "@/lib/ai/provider";
import { retrieveFromDirectory } from "@/lib/ai/rag";
import { generateThinkTankDeck, type ThinkTankDetail } from "@/lib/ai/thinktank";
import { awardXp } from "@/lib/gamify/award";
import { createNoteAction } from "@/app/(app)/directory/actions";
import { createCardsFromTextAction } from "@/app/(app)/review/actions";

/**
 * Start a new deck: a fast insert with status "generating", returned in well
 * under a second. The slow AI work runs in /api/thinktank/generate, which the
 * reader kicks and polls — a held-open 10–30s response was getting severed by
 * the serverless timeout and surfacing as an error even though the deck built
 * fine.
 */
export async function createThinkTankDeckAction(rawTopic: string, detail: ThinkTankDetail = "standard") {
  const topic = (rawTopic ?? "").trim().slice(0, 200);
  if (!topic) return { ok: false as const, error: "Enter a topic to learn" };
  const { user } = await requireUser();

  if (!aiAvailable() && !process.env.ANTHROPIC_API_KEY) {
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
        title: topic, // placeholder until generation writes the polished title
        status: "generating",
        title: deck.title,
        description: deck.description,
        status: "ready",
        model: deck.model,
        tokenCount: deck.tokenCount,
        detail,
      })
      .returning({ id: thinktankDecks.id });
    revalidatePath("/thinktank");
    return { ok: true as const, deckId: inserted.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Couldn't start the deck";
    console.error("createThinkTankDeckAction failed:", msg);
    return { ok: false as const, error: msg };
  }
}

/** Light status probe for the reader's generation poll. */
export async function getDeckStatusAction(deckId: string) {
  const { user } = await requireUser();
  const [row] = await db
    .select({
      status: thinktankDecks.status,
      cardCount: sql<number>`(select count(*)::int from ${thinktankCards} c where c.deck_id = ${thinktankDecks.id})`,
    })
    .from(thinktankDecks)
    .where(and(eq(thinktankDecks.id, deckId), eq(thinktankDecks.userId, user.id)))
    .limit(1);
  if (!row) return { ok: false as const };
  return { ok: true as const, status: row.status, cardCount: row.cardCount };
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

    const libraryRefs = card.sourceRefs.filter((r) => r.itemId);
    const webRefs = card.sourceRefs.filter((r) => !r.itemId && r.url);
    const refs =
      (libraryRefs.length > 0
        ? `\n\n**Related in your library:**\n${libraryRefs.map((r) => `- [[${r.title}]]`).join("\n")}`
        : "") +
      (webRefs.length > 0
        ? `\n\n**Sources:**\n${webRefs.map((r) => `- [${r.title}](${r.url})`).join("\n")}`
        : "");
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
